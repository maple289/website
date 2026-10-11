-- Eligible, paginated directory. Account/block checks stay on the server, and
-- selecting a person still uses the locked, unique-pair direct-create RPC.
CREATE OR REPLACE FUNCTION public.messenger_name(p_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(nullif(btrim(concat_ws(' ',nullif(btrim(first_name),''),nullif(btrim(last_name),''))),''),nullif(btrim(email),''),'User')
  FROM public.profiles WHERE id=p_user;
$$;

CREATE FUNCTION public.messenger_people(p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); query text:=left(btrim(coalesce(p_data->>'query','')),100);
  after_name text:=p_data->'after'->>'name'; after_id uuid:=(p_data->'after'->>'id')::uuid;
  rows jsonb; more boolean; last_row jsonb;
BEGIN
  IF NOT public.messenger_active(actor) THEN RAISE EXCEPTION 'Please sign in with an active account' USING ERRCODE='42501'; END IF;
  IF (after_name IS NULL) <> (after_id IS NULL) THEN RAISE EXCEPTION 'Invalid user-list cursor'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(person) ORDER BY person.name,person.id),'[]'::jsonb) INTO rows FROM (
    SELECT p.id,public.messenger_name(p.id) AS name,
      EXISTS(SELECT 1 FROM public.messenger_sessions s WHERE s.user_id=p.id AND s.expires_at>now()) AS online,
      direct.id AS conversation_id,
      CASE WHEN own.hidden IS FALSE THEN (SELECT count(*) FROM public.messenger_messages m
        WHERE m.conversation_id=direct.id AND m.sequence>greatest(own.read_sequence,own.cleared_sequence,direct.cleared_sequence)
        AND m.sender_id IS DISTINCT FROM actor AND m.deletion_started_at IS NULL AND public.messenger_message_visible(m.id)) ELSE 0 END AS unread
    FROM public.profiles p
    LEFT JOIN public.messenger_conversations direct ON direct.kind='direct'
      AND direct.direct_key=least(actor::text,p.id::text)||':'||greatest(actor::text,p.id::text)
    LEFT JOIN public.messenger_members own ON own.conversation_id=direct.id AND own.user_id=actor
    WHERE p.id<>actor AND public.messenger_active(p.id) AND NOT public.messenger_blocked(actor,p.id)
      AND (query='' OR strpos(lower(public.messenger_name(p.id)),lower(query))>0 OR strpos(lower(coalesce(p.email,'')),lower(query))>0)
      AND (after_id IS NULL OR (public.messenger_name(p.id),p.id)>(after_name,after_id))
      AND (direct.id IS NULL OR own.user_id IS NOT NULL)
    ORDER BY name,p.id LIMIT 51
  ) person;
  more:=jsonb_array_length(rows)>50;
  IF more THEN rows:=rows-50; END IF;
  last_row:=rows->(jsonb_array_length(rows)-1);
  RETURN jsonb_build_object('users',rows,'next',CASE WHEN more THEN jsonb_build_object('name',last_row->>'name','id',last_row->>'id') ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.messenger_people(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.messenger_people(jsonb) TO service_role;

-- Extend the current RPC without replacing its call/deletion/membership logic.
DO $migration$
DECLARE definition text; marker text:='  ELSIF p_action=''users'' THEN';
BEGIN
  SELECT pg_get_functiondef('public.messenger_rpc(text,uuid,jsonb)'::regprocedure) INTO definition;
  IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'Messenger users branch missing'; END IF;
  definition:=replace(definition,marker,E'  ELSIF p_action=''people'' THEN\n    RETURN public.messenger_people(p_data);\n'||marker);
  EXECUTE definition;
END $migration$;
NOTIFY pgrst,'reload schema';
