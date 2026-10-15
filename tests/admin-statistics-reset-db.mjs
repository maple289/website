// Actual analytics migrations/RPCs in isolated PostgreSQL; no live configuration.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const admin = '11111111-1111-4111-8111-111111111111', member = '22222222-2222-4222-8222-222222222222';
const video = '33333333-3333-4333-8333-333333333333', photo = '44444444-4444-4444-8444-444444444444', file = '55555555-5555-4555-8555-555555555555';
const query = async (sql, params) => (await db.query(sql, params)).rows;
const actor = async (id, role = 'authenticated') => {
  await db.exec('RESET ROLE');
  await query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('SET ROLE ' + role);
};
const dashboard = async (section = 'overview', extra = '') => (await query(`SELECT admin_analytics(p_section=>$1,p_from=>now()-interval '30 days',p_to=>now()+interval '1 day'${extra}) data`, [section]))[0].data;
const reset = async () => (await query('SELECT admin_reset_statistics() data'))[0].data;
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz,last_sign_in_at timestamptz);
    CREATE TABLE profiles(id uuid PRIMARY KEY REFERENCES auth.users,role text,email text,first_name text,last_name text,created_at timestamptz DEFAULT now());
    CREATE TABLE account_activation(user_id uuid PRIMARY KEY,active boolean DEFAULT true,must_change_password boolean DEFAULT false);
    CREATE FUNCTION is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin')$$;
    CREATE TABLE videos(id uuid PRIMARY KEY,owner_id uuid,file_name text,created_at timestamptz DEFAULT now()-interval '1 day',file_size bigint DEFAULT 10,
      processed_file_size bigint DEFAULT 8,duration_seconds double precision,resolution_width integer,resolution_height integer,
      visibility text DEFAULT 'public',mime_type text DEFAULT 'video/mp4',processing_status text DEFAULT 'ready',storage_path text,processed_storage_path text,preview_path text);
    CREATE TABLE photos(id uuid PRIMARY KEY,owner_id uuid,file_name text,created_at timestamptz DEFAULT now()-interval '1 day',file_size bigint DEFAULT 10,
      visibility text DEFAULT 'public',mime_type text DEFAULT 'image/jpeg',storage_path text,preview_path text,thumbnail_path text);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text,metadata jsonb DEFAULT '{"size":10}',created_at timestamptz DEFAULT now()-interval '1 day');
    CREATE TABLE media_upload_jobs(id uuid PRIMARY KEY,kind text,status text,owner_id uuid,finished_at timestamptz,result jsonb);
    CREATE TABLE user_file_metadata(public_id uuid UNIQUE DEFAULT gen_random_uuid(),owner_id uuid,object_path text,is_folder boolean DEFAULT false,
      trashed_at timestamptz,file_size bigint DEFAULT 10,mime_type text,PRIMARY KEY(owner_id,object_path));
    CREATE TABLE user_file_shares(owner_id uuid,object_path text,recipient_id uuid);
    CREATE TABLE media_reactions(media_type text,media_id uuid,user_id uuid,reaction text);
    CREATE TABLE storage_settings(id integer PRIMARY KEY,videos_base_path text,images_base_path text,updated_by uuid);
    CREATE TABLE messages(id uuid PRIMARY KEY,body text);
    CREATE TABLE conversations(id uuid PRIMARY KEY);
    CREATE TABLE previews(id uuid PRIMARY KEY,path text);
    CREATE FUNCTION can_access_reaction_media(text,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
    CREATE FUNCTION can_read_user_file(text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
    CREATE FUNCTION public_file_root(text) RETURNS text LANGUAGE sql AS $$SELECT NULL::text$$;
    CREATE FUNCTION resolve_public_user_file(uuid) RETURNS text LANGUAGE sql AS $$SELECT object_path FROM public.user_file_metadata WHERE public_id=$1$$;
    INSERT INTO auth.users(id,last_sign_in_at) VALUES('${admin}',now()),('${member}',now());
    INSERT INTO profiles(id,role,email) VALUES('${admin}','admin','admin@example.test'),('${member}','user','member@example.test');
    INSERT INTO videos(id,owner_id,file_name,storage_path,preview_path) VALUES('${video}','${member}','Video','original.mp4','preview.webp');
    INSERT INTO photos(id,owner_id,file_name,storage_path,thumbnail_path) VALUES('${photo}','${member}','Photo','original.jpg','thumb.webp');
    INSERT INTO storage.objects(id,bucket_id,name) VALUES('${file}','user-files','${member}/file.txt');
    INSERT INTO user_file_metadata(owner_id,object_path) VALUES('${member}','${member}/file.txt');
    INSERT INTO user_file_shares VALUES('${member}','${member}/file.txt','${admin}');
    INSERT INTO media_reactions VALUES('video','${video}','${admin}','like');
    INSERT INTO media_upload_jobs VALUES('${video}','video','complete','${member}',now()-interval '1 day','{"id":"${video}"}');
    INSERT INTO messages VALUES(gen_random_uuid(),'Retained message');
    INSERT INTO conversations VALUES(gen_random_uuid());
    INSERT INTO previews VALUES(gen_random_uuid(),'retained-preview.webp');`);
  for (const migration of ['20261002000000_admin_analytics.sql','20261002010000_admin_analytics_api.sql','20261003000000_user_analytics.sql','20261003010000_safe_analytics_cache_invalidation.sql','20261015010000_admin_statistics_reset.sql']) {
    await db.exec(await readFile('supabase/migrations/' + migration, 'utf8'));
  }
  pass('forward migration applies over existing admin and personal analytics');
  await actor('', 'anon');
  for (const [kind, action, id] of [['video','view',video],['photo','view',photo],['file','preview',file],['file','download',file]]) {
    // File requests require an authenticated owner unless a public ID is used.
    await actor(kind === 'file' ? member : '', kind === 'file' ? 'authenticated' : 'anon');
    await query('SELECT analytics_record($1,$2,gen_random_uuid(),$3)', [kind, action, id]);
  }
  await actor(admin);
  const before = await dashboard();
  assert.equal(before.overview.video_views,1); assert.equal(before.overview.photo_views,1);
  assert.equal(before.top.file[0].value,2);
  assert.ok((await dashboard('activity')).total >= 4);
  assert.ok(before.statistics_since);
  pass('initial baseline preserves pre-existing counters, rankings and activity');

  // Snapshot all retained content/raw statistics, including uploads and shares.
  const retained = ['auth.users','profiles','videos','photos','storage.objects','media_upload_jobs','user_file_metadata','user_file_shares','media_reactions','messages','conversations','previews','analytics_content','analytics_events','analytics_viewers','analytics_user_activity'];
  const snapshot = async () => {
    await db.exec('RESET ROLE');
    return Promise.all(retained.map(async table => (await query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') data FROM ${table} t`))[0].data));
  };
  const contentBefore = await snapshot();
  const historyBefore = (await query('SELECT to_jsonb(a) data FROM analytics_activity a ORDER BY id')).map(r => r.data);
  await actor(member);
  await assert.rejects(reset(), /Administrator access required/);
  await assert.rejects(dashboard(), /Administrator access required/);
  await assert.rejects(query('UPDATE analytics_config SET statistics_reset_at=now() WHERE id=true'), /permission denied/);
  await assert.rejects(query('SELECT * FROM analytics_admin_catalog'), /permission denied/);
  await actor('', 'anon'); await assert.rejects(reset(), /permission denied/);
  await actor(''); await assert.rejects(reset(), /Administrator access required/);
  pass('ordinary users, anonymous callers and missing identity cannot reset or write the baseline');

  await db.exec(`RESET ROLE; UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${admin}';`);
  await actor(admin); await assert.rejects(reset(), /Active administrator/);
  await db.exec(`RESET ROLE; UPDATE auth.users SET banned_until=NULL WHERE id='${admin}';
    INSERT INTO account_activation VALUES('${admin}',false,false);`);
  await actor(admin); await assert.rejects(reset(), /Active administrator/);
  await db.exec(`RESET ROLE; UPDATE account_activation SET active=true,must_change_password=true WHERE user_id='${admin}';`);
  await actor(admin); await assert.rejects(reset(), /Active administrator/);
  await db.exec(`RESET ROLE; DELETE FROM account_activation WHERE user_id='${admin}';`);
  pass('disabled, banned and password-setup administrators are rejected server-side');

  await db.exec(`CREATE FUNCTION fail_reset_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='statistics_reset' THEN RAISE EXCEPTION 'Fixture audit failure'; END IF; RETURN NEW; END$$;
    CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON analytics_activity FOR EACH ROW EXECUTE FUNCTION fail_reset_audit();`);
  await actor(admin); await assert.rejects(reset(), /Fixture audit failure/);
  assert.deepEqual((await dashboard()).top,before.top);
  await db.exec('RESET ROLE');
  assert.equal((await query('SELECT statistics_reset_at FROM analytics_config'))[0].statistics_reset_at,null);
  assert.equal((await query("SELECT count(*)::int n FROM analytics_activity WHERE action='statistics_reset'"))[0].n,0);
  await db.exec('DROP TRIGGER fixture_audit_failure ON analytics_activity');
  pass('audit failure rolls back the entire reset; baseline, cached reports and history remain unchanged');

  await actor(admin);
  const baseline = (await reset()).statistics_since;
  const after = await dashboard();
  assert.equal(after.statistics_since,baseline);
  assert.deepEqual(after.top,{video:[],photo:[],file:[]});
  for (const key of ['video_views','photo_views','file_previews','file_downloads','uploads_today','uploads_week','uploads_month','active_users']) assert.equal(after.overview[key],0,key);
  assert.ok(after.series.every(row => Object.entries(row).every(([key,value]) => key==='date' || value===0)));
  assert.equal((await dashboard('activity')).total,0);
  assert.deepEqual((await dashboard('activity')).rows,[]);
  assert.equal(after.overview.users,before.overview.users);
  for (const key of ['videos','photos','files']) assert.equal(after.overview[key],before.overview[key]);
  for (const section of ['videos','photos','files']) {
    const records=await dashboard(section);
    assert.equal(records.total,1);
    for (const key of ['views','previews','downloads','unique_viewers']) assert.equal(records.rows[0][key],0);
    assert.equal(records.rows[0].last_viewed_at,null); assert.equal(records.rows[0].last_accessed_at,null);
  }
  assert.ok((await dashboard('users')).rows.every(row=>row.views===0 && row.uploads===0));
  assert.deepEqual((await dashboard('user',`,p_owner=>'${member}'`)).top,after.top);
  pass('all admin counters/rankings/charts and activity reset together, including tables and per-user drilldowns');

  assert.deepEqual(await snapshot(),contentBefore);
  const historyAfter = (await query('SELECT to_jsonb(a) data FROM analytics_activity a ORDER BY id')).map(r=>r.data);
  assert.deepEqual(historyAfter.slice(0,historyBefore.length),historyBefore);
  assert.equal(historyAfter.at(-1).actor_id,admin); assert.equal(historyAfter.at(-1).action,'statistics_reset');
  assert.equal(historyAfter.at(-1).occurred_at,baseline);
  await actor(member);
  const personal=(await query('SELECT user_analytics() data'))[0].data;
  assert.equal(personal.overview.video_views,1);
  pass('content, stored objects, lifetime counters and raw events unchanged; private actor/time audit retained and personal reports preserved');

  await actor(admin);
  await query('SELECT analytics_record($1,$2,gen_random_uuid(),$3)', ['video','view',video]);
  await query('SELECT analytics_record($1,$2,gen_random_uuid(),$3)', ['file','preview',file]);
  await db.exec('RESET ROLE');
  // Equality belongs to the new window, including registered viewers.
  await query(`INSERT INTO analytics_events(request_id,content_type,content_id,actor_id,action,occurred_at)
    VALUES(gen_random_uuid(),'photo',$1,$2,'view',$3)`,[photo,member,baseline]);
  await query(`INSERT INTO analytics_activity(actor_id,action,occurred_at) VALUES($1,'login',$2)`,[member,baseline]);
  await query(`INSERT INTO photos(id,owner_id,file_name,created_at) VALUES(gen_random_uuid(),$1,'New upload',clock_timestamp())`,[member]);
  await db.exec("UPDATE analytics_cache SET expires_at=now()-interval '1 second' WHERE key IS NOT NULL;");
  await actor(admin);
  const fresh=await dashboard();
  assert.equal(fresh.overview.video_views,1); assert.equal(fresh.overview.photo_views,1); assert.equal(fresh.overview.file_previews,1);
  assert.equal(fresh.top.video[0].value,1); assert.equal(fresh.top.file[0].value,1);
  assert.equal((await dashboard('photos')).rows.find(row=>row.content_id===photo).unique_viewers,1);
  assert.equal((await dashboard('activity')).total,4);
  assert.equal(fresh.series.reduce((n,row)=>n+row.video_views,0),1);
  assert.equal(fresh.series.reduce((n,row)=>n+row.photo_uploads,0),1);
  assert.equal(fresh.overview.uploads_today,1);
  assert.equal(fresh.overview.uploads_week,1);
  assert.equal(fresh.overview.uploads_month,1);
  pass('new real views/previews/uploads and activity count normally; exact baseline boundary included');

  const second=(await reset()).statistics_since;
  assert.ok(new Date(second)>=new Date(baseline));
  assert.deepEqual((await dashboard()).top,{video:[],photo:[],file:[]});
  assert.equal((await dashboard('activity')).total,0);
  await db.exec('RESET ROLE');
  assert.equal((await query('SELECT count(*)::int n FROM analytics_events'))[0].n,7);
  assert.equal((await query("SELECT count(*)::int n FROM analytics_activity WHERE action='statistics_reset'"))[0].n,2);
  pass('repeated resets use fresh cache windows and preserve all previous events/audits');
  console.log(checks+' admin statistics PostgreSQL checks passed');
} finally { await db.close(); }
