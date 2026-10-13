BEGIN;
ALTER TABLE public.account_activation
  ADD COLUMN temporary_password_hash text UNIQUE,
  ADD COLUMN temporary_password_expires_at timestamptz,
  ADD COLUMN temporary_password_attempts integer NOT NULL DEFAULT 0 CHECK (temporary_password_attempts BETWEEN 0 AND 10);

-- Service-only issuer. Approval retries reuse their credential without extending
-- its lifetime or replacing a newer password requested by the applicant.
CREATE FUNCTION public.issue_initial_temporary_password(p_identifier text,p_password_hash text,p_delivery_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.account_activation%ROWTYPE; expiry timestamptz;
BEGIN
  IF p_password_hash !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
  SELECT activation.* INTO a FROM public.account_activation activation
    JOIN auth.users u ON u.id=activation.user_id JOIN public.profiles p ON p.id=u.id
    WHERE lower(u.email)=lower(btrim(p_identifier)) AND activation.active AND activation.must_change_password
      AND coalesce(u.encrypted_password,'')='' AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until<=now()) AND u.email_confirmed_at IS NOT NULL
      AND p.role='user' FOR UPDATE OF activation;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_delivery_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.registration_email_deliveries WHERE id=p_delivery_id
      AND registration_id=a.registration_id AND operation='registration_approved'
      AND lower(recipient)=lower(btrim(p_identifier))) THEN RETURN NULL; END IF;
    IF a.temporary_password_hash=p_password_hash THEN
      IF a.temporary_password_expires_at<=now() OR a.temporary_password_attempts>=10 THEN RETURN NULL; END IF;
      RETURN jsonb_build_object('expires_at',a.temporary_password_expires_at);
    END IF;
    IF a.temporary_password_hash IS NOT NULL THEN RETURN NULL; END IF;
  END IF;
  IF a.last_setup_request_at>now()-interval '60 seconds'
    OR a.setup_claimed_at>now()-interval '2 minutes' THEN RETURN NULL; END IF;
  expiry:=now()+interval '1 hour';
  UPDATE public.account_activation SET temporary_password_hash=p_password_hash,
    temporary_password_expires_at=expiry,temporary_password_attempts=0,last_setup_request_at=now(),
    setup_token_hash=NULL,setup_expires_at=NULL,setup_claimed_at=NULL WHERE user_id=a.user_id;
  RETURN jsonb_build_object('expires_at',expiry);
END;
$$;

CREATE FUNCTION public.redeem_initial_temporary_password(p_identifier text,p_password_hash text,p_setup_hash text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.account_activation%ROWTYPE; expiry timestamptz;
BEGIN
  IF p_password_hash !~ '^[a-f0-9]{64}$' OR p_setup_hash !~ '^[a-f0-9]{64}$' THEN RETURN 0; END IF;
  SELECT activation.* INTO a FROM public.account_activation activation JOIN auth.users u ON u.id=activation.user_id
    WHERE lower(u.email)=lower(btrim(p_identifier)) AND activation.active AND activation.must_change_password
      AND activation.temporary_password_expires_at>now() AND activation.temporary_password_attempts<10
      AND coalesce(u.encrypted_password,'')='' AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until<=now()) AND u.email_confirmed_at IS NOT NULL
      AND (activation.setup_claimed_at IS NULL OR activation.setup_claimed_at<now()-interval '2 minutes')
    FOR UPDATE OF activation;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF a.temporary_password_hash IS DISTINCT FROM p_password_hash THEN
    UPDATE public.account_activation SET temporary_password_attempts=temporary_password_attempts+1 WHERE user_id=a.user_id;
    RETURN 0;
  END IF;
  expiry:=a.temporary_password_expires_at;
  UPDATE public.account_activation SET setup_token_hash=p_setup_hash,setup_expires_at=expiry,setup_claimed_at=NULL WHERE user_id=a.user_id;
  RETURN floor(extract(epoch FROM expiry-now()))::integer;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_initial_temporary_password(text,text,uuid),public.redeem_initial_temporary_password(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_initial_temporary_password(text,text,uuid),public.redeem_initial_temporary_password(text,text,text) TO service_role;
-- Retire blank-password issuance during rollout; existing setup claims may finish.
CREATE OR REPLACE FUNCTION public.issue_initial_password_email(p_identifier text,p_token_hash text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.finish_account_activation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF coalesce(NEW.encrypted_password,'')<>'' AND NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    UPDATE public.account_activation SET must_change_password=false,password_set_at=coalesce(password_set_at,now()),
      setup_token_hash=NULL,setup_expires_at=NULL,setup_claimed_at=NULL,
      temporary_password_hash=NULL,temporary_password_expires_at=NULL,temporary_password_attempts=0 WHERE user_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
