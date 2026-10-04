// Actual settings handler and constraints; isolated PGlite, no production traffic.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { PGlite } from '../.runtime/sharing-tests/node_modules/@electric-sql/pglite/dist/index.js';
const db = new PGlite();
let caller = '11111111-1111-4111-8111-111111111111', handler, checks = 0, failSave = false;
const member = '22222222-2222-4222-8222-222222222222';
const pass = name => { checks++; console.log('PASS '+name); };
const client = {
  auth: { getUser: async () => ({data:{user:caller?{id:caller}:null},error:null}) },
  from(table) {
    let changes=null, filters=[];
    const query={select(){return query},eq(key,value){filters.push([key,value]);return query},
      update(value){changes=value;return query}, single(){return query},maybeSingle(){return query},
      async then(resolve){
        if(changes&&failSave)return resolve({data:null,error:{code:'FIXTURE_FAILURE'}});
        try {
          const params=[];
          let sql=changes?'UPDATE '+table+' SET '+Object.entries(changes).map(([key,value])=>{params.push(value);return key+'=$'+params.length}).join(','):'SELECT * FROM '+table;
          sql+=' WHERE '+filters.map(([key,value])=>{params.push(value);return key+'=$'+params.length}).join(' AND ');
          if(changes)sql+=' RETURNING *';
          const {rows}=await db.query(sql,params);return resolve({data:rows[0]??null,error:null});
        }catch(error){return resolve({data:null,error:{code:error.code}})}
      }};
    return query;
  }
};
globalThis.__settingsClient=client;
globalThis.Deno={env:{get:()=> 'isolated-fixture'},serve:fn=>{handler=fn}};
const originalError=console.error;console.error=()=>{};
try {
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text);
    INSERT INTO auth.users VALUES('${caller}'),('${member}');
    INSERT INTO profiles VALUES('${caller}','admin'),('${member}','user');
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('audit.admin',true)='yes'$$;`);
  await db.exec(await readFile('supabase/migrations/20260907170638_add_storage_settings_table.sql','utf8'));
  await db.exec("ALTER TABLE storage_settings ADD COLUMN file_server_url text NOT NULL DEFAULT ''; GRANT SELECT,UPDATE ON storage_settings TO authenticated;");
  await db.exec(await readFile('supabase/migrations/20261004010000_configurable_video_bitrate.sql','utf8'));
  assert.equal(Number((await db.query('SELECT target_video_bitrate_mbps FROM storage_settings')).rows[0].target_video_bitrate_mbps),3);
  pass('new setting defaults to 3.0 Mbps');
  let source=await readFile('supabase/functions/storage-settings/index.ts','utf8');
  source=source.replace(/^import .*;\s*$/gm,'')+'\n';
  source='const createClient=()=>globalThis.__settingsClient;\n'+source;
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  const request=async(body,method='PUT')=>{
    const response=await handler(new Request('https://fixture.invalid/storage-settings',{method,headers:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})}));
    return {status:response.status,body:await response.json()};
  };
  assert.equal((await request(null,'GET')).body.target_video_bitrate_mbps,3);pass('Admin GET returns numeric current setting');
  await db.query("UPDATE storage_settings SET videos_base_path='videos',images_base_path='images',file_server_url='https://files.example.test';");
  for(const value of [1,2.5,3,3.5,4,4.5,3.25,15]) {
    const result=await request({target_video_bitrate_mbps:value});assert.equal(result.status,200);assert.equal(result.body.target_video_bitrate_mbps,value);
    assert.equal(result.body.videos_base_path,'videos');assert.equal(result.body.images_base_path,'images');assert.equal(result.body.file_server_url,'https://files.example.test');
    pass(value+' Mbps saved without changing storage configuration');
  }
  for(const value of [0,.99,15.01,'3',null,true,{},3.001]) {
    assert.equal((await request({target_video_bitrate_mbps:value})).status,400);
    assert.equal(Number((await db.query('SELECT target_video_bitrate_mbps FROM storage_settings')).rows[0].target_video_bitrate_mbps),15);
    pass('invalid target rejected: '+JSON.stringify(value));
  }
  assert.equal((await request({videos_base_path:'new-videos',images_base_path:'new-images',file_server_url:''})).body.target_video_bitrate_mbps,15);
  pass('existing storage save preserves video setting');
  failSave=true;assert.equal((await request({target_video_bitrate_mbps:3})).status,500);failSave=false;
  assert.equal(Number((await db.query('SELECT target_video_bitrate_mbps FROM storage_settings')).rows[0].target_video_bitrate_mbps),15);pass('failed save preserves last saved value');
  caller=member;assert.equal((await request({target_video_bitrate_mbps:3})).status,403);assert.equal((await request(null,'GET')).status,403);pass('regular users cannot read/change processing configuration');
  caller=null;assert.equal((await request({target_video_bitrate_mbps:3})).status,401);pass('anonymous settings request rejected');
  for(const sql of ["UPDATE storage_settings SET target_video_bitrate_mbps=0 WHERE id=1;","UPDATE storage_settings SET target_video_bitrate_mbps=16 WHERE id=1;","UPDATE storage_settings SET target_video_bitrate_mbps=NULL WHERE id=1;"]){await assert.rejects(db.exec(sql));}
  pass('database independently enforces range and non-null');
  await db.exec("SET ROLE authenticated; SET audit.admin='no';");
  assert.equal((await db.query('SELECT * FROM storage_settings')).rows.length,0);
  assert.equal((await db.query('UPDATE storage_settings SET target_video_bitrate_mbps=3 WHERE id=1 RETURNING id')).rows.length,0);
  await db.exec('RESET ROLE;');pass('existing RLS blocks direct regular-user settings access');
  console.log(checks+' settings API/database checks passed');
} finally {console.error=originalError;await db.close();}
