BEGIN;
-- Grants reference library media; deleting a group cascades only its grants.
CREATE TABLE public.media_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_type text NOT NULL CHECK(media_type IN ('video','photo')),
  media_id uuid NOT NULL,
  video_id uuid GENERATED ALWAYS AS (CASE WHEN media_type='video' THEN media_id END) STORED REFERENCES public.videos(id) ON DELETE CASCADE,
  photo_id uuid GENERATED ALWAYS AS (CASE WHEN media_type='photo' THEN media_id END) STORED REFERENCES public.photos(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.messenger_conversations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((recipient_id IS NULL)<>(group_id IS NULL)),
  UNIQUE(media_type,media_id,recipient_id), UNIQUE(media_type,media_id,group_id)
);
CREATE INDEX media_shares_group ON public.media_shares(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX media_shares_recipient ON public.media_shares(recipient_id) WHERE recipient_id IS NOT NULL;
ALTER TABLE public.media_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_shares FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.media_shares TO service_role;

CREATE FUNCTION public.media_access_for_user(p_type text,p_id uuid,p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM (
    SELECT owner_id,visibility FROM public.videos WHERE p_type='video' AND id=p_id
    UNION ALL SELECT owner_id,visibility FROM public.photos WHERE p_type='photo' AND id=p_id
  ) resource WHERE resource.visibility='public' OR (public.active_account(p_user) AND (
    resource.owner_id=p_user OR EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user AND role='admin')
    OR EXISTS(SELECT 1 FROM public.media_shares s WHERE s.media_type=p_type AND s.media_id=p_id
      AND (s.recipient_id=p_user OR EXISTS(SELECT 1 FROM public.messenger_members m
        JOIN public.messenger_conversations c ON c.id=m.conversation_id AND c.kind='group'
        WHERE m.conversation_id=s.group_id AND m.user_id=p_user))))));
