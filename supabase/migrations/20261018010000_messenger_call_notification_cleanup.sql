-- Close ended-call alerts through authenticated page/SW reconciliation.
-- Never enqueue replacement or silent close-only Web Push. Existing grants
-- and function signatures are retained, including already installed versions.

CREATE OR REPLACE FUNCTION public.messenger_notification_payload(p public.messenger_notification_events) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE pref public.messenger_notification_preferences; own public.messenger_members;
  msg public.messenger_messages; c public.messenger_calls; sender uuid; label text; body text;
BEGIN
  IF p.expires_at<=now() OR NOT public.messenger_active(p.recipient_id) THEN RETURN NULL; END IF;
  IF p.kind='call-closed' THEN
    RETURN jsonb_build_object('id',p.id,'kind',p.kind,'conversation_id',p.conversation_id,'call_id',p.call_id,
      'sender_name',coalesce((SELECT left(public.messenger_name(caller_id),100) FROM public.messenger_calls WHERE id=p.call_id),'myhostage'),
      'body','','sound',false,'expires_at',to_char(p.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  END IF;
  SELECT * INTO own FROM public.messenger_members WHERE conversation_id=p.conversation_id AND user_id=p.recipient_id;
  IF NOT FOUND OR own.muted OR own.hidden THEN RETURN NULL; END IF;
  SELECT * INTO pref FROM public.messenger_notification_preferences WHERE user_id=p.recipient_id;
  IF p.kind='message' THEN
    IF pref.notify_messages=false THEN RETURN NULL; END IF;
    SELECT * INTO msg FROM public.messenger_messages WHERE id=p.message_id AND conversation_id=p.conversation_id;
    IF NOT FOUND OR msg.deleted_at IS NOT NULL OR msg.deletion_started_at IS NOT NULL
      OR msg.sequence<=greatest(own.read_sequence,own.cleared_sequence,(SELECT cleared_sequence FROM public.messenger_conversations WHERE id=p.conversation_id))
      OR EXISTS(SELECT 1 FROM public.messenger_message_hides WHERE message_id=msg.id AND user_id=p.recipient_id) THEN RETURN NULL; END IF;
    sender:=msg.sender_id;
    body:=CASE WHEN pref.show_message_preview=false THEN 'New message' ELSE coalesce(nullif(left(msg.body,180),''),'New attachment') END;
  ELSE
    IF (p.kind='voice' AND pref.notify_voice_calls=false) OR (p.kind='video' AND pref.notify_video_calls=false) THEN RETURN NULL; END IF;
    SELECT * INTO c FROM public.messenger_calls WHERE id=p.call_id AND conversation_id=p.conversation_id;
    IF NOT FOUND OR c.state='ended' OR c.started_at<now()-interval '45 seconds'
      OR NOT EXISTS(SELECT 1 FROM public.messenger_call_members WHERE call_id=c.id AND user_id=p.recipient_id AND state='invited') THEN RETURN NULL; END IF;
    sender:=c.caller_id; body:=CASE p.kind WHEN 'voice' THEN 'Incoming Voice Call' ELSE 'Incoming Video Call' END;
  END IF;
  IF sender IS NULL OR NOT public.messenger_active(sender) OR public.messenger_blocked(p.recipient_id,sender) THEN RETURN NULL; END IF;
  label:=public.messenger_name(sender);
  RETURN jsonb_build_object('id',p.id,'kind',p.kind,'conversation_id',p.conversation_id,
    'message_id',p.message_id,'call_id',p.call_id,'sender_name',left(label,100),'body',body,
    'sound',coalesce(pref.sound_enabled,true),'expires_at',to_char(p.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END $$;

CREATE OR REPLACE FUNCTION public.messenger_notifications_rpc(p_action text,p_data jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); result jsonb; prefs public.messenger_notification_preferences;
  device public.messenger_push_subscriptions; entry public.messenger_notification_events;
  cursor_value bigint; endpoint_value text; key_value text; auth_value text;
  job public.messenger_push_deliveries; payload jsonb; token uuid; active_calls jsonb;
BEGIN
  IF NOT public.messenger_active(actor) THEN RAISE EXCEPTION 'An active account is required' USING ERRCODE='42501'; END IF;
  IF octet_length(p_data::text)>12000 THEN RAISE EXCEPTION 'Invalid notification request'; END IF;
  IF p_action IN ('settings','preferences') THEN
    INSERT INTO public.messenger_notification_preferences(user_id) VALUES(actor) ON CONFLICT DO NOTHING;
    IF p_action='preferences' THEN
      IF EXISTS(SELECT 1 FROM jsonb_each(p_data) x WHERE x.key NOT IN ('notify_messages','notify_voice_calls','notify_video_calls','show_message_preview','sound_enabled') OR jsonb_typeof(x.value)<>'boolean') THEN
        RAISE EXCEPTION 'Invalid notification preferences'; END IF;
      UPDATE public.messenger_notification_preferences SET
        notify_messages=coalesce((p_data->>'notify_messages')::boolean,notify_messages),
        notify_voice_calls=coalesce((p_data->>'notify_voice_calls')::boolean,notify_voice_calls),
        notify_video_calls=coalesce((p_data->>'notify_video_calls')::boolean,notify_video_calls),
        show_message_preview=coalesce((p_data->>'show_message_preview')::boolean,show_message_preview),
        sound_enabled=coalesce((p_data->>'sound_enabled')::boolean,sound_enabled) WHERE user_id=actor;
    END IF;
    SELECT * INTO prefs FROM public.messenger_notification_preferences WHERE user_id=actor;
    RETURN jsonb_build_object('preferences',to_jsonb(prefs)-'user_id',
      'muted_conversations',coalesce((SELECT jsonb_agg(conversation_id) FROM public.messenger_members WHERE user_id=actor AND muted),'[]'::jsonb),
      'public_key',(SELECT public_key FROM public.messenger_push_config WHERE singleton),
      'available',coalesce((SELECT heartbeat_at>now()-interval '3 minutes' FROM public.messenger_push_config WHERE singleton),false));
  ELSIF p_action='subscribe' THEN
    endpoint_value:=p_data->'subscription'->>'endpoint'; key_value:=p_data->'subscription'->'keys'->>'p256dh'; auth_value:=p_data->'subscription'->'keys'->>'auth';
    IF NOT coalesce(public.messenger_push_endpoint_valid(endpoint_value),false)
      OR key_value IS NULL OR key_value !~ '^[A-Za-z0-9_-]{87}={0,1}$'
      OR auth_value IS NULL OR auth_value !~ '^[A-Za-z0-9_-]{22}={0,2}$' THEN RAISE EXCEPTION 'Invalid push subscription'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,731));
    PERFORM pg_advisory_xact_lock(hashtextextended(endpoint_value,732));
    SELECT * INTO device FROM public.messenger_push_subscriptions WHERE endpoint=endpoint_value FOR UPDATE;
    IF FOUND AND device.user_id<>actor THEN RAISE EXCEPTION 'This browser subscription belongs to another account. Disable it and enable notifications again'; END IF;
    IF device.id IS NULL AND (SELECT count(*) FROM public.messenger_push_subscriptions WHERE user_id=actor)>=30 THEN RAISE EXCEPTION 'Device limit reached'; END IF;
    INSERT INTO public.messenger_push_subscriptions(user_id,endpoint,p256dh,auth,device_label,auth_session_id)
      VALUES(actor,endpoint_value,key_value,auth_value,left(coalesce(p_data->>'device_label','Browser'),100),
        nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id','')::uuid)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,enabled=true,
        created_at=CASE WHEN NOT messenger_push_subscriptions.enabled THEN now() ELSE messenger_push_subscriptions.created_at END,
        device_label=excluded.device_label,auth_session_id=excluded.auth_session_id,last_used_at=now() RETURNING * INTO device;
    RETURN jsonb_build_object('id',device.id);
  ELSIF p_action IN ('disable','device') THEN
    SELECT * INTO device FROM public.messenger_push_subscriptions WHERE id=(p_data->>'id')::uuid AND user_id=actor;
    IF p_action='disable' THEN
      UPDATE public.messenger_push_subscriptions SET enabled=false WHERE id=device.id;
      RETURN '{}'::jsonb;
    END IF;
    RETURN jsonb_build_object('enabled',coalesce(device.enabled,false));
  ELSIF p_action IN ('delivery-claim','delivery-ack') THEN
    SELECT * INTO entry FROM public.messenger_notification_events WHERE id=(p_data->>'id')::uuid AND recipient_id=actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'Notification unavailable' USING ERRCODE='42501'; END IF;
    payload:=public.messenger_notification_payload(entry);
    IF payload IS NULL THEN RETURN jsonb_build_object('action','ignore'); END IF;
    SELECT * INTO device FROM public.messenger_push_subscriptions WHERE id=(p_data->>'device_id')::uuid AND user_id=actor AND enabled;
    IF NOT FOUND THEN RETURN jsonb_build_object('action','local','payload',payload); END IF;
    IF p_action='delivery-ack' THEN
      UPDATE public.messenger_push_deliveries SET finished=true,lease_until=NULL
        WHERE event_id=entry.id AND subscription_id=device.id AND lease=(p_data->>'lease')::uuid AND lease_mode='page';
      RETURN '{}'::jsonb;
    END IF;
    INSERT INTO public.messenger_push_deliveries(event_id,subscription_id) VALUES(entry.id,device.id) ON CONFLICT DO NOTHING;
    SELECT * INTO job FROM public.messenger_push_deliveries WHERE event_id=entry.id AND subscription_id=device.id FOR UPDATE;
    -- Once submitted to a provider it must remain an OS notification. In
    -- particular Safari forbids silently consuming a real push in the page.
    IF job.lease_mode='push' THEN RETURN jsonb_build_object('action','push'); END IF;
    token:=coalesce(CASE WHEN job.lease_mode='page' AND job.lease_until>now() THEN job.lease END,gen_random_uuid());
    UPDATE public.messenger_push_deliveries SET lease=token,lease_mode='page',lease_until=now()+interval '5 seconds' WHERE id=job.id;
    RETURN jsonb_build_object('action','page','lease',token,'payload',payload);
  ELSIF p_action='events' THEN
    -- Reconcile existing OS call alerts even when a page resumes after missing
    -- the close event. This is metadata only: no read/call-state mutation.
    SELECT coalesce(jsonb_agg(e.call_id),'[]'::jsonb) INTO active_calls FROM public.messenger_notification_events e
      WHERE e.recipient_id=actor AND e.kind IN ('voice','video') AND e.expires_at>now()
        AND public.messenger_notification_payload(e) IS NOT NULL;
    IF p_data->>'after' IS NULL AND p_data->>'since' IS NULL THEN
      RETURN jsonb_build_object('cursor',coalesce((SELECT max(sequence) FROM public.messenger_notification_events WHERE recipient_id=actor),0),'events','[]'::jsonb,'active_calls',active_calls);
    END IF;
    IF p_data->>'after' IS NULL THEN
      -- A short startup overlap catches messages received while the page loads.
      -- IDs are deduplicated by the browser. Clamp clock skew and old timestamps.
      SELECT coalesce(max(sequence),0) INTO cursor_value FROM public.messenger_notification_events
        WHERE recipient_id=actor AND created_at<greatest(now()-interval '5 minutes',least((p_data->>'since')::timestamptz,now()-interval '5 seconds'));
    ELSE cursor_value:=greatest(0,(p_data->>'after')::bigint); END IF;
    result:='[]'::jsonb;
    FOR entry IN SELECT * FROM public.messenger_notification_events WHERE recipient_id=actor AND sequence>cursor_value ORDER BY sequence LIMIT 100 LOOP
      cursor_value:=entry.sequence;
      IF public.messenger_notification_payload(entry) IS NOT NULL THEN result:=result||jsonb_build_array(public.messenger_notification_payload(entry)); END IF;
    END LOOP;
    RETURN jsonb_build_object('cursor',cursor_value,'events',result,'active_calls',active_calls);
  END IF;
  RAISE EXCEPTION 'Unknown notification action';
END $$;

CREATE OR REPLACE FUNCTION public.messenger_push_worker(p_action text,p_data jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.messenger_push_deliveries; sub public.messenger_push_subscriptions;
  entry public.messenger_notification_events; payload jsonb; result jsonb:='[]'::jsonb; token uuid; session_valid boolean;
BEGIN
  IF p_action='heartbeat' THEN
    IF p_data->>'public_key' !~ '^[A-Za-z0-9_-]{87}$' THEN RAISE EXCEPTION 'Invalid public key'; END IF;
    INSERT INTO public.messenger_push_config(singleton,public_key) VALUES(true,p_data->>'public_key')
      ON CONFLICT(singleton) DO UPDATE SET public_key=excluded.public_key,heartbeat_at=now();
    RETURN '{}'::jsonb;
  ELSIF p_action='claim' THEN
    PERFORM public.messenger_reconcile_calls();
    INSERT INTO public.messenger_push_deliveries(event_id,subscription_id)
      SELECT e.id,s.id FROM public.messenger_notification_events e JOIN public.messenger_push_subscriptions s ON s.user_id=e.recipient_id
      WHERE s.enabled AND e.expires_at>now() AND e.created_at>=s.created_at AND e.kind<>'call-closed'
      ON CONFLICT DO NOTHING;
    FOR job IN SELECT d.* FROM public.messenger_push_deliveries d JOIN public.messenger_notification_events e ON e.id=d.event_id
      WHERE NOT d.finished AND d.next_attempt_at<=now() AND coalesce(d.lease_until,'-infinity')<now() AND e.expires_at>now()
        AND e.created_at<=now()-interval '3 seconds'
      ORDER BY CASE e.kind WHEN 'call-closed' THEN 0 WHEN 'voice' THEN 1 WHEN 'video' THEN 1 ELSE 2 END,e.sequence LIMIT 25 FOR UPDATE OF d SKIP LOCKED LOOP
      SELECT * INTO sub FROM public.messenger_push_subscriptions WHERE id=job.subscription_id;
      SELECT * INTO entry FROM public.messenger_notification_events WHERE id=job.event_id;
      payload:=public.messenger_notification_payload(entry);
      session_valid:=true;
      IF sub.auth_session_id IS NOT NULL AND to_regclass('auth.sessions') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id=$1 AND user_id=$2)' INTO session_valid USING sub.auth_session_id,sub.user_id;
      END IF;
      IF NOT session_valid THEN UPDATE public.messenger_push_subscriptions SET enabled=false WHERE id=sub.id; END IF;
      IF NOT sub.enabled OR NOT session_valid OR entry.created_at<sub.created_at OR payload IS NULL OR job.attempts>=12
        OR entry.kind='call-closed' THEN
        UPDATE public.messenger_push_deliveries SET finished=true WHERE id=job.id;
      ELSE
        token:=gen_random_uuid();
        UPDATE public.messenger_push_deliveries SET attempts=attempts+1,lease=token,lease_mode='push',lease_until=now()+interval '90 seconds' WHERE id=job.id;
        result:=result||jsonb_build_array(jsonb_build_object('id',job.id,'lease',token,'attempt',job.attempts+1,
          'subscription',jsonb_build_object('endpoint',sub.endpoint,'keys',jsonb_build_object('p256dh',sub.p256dh,'auth',sub.auth)),
          'payload',payload||jsonb_build_object('device_id',sub.id),'expires_at',entry.expires_at));
      END IF;
    END LOOP;
    DELETE FROM public.messenger_notification_events WHERE expires_at<now()-interval '7 days';
    DELETE FROM public.messenger_push_subscriptions WHERE NOT enabled AND last_used_at<now()-interval '30 days';
    RETURN result;
  ELSIF p_action='complete' THEN
    SELECT * INTO job FROM public.messenger_push_deliveries WHERE id=(p_data->>'id')::uuid AND lease=(p_data->>'lease')::uuid FOR UPDATE;
    IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
    IF p_data->>'status'='expired' THEN
      DELETE FROM public.messenger_push_subscriptions WHERE id=job.subscription_id;
    ELSE
      UPDATE public.messenger_push_deliveries SET finished=p_data->>'status' IN ('sent','discard'),
        delivered_at=CASE WHEN p_data->>'status'='sent' THEN now() ELSE delivered_at END,
        lease_until=NULL,next_attempt_at=now()+make_interval(secs=>least(300,power(2,job.attempts)::integer*3)) WHERE id=job.id;
      IF p_data->>'status'='sent' THEN UPDATE public.messenger_push_subscriptions SET last_used_at=now() WHERE id=job.subscription_id; END IF;
    END IF;
    RETURN '{}'::jsonb;
  END IF;
  RAISE EXCEPTION 'Unknown push worker action';
END $$;

NOTIFY pgrst,'reload schema';
