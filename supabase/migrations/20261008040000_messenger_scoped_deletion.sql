-- Scoped Messenger deletion. Preserve deployed migration history and content.
-- Per-user hiding never removes another member's messages or stored files.
ALTER TABLE public.messenger_members
  ADD COLUMN cleared_sequence bigint NOT NULL DEFAULT 0 CHECK(cleared_sequence>=0),
  ADD COLUMN hidden boolean NOT NULL DEFAULT false;
ALTER TABLE public.messenger_conversations
  ADD COLUMN cleared_sequence bigint NOT NULL DEFAULT 0 CHECK(cleared_sequence>=0);
ALTER TABLE public.messenger_messages ADD COLUMN deleted_at timestamptz;
CREATE TABLE public.messenger_message_hides (
  message_id uuid REFERENCES public.messenger_messages(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY(message_id,user_id)
);
CREATE INDEX messenger_hidden_by_user ON public.messenger_message_hides(user_id,message_id);
-- These text-free receipts intentionally retain the target UUID after a group
-- is removed. A retry cannot clear messages that arrived after the first commit.
CREATE TABLE public.messenger_deletion_receipts (
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('clear-messages','delete-chat')),
  scope text NOT NULL CHECK(scope IN ('self','everyone')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,client_id)
);
ALTER TABLE public.messenger_message_hides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messenger_deletion_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.messenger_message_hides,public.messenger_deletion_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.messenger_message_hides,public.messenger_deletion_receipts TO service_role;

CREATE FUNCTION public.messenger_message_visible(p_message uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.messenger_active(auth.uid()) AND EXISTS(
    SELECT 1 FROM public.messenger_messages m JOIN public.messenger_members own
      ON own.conversation_id=m.conversation_id AND own.user_id=auth.uid()
    JOIN public.messenger_conversations c ON c.id=m.conversation_id
    WHERE m.id=p_message AND m.sequence>greatest(own.cleared_sequence,c.cleared_sequence)
      AND NOT EXISTS(SELECT 1 FROM public.messenger_message_hides h WHERE h.message_id=m.id AND h.user_id=auth.uid()));
$$;
CREATE FUNCTION public.messenger_notify_self(p_conversation uuid,p_message uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  BEGIN
    PERFORM realtime.send(jsonb_build_object('conversation_id',p_conversation,'message_id',p_message,'kind','hidden'),
      'changed','messenger:user:'||auth.uid()::text,true);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Messenger broadcast failed: SQLSTATE %',SQLSTATE;
  END;
END $$;

-- In one transaction, revoke attachment/preview access, preserve reply IDs and
-- enqueue permanent physical cleanup in the existing retryable worker queues.
-- The private bucket has no browser read URLs; queued bytes cannot be retrieved.
CREATE FUNCTION public.messenger_scrub_messages(p_conversation uuid,p_until bigint DEFAULT NULL,p_message uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  -- Recover plans from deletion attempts started by an older deployed client.
  INSERT INTO public.messenger_storage_cleanup(object_path)
    SELECT DISTINCT item->>'path' FROM public.messenger_messages m
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(m.deletion_files,'[]'::jsonb)) item
    WHERE m.conversation_id=p_conversation AND (p_until IS NULL OR m.sequence<=p_until)
      AND (p_message IS NULL OR m.id=p_message) AND nullif(item->>'path','') IS NOT NULL
    ON CONFLICT DO NOTHING;
  INSERT INTO public.file_preview_cleanup(path)
    SELECT DISTINCT preview.value FROM public.messenger_messages m
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(m.deletion_files,'[]'::jsonb)) item
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(item->'previews','[]'::jsonb)) preview
    WHERE m.conversation_id=p_conversation AND (p_until IS NULL OR m.sequence<=p_until)
      AND (p_message IS NULL OR m.id=p_message) AND nullif(preview.value,'') IS NOT NULL
    ON CONFLICT DO NOTHING;
  DELETE FROM public.file_preview_jobs WHERE source_id IN (
    SELECT a.source_id FROM public.messenger_attachments a JOIN public.messenger_messages m ON m.id=a.message_id
    WHERE m.conversation_id=p_conversation AND (p_until IS NULL OR m.sequence<=p_until) AND (p_message IS NULL OR m.id=p_message));
  DELETE FROM public.messenger_reactions r USING public.messenger_messages m WHERE r.message_id=m.id
    AND m.conversation_id=p_conversation AND (p_until IS NULL OR m.sequence<=p_until) AND (p_message IS NULL OR m.id=p_message);
  DELETE FROM public.messenger_attachments a USING public.messenger_messages m WHERE a.message_id=m.id
    AND m.conversation_id=p_conversation AND (p_until IS NULL OR m.sequence<=p_until) AND (p_message IS NULL OR m.id=p_message);
  UPDATE public.messenger_messages SET body='',edited_at=NULL,deleted_at=coalesce(deleted_at,now()),
    deletion_started_at=coalesce(deletion_started_at,now()),deletion_files=NULL
    WHERE conversation_id=p_conversation AND (p_until IS NULL OR sequence<=p_until) AND (p_message IS NULL OR id=p_message);
END $$;

