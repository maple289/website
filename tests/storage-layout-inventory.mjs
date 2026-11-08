// Execute the operator inventory against isolated PostgreSQL, never production.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
try {
  await db.exec(`
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA streamly_internal;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,encrypted_password text);
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text,version text,owner_id text,
      metadata jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE storage_settings(id int,videos_base_path text,images_base_path text,file_server_url text);
    CREATE TABLE videos(id uuid,owner_id uuid,storage_path text,processed_storage_path text,owner_email text);
    CREATE TABLE photos(id uuid,owner_id uuid,owner_email text);
    CREATE TABLE user_file_metadata(owner_id uuid,object_path text,source_id uuid);
    CREATE TABLE media_upload_jobs(id uuid,owner_id uuid,status text,claim_token uuid,error text);
    CREATE TABLE file_preview_jobs(id uuid,error text);
    CREATE TABLE file_preview_cleanup(path text);
    CREATE TABLE file_operation_receipts(id uuid);
    CREATE TABLE media_shares(id uuid);
    CREATE TABLE user_file_shares(id uuid);
    CREATE TABLE temporary_content_shares(id uuid,token_hash text);
    CREATE TABLE image_access_grants(object_path text);
    CREATE TABLE messenger_members(conversation_id uuid,user_id uuid);
    CREATE TABLE streamly_internal.schema_migrations(version text);
    INSERT INTO auth.users VALUES('11111111-1111-4111-8111-111111111111','do-not-export-password-hashes');
    INSERT INTO storage.buckets VALUES('user-videos','user-videos',false);
    INSERT INTO storage_settings VALUES(1,'old-prefix','','do-not-export-external-configuration');
    INSERT INTO media_upload_jobs VALUES('22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111','processing','33333333-3333-4333-8333-333333333333','do-not-export-worker-error');
    INSERT INTO temporary_content_shares VALUES('44444444-4444-4444-8444-444444444444','do-not-export-token-hashes');
    INSERT INTO streamly_internal.schema_migrations VALUES('fixture');
  `);
  const before = (await db.query('SELECT to_jsonb(j) row FROM media_upload_jobs j')).rows;
  const results = await db.exec(await readFile('scripts/storage-layout-inventory.sql', 'utf8'));
  const snapshot = results.find(r => r.rows?.[0]?.jsonb_build_object)?.rows[0].jsonb_build_object;
  assert.ok(snapshot, 'SQL returns the snapshot in one read-only transaction');
  assert.deepEqual(snapshot.users, ['11111111-1111-4111-8111-111111111111']);
  assert.equal(snapshot.jobs[0].status, 'processing');
  for (const secret of ['do-not-export-password-hashes','do-not-export-external-configuration',
    '33333333-3333-4333-8333-333333333333','do-not-export-worker-error','do-not-export-token-hashes']) {
    assert.ok(!JSON.stringify(snapshot).includes(secret));
  }
  assert.deepEqual((await db.query('SELECT to_jsonb(j) row FROM media_upload_jobs j')).rows, before);
  assert.equal((await db.query('SELECT count(*)::int count FROM storage.buckets')).rows[0].count, 1);
  console.log('PASS storage inventory: PostgreSQL execution, read-only snapshot, live job preserved, credential/error fields excluded');
} finally { await db.close(); }
