BEGIN;
-- Shared recipients never receive Storage SELECT/signing privileges. These
-- capabilities are checked against live membership and session on EVERY fetch.
CREATE TABLE public.image_access_grants (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 object_path text NOT NULL,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour'
);
CREATE INDEX image_access_grants_expiry ON public.image_access_grants(expires_at);
ALTER TABLE public.image_access_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.image_access_grants FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.image_access_grants TO service_role;
CREATE INDEX shared_photo_original_lookup ON public.photos(storage_path);
CREATE INDEX shared_photo_preview_lookup ON public.photos(preview_path);
CREATE INDEX shared_photo_thumbnail_lookup ON public.photos(thumbnail_path);
CREATE INDEX shared_video_poster_lookup ON public.videos(preview_path);
CREATE FUNCTION public.resolve_shared_image(p_path text,p_user uuid,p_session uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH config AS (SELECT coalesce((SELECT btrim(images_base_path,'/') FROM public.storage_settings WHERE id=1),'') AS prefix),
 requested AS (SELECT CASE WHEN prefix='' THEN p_path WHEN starts_with(p_path,prefix||'/') THEN substring(p_path FROM length(prefix)+2) END AS path FROM config)
 SELECT jsonb_build_object('path',r.path,'name',r.name,'mime',r.mime) FROM requested key
 CROSS JOIN LATERAL (
   SELECT p.id,'photo'::text AS kind,key.path,p.file_name AS name,
     CASE WHEN key.path=p.storage_path THEN p.mime_type ELSE 'image/webp' END AS mime
     FROM public.photos p WHERE p.storage_path=key.path OR p.preview_path=key.path OR p.thumbnail_path=key.path
   UNION ALL SELECT v.id,'video',v.preview_path,'preview.webp','image/webp' FROM public.videos v WHERE v.preview_path=key.path
 ) r
 WHERE public.active_account(p_user) AND EXISTS(SELECT 1 FROM auth.sessions WHERE id=p_session AND user_id=p_user AND (not_after IS NULL OR not_after>now()))
   AND public.media_access_for_user(r.kind,r.id,p_user) LIMIT 1;
$$;
CREATE FUNCTION public.check_shared_image(p_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.resolve_shared_image(g.object_path,g.user_id,g.session_id)||jsonb_build_object('object_path',g.object_path)
 FROM public.image_access_grants g WHERE g.token_hash=p_hash AND g.expires_at>now();
$$;
REVOKE ALL ON FUNCTION public.resolve_shared_image(text,uuid,uuid),public.check_shared_image(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_shared_image(text,uuid,uuid),public.check_shared_image(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
