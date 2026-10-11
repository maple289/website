-- WebRTC signaling only: never store recorded audio/video. Signaling expires.
CREATE TABLE public.messenger_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.messenger_conversations(id) ON DELETE CASCADE,
  caller_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  client_id uuid NOT NULL,
  media text NOT NULL CHECK(media IN ('voice','video')),
  state text NOT NULL DEFAULT 'ringing' CHECK(state IN ('ringing','active','ended')),
  outcome text CHECK(outcome IN ('completed','missed','declined','cancelled','failed')),
  started_at timestamptz NOT NULL DEFAULT now(), answered_at timestamptz, ended_at timestamptz,
  CHECK((state='ended')=(ended_at IS NOT NULL)), UNIQUE(caller_id,client_id)
);
CREATE UNIQUE INDEX messenger_one_call_per_conversation ON public.messenger_calls(conversation_id) WHERE state<>'ended';
CREATE INDEX messenger_calls_unfinished ON public.messenger_calls(started_at) WHERE state<>'ended';
CREATE TABLE public.messenger_call_members (
  call_id uuid NOT NULL REFERENCES public.messenger_calls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  state text NOT NULL CHECK(state IN ('invited','joined','declined','left','missed')),
  session_id uuid, heartbeat_at timestamptz, seen_at timestamptz, relay_requested_at timestamptz,
  PRIMARY KEY(call_id,user_id)
);
CREATE UNIQUE INDEX messenger_one_call_per_user ON public.messenger_call_members(user_id) WHERE state IN ('invited','joined');
CREATE INDEX messenger_call_notifications ON public.messenger_call_members(user_id,call_id) WHERE seen_at IS NULL;
CREATE TABLE public.messenger_call_signals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  call_id uuid NOT NULL REFERENCES public.messenger_calls(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('offer','answer','candidate')),
  payload jsonb NOT NULL CHECK(octet_length(payload::text)<=32768),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(sender_id,client_id), CHECK(sender_id<>recipient_id)
);
CREATE INDEX messenger_call_signal_inbox ON public.messenger_call_signals(call_id,recipient_id,id);
CREATE INDEX messenger_call_signal_expiry ON public.messenger_call_signals(created_at);
ALTER TABLE public.messenger_messages ADD COLUMN call_id uuid REFERENCES public.messenger_calls(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX messenger_call_timeline ON public.messenger_messages(call_id) WHERE call_id IS NOT NULL;
ALTER TABLE public.messenger_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messenger_call_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messenger_call_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.messenger_calls,public.messenger_call_members,public.messenger_call_signals FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.messenger_calls,public.messenger_call_members,public.messenger_call_signals TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.messenger_call_signals_id_seq TO service_role;

CREATE FUNCTION public.messenger_call_notify(p_call uuid,p_target uuid DEFAULT NULL,p_signal boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient uuid; cid uuid;
BEGIN
  SELECT conversation_id INTO cid FROM public.messenger_calls WHERE id=p_call;
  FOR recipient IN SELECT cm.user_id FROM public.messenger_call_members cm
    JOIN public.messenger_members m ON m.user_id=cm.user_id AND m.conversation_id=cid
    WHERE cm.call_id=p_call AND (p_target IS NULL OR cm.user_id=p_target) AND public.messenger_active(cm.user_id)
  LOOP
    BEGIN
      PERFORM realtime.send(jsonb_build_object('conversation_id',cid,'call_id',p_call,
        'kind',CASE WHEN p_signal THEN 'call-signal' ELSE 'call-state' END),
        'changed','messenger:user:'||recipient::text,true);
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Call notification failed: SQLSTATE %',SQLSTATE;
    END;
  END LOOP;
END $$;
CREATE FUNCTION public.messenger_call_finish(p_call uuid,p_outcome text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  UPDATE public.messenger_calls SET state='ended',outcome=p_outcome,ended_at=now() WHERE id=p_call AND state<>'ended';
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.messenger_call_members SET state=CASE WHEN state='invited' THEN 'missed' ELSE 'left' END
    WHERE call_id=p_call AND state IN ('joined','invited');
  DELETE FROM public.messenger_call_signals WHERE call_id=p_call;
  PERFORM public.messenger_call_notify(p_call);
END $$;
CREATE FUNCTION public.messenger_reconcile_calls() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.messenger_calls;
BEGIN
  -- Short database critical section, independent of FFmpeg workers.
  PERFORM pg_catalog.pg_advisory_xact_lock(827160042);
  DELETE FROM public.messenger_call_signals WHERE created_at<now()-interval '2 minutes';
  FOR c IN SELECT * FROM public.messenger_calls WHERE state<>'ended' ORDER BY id FOR UPDATE LOOP
    IF EXISTS(SELECT 1 FROM public.messenger_call_members cm WHERE cm.call_id=c.id AND cm.state IN ('joined','invited')
      AND (NOT public.messenger_active(cm.user_id) OR NOT EXISTS(SELECT 1 FROM public.messenger_members m WHERE m.conversation_id=c.conversation_id AND m.user_id=cm.user_id)))
      OR EXISTS(SELECT 1 FROM public.messenger_call_members a JOIN public.messenger_call_members b ON a.call_id=b.call_id AND a.user_id<b.user_id
        WHERE a.call_id=c.id AND a.state IN ('joined','invited') AND b.state IN ('joined','invited') AND public.messenger_blocked(a.user_id,b.user_id)) THEN
      PERFORM public.messenger_call_finish(c.id,'failed'); CONTINUE;
    END IF;
    UPDATE public.messenger_call_members SET state='left' WHERE call_id=c.id AND state='joined' AND heartbeat_at<now()-interval '90 seconds';
    IF c.started_at<now()-interval '45 seconds' THEN
      UPDATE public.messenger_call_members SET state='missed' WHERE call_id=c.id AND state='invited';
      IF FOUND THEN PERFORM public.messenger_call_notify(c.id); END IF;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.messenger_call_members WHERE call_id=c.id AND state='joined')
      OR (c.state='ringing' AND NOT EXISTS(SELECT 1 FROM public.messenger_call_members WHERE call_id=c.id AND state='invited'))
      OR (c.state='active' AND (SELECT count(*) FROM public.messenger_call_members WHERE call_id=c.id AND state='joined')<2
        AND NOT EXISTS(SELECT 1 FROM public.messenger_call_members WHERE call_id=c.id AND state='invited')) THEN
      PERFORM public.messenger_call_finish(c.id,CASE WHEN c.answered_at IS NOT NULL THEN 'completed'
        WHEN EXISTS(SELECT 1 FROM public.messenger_call_members WHERE call_id=c.id AND state='declined') THEN 'declined' ELSE 'missed' END);
    ELSIF c.started_at<now()-interval '4 hours' THEN PERFORM public.messenger_call_finish(c.id,'completed');
    END IF;
  END LOOP;
END $$;
CREATE FUNCTION public.messenger_call_json(p_call uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',c.id,'conversation_id',c.conversation_id,'caller_id',c.caller_id,
    'caller_name',coalesce(public.messenger_name(c.caller_id),'Deleted user'),
    'name',CASE WHEN conv.kind='group' THEN conv.name ELSE coalesce(public.messenger_name(
      (SELECT user_id FROM public.messenger_call_members WHERE call_id=c.id AND user_id<>auth.uid() LIMIT 1)),'Call') END,
    'media',c.media,'state',c.state,'outcome',c.outcome,'started_at',c.started_at,'answered_at',c.answered_at,'ended_at',c.ended_at,
    'duration',greatest(0,extract(epoch FROM(coalesce(c.ended_at,now())-c.answered_at))::integer),
    'my_state',own.state,'mine',own.session_id IS NOT NULL,'seen',own.seen_at IS NOT NULL,
    'members',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.user_id,'name',public.messenger_name(m.user_id),'state',m.state) ORDER BY m.user_id)
      FROM public.messenger_call_members m WHERE m.call_id=c.id),'[]'::jsonb))
  FROM public.messenger_calls c JOIN public.messenger_conversations conv ON conv.id=c.conversation_id
  LEFT JOIN public.messenger_call_members own ON own.call_id=c.id AND own.user_id=auth.uid()
  WHERE c.id=p_call AND public.messenger_member(c.conversation_id);