CREATE OR REPLACE FUNCTION public.messenger_message_json(p public.messenger_messages) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',p.id,'conversation_id',p.conversation_id,'sender_id',p.sender_id,
    'sender_name',coalesce(public.messenger_name(p.sender_id),'Deleted user'),'sequence',p.sequence,
    'body',CASE WHEN p.deletion_started_at IS NOT NULL THEN 'This message was deleted.' ELSE p.body END,
    'created_at',p.created_at,'edited_at',p.edited_at,'deleted',p.deleted_at IS NOT NULL,
    'deleting',p.deletion_started_at IS NOT NULL AND p.deleted_at IS NULL,
    'reply',(SELECT jsonb_build_object('id',r.id,'sender_name',coalesce(public.messenger_name(r.sender_id),'Deleted user'),
      'body',CASE WHEN r.deletion_started_at IS NOT NULL THEN 'This message was deleted.'
        WHEN NOT public.messenger_message_visible(r.id) THEN 'This message is unavailable.' ELSE left(r.body,200) END)
      FROM public.messenger_messages r WHERE r.id=p.reply_to AND r.conversation_id=p.conversation_id),
    'attachments',CASE WHEN p.deletion_started_at IS NOT NULL THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(
      jsonb_build_object('id',a.id,'name',a.name,'mime_type',a.mime_type,'file_size',a.file_size,'available',a.source_id IS NOT NULL)
      ORDER BY a.created_at) FROM public.messenger_attachments a WHERE a.message_id=p.id),'[]'::jsonb) END,
    'reactions',CASE WHEN p.deletion_started_at IS NOT NULL THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(
      jsonb_build_object('user_id',r.user_id,'name',coalesce(public.messenger_name(r.user_id),'User'),'reaction',r.reaction))
      FROM public.messenger_reactions r WHERE r.message_id=p.id),'[]'::jsonb) END);
$$;
CREATE OR REPLACE FUNCTION public.messenger_conversation_json(p_conversation uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',c.id,'kind',c.kind,'name',CASE WHEN c.kind='group' THEN c.name ELSE
      coalesce((SELECT public.messenger_name(user_id) FROM public.messenger_members WHERE conversation_id=c.id AND user_id<>auth.uid() LIMIT 1),'Deleted user') END,
    'updated_at',c.updated_at,'last_sequence',c.last_sequence,'muted',own.muted,'role',own.role,
    'cleared_sequence',greatest(c.cleared_sequence,own.cleared_sequence),'hidden',own.hidden,
    'can_send',c.kind='group' OR ((SELECT count(*) FROM public.messenger_members WHERE conversation_id=c.id)=2 AND NOT EXISTS(
      SELECT 1 FROM public.messenger_members m WHERE m.conversation_id=c.id AND m.user_id<>auth.uid()
        AND (NOT public.messenger_active(m.user_id) OR public.messenger_blocked(auth.uid(),m.user_id)))),
    'unread',(SELECT count(*) FROM public.messenger_messages m WHERE m.conversation_id=c.id AND m.sequence>greatest(own.read_sequence,own.cleared_sequence,c.cleared_sequence)
      AND NOT own.hidden AND m.sender_id IS DISTINCT FROM auth.uid() AND m.deletion_started_at IS NULL AND public.messenger_message_visible(m.id)),
    'latest',(SELECT public.messenger_message_json(m) FROM public.messenger_messages m WHERE m.conversation_id=c.id
      AND m.sequence>greatest(c.cleared_sequence,own.cleared_sequence) AND public.messenger_message_visible(m.id) ORDER BY m.sequence DESC LIMIT 1),
    'members',public.messenger_members_json(c.id))
  FROM public.messenger_conversations c JOIN public.messenger_members own ON own.conversation_id=c.id AND own.user_id=auth.uid()
    WHERE c.id=p_conversation;
