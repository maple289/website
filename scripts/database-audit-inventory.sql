-- Read-only schema and consistency snapshot. No passwords, tokens or email bodies.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
-- Stable deparsing across postgres/supabase_admin and role-specific defaults.
SET LOCAL search_path = '';
SELECT jsonb_build_object(
  'engine', version(),
  'tables', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.schema, t.name) FROM (
    SELECT n.nspname AS schema, c.relname AS name, c.relrowsecurity AS rls,
      (SELECT jsonb_agg(jsonb_build_object('name', a.attname,
        'type', format_type(a.atttypid,a.atttypmod), 'nullable', NOT a.attnotnull,
        'default', pg_get_expr(d.adbin,d.adrelid), 'generated', a.attgenerated)
        ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d
        ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','auth','storage','streamly_internal')
  ) t),
  'constraints', (SELECT jsonb_agg(to_jsonb(t)) FROM (
    SELECT n.nspname AS schema, r.relname AS table_name, c.conname AS name,
      c.contype AS type, c.convalidated AS validated, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname IN ('public','auth','storage') ORDER BY 1,2,3
  ) t),
  'foreign_keys', (SELECT jsonb_agg(to_jsonb(t)) FROM (
    SELECT n.nspname AS schema, r.relname AS table_name, c.conname AS name,
      pn.nspname AS parent_schema, p.relname AS parent_table,
      ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num,pos)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.pos) AS columns,
      ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num,pos)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.pos) AS parent_columns
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace JOIN pg_class p ON p.oid=c.confrelid
    JOIN pg_namespace pn ON pn.oid=p.relnamespace
    WHERE c.contype='f' AND n.nspname IN ('public','auth','storage')
  ) t),
  'indexes', (SELECT jsonb_agg(to_jsonb(t)) FROM (
    SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes
    WHERE schemaname IN ('public','auth','storage') ORDER BY 1,2,3
  ) t),
  'policies', (SELECT jsonb_agg(to_jsonb(t)) FROM (
    SELECT * FROM pg_policies WHERE schemaname IN ('public','auth','storage') ORDER BY schemaname,tablename,policyname
  ) t),
  'triggers', (SELECT jsonb_agg(to_jsonb(t)) FROM (
    SELECT n.nspname AS schema,c.relname AS table_name,t.tgname AS name,
      t.tgenabled AS enabled,pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname IN ('public','auth','storage') ORDER BY 1,2,3
  ) t),
  'functions', (SELECT jsonb_agg(to_jsonb(t)) FROM (
    SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments,
      p.prosecdef AS security_definer,p.proconfig AS settings,
      has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1,2
  ) t),
  'migrations', (SELECT jsonb_agg(version ORDER BY version) FROM streamly_internal.schema_migrations),
  'objects', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket',bucket_id,'name',name,
    'version',version,'size',metadata->>'size','updated_at',updated_at,
    'preview_version',coalesce(version,'')||':'||updated_at::text)), '[]') FROM storage.objects
    WHERE bucket_id IN ('user-videos','user-images','user-files','media-staging','file-previews')),
  'videos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'owner',owner_id,'name',file_name,
    'storage_path',storage_path,'processed_storage_path',processed_storage_path,'preview_path',preview_path,
    'status',processing_status,'created_at',created_at)), '[]') FROM public.videos),
  'photos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'owner',owner_id,'name',file_name,
    'storage_path',storage_path,'preview_path',preview_path,'thumbnail_path',thumbnail_path)), '[]') FROM public.photos),
  'file_metadata', (SELECT coalesce(jsonb_agg(jsonb_build_object('owner',owner_id,'path',object_path,
    'is_folder',is_folder,'trashed_at',trashed_at)), '[]') FROM public.user_file_metadata),
  'jobs', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'owner',owner_id,'kind',kind,
    'target',target_video_id,'status',status,'started_at',started_at,'created_at',created_at)), '[]') FROM public.media_upload_jobs),
  'previews', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'source_id',source_id,
    'path',object_path,'source_version',source_version,'preview_path',preview_path,'status',status,
    'started_at',started_at)), '[]') FROM public.file_preview_jobs),
  'users', (SELECT coalesce(jsonb_agg(id), '[]') FROM auth.users),
  'storage_settings', (SELECT jsonb_build_object('videos_base_path',videos_base_path,'images_base_path',images_base_path)
    FROM public.storage_settings WHERE id=1),
  'checks', jsonb_build_object(
    'duplicate_auth_emails',(SELECT count(*) FROM (SELECT lower(email) FROM auth.users
      WHERE email IS NOT NULL AND NOT is_sso_user GROUP BY lower(email) HAVING count(*)>1) t),
    'profile_email_mismatches',(SELECT count(*) FROM public.profiles p JOIN auth.users u ON u.id=p.id
      WHERE lower(p.email) IS DISTINCT FROM lower(u.email)),
    'missing_profiles',(SELECT count(*) FROM auth.users u WHERE NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=u.id)),
    'activation_password_mismatches',(SELECT count(*) FROM public.account_activation a JOIN auth.users u ON u.id=a.user_id
      WHERE a.must_change_password IS DISTINCT FROM (coalesce(u.encrypted_password,'')='')),
    'pending_statuses',(SELECT jsonb_object_agg(status,total) FROM (SELECT status,count(*) total FROM public.pending_registrations GROUP BY status) t),
    'negative_counters',(SELECT count(*) FROM public.analytics_content WHERE views<0 OR previews<0 OR downloads<0),
    'view_counter_mismatches',(SELECT count(*) FROM public.analytics_content c WHERE c.views IS DISTINCT FROM
      (SELECT count(*) FROM public.analytics_events e WHERE e.content_type=c.content_type AND e.content_id=c.content_id AND e.action='view')),
    'download_counter_mismatches',(SELECT count(*) FROM public.analytics_content c WHERE c.downloads IS DISTINCT FROM
      (SELECT count(*) FROM public.analytics_events e WHERE e.content_type=c.content_type AND e.content_id=c.content_id AND e.action='download')),
    'preview_counter_mismatches',(SELECT count(*) FROM public.analytics_content c WHERE c.previews IS DISTINCT FROM
      (SELECT count(*) FROM public.analytics_events e WHERE e.content_type=c.content_type AND e.content_id=c.content_id AND e.action='preview')),
    'missing_video_analytics',(SELECT count(*) FROM public.videos v WHERE NOT EXISTS(SELECT 1 FROM public.analytics_content c WHERE c.video_id=v.id)),
    'missing_photo_analytics',(SELECT count(*) FROM public.photos p WHERE NOT EXISTS(SELECT 1 FROM public.analytics_content c WHERE c.photo_id=p.id))
  )
);
COMMIT;
