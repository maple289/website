// Real deletion/visibility RPCs in isolated PostgreSQL. Never production data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const a = randomUUID(), b = randomUUID(), stranger = randomUUID();
const sql = async (text, values) => (await db.query(text, values)).rows;
const actor = async (id, role = 'authenticated') => db.exec(`RESET ROLE; SET ROLE ${role}; SET request.jwt.claim.sub='${id}';`);
const admin = () => db.exec('RESET ROLE');
const chat = async (action, conversation = null, data = {}) => (await sql('SELECT public.messenger_rpc($1,$2,$3) AS value', [action, conversation, data]))[0].value;
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA realtime;
    GRANT USAGE ON SCHEMA auth,storage,realtime TO anon,authenticated,service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,first_name text,last_name text,email text);
    CREATE TABLE public.account_activation(user_id uuid PRIMARY KEY,active boolean,must_change_password boolean);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb,created_at timestamptz DEFAULT now());
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint);
    CREATE TABLE realtime.messages(extension text);
    CREATE TABLE realtime.audit(payload jsonb,event text,topic text,private boolean);
    CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS $$INSERT INTO realtime.audit VALUES($1,$2,$3,$4)$$;
    CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql AS $$SELECT ''::text$$;
    CREATE TABLE public.file_preview_jobs(source_id uuid,preview_path text);
    CREATE TABLE public.file_preview_cleanup(path text PRIMARY KEY);
    CREATE FUNCTION public.get_preview_source_by_id(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;`);
  for (const [id, name] of [[a,'Author'],[b,'Recipient'],[stranger,'Stranger']]) {
    await sql('INSERT INTO auth.users(id) VALUES($1)', [id]);
    await sql('INSERT INTO profiles VALUES($1,$2,NULL,$3)', [id, name, name+'@test.invalid']);
  }
  for (const name of ['20261008010000_messenger.sql','20261008030000_messenger_rpc_integrity.sql','20261008040000_messenger_scoped_deletion.sql','20261008050000_messenger_calls.sql','20261011010000_messenger_camera_state.sql','20261011020000_messenger_people.sql','20261011030000_messenger_remove_deleted_cards.sql'])
    await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  await actor(a);
  const { id: cid } = await chat('create',null,{kind:'direct',members:[b]});
  const reservation = await chat('prepare-attachment',cid,{name:'test.txt',size:5,mime:'text/plain'});
  await admin(); const source = randomUUID();
  await sql("INSERT INTO storage.objects(id,bucket_id,name,metadata) VALUES($1,'messenger-attachments',$2,'{\"size\":5,\"mimetype\":\"text/plain\"}')",[source,reservation.path]);
  await actor(a);
  const send = (text,extra={}) => chat('send',cid,{text,client_id:randomUUID(),attachments:[],...extra});
  const original = await send('Original secret text',{attachments:[reservation.id]});
  const reply = await send('Reply survives',{reply_to:original.id});
  await actor(b); await chat('react',cid,{id:original.id,reaction:'love'});
  await admin(); await db.exec('TRUNCATE realtime.audit'); await actor(b);
  await chat('delete-for-self',cid,{id:original.id});
  for (const [action,data] of [['messages',{}],['messages',{before:reply.sequence}],['since',{sequence:0}],['snapshot',{ids:[original.id,reply.id]}],['search',{query:'Original'}]])
    assert.ok((await chat(action,cid,data)).every(m=>m.id!==original.id));
  assert.equal((await chat('snapshot',cid,{ids:[reply.id]}))[0].reply.body,'This message is unavailable.');
  assert.equal((await chat('files',cid)).length,0);
  pass('self deletion excludes cards from every history/search/snapshot/pagination path; reply reference remains neutral');
  await admin();
  let events = await sql('SELECT * FROM realtime.audit');
  assert.ok(events.length>0 && events.every(e=>e.topic==='messenger:user:'+b && e.private && e.payload.kind==='hidden' && e.payload.message_id===original.id));
  assert.equal((await sql('SELECT count(*)::int n FROM messenger_storage_cleanup'))[0].n,0);
  assert.equal((await sql('SELECT count(*)::int n FROM messenger_reactions'))[0].n,1);
  await actor(a);
  assert.ok((await chat('messages',cid)).some(m=>m.id===original.id && m.reactions.length===1));
  assert.equal((await sql('SELECT messenger_attachment($1) value',[reservation.id]))[0].value.name,'test.txt');
  pass('self events target only that account; other participant retains content, reactions and attachment access; no storage deletion');
  await actor(b); await assert.rejects(chat('delete-for-everyone',cid,{id:original.id}),/own messages/);
  await actor(stranger); await assert.rejects(chat('delete-for-self',cid,{id:original.id}),/denied/);
  await assert.rejects(chat('delete-for-everyone',cid,{id:original.id}),/denied/);
  await actor('', 'anon'); await assert.rejects(chat('delete-for-everyone',cid,{id:original.id}),/permission denied/);
  pass('recipient, outsider and anonymous global deletions denied by the backend');
  await admin();
  await sql("UPDATE messenger_messages SET deletion_files=$2 WHERE id=$1",[original.id,[{path:reservation.path,previews:['derived/test-preview.pdf']}]]);
  await sql('INSERT INTO file_preview_jobs VALUES($1,$2)',[source,'derived/test-preview.pdf']);
  await db.exec('TRUNCATE realtime.audit'); await actor(a);
  await chat('delete-for-everyone',cid,{id:original.id});
  await chat('delete-for-everyone',cid,{id:original.id}); // Idempotent retry.
  for (const id of [a,b]) {
    await actor(id);
    for (const [action,data] of [['messages',{}],['messages',{before:reply.sequence}],['since',{sequence:0}],['snapshot',{ids:[original.id,reply.id]}],['search',{query:'Original'}]])
      assert.ok((await chat(action,cid,data)).every(m=>m.id!==original.id));
    assert.equal((await chat('snapshot',cid,{ids:[reply.id]}))[0].reply.body,'Original message deleted');
    assert.equal((await chat('files',cid)).length,0);
    await assert.rejects(sql('SELECT messenger_attachment($1)',[reservation.id]),/unavailable/);
    await assert.rejects(chat('react',cid,{id:original.id,reaction:'like'}),/unavailable/);
    await assert.rejects(chat('send',cid,{text:'Stale reply',reply_to:original.id,client_id:randomUUID(),attachments:[]}),/unavailable/);
  }
  pass('global deletion persists across both participants, reload and pagination; reactions/attachments/stale replies cannot be accessed');
  await admin();
  events = await sql('SELECT * FROM realtime.audit');
  assert.deepEqual(new Set(events.map(e=>e.topic)),new Set([a,b].map(id=>'messenger:user:'+id)));
  assert.ok(events.every(e=>e.private && e.payload.kind==='deleted' && e.payload.message_id===original.id));
  for (const table of ['messenger_reactions','messenger_attachments','file_preview_jobs']) assert.equal((await sql(`SELECT count(*)::int n FROM ${table}`))[0].n,0);
  assert.deepEqual((await sql('SELECT object_path FROM messenger_storage_cleanup')).map(x=>x.object_path),[reservation.path]);
  assert.deepEqual((await sql('SELECT path FROM file_preview_cleanup')).map(x=>x.path),['derived/test-preview.pdf']);
  assert.equal((await sql('SELECT count(*)::int n FROM storage.objects'))[0].n,1); // Existing worker owns physical cleanup.
  assert.equal((await sql('SELECT body FROM messenger_messages WHERE id=$1',[original.id]))[0].body,'');
  pass('private broadcasts reach every member; reactions removed; source and derived cleanup queued once; text-free tombstone retains reply ID');
  await actor(a); await chat('delete-for-everyone',cid,{id:reply.id});
  assert.equal((await chat('conversation',cid)).latest,null);
  assert.deepEqual(await chat('messages',cid),[]);
  assert.equal((await chat('inbox')).conversations[0].latest,null);
  pass('deleting the last visible message clears inbox preview and leaves no placeholder');
  await admin();
  const legacy = randomUUID();
  await sql("INSERT INTO messenger_messages(id,conversation_id,sender_id,client_id,sequence,body,deletion_started_at) VALUES($1,$2,$3,$4,3,'Legacy deletion pending',now())",[legacy,cid,a,randomUUID()]);
  await sql('UPDATE messenger_conversations SET last_sequence=3 WHERE id=$1',[cid]);
  await actor(b);
  assert.deepEqual(await chat('messages',cid),[]);
  assert.deepEqual(await chat('snapshot',cid,{ids:[legacy]}),[]);
  assert.equal((await chat('conversation',cid)).latest,null);
  await assert.rejects(chat('react',cid,{id:legacy,reaction:'like'}),/unavailable/);
  pass('historical partially deleted rows cannot render a card, inbox placeholder or reaction UI');
  console.log(`Messenger deletion: ${checks} checks passed`);
} finally { await db.close(); }
