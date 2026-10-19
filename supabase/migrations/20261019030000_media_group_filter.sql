BEGIN;
-- Discovery filters never imply access. Only current members can enumerate a
-- group's assignments, and the subsequent media SELECT still passes table RLS.
CREATE FUNCTION public.media_filter_groups() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.active_account(auth.uid()) THEN RAISE EXCEPTION 'Please sign in' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY lower(c.name),c.id)
   FROM public.messenger_conversations c JOIN public.messenger_members m ON m.conversation_id=c.id
   WHERE c.kind='group' AND m.user_id=auth.uid()),'[]'::jsonb);
END $$;
CREATE FUNCTION public.group_media_ids(p_type text,p_group uuid) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.active_account(auth.uid()) OR NOT EXISTS(
   SELECT 1 FROM public.messenger_members m JOIN public.messenger_conversations c ON c.id=m.conversation_id
   WHERE c.kind='group' AND c.id=p_group AND m.user_id=auth.uid()
 ) THEN RAISE EXCEPTION 'Group unavailable' USING ERRCODE='42501'; END IF;
 IF p_type IS NULL OR p_type NOT IN ('video','photo') THEN RAISE EXCEPTION 'Invalid media type'; END IF;
 RETURN coalesce((SELECT array_agg(DISTINCT s.media_id) FROM public.media_shares s
   WHERE s.media_type=p_type AND s.group_id=p_group),'{}'::uuid[]);
END $$;
REVOKE ALL ON FUNCTION public.media_filter_groups(),public.group_media_ids(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.media_filter_groups(),public.group_media_ids(text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
