BEGIN;
CREATE TABLE public.video_playback_grants(
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour',
  CHECK((user_id IS NULL)=(session_id IS NULL)));
CREATE INDEX video_playback_grants_expiry ON public.video_playback_grants(expires_at);
ALTER TABLE public.video_playback_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_playback_grants FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.video_playback_grants TO service_role;
CREATE FUNCTION public.video_playback_allowed(p_video uuid,p_user uuid,p_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.videos v WHERE v.id=p_video AND v.processing_status='ready'
   AND ((p_user IS NULL AND p_session IS NULL AND v.visibility='public') OR
     (public.active_account(p_user) AND EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=p_session AND s.user_id=p_user
       AND (s.not_after IS NULL OR s.not_after>now()))
       AND (v.visibility='public' OR v.owner_id=p_user OR EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user AND role='admin')))));
$$;
CREATE FUNCTION public.check_video_playback(p_hash text,p_video uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.video_playback_grants g WHERE g.token_hash=p_hash AND g.video_id=p_video
   AND g.expires_at>now() AND public.video_playback_allowed(g.video_id,g.user_id,g.session_id));
$$;
REVOKE ALL ON FUNCTION public.video_playback_allowed(uuid,uuid,uuid),public.check_video_playback(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.video_playback_allowed(uuid,uuid,uuid),public.check_video_playback(text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
