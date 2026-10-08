-- Native Messenger: session-bound RPCs, private per-user broadcasts, no public
-- attachment URLs. Existing libraries, roles and processing queues are retained.
CREATE TABLE public.messenger_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK(kind IN ('direct','group')),
  name text CHECK(length(name) BETWEEN 1 AND 100),
  direct_key text UNIQUE,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK(last_sequence>=0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((kind='direct' AND direct_key IS NOT NULL AND name IS NULL) OR (kind='group' AND direct_key IS NULL AND name IS NOT NULL))
);
CREATE TABLE public.messenger_members (
  conversation_id uuid REFERENCES public.messenger_conversations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK(role IN ('owner','admin','member')),
  joined_sequence bigint NOT NULL DEFAULT 0,
  delivered_sequence bigint NOT NULL DEFAULT 0 CHECK(delivered_sequence>=0),
  read_sequence bigint NOT NULL DEFAULT 0 CHECK(read_sequence>=0 AND read_sequence<=delivered_sequence),
  muted boolean NOT NULL DEFAULT false, joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(conversation_id,user_id)
);
CREATE UNIQUE INDEX messenger_one_owner ON public.messenger_members(conversation_id) WHERE role='owner';
CREATE INDEX messenger_member_inbox ON public.messenger_members(user_id,conversation_id);
CREATE TABLE public.messenger_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.messenger_conversations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  client_id uuid NOT NULL, sequence bigint NOT NULL CHECK(sequence>0),
  body text NOT NULL DEFAULT '' CHECK(length(body)<=10000),
  reply_to uuid REFERENCES public.messenger_messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), edited_at timestamptz,
  deletion_started_at timestamptz, deletion_files jsonb,
  UNIQUE(conversation_id,sequence), UNIQUE(sender_id,client_id)
);
-- UNIQUE(conversation_id,sequence) also serves both history scroll directions.
CREATE INDEX messenger_sender_rate ON public.messenger_messages(sender_id,created_at DESC);
CREATE INDEX messenger_reply_reference ON public.messenger_messages(reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX messenger_message_search ON public.messenger_messages USING gin(to_tsvector('simple',body));
-- Request deduplication survives message deletion; it retains no message text.
CREATE TABLE public.messenger_send_receipts (
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.messenger_conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messenger_messages(id) ON DELETE SET NULL,
  PRIMARY KEY(user_id,client_id)
);
CREATE TABLE public.messenger_reactions (
  message_id uuid REFERENCES public.messenger_messages(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK(reaction IN ('like','love','lol','smile','wow','sad')),
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(message_id,user_id)
);
CREATE INDEX messenger_receipt_message ON public.messenger_send_receipts(message_id);
CREATE TABLE public.messenger_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.messenger_conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messenger_messages(id) ON DELETE CASCADE,
  -- Account removal retains already-sent attachments for remaining members.
  uploader_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_id uuid UNIQUE REFERENCES storage.objects(id) ON DELETE SET NULL,
  object_path text NOT NULL UNIQUE, name text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  file_size bigint NOT NULL CHECK(file_size>0 AND file_size<=104857600),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messenger_attachment_message ON public.messenger_attachments(message_id);
CREATE INDEX messenger_attachment_conversation ON public.messenger_attachments(conversation_id,created_at DESC);
CREATE INDEX messenger_attachment_pending ON public.messenger_attachments(uploader_id,created_at) WHERE message_id IS NULL;
CREATE TABLE public.messenger_blocks (
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,blocked_id), CHECK(user_id<>blocked_id)
);
CREATE TABLE public.messenger_presence (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.messenger_sessions (
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id uuid NOT NULL, expires_at timestamptz NOT NULL, last_typing_at timestamptz,
  PRIMARY KEY(user_id,session_id)
);
CREATE INDEX messenger_session_expiry ON public.messenger_sessions(expires_at);
CREATE TABLE public.messenger_storage_cleanup (
  object_path text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['messenger_conversations','messenger_members','messenger_messages','messenger_reactions',
    'messenger_attachments','messenger_blocks','messenger_presence','messenger_sessions','messenger_storage_cleanup','messenger_send_receipts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  END LOOP;
END $$;

CREATE FUNCTION public.messenger_active(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p_user IS NOT NULL AND EXISTS(SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id=u.id
    WHERE u.id=p_user AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now()))
    AND NOT EXISTS(SELECT 1 FROM public.account_activation a WHERE a.user_id=p_user AND (NOT a.active OR a.must_change_password));
$$;
CREATE FUNCTION public.messenger_member(p_conversation uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.messenger_active(auth.uid()) AND EXISTS(SELECT 1 FROM public.messenger_members WHERE conversation_id=p_conversation AND user_id=auth.uid());
$$;
CREATE FUNCTION public.messenger_name(p_user uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(nullif(btrim(first_name),''),nullif(btrim(last_name),''),nullif(split_part(email,'@',1),''),'User') FROM public.profiles WHERE id=p_user;
$$;
CREATE FUNCTION public.messenger_blocked(p_first uuid,p_second uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.messenger_blocks WHERE (user_id=p_first AND blocked_id=p_second) OR (user_id=p_second AND blocked_id=p_first));
$$;
CREATE FUNCTION public.messenger_assert(p_conversation uuid,p_send boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.messenger_member(p_conversation) THEN RAISE EXCEPTION 'Conversation unavailable or access denied' USING ERRCODE='42501'; END IF;
  IF p_send AND EXISTS(SELECT 1 FROM public.messenger_conversations c JOIN public.messenger_members m ON m.conversation_id=c.id
    WHERE c.id=p_conversation AND c.kind='direct' AND m.user_id<>auth.uid() AND
      (NOT public.messenger_active(m.user_id) OR public.messenger_blocked(auth.uid(),m.user_id))) THEN
    RAISE EXCEPTION 'Messaging is unavailable for this conversation' USING ERRCODE='42501';
  END IF;
  IF p_send AND EXISTS(SELECT 1 FROM public.messenger_conversations c WHERE c.id=p_conversation AND c.kind='direct'
    AND (SELECT count(*) FROM public.messenger_members WHERE conversation_id=c.id)<>2) THEN
    RAISE EXCEPTION 'Messaging is unavailable for this conversation' USING ERRCODE='42501';
  END IF;
END $$;

-- Events contain identifiers only. Current data always comes from an authorized
-- RPC. A removed member is no longer a broadcast target, even on an old socket.
CREATE FUNCTION public.messenger_notify(p_conversation uuid,p_message uuid DEFAULT NULL,p_event text DEFAULT 'changed') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE recipient uuid; BEGIN
  FOR recipient IN SELECT user_id FROM public.messenger_members WHERE conversation_id=p_conversation LOOP
    IF public.messenger_active(recipient) THEN
      BEGIN
        PERFORM realtime.send(jsonb_build_object('conversation_id',p_conversation,'message_id',p_message,'kind',p_event),
          'changed','messenger:user:'||recipient::text,true);
      EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Messenger broadcast failed: SQLSTATE %',SQLSTATE;
      END;
    END IF;
  END LOOP;
END $$;

-- Receipts update affected authors and the reader's other sessions, rather than
-- broadcasting every delivery acknowledgement to all group members.
CREATE FUNCTION public.messenger_receipt_notify(p_conversation uuid,p_before bigint,p_after bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE recipient uuid; BEGIN
  FOR recipient IN SELECT m.user_id FROM public.messenger_members m WHERE m.conversation_id=p_conversation AND
    (m.user_id=auth.uid() OR EXISTS(SELECT 1 FROM public.messenger_messages msg WHERE msg.conversation_id=p_conversation
      AND msg.sequence>p_before AND msg.sequence<=p_after AND msg.sender_id=m.user_id)) LOOP
    IF public.messenger_active(recipient) THEN
      BEGIN
        PERFORM realtime.send(jsonb_build_object('conversation_id',p_conversation,'message_id',NULL,'kind','receipt'),
          'changed','messenger:user:'||recipient::text,true);
      EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Messenger receipt broadcast failed: SQLSTATE %',SQLSTATE;
      END;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.messenger_message_json(p public.messenger_messages) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',p.id,'conversation_id',p.conversation_id,'sender_id',p.sender_id,
    'sender_name',coalesce(public.messenger_name(p.sender_id),'Deleted user'),'sequence',p.sequence,'body',p.body,
    'created_at',p.created_at,'edited_at',p.edited_at,'deleting',p.deletion_started_at IS NOT NULL,
    'reply', (SELECT jsonb_build_object('id',r.id,'sender_name',coalesce(public.messenger_name(r.sender_id),'Deleted user'),
      'body',left(r.body,200)) FROM public.messenger_messages r WHERE r.id=p.reply_to AND r.conversation_id=p.conversation_id),
    'attachments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'mime_type',a.mime_type,'file_size',a.file_size,
      'available',a.source_id IS NOT NULL) ORDER BY a.created_at) FROM public.messenger_attachments a WHERE a.message_id=p.id),'[]'::jsonb),
    'reactions',coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',r.user_id,'name',coalesce(public.messenger_name(r.user_id),'User'),
      'reaction',r.reaction)) FROM public.messenger_reactions r WHERE r.message_id=p.id),'[]'::jsonb));
