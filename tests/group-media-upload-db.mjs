// Real queue, publication and group-upload migrations in an isolated database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite(), owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const family = randomUUID(), work = randomUUID();
const sql = async (text, args) => (await db.query(text, args)).rows;
const root = () => db.exec('RESET ROLE');
const service = () => db.exec('RESET ROLE; SET ROLE service_role');
const migration = async name => db.exec(await readFile('supabase/migrations/' + name, 'utf8'));
let handler, lastError, calls = [];
const queue = async (kind, group = family, extra = {}) => {
 const id = extra.id ?? randomUUID();
 await root(); await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('media-staging',$1,'{\"size\":10}') ON CONFLICT DO NOTHING", [owner + '/' + id + '/source']);
 return handler(new Request('https://fixture.invalid/functions/v1/queue-media-upload', { method: 'POST', headers: { Authorization: 'Bearer verified-fixture' }, body: JSON.stringify({ id, kind, file_name: 'Upload ' + id, visibility: 'private', group_id: group, ...extra }) }));
};
const prepare = async (id, kind) => {
 await root(); const claim = randomUUID(), name = (await sql('SELECT file_name FROM media_upload_jobs WHERE id=$1', [id]))[0].file_name;
 await sql("UPDATE media_upload_jobs SET status='processing',claim_token=$2,started_at=now() WHERE id=$1", [id, claim]);
 const path = owner + '/' + (kind === 'video' ? 'videos' : 'photos') + '/' + id;
 const record = { id, owner_id: owner, file_name: name, visibility: 'private', storage_path: path + '/original.' + (kind === 'video' ? 'mp4' : 'jpg'), preview_path: kind === 'video' ? owner + '/video-previews/' + id + '/preview.webp' : path + '/preview.webp', thumbnail_path: path + '/thumbnail.webp', processed_storage_path: path + '/stream.mp4', processing_status: 'ready' };
 for (const [bucket, name] of [[kind === 'video' ? 'user-videos' : 'user-images', record.storage_path], [kind === 'video' ? 'user-videos' : 'user-images', kind === 'video' ? record.processed_storage_path : record.thumbnail_path], ['user-images', record.preview_path]]) await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES($1,$2,'{\"size\":10}')", [bucket, name]);
 return () => { return service().then(() => sql('SELECT publish_media_upload($1,$2,$3) value', [id, claim, record])); };
};
try {
 await db.exec(await readFile('tests/media-upload-setup.sql', 'utf8'));
 await db.exec(`ALTER TABLE storage.objects ADD COLUMN metadata jsonb;
 CREATE TABLE storage_settings(id int PRIMARY KEY,videos_base_path text,images_base_path text); INSERT INTO storage_settings VALUES(1,'','');
 ALTER TABLE videos ADD COLUMN owner_email text, ADD COLUMN file_size bigint, ADD COLUMN mime_type text, ADD COLUMN processed_storage_path text,
 ADD COLUMN container_format text, ADD COLUMN video_codec text, ADD COLUMN video_bitrate bigint, ADD COLUMN frame_rate numeric, ADD COLUMN source_metadata jsonb,
 ADD COLUMN processing_action text, ADD COLUMN audio_codec text, ADD COLUMN audio_bitrate bigint, ADD COLUMN processed_file_size bigint,
 ADD COLUMN resolution_width int, ADD COLUMN resolution_height int, ADD COLUMN duration_seconds numeric;
 ALTER TABLE photos ADD COLUMN owner_email text, ADD COLUMN file_size bigint, ADD COLUMN mime_type text, ADD COLUMN preview_path text, ADD COLUMN thumbnail_path text, ADD COLUMN width int, ADD COLUMN height int;
 CREATE FUNCTION active_account(uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=$1) AND NOT EXISTS(SELECT 1 FROM public.account_activation WHERE user_id=$1 AND (NOT active OR must_change_password))$$;
 CREATE TABLE messenger_conversations(id uuid PRIMARY KEY,kind text,name text);
 CREATE TABLE messenger_members(conversation_id uuid REFERENCES messenger_conversations ON DELETE CASCADE,user_id uuid,PRIMARY KEY(conversation_id,user_id));`);
 await migration('20260928090000_validated_media_uploads.sql');
 await migration('20261003140000_media_job_integrity.sql');
 const sharing = await readFile('supabase/migrations/20261019010000_messenger_group_sharing.sql', 'utf8');
 assert.ok(sharing.includes('CREATE FUNCTION public.media_access_for_user'));
 await db.exec(sharing.split('CREATE FUNCTION public.media_access_for_user')[0] + '\nCOMMIT;');
 await migration('20261019030000_media_group_filter.sql');
 await migration('20261019040000_group_media_uploads.sql');
 await sql("INSERT INTO messenger_conversations VALUES($1,'group','Family'),($2,'group','Work')", [family, work]);
 await sql('INSERT INTO messenger_members VALUES($1,$2),($3,$4)', [family, owner, work, other]);
 const client = { auth: { getUser: async token => ({ data: { user: token === 'verified-fixture' ? { id: owner } : null }, error: null }) }, rpc: async (name, args) => {
  calls.push({ name, args }); await service();
  const keys = name === 'queue_group_media_upload' ? ['p_id','p_owner','p_kind','p_name','p_group','p_preview'] : ['p_id','p_owner','p_kind','p_name','p_visibility','p_preview','p_video'];
  try { return { data: (await sql(`SELECT ${name}(${keys.map((_, i) => '$' + (i + 1))}) value`, keys.map(key => args[key])))[0].value, error: null }; }
  catch (error) { lastError=error.message; return { data: null, error }; }
 }};
 const source = (await readFile('supabase/functions/queue-media-upload/index.ts','utf8')).replace(/^import .*;\r?\n/gm,'');
 new Function('Deno','createClient','console',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText)(
  { env: { get: () => 'isolated' }, serve: fn => handler = fn }, () => client, { error() {} });
 for (const kind of ['video','photo']) {
  const response = await queue(kind, family, { owner_id: other, userId: other }); assert.equal(response.status,202,lastError); const { id } = await response.json();
  assert.equal(calls.at(-1).args.p_owner,owner,'body cannot choose owner');
  assert.equal((await sql('SELECT upload_group_id FROM media_upload_jobs WHERE id=$1',[id]))[0].upload_group_id,family);
  assert.equal((await queue(kind,family,{id})).status,202,'same queue retry is idempotent');
  assert.equal((await queue(kind,work,{id})).status,409,'cannot retarget queued upload');
  const publish = await prepare(id,kind); await publish(); await publish();
  assert.deepEqual((await sql('SELECT media_type,group_id,created_by FROM media_shares WHERE media_id=$1',[id])),[{media_type:kind,group_id:family,created_by:owner}]);
  await root(); assert.equal((await sql(`SELECT owner_id,visibility FROM ${kind==='video'?'videos':'photos'} WHERE id=$1`,[id]))[0].owner_id,owner);
 }
 console.log('PASS actual queue handler derives owner, saves private group intent, retries idempotently; real video/photo publisher creates exactly one group grant atomically');
 for(const [group,extra] of [[work,{}],[family,{kind:'preview',target_video_id:randomUUID()}],[family,{visibility:'public'}],[randomUUID(),{}],['invalid',{}]]) assert.ok((await queue('video',group,extra)).status>=400);
 const before=calls.length; assert.equal((await handler(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer forged'},body:'{}'}))).status,401);assert.equal(calls.length,before);
 await root();await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}'`);
 await assert.rejects(sql('SELECT queue_group_media_upload($1,$2,$3,$4,$5)',[randomUUID(),owner,'video','Forged',family]),/permission denied/);
 await assert.rejects(sql('UPDATE media_upload_jobs SET upload_group_id=$1',[work]),/permission denied/);
 console.log('PASS anonymous/forged, nonmember, invalid group, public group upload and preview group target denied; browser cannot call privileged queue or edit job destination');
 const response=await queue('photo'),id=(await response.json()).id,publish=await prepare(id,'photo');
 await root();await sql('DELETE FROM messenger_members WHERE conversation_id=$1 AND user_id=$2',[family,owner]);
 await assert.rejects(publish(),/current membership/);
 assert.equal((await sql('SELECT count(*)::int n FROM photos WHERE id=$1',[id]))[0].n,0);
 assert.equal((await sql('SELECT status FROM media_upload_jobs WHERE id=$1',[id]))[0].status,'processing');
 await root();await sql('INSERT INTO messenger_members VALUES($1,$2)',[family,owner]);await publish();
 console.log('PASS membership revoked during processing rolls back publication and grant; rejoining permits safe retry');
 const r2=await queue('video'),id2=(await r2.json()).id,publish2=await prepare(id2,'video');
 await root();await db.exec("CREATE FUNCTION fixture_share_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF current_setting('fixture.fail_share',true)='yes' THEN RAISE EXCEPTION 'Fixture share failure'; END IF;RETURN NEW;END$$; CREATE TRIGGER fixture_share_failure BEFORE INSERT ON media_shares FOR EACH ROW EXECUTE FUNCTION fixture_share_failure(); SET fixture.fail_share='yes';");
 await assert.rejects(publish2(),/Fixture share failure/);
 assert.equal((await sql('SELECT count(*)::int n FROM videos WHERE id=$1',[id2]))[0].n,0);
 await root();await db.exec("SET fixture.fail_share='no'");await publish2();
 const r3=await queue('photo'),id3=(await r3.json()).id,publish3=await prepare(id3,'photo');
 await root();await sql('DELETE FROM messenger_conversations WHERE id=$1',[family]);await assert.rejects(publish3(),/current membership/);
 assert.equal((await sql('SELECT count(*)::int n FROM photos WHERE id=$1',[id3]))[0].n,0);
 assert.equal((await sql('SELECT count(*)::int n FROM videos WHERE id=$1',[id2]))[0].n,1,'deleting group must preserve completed original');
 console.log('PASS grant insertion failure rolls back media and completion; deleted group fails pending publication and preserves completed originals');
 const ordinary=await queue('video',null),ordinaryId=(await ordinary.json()).id;assert.equal(ordinary.status,202);assert.equal(calls.at(-1).name,'queue_media_upload');
 const publishOrdinary=await prepare(ordinaryId,'video');await publishOrdinary();assert.equal((await sql('SELECT count(*)::int n FROM media_shares WHERE media_id=$1',[ordinaryId]))[0].n,0);
 console.log('PASS ordinary personal uploads retain the original queue/publication path without group grants');
} finally { await db.close(); }