$$;

-- Reuse the existing message serializer and preserve its scoped-deletion rules.
ALTER FUNCTION public.messenger_message_json(public.messenger_messages) RENAME TO messenger_message_json_before_calls;
CREATE FUNCTION public.messenger_message_json(p public.messenger_messages) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.messenger_message_json_before_calls(p)||jsonb_build_object('call_event',p.call_id IS NOT NULL,'call',CASE WHEN p.deleted_at IS NULL AND p.deletion_started_at IS NULL
    AND p.call_id IS NOT NULL THEN public.messenger_call_json(p.call_id) ELSE NULL END);
$$;
-- SQL callers of the old function resolve dependencies by OID. Rebuild their
-- definitions so every snapshot uses the enriched serializer as well.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('messenger_rpc','messenger_conversation_json')
  LOOP EXECUTE pg_catalog.pg_get_functiondef(f.oid); END LOOP;
END $$;
CREATE FUNCTION public.messenger_call_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF OLD.call_id IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.deletion_started_at IS NULL AND NEW.body IS DISTINCT FROM OLD.body THEN
    RAISE EXCEPTION 'Call history cannot be edited';
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER messenger_call_history_guard BEFORE UPDATE ON public.messenger_messages FOR EACH ROW EXECUTE FUNCTION public.messenger_call_history_guard();