$$;
CREATE FUNCTION public.can_read_media(p_type text,p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.media_access_for_user(p_type,p_id,auth.uid());
$$;
REVOKE ALL ON FUNCTION public.media_access_for_user(text,uuid,uuid),public.can_read_media(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.media_access_for_user(text,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_media(text,uuid) TO authenticated;
CREATE POLICY videos_shared_read ON public.videos FOR SELECT TO authenticated USING(public.can_read_media('video',id));
CREATE POLICY photos_shared_read ON public.photos FOR SELECT TO authenticated USING(public.can_read_media('photo',id));
CREATE OR REPLACE FUNCTION public.can_access_reaction_media(p_type text,p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.media_access_for_user(p_type,p_id,auth.uid()) $$;
CREATE OR REPLACE FUNCTION public.video_playback_allowed(p_video uuid,p_user uuid,p_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.videos v WHERE v.id=p_video AND v.processing_status='ready'
   AND public.media_access_for_user('video',v.id,p_user)
   AND ((p_user IS NULL AND p_session IS NULL AND v.visibility='public') OR
     (public.active_account(p_user) AND EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=p_session AND s.user_id=p_user
       AND (s.not_after IS NULL OR s.not_after>now())))));
$$;

-- Owner-only atomic grant updates. Frontend recipient IDs never set the actor.
CREATE FUNCTION public.media_sharing_rpc(p_type text,p_id uuid,p_action text,p_data jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); owner uuid; people uuid[]; groups uuid[]; target uuid; visibility_value text; revision_value text;
BEGIN
 IF NOT public.active_account(actor) THEN RAISE EXCEPTION 'Please sign in' USING ERRCODE='42501'; END IF;
 IF p_type='video' THEN SELECT owner_id,visibility INTO owner,visibility_value FROM public.videos WHERE id=p_id FOR UPDATE;
 ELSIF p_type='photo' THEN SELECT owner_id,visibility INTO owner,visibility_value FROM public.photos WHERE id=p_id FOR UPDATE; END IF;
 IF owner IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Only the owner can manage sharing' USING ERRCODE='42501'; END IF;
 SELECT md5(coalesce(jsonb_agg(s.id ORDER BY s.id),'[]'::jsonb)::text||':'||visibility_value) INTO revision_value FROM public.media_shares s WHERE s.media_type=p_type AND s.media_id=p_id;
 IF p_action='get' THEN
   RETURN jsonb_build_object('revision',revision_value,'visibility',visibility_value,'users',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.recipient_id,'name',public.messenger_name(s.recipient_id))) FROM public.media_shares s WHERE s.media_type=p_type AND s.media_id=p_id AND s.recipient_id IS NOT NULL),'[]'),
     'selected_groups',coalesce((SELECT jsonb_agg(s.group_id) FROM public.media_shares s WHERE s.media_type=p_type AND s.media_id=p_id AND s.group_id IS NOT NULL),'[]'),
     'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name,c.id) FROM public.messenger_conversations c WHERE c.kind='group' AND
       (EXISTS(SELECT 1 FROM public.messenger_members WHERE conversation_id=c.id AND user_id=actor) OR EXISTS(SELECT 1 FROM public.media_shares s WHERE s.group_id=c.id AND s.media_type=p_type AND s.media_id=p_id))),'[]'));
 ELSIF p_action='save' THEN
   IF p_data->>'revision' IS DISTINCT FROM revision_value THEN RAISE EXCEPTION 'Sharing changed in another session. Close and reopen sharing before saving.'; END IF;
   IF jsonb_typeof(p_data->'users') IS DISTINCT FROM 'array' OR jsonb_typeof(p_data->'groups') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_data->'users')>200 OR jsonb_array_length(p_data->'groups')>200 OR p_data->>'visibility' NOT IN ('public','private') OR p_data->>'visibility' IS NULL THEN RAISE EXCEPTION 'Invalid sharing selection'; END IF;
   SELECT coalesce(array_agg(DISTINCT value::uuid),'{}') INTO people FROM jsonb_array_elements_text(p_data->'users');
   SELECT coalesce(array_agg(DISTINCT value::uuid),'{}') INTO groups FROM jsonb_array_elements_text(p_data->'groups');
   IF EXISTS(SELECT 1 FROM unnest(people) id WHERE id=actor OR NOT public.active_account(id) OR public.messenger_blocked(actor,id)) THEN RAISE EXCEPTION 'A selected person is unavailable'; END IF;
   -- Serialize with membership changes/deletion. Existing grants can be kept or
   -- revoked after the uploader leaves; new grants require current membership.
   FOR target IN SELECT unnest(groups) ORDER BY 1 LOOP
     PERFORM 1 FROM public.messenger_conversations WHERE id=target AND kind='group' FOR UPDATE;
     IF NOT FOUND OR (NOT EXISTS(SELECT 1 FROM public.messenger_members WHERE conversation_id=target AND user_id=actor)
       AND NOT EXISTS(SELECT 1 FROM public.media_shares WHERE media_type=p_type AND media_id=p_id AND group_id=target)) THEN RAISE EXCEPTION 'A selected group is unavailable'; END IF;
   END LOOP;
   DELETE FROM public.media_shares WHERE media_type=p_type AND media_id=p_id AND
     ((recipient_id IS NOT NULL AND NOT recipient_id=ANY(people)) OR (group_id IS NOT NULL AND NOT group_id=ANY(groups)));
   INSERT INTO public.media_shares(media_type,media_id,recipient_id,created_by) SELECT p_type,p_id,id,actor FROM unnest(people) id ON CONFLICT DO NOTHING;
   INSERT INTO public.media_shares(media_type,media_id,group_id,created_by) SELECT p_type,p_id,id,actor FROM unnest(groups) id ON CONFLICT DO NOTHING;
   IF p_type='video' THEN UPDATE public.videos SET visibility=p_data->>'visibility' WHERE id=p_id;
   ELSE UPDATE public.photos SET visibility=p_data->>'visibility' WHERE id=p_id; END IF;
   RETURN '{}';
 END IF;
 RAISE EXCEPTION 'Unsupported sharing action';