$$;
CREATE FUNCTION public.messenger_members_json(p_conversation uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',public.messenger_name(m.user_id),'role',m.role,
    'joined_sequence',m.joined_sequence,'delivered_sequence',m.delivered_sequence,'read_sequence',m.read_sequence,
    'online',EXISTS(SELECT 1 FROM public.messenger_sessions s WHERE s.user_id=m.user_id AND s.expires_at>now()),
    'last_seen',(SELECT last_seen FROM public.messenger_presence WHERE user_id=m.user_id),
    'blocked',EXISTS(SELECT 1 FROM public.messenger_blocks WHERE user_id=auth.uid() AND blocked_id=m.user_id)) ORDER BY m.joined_at),'[]'::jsonb)
  FROM public.messenger_members m WHERE m.conversation_id=p_conversation;
$$;
CREATE FUNCTION public.messenger_conversation_json(p_conversation uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',c.id,'kind',c.kind,'name',CASE WHEN c.kind='group' THEN c.name ELSE
      coalesce((SELECT public.messenger_name(user_id) FROM public.messenger_members WHERE conversation_id=c.id AND user_id<>auth.uid() LIMIT 1),'Deleted user') END,
    'updated_at',c.updated_at,'last_sequence',c.last_sequence,'muted',own.muted,'role',own.role,
    'can_send',c.kind='group' OR ((SELECT count(*) FROM public.messenger_members WHERE conversation_id=c.id)=2 AND NOT EXISTS(SELECT 1 FROM public.messenger_members m WHERE m.conversation_id=c.id AND m.user_id<>auth.uid()
      AND (NOT public.messenger_active(m.user_id) OR public.messenger_blocked(auth.uid(),m.user_id)))),
    'unread',(SELECT count(*) FROM public.messenger_messages WHERE conversation_id=c.id AND sequence>own.read_sequence AND sender_id IS DISTINCT FROM auth.uid()),
    'latest',(SELECT public.messenger_message_json(m) FROM public.messenger_messages m WHERE m.conversation_id=c.id ORDER BY m.sequence DESC LIMIT 1),
    'members',public.messenger_members_json(c.id))
  FROM public.messenger_conversations c JOIN public.messenger_members own ON own.conversation_id=c.id AND own.user_id=auth.uid() WHERE c.id=p_conversation;