CREATE FUNCTION public.messenger_calls_rpc(p_action text,p_call uuid DEFAULT NULL,p_data jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); c public.messenger_calls; own public.messenger_call_members; cid uuid;
  sid uuid; nonce uuid; target uuid; seq bigint; result jsonb; peer_count integer;
BEGIN
  IF NOT public.messenger_active(actor) THEN RAISE EXCEPTION 'Please sign in with an active account' USING ERRCODE='42501'; END IF;
  IF octet_length(p_data::text)>40000 THEN RAISE EXCEPTION 'Call request too large'; END IF;
  IF p_action='start' THEN
    cid:=(p_data->>'conversation_id')::uuid; sid:=(p_data->>'session_id')::uuid; nonce:=(p_data->>'client_id')::uuid;
    IF sid IS NULL OR nonce IS NULL OR p_data->>'media' IS NULL OR p_data->>'media' NOT IN ('voice','video') THEN RAISE EXCEPTION 'Invalid call request'; END IF;
    PERFORM 1 FROM public.messenger_conversations WHERE id=cid FOR UPDATE;
    PERFORM public.messenger_assert(cid,true);
    PERFORM public.messenger_reconcile_calls();
    SELECT * INTO c FROM public.messenger_calls WHERE caller_id=actor AND client_id=nonce;
    IF c.id IS NOT NULL THEN
      IF c.conversation_id<>cid OR NOT EXISTS(SELECT 1 FROM public.messenger_call_members WHERE call_id=c.id AND user_id=actor AND session_id=sid) THEN
        RAISE EXCEPTION 'This call request belongs to another session'; END IF;
      RETURN public.messenger_call_json(c.id);
    END IF;
    SELECT count(*) INTO peer_count FROM public.messenger_members WHERE conversation_id=cid;
    IF peer_count<2 OR peer_count>4 THEN RAISE EXCEPTION 'Calls support two to four conversation members'; END IF;
    IF EXISTS(SELECT 1 FROM public.messenger_members WHERE conversation_id=cid AND NOT public.messenger_active(user_id))
      OR EXISTS(SELECT 1 FROM public.messenger_members a JOIN public.messenger_members b ON a.conversation_id=b.conversation_id AND a.user_id<b.user_id
        WHERE a.conversation_id=cid AND public.messenger_blocked(a.user_id,b.user_id)) THEN RAISE EXCEPTION 'A conversation member is unavailable or blocked'; END IF;
    IF EXISTS(SELECT 1 FROM public.messenger_calls WHERE conversation_id=cid AND state<>'ended') OR EXISTS(
      SELECT 1 FROM public.messenger_call_members cm JOIN public.messenger_members m ON m.user_id=cm.user_id
      WHERE m.conversation_id=cid AND cm.state IN ('joined','invited')) THEN RAISE EXCEPTION 'A participant is already in a call'; END IF;
    IF (SELECT count(*) FROM public.messenger_calls WHERE caller_id=actor AND started_at>now()-interval '1 minute')>=5 THEN RAISE EXCEPTION 'Please wait before calling again'; END IF;
    INSERT INTO public.messenger_calls(conversation_id,caller_id,client_id,media) VALUES(cid,actor,nonce,p_data->>'media') RETURNING * INTO c;
    INSERT INTO public.messenger_call_members(call_id,user_id,state,session_id,heartbeat_at,seen_at)
      SELECT c.id,user_id,CASE WHEN user_id=actor THEN 'joined' ELSE 'invited' END,
        CASE WHEN user_id=actor THEN sid END,CASE WHEN user_id=actor THEN now() END,CASE WHEN user_id=actor THEN now() END
      FROM public.messenger_members WHERE conversation_id=cid;
    UPDATE public.messenger_conversations SET last_sequence=last_sequence+1,updated_at=now() WHERE id=cid RETURNING last_sequence INTO seq;
    UPDATE public.messenger_members SET hidden=false WHERE conversation_id=cid;
    INSERT INTO public.messenger_messages(conversation_id,sender_id,client_id,sequence,body,call_id)
      VALUES(cid,actor,nonce,seq,CASE WHEN c.media='video' THEN 'Video call' ELSE 'Voice call' END,c.id);
    PERFORM public.messenger_call_notify(c.id); RETURN public.messenger_call_json(c.id);
  END IF;
  PERFORM public.messenger_reconcile_calls();
  IF p_action='inbox' THEN
    SELECT coalesce(jsonb_agg(public.messenger_call_json(x.id) ORDER BY x.started_at DESC),'[]'::jsonb) INTO result
      FROM (SELECT entry.id,entry.started_at FROM public.messenger_calls entry JOIN public.messenger_call_members cm ON cm.call_id=entry.id
        WHERE cm.user_id=actor AND public.messenger_member(entry.conversation_id) AND (entry.state<>'ended'
          OR (cm.seen_at IS NULL AND cm.state='missed' AND EXISTS(SELECT 1 FROM public.messenger_messages m
            WHERE m.call_id=entry.id AND m.deleted_at IS NULL AND public.messenger_message_visible(m.id))))
        ORDER BY entry.started_at DESC LIMIT 50) x;
    RETURN result;
  END IF;
  SELECT * INTO c FROM public.messenger_calls WHERE id=p_call FOR UPDATE;
  IF c.id IS NULL OR NOT public.messenger_member(c.conversation_id) THEN RAISE EXCEPTION 'Call unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO own FROM public.messenger_call_members WHERE call_id=c.id AND user_id=actor;
  IF own.user_id IS NULL THEN RAISE EXCEPTION 'Call unavailable' USING ERRCODE='42501'; END IF;
  sid:=(p_data->>'session_id')::uuid;
  IF p_action='seen' THEN
    UPDATE public.messenger_call_members SET seen_at=now() WHERE call_id=c.id AND user_id=actor; RETURN '{}'::jsonb;
  ELSIF p_action='decline' THEN
    IF own.state='invited' THEN UPDATE public.messenger_call_members SET state='declined',seen_at=now() WHERE call_id=c.id AND user_id=actor;
      PERFORM public.messenger_reconcile_calls(); PERFORM public.messenger_call_notify(c.id); END IF;
    RETURN public.messenger_call_json(c.id);
  ELSIF p_action='accept' THEN
    IF sid IS NULL OR c.state='ended' OR (own.state<>'invited' AND (own.state<>'joined' OR own.session_id IS DISTINCT FROM sid)) THEN RAISE EXCEPTION 'This call is no longer available'; END IF;
    UPDATE public.messenger_call_members SET state='joined',session_id=sid,heartbeat_at=now(),seen_at=now() WHERE call_id=c.id AND user_id=actor;
    UPDATE public.messenger_calls SET state='active',answered_at=coalesce(answered_at,now()) WHERE id=c.id;
    PERFORM public.messenger_call_notify(c.id); RETURN public.messenger_call_json(c.id);
  END IF;
  IF p_action='snapshot' THEN RETURN public.messenger_call_json(c.id); END IF;
  IF sid IS NULL OR own.session_id IS DISTINCT FROM sid THEN RAISE EXCEPTION 'This call is active in another browser tab' USING ERRCODE='42501'; END IF;
  IF p_action='heartbeat' AND (c.state='ended' OR own.state<>'joined') THEN RETURN public.messenger_call_json(c.id); END IF;
  IF p_action='end' THEN
    IF c.state='ended' OR own.state<>'joined' THEN RETURN public.messenger_call_json(c.id); END IF;
    UPDATE public.messenger_call_members SET state='left',seen_at=now() WHERE call_id=c.id AND user_id=actor;
    IF c.state='ringing' AND c.caller_id=actor THEN PERFORM public.messenger_call_finish(c.id,'cancelled');
    ELSE PERFORM public.messenger_reconcile_calls(); PERFORM public.messenger_call_notify(c.id); END IF;
    RETURN public.messenger_call_json(c.id);
  END IF;
  IF c.state='ended' OR own.state<>'joined' THEN RAISE EXCEPTION 'This call has ended'; END IF;
  IF p_action='heartbeat' THEN
    UPDATE public.messenger_call_members SET heartbeat_at=now() WHERE call_id=c.id AND user_id=actor;
    RETURN public.messenger_call_json(c.id);
  ELSIF p_action='credentials' THEN
    RETURN jsonb_build_object('ok',true,'user_id',actor);
  ELSIF p_action='relay-reserve' THEN
    -- Relay credentials authorize resources. Serialize and bound issuance per
    -- joined browser session; the later authorization recheck is read-only.
    IF own.relay_requested_at>now()-interval '30 seconds' THEN RAISE EXCEPTION 'Please wait before requesting relay credentials again'; END IF;
    UPDATE public.messenger_call_members SET relay_requested_at=now() WHERE call_id=c.id AND user_id=actor;
    RETURN jsonb_build_object('ok',true,'user_id',actor);
  ELSIF p_action='signals' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'sender_id',s.sender_id,'kind',s.kind,'payload',s.payload) ORDER BY s.id),'[]'::jsonb) INTO result
      FROM (SELECT * FROM public.messenger_call_signals WHERE call_id=c.id AND recipient_id=actor
        AND id>greatest(coalesce((p_data->>'after')::bigint,0),0) ORDER BY id LIMIT 200) s;
    RETURN result;
  ELSIF p_action='signal' THEN
    target:=(p_data->>'recipient_id')::uuid; nonce:=(p_data->>'client_id')::uuid;
    IF nonce IS NULL OR target IS NULL OR target=actor OR NOT EXISTS(SELECT 1 FROM public.messenger_call_members cm
      JOIN public.messenger_members m ON m.user_id=cm.user_id AND m.conversation_id=c.conversation_id
      WHERE cm.call_id=c.id AND cm.user_id=target AND cm.state='joined' AND public.messenger_active(cm.user_id))
      OR public.messenger_blocked(actor,target) THEN RAISE EXCEPTION 'Call participant unavailable' USING ERRCODE='42501'; END IF;
    IF p_data->>'kind' IS NULL OR p_data->>'kind' NOT IN ('offer','answer','candidate') OR jsonb_typeof(p_data->'payload') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid call signal'; END IF;
    IF (SELECT count(*) FROM public.messenger_call_signals WHERE sender_id=actor AND created_at>now()-interval '1 minute')>=600 THEN RAISE EXCEPTION 'Too many call signals'; END IF;
    INSERT INTO public.messenger_call_signals(call_id,sender_id,recipient_id,client_id,kind,payload)
      VALUES(c.id,actor,target,nonce,p_data->>'kind',p_data->'payload') ON CONFLICT(sender_id,client_id) DO NOTHING;
    IF FOUND THEN PERFORM public.messenger_call_notify(c.id,target,true); END IF; RETURN '{}'::jsonb;
  END IF;
  RAISE EXCEPTION 'Unknown call action';
END $$;

REVOKE ALL ON FUNCTION public.messenger_call_notify(uuid,uuid,boolean),public.messenger_call_finish(uuid,text),
  public.messenger_reconcile_calls(),public.messenger_call_json(uuid),public.messenger_call_history_guard(),
  public.messenger_message_json_before_calls(public.messenger_messages),public.messenger_message_json(public.messenger_messages),
  public.messenger_calls_rpc(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.messenger_calls_rpc(text,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.messenger_reconcile_calls() TO service_role;
NOTIFY pgrst,'reload schema';
