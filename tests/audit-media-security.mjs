// Actual migrations and playback handler; synthetic DB and in-memory bytes only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111', adminId = '22222222-2222-4222-8222-222222222222';
const videoId = '33333333-3333-4333-8333-333333333333', sessionId = '44444444-4444-4444-8444-444444444444';
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,disabled boolean DEFAULT false);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
    CREATE TABLE profiles(id uuid PRIMARY KEY,role text);
    CREATE TABLE videos(id uuid PRIMARY KEY,owner_id uuid,processing_status text,visibility text,storage_path text,processed_storage_path text,mime_type text,file_name text);
    CREATE TABLE photos(id uuid); CREATE TABLE media_upload_jobs(id uuid);
    CREATE TABLE storage.objects(bucket_id text,name text);
    CREATE TABLE storage_settings(id integer PRIMARY KEY,videos_base_path text,images_base_path text,target_video_bitrate_mbps integer DEFAULT 3);
    CREATE FUNCTION active_account(actor uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND NOT disabled)$$;
    CREATE FUNCTION claim_public_request(text,integer,integer) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
    INSERT INTO auth.users VALUES('${owner}',false),('${adminId}',false);
    INSERT INTO auth.sessions VALUES('${sessionId}','${owner}',NULL);
    INSERT INTO profiles VALUES('${owner}','user'),('${adminId}','admin');
    INSERT INTO storage_settings VALUES(1,'','',3);
    INSERT INTO videos VALUES('${videoId}','${owner}','ready','private','${owner}/original.mp4',NULL,'video/mp4','Original.mp4');`);
  await db.exec(await fs.readFile('supabase/migrations/20261012020000_guard_storage_prefix_changes.sql','utf8'));
  await db.exec(await fs.readFile('supabase/migrations/20261012030000_reauthorized_video_playback.sql','utf8'));
  await assert.rejects(db.exec("UPDATE storage_settings SET videos_base_path='changed'"), /Storage prefixes cannot change/);
  await db.exec('UPDATE storage_settings SET videos_base_path=\'\',images_base_path=\'\',target_video_bitrate_mbps=4');
  assert.equal((await db.query('SELECT target_video_bitrate_mbps n FROM storage_settings')).rows[0].n,4);
  console.log('PASS empty/unchanged storage roots and unrelated saves work; populated media prefixes cannot be changed');
  const allowed = async (user, session) => (await db.query('SELECT video_playback_allowed($1,$2,$3) okay',[videoId,user,session])).rows[0].okay;
  assert.equal(await allowed(null,null),false); assert.equal(await allowed(owner,sessionId),true);
  assert.equal(await allowed(adminId,sessionId),false);
  await db.query('UPDATE auth.sessions SET user_id=$1',[adminId]); assert.equal(await allowed(adminId,sessionId),true);
  await db.query("UPDATE profiles SET role='user' WHERE id=$1",[adminId]); assert.equal(await allowed(adminId,sessionId),false);
  await db.query("UPDATE profiles SET role='admin' WHERE id=$1",[adminId]); await db.query('UPDATE auth.sessions SET user_id=$1',[owner]);
  await db.exec("INSERT INTO video_playback_grants(token_hash,video_id,user_id,session_id) VALUES(repeat('a',64),'"+videoId+"','"+owner+"','"+sessionId+"')");
  const check = async () => (await db.query("SELECT check_video_playback(repeat('a',64),$1) okay",[videoId])).rows[0].okay;
  assert.equal(await check(),true);
  await db.query('UPDATE auth.users SET disabled=true WHERE id=$1',[owner]); assert.equal(await check(),false);
  await db.query('UPDATE auth.users SET disabled=false WHERE id=$1',[owner]);
  await db.query("UPDATE auth.sessions SET not_after=now()-interval '1 second'"); assert.equal(await check(),false);
  await db.query('UPDATE auth.sessions SET not_after=NULL');
  await db.exec('DELETE FROM auth.sessions'); assert.equal(await check(),false);
  await db.query('INSERT INTO auth.sessions VALUES($1,$2,NULL)',[sessionId,owner]);
  await db.exec("UPDATE video_playback_grants SET expires_at=now()-interval '1 second'"); assert.equal(await check(),false);
  await db.exec("UPDATE videos SET visibility='public'"); assert.equal(await allowed(null,null),true);
  await db.exec("INSERT INTO video_playback_grants(token_hash,video_id) VALUES(repeat('b',64),'"+videoId+"')");
  await db.exec("UPDATE videos SET visibility='private'");
  assert.equal((await db.query("SELECT check_video_playback(repeat('b',64),$1) okay",[videoId])).rows[0].okay,false);
  console.log('PASS owner/admin/session identity, disablement, logout, expiry and public-to-private revocation checked on every request');
  let handler, streamRequests=0;
  const client = {
    auth:{getUser:async()=>({data:{user:{id:owner}},error:null})},
    async rpc(name,args) { const keys={video_playback_allowed:['p_video','p_user','p_session'],check_video_playback:['p_hash','p_video'],claim_public_request:['p_bucket','p_seconds','p_limit']}[name];
      return {data:(await db.query(`SELECT ${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) okay`,keys.map(k=>args[k]))).rows[0].okay,error:null}; },
    from(table) {
      const filters=[]; let action='select', values;
      const b={select(){return b;},eq(k,v){filters.push([k,v]);return b;},maybeSingle(){return b;},insert(v){action='insert';values=v;return b;},delete(){action='delete';return b;},lt(){return b;},async then(resolve){
        let rows=[];
        if(action==='select')rows=(await db.query('SELECT * FROM '+table+' WHERE '+filters.map(([k],i)=>k+'=$'+(i+1)).join(' AND '),filters.map(([,v])=>v))).rows;
        if(action==='insert'){const keys=Object.keys(values);await db.query('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(values));}
        resolve({data:rows[0]??null,error:null});}};return b;
    }
  };
  const source=(await fs.readFile('supabase/functions/serve-media/index.ts','utf8')).replace(/^import .*;\r?\n/gm,'');
  const upstream=async(url,options)=>{streamRequests++; assert.match(url,/\/storage\/v1\/object\/authenticated\/user-videos\//);assert.equal(options.headers.Range,'bytes=0-3');return new Response('test',{status:206,headers:{'Content-Range':'bytes 0-3/8','Accept-Ranges':'bytes','Content-Length':'4'}});};
  new Function('Deno','createClient','fetch',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText)(
    {env:{get:name=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'})[name]},serve:fn=>handler=fn},()=>client,upstream);
  const jwt='e30.'+Buffer.from(JSON.stringify({session_id:sessionId})).toString('base64url')+'.fixture';
  const issue=await handler(new Request('https://fixture.invalid/functions/v1/serve-media?id='+videoId,{headers:{Authorization:'Bearer '+jwt}}));
  assert.equal(issue.status,200); const grant=await issue.json();assert.equal(grant.url.includes('/object/sign/'),false);
  const bytes=await handler(new Request(grant.url,{headers:{Range:'bytes=0-3'}}));assert.equal(bytes.status,206);assert.equal(await bytes.text(),'test');assert.equal(bytes.headers.get('Content-Range'),'bytes 0-3/8');assert.match(bytes.headers.get('Cache-Control'),/no-store/);
  await db.query('UPDATE auth.users SET disabled=true WHERE id=$1',[owner]);assert.equal((await handler(new Request(grant.url))).status,403);assert.equal(streamRequests,1);
  await db.exec('DELETE FROM videos');assert.equal((await handler(new Request(grant.url))).status,404);
  assert.equal((await db.query('SELECT * FROM video_playback_grants')).rows.length,0);
  console.log('PASS actual Edge handler streams authorized ranges without Storage capabilities; disabled/deleted content never reaches byte storage');
} finally { await db.close(); }