$$;

-- No direct browser table writes, including no browser-supplied author/reader ID.
CREATE FUNCTION public.messenger_rpc(p_action text,p_conversation uuid DEFAULT NULL,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); target uuid; cid uuid; mid uuid; aid uuid; sid uuid;
  conv public.messenger_conversations; member public.messenger_members; msg public.messenger_messages;
  attachment public.messenger_attachments; source storage.objects; old_reaction text;
  ids uuid[]; attachment_ids uuid[]; count_ids integer; next_sequence bigint; requested bigint;
  text_value text:=btrim(coalesce(p_data->>'text','')); query text:=left(btrim(coalesce(p_data->>'query','')),100);
  result jsonb; receipt record; filename text; key_pair text; changed boolean:=false;
BEGIN
  IF NOT public.messenger_active(actor) THEN RAISE EXCEPTION 'Please sign in with an active account' USING ERRCODE='42501'; END IF;
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
      IF cid IS NOT NULL THEN RETURN jsonb_build_object('id',cid); END IF;
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
      WHERE m.user_id=actor AND m.delivered_sequence<c.last_sequence LOOP
      UPDATE public.messenger_members SET delivered_sequence=greatest(delivered_sequence,receipt.last_sequence)
        WHERE conversation_id=receipt.conversation_id AND user_id=actor AND delivered_sequence<receipt.last_sequence;
      IF FOUND THEN PERFORM public.messenger_receipt_notify(receipt.conversation_id,receipt.delivered_sequence,receipt.last_sequence); END IF;
    END LOOP;
    SELECT coalesce(jsonb_agg(public.messenger_conversation_json(row.id) ORDER BY row.updated_at DESC),'[]'::jsonb) INTO result
      FROM (SELECT c.id,c.updated_at FROM public.messenger_conversations c JOIN public.messenger_members m ON m.conversation_id=c.id AND m.user_id=actor
        WHERE query='' OR coalesce(c.name,'') ILIKE '%'||query||'%' OR EXISTS(SELECT 1 FROM public.messenger_members other WHERE other.conversation_id=c.id AND public.messenger_name(other.user_id) ILIKE '%'||query||'%')
        ORDER BY c.updated_at DESC,c.id LIMIT 50 OFFSET least(greatest(coalesce((p_data->>'offset')::int,0),0),100000)) row;
    RETURN jsonb_build_object('conversations',result,'unread',(SELECT count(*) FROM public.messenger_messages msg JOIN public.messenger_members m ON m.conversation_id=msg.conversation_id AND m.user_id=actor WHERE msg.sequence>m.read_sequence AND msg.sender_id IS DISTINCT FROM actor));
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

  PERFORM public.messenger_assert(p_conversation,p_action IN ('send','prepare-attachment','typing-targets'));
  SELECT * INTO conv FROM public.messenger_conversations WHERE id=p_conversation FOR UPDATE;
  -- Membership may have changed while waiting behind another group operation.
  PERFORM public.messenger_assert(p_conversation,p_action IN ('send','prepare-attachment','typing-targets'));
  SELECT * INTO member FROM public.messenger_members WHERE conversation_id=p_conversation AND user_id=actor;
  IF p_action='conversation' THEN RETURN public.messenger_conversation_json(p_conversation);
  ELSIF p_action='messages' THEN
    SELECT coalesce(jsonb_agg(public.messenger_message_json(row::public.messenger_messages) ORDER BY row.sequence),'[]'::jsonb) INTO result FROM
      (SELECT m.* FROM public.messenger_messages m WHERE m.conversation_id=p_conversation AND
        ((p_data->>'before') IS NULL OR m.sequence<(p_data->>'before')::bigint) ORDER BY m.sequence DESC LIMIT 50) row;
    RETURN result;
  ELSIF p_action='message' THEN
    SELECT * INTO msg FROM public.messenger_messages WHERE id=(p_data->>'id')::uuid AND conversation_id=p_conversation;
    RETURN CASE WHEN msg.id IS NULL THEN 'null'::jsonb ELSE public.messenger_message_json(msg) END;
  ELSIF p_action='snapshot' THEN
    -- Refresh the bounded loaded window after reconnect, including edits and
    -- deletions that happened while offline. Absent IDs are removed by the UI.
    IF jsonb_typeof(p_data->'ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'ids')>500 THEN RAISE EXCEPTION 'History window is too large'; END IF;
    SELECT coalesce(array_agg(DISTINCT value::uuid),'{}'::uuid[]) INTO ids FROM jsonb_array_elements_text(coalesce(p_data->'ids','[]'));
    IF cardinality(ids)>500 THEN RAISE EXCEPTION 'History window is too large'; END IF;
    SELECT coalesce(jsonb_agg(public.messenger_message_json(m) ORDER BY m.sequence),'[]'::jsonb) INTO result
      FROM public.messenger_messages m WHERE m.conversation_id=p_conversation AND m.id=ANY(ids);
    RETURN result;
  ELSIF p_action='since' THEN
    SELECT coalesce(jsonb_agg(public.messenger_message_json(row::public.messenger_messages) ORDER BY row.sequence),'[]'::jsonb) INTO result FROM
      (SELECT m.* FROM public.messenger_messages m WHERE m.conversation_id=p_conversation AND m.sequence>coalesce((p_data->>'sequence')::bigint,0)
       ORDER BY m.sequence LIMIT 200) row;
    RETURN result;
  ELSIF p_action='search' THEN
    IF length(query)<2 THEN RETURN '[]'::jsonb; END IF;
    SELECT coalesce(jsonb_agg(public.messenger_message_json(row::public.messenger_messages) ORDER BY row.sequence DESC),'[]'::jsonb) INTO result FROM
      (SELECT m.* FROM public.messenger_messages m WHERE m.conversation_id=p_conversation AND to_tsvector('simple',m.body) @@ websearch_to_tsquery('simple',query)
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
      RETURN public.messenger_message_json(msg);
    END IF;
    IF jsonb_typeof(coalesce(p_data->'attachments','[]'::jsonb)) IS DISTINCT FROM 'array' OR jsonb_array_length(coalesce(p_data->'attachments','[]'::jsonb))>10 THEN RAISE EXCEPTION 'A message can contain up to 10 attachments'; END IF;
    SELECT coalesce(array_agg(DISTINCT value::uuid),'{}'::uuid[]) INTO attachment_ids FROM jsonb_array_elements_text(coalesce(p_data->'attachments','[]'));
    IF length(text_value)>10000 OR (text_value='' AND cardinality(attachment_ids)=0) OR cardinality(attachment_ids)>10 THEN RAISE EXCEPTION 'Send text (up to 10,000 characters) or up to 10 attachments'; END IF;
    IF (SELECT count(*) FROM public.messenger_messages WHERE sender_id=actor AND created_at>now()-interval '1 minute')>=60 THEN RAISE EXCEPTION 'Please wait a moment before sending more messages'; END IF;
    IF (p_data->>'reply_to') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.messenger_messages WHERE id=(p_data->>'reply_to')::uuid AND conversation_id=p_conversation AND deletion_started_at IS NULL) THEN RAISE EXCEPTION 'The replied-to message is unavailable'; END IF;
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
    UPDATE public.messenger_members SET delivered_sequence=next_sequence WHERE conversation_id=p_conversation AND user_id=actor;
    PERFORM public.messenger_notify(p_conversation,msg.id); RETURN public.messenger_message_json(msg);
  ELSIF p_action IN ('edit','delete-plan','delete-message','react') THEN
    mid:=(p_data->>'id')::uuid;
    SELECT * INTO msg FROM public.messenger_messages WHERE id=mid AND conversation_id=p_conversation FOR UPDATE;
    IF msg.id IS NULL THEN
      IF p_action='delete-message' THEN RETURN '{}'::jsonb; END IF;
      IF p_action='delete-plan' THEN RETURN '[]'::jsonb; END IF;
      RAISE EXCEPTION 'Message unavailable';
    END IF;
    IF p_action='react' THEN
      IF msg.deletion_started_at IS NOT NULL THEN RAISE EXCEPTION 'Message is being deleted'; END IF;
      old_reaction:=p_data->>'reaction';
      IF old_reaction NOT IN ('like','love','lol','smile','wow','sad') OR old_reaction IS NULL THEN RAISE EXCEPTION 'Choose a valid reaction'; END IF;
      -- Locking the message serializes simultaneous toggles and replacements.
      IF EXISTS(SELECT 1 FROM public.messenger_reactions WHERE message_id=mid AND user_id=actor AND reaction=old_reaction) THEN
        DELETE FROM public.messenger_reactions WHERE message_id=mid AND user_id=actor;
      ELSE INSERT INTO public.messenger_reactions(message_id,user_id,reaction) VALUES(mid,actor,old_reaction)
        ON CONFLICT(message_id,user_id) DO UPDATE SET reaction=EXCLUDED.reaction,updated_at=now(); END IF;
    ELSE
      IF msg.sender_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'You can change only your own messages' USING ERRCODE='42501'; END IF;
      IF p_action='edit' THEN
        IF msg.deletion_started_at IS NOT NULL OR length(text_value)>10000 OR
          (text_value='' AND NOT EXISTS(SELECT 1 FROM public.messenger_attachments WHERE message_id=mid)) THEN RAISE EXCEPTION 'Enter a valid message'; END IF;
        UPDATE public.messenger_messages SET body=text_value,edited_at=now() WHERE id=mid RETURNING * INTO msg;
      ELSIF p_action='delete-plan' THEN
        UPDATE public.messenger_messages SET deletion_started_at=coalesce(deletion_started_at,now()) WHERE id=mid;
        -- Preserve the plan across source deletion (which cascades preview jobs).
        -- A retry must still verify/remove the same cached PDFs.
        IF msg.deletion_files IS NULL THEN
          SELECT coalesce(jsonb_agg(jsonb_build_object('path',a.object_path,'previews',coalesce((SELECT jsonb_agg(preview_path) FROM public.file_preview_jobs WHERE source_id=a.source_id),'[]'::jsonb))),'[]'::jsonb)
            INTO result FROM public.messenger_attachments a WHERE a.message_id=mid;
          UPDATE public.messenger_messages SET deletion_files=result WHERE id=mid;
        ELSE result:=msg.deletion_files; END IF;
        RETURN result;
      ELSE
        IF msg.deletion_started_at IS NULL OR EXISTS(SELECT 1 FROM public.messenger_attachments a JOIN storage.objects o ON o.bucket_id='messenger-attachments' AND o.name=a.object_path WHERE a.message_id=mid)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(msg.deletion_files,'[]')) item CROSS JOIN LATERAL jsonb_array_elements_text(item->'previews') path
            JOIN storage.objects o ON o.bucket_id='file-previews' AND o.name=path.value)
          THEN RAISE EXCEPTION 'Stored attachments have not been completely removed. Retry deletion'; END IF;
        DELETE FROM public.messenger_messages WHERE id=mid;
        PERFORM public.messenger_notify(p_conversation,mid,'deleted'); RETURN '{}'::jsonb;
      END IF;
    END IF;
    PERFORM public.messenger_notify(p_conversation,mid); SELECT * INTO msg FROM public.messenger_messages WHERE id=mid; RETURN public.messenger_message_json(msg);
  ELSIF p_action='files' THEN
    SELECT coalesce(jsonb_agg(row),'[]'::jsonb) INTO result FROM (SELECT a.id,a.name,a.mime_type,a.file_size,a.message_id FROM public.messenger_attachments a
      JOIN public.messenger_messages m ON m.id=a.message_id WHERE a.conversation_id=p_conversation AND m.deletion_started_at IS NULL
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

-- Group owner departure/account removal elects the oldest admin/member. No
-- account deletion is broadened to erase other members' conversation history.
CREATE FUNCTION public.messenger_owner_departed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE successor uuid; BEGIN
  IF OLD.role='owner' AND EXISTS(SELECT 1 FROM public.messenger_conversations WHERE id=OLD.conversation_id AND kind='group') THEN
    SELECT user_id INTO successor FROM public.messenger_members WHERE conversation_id=OLD.conversation_id ORDER BY (role='admin') DESC,joined_at,user_id LIMIT 1;
    IF successor IS NOT NULL THEN UPDATE public.messenger_members SET role='owner' WHERE conversation_id=OLD.conversation_id AND user_id=successor; END IF;
    UPDATE public.messenger_conversations SET owner_id=successor WHERE id=OLD.conversation_id;
  END IF; RETURN OLD;
END $$;
CREATE TRIGGER messenger_owner_departed AFTER DELETE ON public.messenger_members FOR EACH ROW EXECUTE FUNCTION public.messenger_owner_departed();
CREATE FUNCTION public.messenger_attachment_cleanup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  INSERT INTO public.messenger_storage_cleanup(object_path) VALUES(OLD.object_path) ON CONFLICT DO NOTHING; RETURN OLD;
END $$;
CREATE TRIGGER messenger_attachment_cleanup AFTER DELETE ON public.messenger_attachments FOR EACH ROW EXECUTE FUNCTION public.messenger_attachment_cleanup();
CREATE FUNCTION public.messenger_reconcile_uploads() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  DELETE FROM public.messenger_attachments WHERE message_id IS NULL AND created_at<now()-interval '24 hours';
  -- Also recover a late Storage completion after an aborted upload reservation.
  INSERT INTO public.messenger_storage_cleanup(object_path)
    SELECT o.name FROM storage.objects o WHERE o.bucket_id='messenger-attachments' AND o.created_at<now()-interval '15 minutes'
      AND NOT EXISTS(SELECT 1 FROM public.messenger_attachments a WHERE a.object_path=o.name)
    ON CONFLICT DO NOTHING;
END
$$;

INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('messenger-attachments','messenger-attachments',false,104857600)
  ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit;
CREATE FUNCTION public.messenger_upload_allowed(p_path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.messenger_attachments a WHERE a.object_path=p_path AND a.uploader_id=auth.uid() AND a.message_id IS NULL
    AND a.created_at>now()-interval '24 hours' AND public.messenger_member(a.conversation_id));
$$;
CREATE POLICY messenger_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='messenger-attachments' AND public.messenger_upload_allowed(name));
CREATE POLICY messenger_cancel_upload ON storage.objects FOR DELETE TO authenticated USING(bucket_id='messenger-attachments' AND public.messenger_upload_allowed(name));
-- Restrictive policies also guard against any pre-existing permissive bucket rule.
CREATE POLICY messenger_no_storage_reads ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(bucket_id<>'messenger-attachments');
CREATE POLICY messenger_no_storage_overwrite ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(bucket_id<>'messenger-attachments') WITH CHECK(bucket_id<>'messenger-attachments');
CREATE POLICY messenger_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(bucket_id<>'messenger-attachments' OR public.messenger_upload_allowed(name));
CREATE POLICY messenger_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id<>'messenger-attachments' OR public.messenger_upload_allowed(name));
CREATE POLICY messenger_anon_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO anon WITH CHECK(bucket_id<>'messenger-attachments');
CREATE POLICY messenger_anon_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO anon USING(bucket_id<>'messenger-attachments');