$$;
CREATE OR REPLACE FUNCTION public.messenger_attachment(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE attachment public.messenger_attachments; result jsonb;
BEGIN
  SELECT a.* INTO attachment FROM public.messenger_attachments a JOIN public.messenger_messages m ON m.id=a.message_id
    WHERE a.id=p_id AND m.deletion_started_at IS NULL AND public.messenger_message_visible(m.id);
  IF attachment.id IS NULL THEN RAISE EXCEPTION 'Attachment unavailable' USING ERRCODE='42501'; END IF;
  SELECT public.get_preview_source_by_id(o.id)||jsonb_build_object('name',attachment.name,'conversation_id',attachment.conversation_id)
    INTO result FROM storage.objects o WHERE o.id=attachment.source_id AND o.bucket_id='messenger-attachments' AND o.name=attachment.object_path;
  IF result IS NULL THEN RAISE EXCEPTION 'Attachment unavailable'; END IF; RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.messenger_rpc(p_action text,p_conversation uuid DEFAULT NULL,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); target uuid; cid uuid; mid uuid; aid uuid; sid uuid;
  conv public.messenger_conversations; member public.messenger_members; msg public.messenger_messages;
  attachment public.messenger_attachments; source storage.objects; old_reaction text;
  ids uuid[]; attachment_ids uuid[]; count_ids integer; next_sequence bigint; requested bigint;
  text_value text:=btrim(coalesce(p_data->>'text','')); query text:=left(btrim(coalesce(p_data->>'query','')),100);
  result jsonb; receipt record; filename text; key_pair text; changed boolean:=false;
  delete_scope text:=p_data->>'scope'; deletion_receipt public.messenger_deletion_receipts;
BEGIN
  IF NOT public.messenger_active(actor) THEN RAISE EXCEPTION 'Please sign in with an active account' USING ERRCODE='42501'; END IF;
  IF p_action IN ('clear-messages','delete-chat') THEN
    IF delete_scope IS NULL OR delete_scope NOT IN ('self','everyone') OR p_data->>'client_id' IS NULL THEN
      RAISE EXCEPTION 'Choose a deletion scope and a valid request';
    END IF;
    SELECT * INTO deletion_receipt FROM public.messenger_deletion_receipts WHERE user_id=actor AND client_id=(p_data->>'client_id')::uuid;
    IF deletion_receipt.client_id IS NOT NULL THEN
      IF deletion_receipt.conversation_id IS DISTINCT FROM p_conversation OR deletion_receipt.action<>p_action OR deletion_receipt.scope<>delete_scope THEN
        RAISE EXCEPTION 'Deletion retry belongs to another operation';
      END IF;
      RETURN '{}'::jsonb;
    END IF;
  END IF;
  IF p_action='heartbeat' THEN
    sid:=(p_data->>'session_id')::uuid;
    changed:=NOT EXISTS(SELECT 1 FROM public.messenger_sessions WHERE user_id=actor AND expires_at>now());
    DELETE FROM public.messenger_sessions WHERE expires_at<now()-interval '5 minutes';
    IF NOT EXISTS(SELECT 1 FROM public.messenger_sessions WHERE user_id=actor AND session_id=sid)
      AND (SELECT count(*) FROM public.messenger_sessions WHERE user_id=actor AND expires_at>now())>=8 THEN RAISE EXCEPTION 'Too many active chat sessions'; END IF;
    INSERT INTO public.messenger_sessions(user_id,session_id,expires_at) VALUES(actor,sid,now()+interval '60 seconds')
      ON CONFLICT(user_id,session_id) DO UPDATE SET expires_at=EXCLUDED.expires_at;
    INSERT INTO public.messenger_presence(user_id,last_seen) VALUES(actor,now()) ON CONFLICT(user_id) DO UPDATE SET last_seen=EXCLUDED.last_seen;
    IF changed THEN FOR cid IN SELECT conversation_id FROM public.messenger_members WHERE user_id=actor LOOP PERFORM public.messenger_notify(cid,NULL,'presence'); END LOOP; END IF;
    RETURN '{}'::jsonb;
  ELSIF p_action='session-end' THEN
    DELETE FROM public.messenger_sessions WHERE user_id=actor AND session_id=(p_data->>'session_id')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.messenger_sessions WHERE user_id=actor AND expires_at>now()) THEN
      FOR cid IN SELECT conversation_id FROM public.messenger_members WHERE user_id=actor LOOP PERFORM public.messenger_notify(cid,NULL,'presence'); END LOOP;
    END IF; RETURN '{}'::jsonb;
  ELSIF p_action='users' THEN
    IF length(query)<2 THEN RETURN '[]'::jsonb; END IF;
    SELECT coalesce(jsonb_agg(row),'[]'::jsonb) INTO result FROM (SELECT p.id,public.messenger_name(p.id) AS name
      FROM public.profiles p WHERE p.id<>actor AND public.messenger_active(p.id) AND NOT public.messenger_blocked(actor,p.id)
      AND (coalesce(p.first_name,'') ILIKE '%'||query||'%' OR coalesce(p.last_name,'') ILIKE '%'||query||'%' OR p.email ILIKE '%'||query||'%')
      ORDER BY public.messenger_name(p.id),p.id LIMIT 30) row;
    RETURN result;
  ELSIF p_action='create' THEN
    IF jsonb_typeof(p_data->'members') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'members')>50 THEN RAISE EXCEPTION 'Choose up to 49 other members'; END IF;
    SELECT array_agg(DISTINCT value::uuid) INTO ids FROM jsonb_array_elements_text(coalesce(p_data->'members','[]'));
    ids:=array_remove(coalesce(ids,'{}'::uuid[]),actor); count_ids:=cardinality(ids);
    IF count_ids<1 OR count_ids>49 THEN RAISE EXCEPTION 'Choose between 1 and 49 other members'; END IF;
    IF EXISTS(SELECT 1 FROM unnest(ids) id WHERE NOT public.messenger_active(id) OR public.messenger_blocked(actor,id)) THEN RAISE EXCEPTION 'A selected user is unavailable'; END IF;
    IF p_data->>'kind'='direct' THEN
      IF count_ids<>1 THEN RAISE EXCEPTION 'Direct conversations require two users'; END IF;
      key_pair:=least(actor::text,ids[1]::text)||':'||greatest(actor::text,ids[1]::text);
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(key_pair,0));
      SELECT id INTO cid FROM public.messenger_conversations WHERE direct_key=key_pair;
      IF cid IS NOT NULL THEN
        UPDATE public.messenger_members SET hidden=false WHERE conversation_id=cid AND user_id=actor;
        PERFORM public.messenger_notify_self(cid); RETURN jsonb_build_object('id',cid);
      END IF;
      INSERT INTO public.messenger_conversations(kind,direct_key,owner_id) VALUES('direct',key_pair,actor) RETURNING id INTO cid;
    ELSE
      IF p_data->>'kind' IS DISTINCT FROM 'group' OR length(text_value)<1 OR length(text_value)>100 THEN RAISE EXCEPTION 'Provide a group name (up to 100 characters)'; END IF;
      INSERT INTO public.messenger_conversations(kind,name,owner_id) VALUES('group',text_value,actor) RETURNING id INTO cid;
    END IF;
    INSERT INTO public.messenger_members(conversation_id,user_id,role) VALUES(cid,actor,CASE WHEN p_data->>'kind'='group' THEN 'owner' ELSE 'member' END);
    INSERT INTO public.messenger_members(conversation_id,user_id) SELECT cid,id FROM unnest(ids) id;
    PERFORM public.messenger_notify(cid); RETURN jsonb_build_object('id',cid);
  ELSIF p_action='inbox' THEN
    -- Delivery is acknowledged only after the signed-in client retrieves its inbox.
    FOR receipt IN SELECT m.conversation_id,m.delivered_sequence,c.last_sequence FROM public.messenger_members m JOIN public.messenger_conversations c ON c.id=m.conversation_id
      WHERE m.user_id=actor AND NOT m.hidden AND m.delivered_sequence<c.last_sequence LOOP
      UPDATE public.messenger_members SET delivered_sequence=greatest(delivered_sequence,receipt.last_sequence)
        WHERE conversation_id=receipt.conversation_id AND user_id=actor AND delivered_sequence<receipt.last_sequence;
      IF FOUND THEN PERFORM public.messenger_receipt_notify(receipt.conversation_id,receipt.delivered_sequence,receipt.last_sequence); END IF;
    END LOOP;
    SELECT coalesce(jsonb_agg(public.messenger_conversation_json(row.id) ORDER BY row.updated_at DESC),'[]'::jsonb) INTO result
      FROM (SELECT c.id,c.updated_at FROM public.messenger_conversations c JOIN public.messenger_members m ON m.conversation_id=c.id AND m.user_id=actor
        WHERE NOT m.hidden AND (query='' OR coalesce(c.name,'') ILIKE '%'||query||'%' OR EXISTS(SELECT 1 FROM public.messenger_members other WHERE other.conversation_id=c.id AND public.messenger_name(other.user_id) ILIKE '%'||query||'%'))
        ORDER BY c.updated_at DESC,c.id LIMIT 50 OFFSET least(greatest(coalesce((p_data->>'offset')::int,0),0),100000)) row;
    RETURN jsonb_build_object('conversations',result,'unread',(SELECT count(*) FROM public.messenger_messages unread_message JOIN public.messenger_members m ON m.conversation_id=unread_message.conversation_id AND m.user_id=actor JOIN public.messenger_conversations c ON c.id=m.conversation_id WHERE NOT m.hidden AND unread_message.sequence>greatest(m.read_sequence,m.cleared_sequence,c.cleared_sequence) AND unread_message.sender_id IS DISTINCT FROM actor AND unread_message.deletion_started_at IS NULL AND public.messenger_message_visible(unread_message.id)));
  ELSIF p_action='block' OR p_action='unblock' THEN
    target:=(p_data->>'user_id')::uuid;
    IF target=actor OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=target) THEN RAISE EXCEPTION 'User unavailable'; END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(actor::text,target::text)||':'||greatest(actor::text,target::text),0));
    IF p_action='block' THEN INSERT INTO public.messenger_blocks(user_id,blocked_id) VALUES(actor,target) ON CONFLICT DO NOTHING;
    ELSE DELETE FROM public.messenger_blocks WHERE user_id=actor AND blocked_id=target; END IF;
    FOR cid IN SELECT own.conversation_id FROM public.messenger_members own JOIN public.messenger_members other ON other.conversation_id=own.conversation_id WHERE own.user_id=actor AND other.user_id=target LOOP PERFORM public.messenger_notify(cid); END LOOP;
    RETURN '{}'::jsonb;
  ELSIF p_action='blocked-users' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.blocked_id,'name',public.messenger_name(b.blocked_id))),'[]'::jsonb) INTO result FROM public.messenger_blocks b WHERE b.user_id=actor; RETURN result;
  END IF;

  IF p_action NOT IN ('clear-messages','delete-chat') THEN
    PERFORM public.messenger_assert(p_conversation,p_action IN ('send','prepare-attachment','typing-targets'));
  END IF;
  SELECT * INTO conv FROM public.messenger_conversations WHERE id=p_conversation AND public.messenger_member(id) FOR UPDATE;
  IF p_action IN ('clear-messages','delete-chat') THEN
    IF delete_scope IS NULL OR delete_scope NOT IN ('self','everyone') OR p_data->>'client_id' IS NULL THEN
      RAISE EXCEPTION 'Choose a deletion scope and a valid request';
    END IF;
    SELECT * INTO deletion_receipt FROM public.messenger_deletion_receipts WHERE user_id=actor AND client_id=(p_data->>'client_id')::uuid;
    IF deletion_receipt.client_id IS NOT NULL THEN
      IF deletion_receipt.conversation_id IS DISTINCT FROM p_conversation OR deletion_receipt.action<>p_action OR deletion_receipt.scope<>delete_scope THEN
        RAISE EXCEPTION 'Deletion retry belongs to another operation';
      END IF;
      RETURN '{}'::jsonb;
    END IF;
  END IF;

  -- Membership may have changed while waiting behind another group operation.
  PERFORM public.messenger_assert(p_conversation,p_action IN ('send','prepare-attachment','typing-targets'));
  SELECT * INTO member FROM public.messenger_members WHERE conversation_id=p_conversation AND user_id=actor;
  IF p_action='conversation' THEN RETURN public.messenger_conversation_json(p_conversation);
  ELSIF p_action='deletion-info' THEN
    RETURN jsonb_build_object('sequence',conv.last_sequence,
      'own_count',(SELECT count(*) FROM public.messenger_messages m WHERE m.conversation_id=p_conversation AND m.sequence>greatest(member.cleared_sequence,conv.cleared_sequence) AND public.messenger_message_visible(m.id)),
      'everyone_count',(SELECT count(*) FROM public.messenger_messages m WHERE m.conversation_id=p_conversation AND m.sequence>conv.cleared_sequence));
  ELSIF p_action='messages' THEN
    SELECT coalesce(jsonb_agg(public.messenger_message_json(row::public.messenger_messages) ORDER BY row.sequence),'[]'::jsonb) INTO result FROM
      (SELECT m.* FROM public.messenger_messages m WHERE m.conversation_id=p_conversation AND m.sequence>greatest(member.cleared_sequence,conv.cleared_sequence) AND public.messenger_message_visible(m.id) AND
        ((p_data->>'before') IS NULL OR m.sequence<(p_data->>'before')::bigint) ORDER BY m.sequence DESC LIMIT 50) row;
    RETURN result;
  ELSIF p_action='message' THEN
    SELECT * INTO msg FROM public.messenger_messages WHERE id=(p_data->>'id')::uuid AND conversation_id=p_conversation AND public.messenger_message_visible(id);
    RETURN CASE WHEN msg.id IS NULL THEN 'null'::jsonb ELSE public.messenger_message_json(msg) END;
  ELSIF p_action='snapshot' THEN
    -- Refresh the bounded loaded window after reconnect, including edits and
    -- deletions that happened while offline. Absent IDs are removed by the UI.
    IF jsonb_typeof(p_data->'ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'ids')>500 THEN RAISE EXCEPTION 'History window is too large'; END IF;
    SELECT coalesce(array_agg(DISTINCT value::uuid),'{}'::uuid[]) INTO ids FROM jsonb_array_elements_text(coalesce(p_data->'ids','[]'));
    IF cardinality(ids)>500 THEN RAISE EXCEPTION 'History window is too large'; END IF;
    SELECT coalesce(jsonb_agg(public.messenger_message_json(m) ORDER BY m.sequence),'[]'::jsonb) INTO result
      FROM public.messenger_messages m WHERE m.conversation_id=p_conversation AND m.id=ANY(ids) AND public.messenger_message_visible(m.id);
    RETURN result;
  ELSIF p_action='since' THEN
    SELECT coalesce(jsonb_agg(public.messenger_message_json(row::public.messenger_messages) ORDER BY row.sequence),'[]'::jsonb) INTO result FROM
      (SELECT m.* FROM public.messenger_messages m WHERE m.conversation_id=p_conversation AND m.sequence>greatest(member.cleared_sequence,conv.cleared_sequence) AND public.messenger_message_visible(m.id) AND m.sequence>coalesce((p_data->>'sequence')::bigint,0)
       ORDER BY m.sequence LIMIT 200) row;
    RETURN result;
  ELSIF p_action='search' THEN
    IF length(query)<2 THEN RETURN '[]'::jsonb; END IF;
    SELECT coalesce(jsonb_agg(public.messenger_message_json(row::public.messenger_messages) ORDER BY row.sequence DESC),'[]'::jsonb) INTO result FROM
      (SELECT m.* FROM public.messenger_messages m WHERE m.conversation_id=p_conversation AND m.sequence>greatest(member.cleared_sequence,conv.cleared_sequence) AND m.deletion_started_at IS NULL AND public.messenger_message_visible(m.id) AND to_tsvector('simple',m.body) @@ websearch_to_tsquery('simple',query)
        ORDER BY m.sequence DESC LIMIT 50 OFFSET least(greatest(coalesce((p_data->>'offset')::int,0),0),100000)) row; RETURN result;
  ELSIF p_action='read' THEN
    requested:=least(greatest(coalesce((p_data->>'sequence')::bigint,0),0),conv.last_sequence);
    IF requested>member.read_sequence THEN
      UPDATE public.messenger_members SET read_sequence=requested,delivered_sequence=greatest(delivered_sequence,requested) WHERE conversation_id=p_conversation AND user_id=actor;
      PERFORM public.messenger_receipt_notify(p_conversation,member.read_sequence,requested);
    END IF; RETURN '{}'::jsonb;
  ELSIF p_action='mute' THEN
    UPDATE public.messenger_members SET muted=coalesce((p_data->>'muted')::boolean,false) WHERE conversation_id=p_conversation AND user_id=actor;
    PERFORM public.messenger_notify(p_conversation); RETURN '{}'::jsonb;
  ELSIF p_action='typing-targets' THEN
    sid:=(p_data->>'session_id')::uuid;
    UPDATE public.messenger_sessions SET last_typing_at=now() WHERE user_id=actor AND session_id=sid AND expires_at>now()
      AND (last_typing_at IS NULL OR last_typing_at<now()-interval '2 seconds' OR p_data->>'typing'='false');
    IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
    SELECT coalesce(jsonb_agg(m.user_id),'[]'::jsonb) INTO result FROM public.messenger_members m
      WHERE m.conversation_id=p_conversation AND m.user_id<>actor AND public.messenger_active(m.user_id) AND NOT public.messenger_blocked(actor,m.user_id); RETURN result;
  ELSIF p_action='prepare-attachment' THEN
    filename:=btrim(coalesce(p_data->>'name',''));
    IF filename='' OR octet_length(filename)>200 OR filename~'[[:cntrl:]/]' OR strpos(filename,chr(92))>0 OR filename IN ('.','..') THEN RAISE EXCEPTION 'Choose a valid filename (up to 200 bytes)'; END IF;
    IF (SELECT count(*) FROM public.messenger_attachments WHERE uploader_id=actor AND message_id IS NULL)>=30 THEN RAISE EXCEPTION 'Too many unfinished attachments. Send or remove existing attachments first'; END IF;
    aid:=gen_random_uuid();
    INSERT INTO public.messenger_attachments(id,conversation_id,uploader_id,object_path,name,file_size,mime_type)
      VALUES(aid,p_conversation,actor,actor::text||'/'||p_conversation::text||'/'||aid::text||'/'||filename,filename,
      (p_data->>'size')::bigint,left(coalesce(nullif(p_data->>'mime',''),'application/octet-stream'),150)) RETURNING * INTO attachment;
    RETURN jsonb_build_object('id',aid,'path',attachment.object_path);
  ELSIF p_action='cancel-attachment' THEN
    DELETE FROM public.messenger_attachments WHERE id=(p_data->>'id')::uuid AND conversation_id=p_conversation AND uploader_id=actor AND message_id IS NULL;
    RETURN '{}'::jsonb;
  ELSIF p_action='cancel-send' THEN
    -- A late, still-running send must not publish after the user discards an
    -- uncertain draft. A committed message is retained, never silently deleted.
    sid:=(p_data->>'client_id')::uuid;
    INSERT INTO public.messenger_send_receipts(user_id,client_id,conversation_id,message_id) VALUES(actor,sid,p_conversation,NULL) ON CONFLICT DO NOTHING;
    IF jsonb_typeof(p_data->'attachments') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'attachments')>10 THEN RAISE EXCEPTION 'Invalid draft'; END IF;
    SELECT coalesce(array_agg(DISTINCT value::uuid),'{}'::uuid[]) INTO attachment_ids FROM jsonb_array_elements_text(p_data->'attachments');
    DELETE FROM public.messenger_attachments WHERE id=ANY(attachment_ids) AND uploader_id=actor AND conversation_id=p_conversation AND message_id IS NULL;
    RETURN '{}'::jsonb;
  ELSIF p_action='send' THEN
    IF conv.kind='direct' THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(conv.direct_key,0));
      PERFORM public.messenger_assert(p_conversation,true);
    END IF;
    sid:=(p_data->>'client_id')::uuid;
    IF EXISTS(SELECT 1 FROM public.messenger_send_receipts WHERE user_id=actor AND client_id=sid AND message_id IS NULL) THEN
      RAISE EXCEPTION 'This message request is no longer active. Start a new message';
    END IF;
    SELECT * INTO msg FROM public.messenger_messages WHERE sender_id=actor AND client_id=sid;
    IF msg.id IS NOT NULL THEN
      IF msg.conversation_id<>p_conversation THEN RAISE EXCEPTION 'Message retry belongs to another conversation'; END IF;
      IF NOT public.messenger_message_visible(msg.id) THEN RETURN jsonb_build_object('id',msg.id); END IF;
      RETURN public.messenger_message_json(msg);
    END IF;
    IF jsonb_typeof(coalesce(p_data->'attachments','[]'::jsonb)) IS DISTINCT FROM 'array' OR jsonb_array_length(coalesce(p_data->'attachments','[]'::jsonb))>10 THEN RAISE EXCEPTION 'A message can contain up to 10 attachments'; END IF;
    SELECT coalesce(array_agg(DISTINCT value::uuid),'{}'::uuid[]) INTO attachment_ids FROM jsonb_array_elements_text(coalesce(p_data->'attachments','[]'));
    IF length(text_value)>10000 OR (text_value='' AND cardinality(attachment_ids)=0) OR cardinality(attachment_ids)>10 THEN RAISE EXCEPTION 'Send text (up to 10,000 characters) or up to 10 attachments'; END IF;
    IF (SELECT count(*) FROM public.messenger_messages WHERE sender_id=actor AND created_at>now()-interval '1 minute')>=60 THEN RAISE EXCEPTION 'Please wait a moment before sending more messages'; END IF;
    IF (p_data->>'reply_to') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.messenger_messages WHERE id=(p_data->>'reply_to')::uuid AND conversation_id=p_conversation AND deletion_started_at IS NULL AND public.messenger_message_visible(id)) THEN RAISE EXCEPTION 'The replied-to message is unavailable'; END IF;
    FOREACH aid IN ARRAY attachment_ids LOOP
      SELECT * INTO attachment FROM public.messenger_attachments WHERE id=aid AND uploader_id=actor AND conversation_id=p_conversation AND message_id IS NULL FOR UPDATE;
      IF attachment.id IS NULL THEN RAISE EXCEPTION 'An attachment is unavailable'; END IF;
      SELECT * INTO source FROM storage.objects WHERE bucket_id='messenger-attachments' AND name=attachment.object_path FOR SHARE;
      IF source.id IS NULL OR coalesce((source.metadata->>'size')::bigint,0)<>attachment.file_size THEN RAISE EXCEPTION 'An attachment did not finish uploading'; END IF;
      UPDATE public.messenger_attachments SET source_id=source.id,mime_type=coalesce(source.metadata->>'mimetype','application/octet-stream') WHERE id=aid;
    END LOOP;
    IF (SELECT coalesce(sum(file_size),0) FROM public.messenger_attachments WHERE id=ANY(attachment_ids))>209715200 THEN RAISE EXCEPTION 'Attachments exceed the 200 MB message limit'; END IF;
    next_sequence:=conv.last_sequence+1;
    INSERT INTO public.messenger_messages(conversation_id,sender_id,client_id,sequence,body,reply_to)
      VALUES(p_conversation,actor,sid,next_sequence,text_value,(p_data->>'reply_to')::uuid) RETURNING * INTO msg;
    INSERT INTO public.messenger_send_receipts(user_id,client_id,conversation_id,message_id) VALUES(actor,sid,p_conversation,msg.id);
    UPDATE public.messenger_attachments SET message_id=msg.id WHERE id=ANY(attachment_ids);
    UPDATE public.messenger_conversations SET last_sequence=next_sequence,updated_at=now() WHERE id=p_conversation;
    -- A new message restores direct chats hidden by either participant.
    UPDATE public.messenger_members SET hidden=false WHERE conversation_id=p_conversation AND hidden;
    UPDATE public.messenger_members SET delivered_sequence=next_sequence WHERE conversation_id=p_conversation AND user_id=actor;
    PERFORM public.messenger_notify(p_conversation,msg.id); RETURN public.messenger_message_json(msg);
  ELSIF p_action IN ('clear-messages','delete-chat') THEN
    -- This conversation lock is shared with send, membership and message edits.
    -- The captured sequence excludes messages sent after this transaction.
    IF delete_scope='everyone' AND ((p_action='delete-chat' AND conv.kind<>'group')
      OR (conv.kind='group' AND member.role NOT IN ('owner','admin'))) THEN
      RAISE EXCEPTION 'Group owner or administrator permission required' USING ERRCODE='42501';
    END IF;
    INSERT INTO public.messenger_deletion_receipts(user_id,client_id,conversation_id,action,scope)
      VALUES(actor,(p_data->>'client_id')::uuid,p_conversation,p_action,delete_scope);
    IF p_action='clear-messages' THEN
      requested:=least(greatest(coalesce((p_data->>'through_sequence')::bigint,conv.last_sequence),0),conv.last_sequence);
      IF delete_scope='self' THEN
        UPDATE public.messenger_members SET cleared_sequence=greatest(cleared_sequence,requested),
          read_sequence=greatest(read_sequence,requested),delivered_sequence=greatest(delivered_sequence,requested)
          WHERE conversation_id=p_conversation AND user_id=actor;
        PERFORM public.messenger_notify_self(p_conversation);
      ELSE
        PERFORM public.messenger_scrub_messages(p_conversation,requested);
        UPDATE public.messenger_conversations SET cleared_sequence=greatest(cleared_sequence,requested) WHERE id=p_conversation;
        PERFORM public.messenger_notify(p_conversation,NULL,'cleared');
      END IF;
    ELSIF delete_scope='self' THEN
      IF conv.kind='direct' THEN
        UPDATE public.messenger_members SET hidden=true,read_sequence=greatest(read_sequence,conv.last_sequence),
          delivered_sequence=greatest(delivered_sequence,conv.last_sequence) WHERE conversation_id=p_conversation AND user_id=actor;
        PERFORM public.messenger_notify_self(p_conversation);
      ELSE
        PERFORM public.messenger_notify(p_conversation,NULL,'left');
        DELETE FROM public.messenger_members WHERE conversation_id=p_conversation AND user_id=actor;
        PERFORM public.messenger_notify(p_conversation,NULL,'left');
      END IF;
    ELSE
      PERFORM public.messenger_scrub_messages(p_conversation);
      -- Notify all existing members before the membership rows cascade away.
      PERFORM public.messenger_notify(p_conversation,NULL,'deleted');
      DELETE FROM public.messenger_conversations WHERE id=p_conversation;
    END IF;
    RETURN '{}'::jsonb;
  ELSIF p_action IN ('edit','delete-plan','delete-message','delete-for-self','delete-for-everyone','react') THEN
    mid:=(p_data->>'id')::uuid;
    SELECT * INTO msg FROM public.messenger_messages WHERE id=mid AND conversation_id=p_conversation FOR UPDATE;
    IF msg.id IS NULL THEN RAISE EXCEPTION 'Message unavailable'; END IF;
    IF p_action='delete-for-self' THEN
      INSERT INTO public.messenger_message_hides(message_id,user_id) VALUES(mid,actor) ON CONFLICT DO NOTHING;
      PERFORM public.messenger_notify_self(p_conversation,mid); RETURN '{}'::jsonb;
    ELSIF p_action IN ('delete-plan','delete-message','delete-for-everyone') THEN
      IF msg.sender_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'You can delete only your own messages for everyone' USING ERRCODE='42501'; END IF;
      -- Compatibility for an older deployed client's two-step delete endpoint.
      IF p_action='delete-plan' THEN RETURN '[]'::jsonb; END IF;
      PERFORM public.messenger_scrub_messages(p_conversation,NULL,mid);
      PERFORM public.messenger_notify(p_conversation,mid,'deleted');
      SELECT * INTO msg FROM public.messenger_messages WHERE id=mid;
      RETURN CASE WHEN p_action='delete-message' THEN '{}'::jsonb ELSE public.messenger_message_json(msg) END;
    END IF;
    IF msg.deletion_started_at IS NOT NULL OR NOT public.messenger_message_visible(mid) THEN RAISE EXCEPTION 'Message unavailable'; END IF;
    IF p_action='react' THEN
      old_reaction:=p_data->>'reaction';
      IF old_reaction NOT IN ('like','love','lol','smile','wow','sad') OR old_reaction IS NULL THEN RAISE EXCEPTION 'Choose a valid reaction'; END IF;
      IF EXISTS(SELECT 1 FROM public.messenger_reactions WHERE message_id=mid AND user_id=actor AND reaction=old_reaction) THEN
        DELETE FROM public.messenger_reactions WHERE message_id=mid AND user_id=actor;
      ELSE INSERT INTO public.messenger_reactions(message_id,user_id,reaction) VALUES(mid,actor,old_reaction)
        ON CONFLICT(message_id,user_id) DO UPDATE SET reaction=EXCLUDED.reaction,updated_at=now(); END IF;
    ELSE
      IF msg.sender_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'You can change only your own messages' USING ERRCODE='42501'; END IF;
      IF length(text_value)>10000 OR (text_value='' AND NOT EXISTS(SELECT 1 FROM public.messenger_attachments WHERE message_id=mid)) THEN RAISE EXCEPTION 'Enter a valid message'; END IF;
      UPDATE public.messenger_messages SET body=text_value,edited_at=now() WHERE id=mid RETURNING * INTO msg;
    END IF;
    PERFORM public.messenger_notify(p_conversation,mid); SELECT * INTO msg FROM public.messenger_messages WHERE id=mid; RETURN public.messenger_message_json(msg);
  ELSIF p_action='files' THEN
    SELECT coalesce(jsonb_agg(row),'[]'::jsonb) INTO result FROM (SELECT a.id,a.name,a.mime_type,a.file_size,a.message_id FROM public.messenger_attachments a
      JOIN public.messenger_messages m ON m.id=a.message_id WHERE a.conversation_id=p_conversation AND m.sequence>greatest(member.cleared_sequence,conv.cleared_sequence) AND m.deletion_started_at IS NULL AND public.messenger_message_visible(m.id)
      ORDER BY a.created_at DESC LIMIT 50 OFFSET least(greatest(coalesce((p_data->>'offset')::int,0),0),100000)) row; RETURN result;
  ELSIF p_action IN ('group-name','add-member','remove-member','member-role','leave') THEN
    IF conv.kind<>'group' THEN RAISE EXCEPTION 'This action is for groups only'; END IF;
    IF p_action<>'leave' AND member.role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Group administrator permission required' USING ERRCODE='42501'; END IF;
    IF p_action='group-name' THEN
      IF length(text_value)<1 OR length(text_value)>100 THEN RAISE EXCEPTION 'Enter a group name (up to 100 characters)'; END IF;
      UPDATE public.messenger_conversations SET name=text_value,updated_at=now() WHERE id=p_conversation;
    ELSIF p_action='add-member' THEN
      target:=(p_data->>'user_id')::uuid;
      IF NOT public.messenger_active(target) OR public.messenger_blocked(actor,target) THEN RAISE EXCEPTION 'User unavailable'; END IF;
      IF (SELECT count(*) FROM public.messenger_members WHERE conversation_id=p_conversation)>=50 THEN RAISE EXCEPTION 'Groups support up to 50 members'; END IF;
      INSERT INTO public.messenger_members(conversation_id,user_id,joined_sequence,delivered_sequence,read_sequence) VALUES(p_conversation,target,conv.last_sequence,conv.last_sequence,conv.last_sequence) ON CONFLICT DO NOTHING;
    ELSIF p_action='member-role' THEN
      IF member.role<>'owner' OR p_data->>'role' NOT IN ('admin','member') THEN RAISE EXCEPTION 'Only the owner can assign administrators'; END IF;
      UPDATE public.messenger_members SET role=p_data->>'role' WHERE conversation_id=p_conversation AND user_id=(p_data->>'user_id')::uuid AND role<>'owner';
    ELSE
      target:=CASE WHEN p_action='leave' THEN actor ELSE (p_data->>'user_id')::uuid END;
      IF p_action='remove-member' AND EXISTS(SELECT 1 FROM public.messenger_members WHERE conversation_id=p_conversation AND user_id=target AND
        (role='owner' OR (role='admin' AND member.role<>'owner'))) THEN RAISE EXCEPTION 'You cannot remove this group administrator'; END IF;
      -- Notify the departing account before removal; it then loses RPC/storage access.
      PERFORM public.messenger_notify(p_conversation);
      DELETE FROM public.messenger_members WHERE conversation_id=p_conversation AND user_id=target;
    END IF;
    PERFORM public.messenger_notify(p_conversation); RETURN '{}'::jsonb;
  END IF;
  RAISE EXCEPTION 'Unsupported Messenger action';
END $$;


REVOKE ALL ON FUNCTION public.messenger_message_visible(uuid),public.messenger_notify_self(uuid,uuid),
  public.messenger_scrub_messages(uuid,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.messenger_message_visible(uuid),public.messenger_notify_self(uuid,uuid),
  public.messenger_scrub_messages(uuid,bigint,uuid) TO service_role;
-- CREATE OR REPLACE retains the existing narrow RPC/attachment grants.
NOTIFY pgrst,'reload schema';
