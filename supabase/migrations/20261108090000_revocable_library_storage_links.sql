-- Library-only compatibility for previously issued provider URLs. Physical
-- aliases resolve current resources; a retained copy is never permission.
BEGIN;
-- Share one file-read rule with existing RLS instead of inventing a second set
-- of folder/share semantics. Preserve the installed SQL body verbatim except
-- for replacing its ambient actor with the explicit verified actor parameter.
DO $$
DECLARE body text;
BEGIN
 SELECT prosrc INTO body FROM pg_proc WHERE oid='public.can_read_user_file(text)'::regprocedure;
 IF position('auth.uid()' IN body)=0 THEN RAISE EXCEPTION 'Unexpected file authorization contract'; END IF;
 EXECUTE 'CREATE FUNCTION streamly_internal.library_file_access(p_path text,p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''''
 AS '||quote_literal(replace(body,'auth.uid()','p_user'));
END $$;
ALTER FUNCTION streamly_internal.library_file_access(text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION streamly_internal.library_file_access(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.can_read_user_file(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT streamly_internal.library_file_access(p_path,auth.uid());
$$;

CREATE VIEW streamly_internal.library_gateway_sources AS
 SELECT m.resource_type,m.resource_id,m.owner_id,m.media_role,m.bucket_id,m.object_path,m.file_name,m.mime_type,
   m.visibility='public' AND m.ready AS public_access,m.ready
 FROM streamly_internal.library_media_objects m
 UNION ALL
 SELECT 'file',m.public_id,m.owner_id,'file',s.value->>'bucket',s.value->>'path',regexp_replace(m.object_path,'^.*/',''),
   coalesce(nullif(m.mime_type,''),'application/octet-stream'),public.resolve_public_user_file(m.public_id)=m.object_path,true
 FROM public.user_file_metadata m CROSS JOIN LATERAL (SELECT public.get_file_preview_source(m.object_path) value) s
 WHERE NOT m.is_folder AND m.trashed_at IS NULL AND s.value IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.user_file_metadata t WHERE t.owner_id=m.owner_id AND t.trashed_at IS NOT NULL
     AND (t.object_path=m.object_path OR t.is_folder AND starts_with(m.object_path,t.object_path||'/')));
ALTER VIEW streamly_internal.library_gateway_sources OWNER TO postgres;
REVOKE ALL ON streamly_internal.library_gateway_sources FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION streamly_internal.authorized_library_resource(p_type text,p_id uuid,p_role text,p_user uuid,p_session uuid,p_public_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('resource_type',s.resource_type,'resource_id',s.resource_id,'media_role',s.media_role,
   'bucket',s.bucket_id,'object_path',s.object_path,'name',s.file_name,'mime',s.mime_type,'public',coalesce(s.public_access,false))
 FROM streamly_internal.library_gateway_sources s WHERE s.resource_type=p_type AND s.resource_id=p_id AND s.media_role=p_role AND s.ready
 AND (s.public_access OR NOT p_public_only AND public.active_account(p_user) AND EXISTS(
   SELECT 1 FROM auth.sessions WHERE id=p_session AND user_id=p_user AND (not_after IS NULL OR not_after>now()))
   AND CASE WHEN s.resource_type='file' THEN streamly_internal.library_file_access(
     (SELECT object_path FROM public.user_file_metadata WHERE public_id=s.resource_id AND owner_id=s.owner_id),p_user)
     ELSE public.media_access_for_user(s.resource_type,s.resource_id,p_user) END) LIMIT 1;
$$;
ALTER FUNCTION streamly_internal.authorized_library_resource(text,uuid,text,uuid,uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION streamly_internal.authorized_library_resource(text,uuid,text,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.resolve_library_storage_link(p_bucket text,p_key text,p_user uuid DEFAULT NULL,p_session uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT streamly_internal.authorized_library_resource(s.resource_type,s.resource_id,s.media_role,p_user,p_session)
 FROM streamly_internal.library_gateway_sources s WHERE p_bucket IN ('users','user-videos','user-images','user-files')
 AND (s.bucket_id=p_bucket AND s.object_path=p_key OR EXISTS(
   SELECT 1 FROM streamly_internal.storage_migration_objects a WHERE a.resource_type=s.resource_type AND a.resource_id=s.resource_id
     AND a.owner_id=s.owner_id AND a.media_role=s.media_role AND a.old_bucket=p_bucket AND a.old_key=p_key))
 AND streamly_internal.authorized_library_resource(s.resource_type,s.resource_id,s.media_role,p_user,p_session) IS NOT NULL
 ORDER BY CASE s.media_role WHEN 'final' THEN 0 ELSE 1 END LIMIT 1;
$$;
ALTER FUNCTION public.resolve_library_storage_link(text,text,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_library_storage_link(text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_library_storage_link(text,text,uuid,uuid) TO service_role;

CREATE TABLE public.library_storage_link_grants(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 resource_type text NOT NULL CHECK(resource_type IN ('video','photo','file')),resource_id uuid NOT NULL,
 media_role text NOT NULL CHECK(media_role IN ('original','final','preview','thumbnail','file')),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '1 hour')
);
ALTER TABLE public.library_storage_link_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.library_storage_link_grants FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.library_storage_link_grants TO service_role;
CREATE INDEX library_storage_link_grants_expiry ON public.library_storage_link_grants(expires_at);
CREATE FUNCTION public.resolve_public_library_link(p_type text,p_id uuid,p_role text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT streamly_internal.authorized_library_resource(p_type,p_id,p_role,NULL,NULL,true);
$$;
ALTER FUNCTION public.resolve_public_library_link(text,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_public_library_link(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_public_library_link(text,uuid,text) TO service_role;
CREATE FUNCTION public.check_library_storage_link(p_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT streamly_internal.authorized_library_resource(g.resource_type,g.resource_id,g.media_role,g.user_id,g.session_id)
 FROM public.library_storage_link_grants g WHERE g.token_hash=p_hash AND g.expires_at>now()
 AND public.active_account(g.user_id) AND EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=g.session_id AND s.user_id=g.user_id
   AND (s.not_after IS NULL OR s.not_after>now()));
$$;
ALTER FUNCTION public.check_library_storage_link(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_library_storage_link(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_library_storage_link(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