-- A cached authorization applies only to a user's OWN notifications topic. No
-- client can publish data or impersonate typing/presence on Messenger topics.
DO $$ BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RAISE EXCEPTION 'Messenger requires Supabase Realtime private Broadcast support'; END IF;
END $$;
CREATE POLICY messenger_receive ON realtime.messages FOR SELECT TO authenticated USING(extension='broadcast' AND public.messenger_active(auth.uid()) AND realtime.topic()='messenger:user:'||auth.uid()::text);
CREATE POLICY messenger_topic_read_guard ON realtime.messages AS RESTRICTIVE FOR SELECT TO authenticated
  USING(realtime.topic() NOT LIKE 'messenger:%' OR (auth.uid() IS NOT NULL AND extension='broadcast' AND public.messenger_active(auth.uid()) AND realtime.topic()='messenger:user:'||auth.uid()::text));
CREATE POLICY messenger_anon_topic_guard ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon USING(realtime.topic() NOT LIKE 'messenger:%');
CREATE POLICY messenger_topic_write_guard ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(realtime.topic() NOT LIKE 'messenger:%');
DO $$ BEGIN
  -- Current self-hosted Realtime tenant schema. Fail closed rather than let a
  -- browser bypass private-channel authorization by setting private:false.
  IF to_regclass('_realtime.tenants') IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='_realtime' AND table_name='tenants' AND column_name='private_only') THEN
      RAISE EXCEPTION 'Upgrade Realtime to support private_only before enabling Messenger';
    END IF;
    -- Runtime configuration is installed by deploy.sh using supabase_admin.
    -- Application migrations run as postgres, which cannot update this table.
    -- This initial migration failed transactionally before being applied; keep
    -- its safety check while separating tenant administration from app DDL.
    IF NOT EXISTS(SELECT 1 FROM _realtime.tenants) OR
      EXISTS(SELECT 1 FROM _realtime.tenants WHERE private_only IS DISTINCT FROM true) THEN
      RAISE EXCEPTION 'Enable private Realtime access using scripts/deploy.sh before enabling Messenger';
    END IF;
  END IF;
END $$;

-- Revoke helpers, leaving only the narrow RPC and boolean Storage policy helper.
DO $$ DECLARE fn record; BEGIN
  FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'messenger_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn.signature);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.messenger_rpc(text,uuid,jsonb),public.messenger_upload_allowed(text),public.messenger_active(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