END $$;
REVOKE ALL ON FUNCTION public.media_sharing_rpc(text,uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.media_sharing_rpc(text,uuid,text,jsonb) TO authenticated;
CREATE FUNCTION public.shared_media_ids(p_type text) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(array_agg(DISTINCT s.media_id),'{}') FROM public.media_shares s
 WHERE s.media_type=p_type AND public.active_account(auth.uid()) AND
   (s.recipient_id=auth.uid() OR EXISTS(SELECT 1 FROM public.messenger_members m WHERE m.conversation_id=s.group_id AND m.user_id=auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.shared_media_ids(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shared_media_ids(text) TO authenticated;

CREATE FUNCTION public.messenger_groups_rpc(p_action text,p_group uuid DEFAULT NULL,p_data jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); c public.messenger_conversations; result jsonb; request_id uuid:=(p_data->>'client_id')::uuid;
BEGIN
 IF NOT public.messenger_active(actor) THEN RAISE EXCEPTION 'Please sign in' USING ERRCODE='42501'; END IF;
 IF p_action='admin-list' THEN
   IF NOT public.is_admin() THEN RAISE EXCEPTION 'Site administrator required' USING ERRCODE='42501'; END IF;
   SELECT coalesce(jsonb_agg(to_jsonb(row)),'[]') INTO result FROM (SELECT id,name,public.messenger_name(owner_id) AS owner,owner_id=actor AS is_owner,
     (SELECT count(*) FROM public.messenger_members WHERE conversation_id=g.id) AS member_count
     FROM public.messenger_conversations g WHERE kind='group' AND strpos(lower(name),lower(left(coalesce(p_data->>'query',''),100)))>0
     ORDER BY name,id LIMIT 50 OFFSET least(greatest(coalesce((p_data->>'offset')::int,0),0),100000)) row;
   RETURN result;
 ELSIF p_action='delete' THEN
   IF request_id IS NULL THEN RAISE EXCEPTION 'Deletion request required'; END IF;
   PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('group-delete:'||actor||':'||request_id,0));
   IF EXISTS(SELECT 1 FROM public.messenger_deletion_receipts WHERE user_id=actor AND client_id=request_id
     AND conversation_id=p_group AND action='delete-chat' AND scope='everyone') THEN RETURN '{}'; END IF;
   IF EXISTS(SELECT 1 FROM public.messenger_deletion_receipts WHERE user_id=actor AND client_id=request_id) THEN RAISE EXCEPTION 'Deletion retry belongs to another operation'; END IF;
   SELECT * INTO c FROM public.messenger_conversations WHERE id=p_group AND kind='group' FOR UPDATE;
   IF c.id IS NULL OR NOT (public.is_admin() OR (c.owner_id=actor AND EXISTS(SELECT 1 FROM public.messenger_members WHERE conversation_id=c.id AND user_id=actor AND role='owner'))) THEN
     RAISE EXCEPTION 'Group owner or site administrator required' USING ERRCODE='42501'; END IF;
   INSERT INTO public.messenger_deletion_receipts(user_id,client_id,conversation_id,action,scope) VALUES(actor,request_id,p_group,'delete-chat','everyone');
   PERFORM public.messenger_scrub_messages(p_group);
   -- Recipients must still exist when the transaction queues private broadcasts.
   PERFORM public.messenger_notify(p_group,NULL,'group-deleted');
   DELETE FROM public.messenger_conversations WHERE id=p_group;
   RETURN '{}';
 END IF;
 RAISE EXCEPTION 'Unsupported group action';
END $$;
REVOKE ALL ON FUNCTION public.messenger_groups_rpc(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.messenger_groups_rpc(text,uuid,jsonb) TO authenticated;

-- Route older clients through the same owner/site-admin deletion action before
-- their membership-only branch. Group admins retain member management only.
DO $migration$
DECLARE definition text; marker text:='  IF p_action IN (''clear-messages'',''delete-chat'') THEN';
BEGIN
 SELECT pg_get_functiondef('public.messenger_rpc(text,uuid,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'Messenger deletion branch missing'; END IF;
 definition:=overlay(definition placing E'  IF p_action=''delete-chat'' AND delete_scope=''everyone'' THEN\n    RETURN public.messenger_groups_rpc(''delete'',p_conversation,p_data);\n  END IF;\n' from strpos(definition,marker) for 0);
 EXECUTE definition;
END $migration$;
ALTER FUNCTION public.messenger_conversation_json(uuid) RENAME TO messenger_conversation_json_before_group_sharing;
CREATE FUNCTION public.messenger_conversation_json(p_conversation uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.messenger_conversation_json_before_group_sharing(p_conversation)||jsonb_build_object('can_delete_group',
   EXISTS(SELECT 1 FROM public.messenger_conversations c WHERE c.id=p_conversation AND c.kind='group' AND
     (public.is_admin() OR (c.owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.messenger_members WHERE conversation_id=c.id AND user_id=auth.uid() AND role='owner')))));
$$;
REVOKE ALL ON FUNCTION public.messenger_conversation_json(uuid),public.messenger_conversation_json_before_group_sharing(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.messenger_conversation_json(uuid),public.messenger_conversation_json_before_group_sharing(uuid) TO service_role;

-- Notification events predate group FK cleanup. Remove only orphan alerts, then
-- cascade future group/message removals through events and delivery jobs.
DELETE FROM public.messenger_notification_events e WHERE NOT EXISTS(SELECT 1 FROM public.messenger_conversations c WHERE c.id=e.conversation_id);
ALTER TABLE public.messenger_notification_events ADD CONSTRAINT notification_conversation_fk FOREIGN KEY(conversation_id) REFERENCES public.messenger_conversations(id) ON DELETE CASCADE;
CREATE INDEX messenger_notification_conversation ON public.messenger_notification_events(conversation_id);
CREATE FUNCTION public.messenger_group_access_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cid uuid; recipient uuid;
BEGIN
 cid:=CASE WHEN TG_OP='DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id END;
 IF TG_OP='DELETE' THEN
   DELETE FROM public.messenger_notification_events WHERE conversation_id=cid AND recipient_id=OLD.user_id;
   recipient:=OLD.user_id;
 ELSE recipient:=NEW.user_id; END IF;
 PERFORM realtime.send(jsonb_build_object('conversation_id',cid,'kind','group-access','revoked',TG_OP='DELETE'),'changed','messenger:user:'||recipient,true);
 RETURN NULL;
END $$;
CREATE TRIGGER messenger_group_access_changed AFTER INSERT OR DELETE ON public.messenger_members FOR EACH ROW EXECUTE FUNCTION public.messenger_group_access_changed();
REVOKE ALL ON FUNCTION public.messenger_group_access_changed() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.media_share_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.media_shares; recipient uuid;
BEGIN
 s:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 FOR recipient IN SELECT s.recipient_id WHERE s.recipient_id IS NOT NULL UNION SELECT user_id FROM public.messenger_members WHERE conversation_id=s.group_id LOOP
   PERFORM realtime.send(jsonb_build_object('conversation_id',coalesce(s.group_id,s.media_id),'kind','media-access'),'changed','messenger:user:'||recipient,true);
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER media_share_changed AFTER INSERT OR DELETE ON public.media_shares FOR EACH ROW EXECUTE FUNCTION public.media_share_changed();
REVOKE ALL ON FUNCTION public.media_share_changed() FROM PUBLIC,anon,authenticated;
-- Awake pages/workers reconcile deleted/removed groups after reconnect too.
DO $migration$
DECLARE definition text; marker text:='''active_calls'',active_calls';
BEGIN
 SELECT pg_get_functiondef('public.messenger_notifications_rpc(text,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'Notification reconciliation branch missing'; END IF;
 EXECUTE replace(definition,marker,marker||',''active_conversations'',coalesce((SELECT jsonb_agg(conversation_id) FROM public.messenger_members WHERE user_id=actor),''[]''::jsonb)');
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
