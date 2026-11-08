-- Operator audit only. Run with psql -X -Atq -v ON_ERROR_STOP=1.
-- No passwords, session tokens, message bodies or mutations are collected.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
-- JSON numbers must not depend on postgres/supabase_admin role defaults.
SET LOCAL extra_float_digits = 3;
SELECT jsonb_build_object(
  'captured_at', transaction_timestamp(),
  'mode', 'read-only snapshot; filesystem can change concurrently',
  'engine', version(),
  'users', (SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM auth.users),
  'storage_settings', (SELECT to_jsonb(s)-'file_server_url' FROM public.storage_settings s WHERE id=1),
  'buckets', (SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]') FROM storage.buckets b),
  'objects', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'bucket',o.bucket_id,'name',o.name,'version',o.version,
    'owner',coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner'),
    'size',o.metadata->>'size','mime',o.metadata->>'mimetype',
    'created_at',o.created_at,'updated_at',o.updated_at) ORDER BY o.bucket_id,o.name),'[]') FROM storage.objects o),
  'videos', (SELECT coalesce(jsonb_agg(to_jsonb(v)-'owner_email' ORDER BY v.id),'[]') FROM public.videos v),
  'photos', (SELECT coalesce(jsonb_agg(to_jsonb(p)-'owner_email' ORDER BY p.id),'[]') FROM public.photos p),
  'file_metadata', (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.owner_id,f.object_path),'[]') FROM public.user_file_metadata f),
  'jobs', (SELECT coalesce(jsonb_agg(to_jsonb(j)-'claim_token'-'error' ORDER BY j.id),'[]') FROM public.media_upload_jobs j),
  'previews', (SELECT coalesce(jsonb_agg(to_jsonb(p)-'error' ORDER BY p.id),'[]') FROM public.file_preview_jobs p),
  'preview_cleanup', (SELECT coalesce(jsonb_agg(path ORDER BY path),'[]') FROM public.file_preview_cleanup),
  'file_operations', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.file_operation_receipts r),
  'media_shares', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.media_shares s),
  'file_shares', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.user_file_shares s),
  'temporary_shares', (SELECT coalesce(jsonb_agg(to_jsonb(s)-'token_hash' ORDER BY s.id),'[]') FROM public.temporary_content_shares s),
  'image_grant_paths', (SELECT coalesce(jsonb_agg(DISTINCT object_path),'[]') FROM public.image_access_grants),
  'group_membership_fingerprint', (SELECT md5(coalesce(string_agg(to_jsonb(m)::text,E'\n' ORDER BY m.conversation_id,m.user_id),'')) FROM public.messenger_members m),
  'storage_policies', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.policyname),'[]') FROM pg_catalog.pg_policies p WHERE p.schemaname='storage'),
  'path_constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,
    'definition',pg_get_constraintdef(c.oid)) ORDER BY c.conname),'[]') FROM pg_catalog.pg_constraint c
    WHERE c.connamespace='public'::regnamespace AND pg_get_constraintdef(c.oid) ~ '(storage_path|object_path|source_id|owner_id)'),
  'storage_tables', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.table_name,'column',c.column_name,'type',c.data_type)
    ORDER BY c.table_name,c.ordinal_position),'[]') FROM information_schema.columns c WHERE c.table_schema='storage'),
  'path_functions', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,
    'definition',pg_get_functiondef(p.oid)) ORDER BY p.oid::regprocedure::text),'[]') FROM pg_catalog.pg_proc p
    WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'
      AND p.prosrc ~ '(user-videos|user-images|user-files|video-previews|media-staging|processed_storage_path)'),
  'migrations', (SELECT jsonb_agg(version ORDER BY version) FROM streamly_internal.schema_migrations)
);
COMMIT;
