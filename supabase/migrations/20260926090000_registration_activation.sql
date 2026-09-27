-- Approval and account creation are one transaction. Initial login issues only
-- an opaque, expiring password-setup capability; it never issues an Auth JWT.
ALTER TABLE public.pending_registrations ADD COLUMN username text;
ALTER TABLE public.profiles ADD COLUMN username text;
CREATE UNIQUE INDEX profiles_username_unique ON public.profiles (lower(username)) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX pending_username_unique ON public.pending_registrations (lower(username)) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX pending_email_case_unique ON public.pending_registrations (lower(email));
ALTER TABLE public.pending_registrations ADD CONSTRAINT pending_username_format CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_][A-Za-z0-9_-]{2,31}$');
ALTER TABLE public.profiles ADD CONSTRAINT profile_username_format CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_][A-Za-z0-9_-]{2,31}$');
-- Preserve email audit records after successful approval deletes the pending row.
ALTER TABLE public.registration_email_deliveries DROP CONSTRAINT registration_email_deliveries_registration_id_fkey;
REVOKE INSERT ON public.pending_registrations FROM anon, authenticated;
REVOKE INSERT (email, first_name, last_name) ON public.pending_registrations FROM anon, authenticated;

CREATE TABLE public.account_activation (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL UNIQUE,
  registration_snapshot jsonb NOT NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  password_set_at timestamptz,
  setup_token_hash text UNIQUE,
  setup_expires_at timestamptz,
  setup_claimed_at timestamptz,
  last_setup_request_at timestamptz
);
ALTER TABLE public.account_activation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_activation FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.account_activation TO service_role;

CREATE FUNCTION public.approve_pending_account(p_registration_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.pending_registrations%ROWTYPE;
  account_id uuid := gen_random_uuid();
  login_name text;
  account_email text;
  metadata jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.pending_registrations WHERE id=p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending registration not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Registration has already been reviewed'; END IF;
  account_email := lower(btrim(r.email));
  -- Legacy requests have no username; derive a deterministic name from the email.
  login_name := coalesce(nullif(btrim(r.username), ''), left(regexp_replace(split_part(account_email, '@', 1), '[^A-Za-z0-9_-]', '_', 'g'), 32));
  IF login_name !~ '^[A-Za-z0-9_][A-Za-z0-9_-]{2,31}$' THEN RAISE EXCEPTION 'Registration requires a valid username (3–32 letters, numbers, underscores or hyphens)'; END IF;
  IF account_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Registration email is invalid'; END IF;
  -- Serialize against concurrent Auth API inserts as well as other approvals.
  LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=account_email) OR
     EXISTS(SELECT 1 FROM public.profiles WHERE lower(email)=account_email) THEN
    RAISE EXCEPTION 'An account with this email already exists' USING ERRCODE='23505';
  END IF;
  IF EXISTS(SELECT 1 FROM public.profiles WHERE lower(username)=lower(login_name)) THEN
    RAISE EXCEPTION 'An account with this username already exists' USING ERRCODE='23505';
  END IF;
  metadata := jsonb_build_object('username', login_name, 'first_name', r.first_name, 'last_name', r.last_name);
  INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,
    raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at,is_sso_user,is_anonymous)
  VALUES ('00000000-0000-0000-0000-000000000000',account_id,'authenticated','authenticated',account_email,NULL,now(),
    '','','','','',jsonb_build_object('provider','email','providers',jsonb_build_array('email')),metadata,false,now(),now(),false,false);
  INSERT INTO auth.identities (id,provider_id,user_id,identity_data,provider,created_at,updated_at)
  VALUES (gen_random_uuid(),account_id::text,account_id,jsonb_build_object('sub',account_id::text,'email',account_email,'email_verified',true,'phone_verified',false),'email',now(),now());
  -- The existing auth.users trigger creates the profile. Its role must be user.
  UPDATE public.profiles SET username=login_name,role='user',first_name=r.first_name,last_name=r.last_name WHERE id=account_id;
  INSERT INTO public.account_activation(user_id,registration_id,registration_snapshot,approved_by)
  VALUES(account_id,r.id,to_jsonb(r),auth.uid());
  IF NOT EXISTS(SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id=u.id
    JOIN public.account_activation a ON a.user_id=u.id WHERE u.id=account_id
    AND u.encrypted_password IS NULL AND p.role='user' AND a.must_change_password AND a.active) THEN
    RAISE EXCEPTION 'Account verification failed';
  END IF;
  DELETE FROM public.pending_registrations WHERE id=r.id;
  RETURN jsonb_build_object('user_id',account_id,'email',account_email,'username',login_name,'must_change_password',true);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_pending_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_pending_account(uuid) TO authenticated;

CREATE FUNCTION public.start_initial_login(p_identifier text,p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE account_id uuid;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  SELECT u.id INTO account_id FROM auth.users u JOIN public.profiles p ON p.id=u.id
  JOIN public.account_activation a ON a.user_id=u.id
  WHERE (lower(u.email)=lower(btrim(p_identifier)) OR lower(p.username)=lower(btrim(p_identifier)))
    AND a.active AND a.must_change_password AND coalesce(u.encrypted_password,'')=''
    AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now())
    AND u.email_confirmed_at IS NOT NULL AND p.role='user' FOR UPDATE OF a;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.account_activation SET setup_token_hash=p_token_hash,setup_expires_at=now()+interval '15 minutes',setup_claimed_at=NULL,last_setup_request_at=now()
  WHERE user_id=account_id AND (last_setup_request_at IS NULL OR last_setup_request_at < now()-interval '2 seconds')
    AND (setup_claimed_at IS NULL OR setup_claimed_at < now()-interval '2 minutes');
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.claim_initial_password(p_token_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE account_id uuid;
BEGIN
  SELECT a.user_id INTO account_id FROM public.account_activation a JOIN auth.users u ON u.id=a.user_id
  WHERE a.setup_token_hash=p_token_hash AND a.setup_expires_at>now() AND a.active AND a.must_change_password
    AND a.setup_claimed_at IS NULL AND coalesce(u.encrypted_password,'')=''
    AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now()) FOR UPDATE OF a;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.account_activation SET setup_claimed_at=now() WHERE user_id=account_id;
  RETURN account_id;
END;
$$;

CREATE FUNCTION public.release_initial_password(p_token_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.account_activation a SET setup_claimed_at=NULL
  WHERE a.setup_token_hash=p_token_hash AND a.must_change_password
    AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=a.user_id AND coalesce(u.encrypted_password,'')='');
$$;

CREATE FUNCTION public.resolve_login_email(p_identifier text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.email::text FROM auth.users u JOIN public.profiles p ON p.id=u.id
  LEFT JOIN public.account_activation a ON a.user_id=u.id
  WHERE (lower(u.email)=lower(btrim(p_identifier)) OR lower(p.username)=lower(btrim(p_identifier)))
    AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
    AND coalesce(a.active,true) AND NOT coalesce(a.must_change_password,false)
    AND coalesce(u.encrypted_password,'')<>'' LIMIT 1;
$$;

-- Updating a password through Supabase Auth hashes it using the existing Auth
-- implementation; this trigger changes activation state in that same transaction.
CREATE FUNCTION public.finish_account_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(NEW.encrypted_password,'')<>'' AND NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    UPDATE public.account_activation SET must_change_password=false,password_set_at=coalesce(password_set_at,now()),
      setup_token_hash=NULL,setup_expires_at=NULL,setup_claimed_at=NULL WHERE user_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_password_established AFTER UPDATE OF encrypted_password ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.finish_account_activation();

-- No alternative login route (OTP, recovery, OAuth or token refresh) can grant
-- normal access to an account whose setup is incomplete or which is disabled.
CREATE FUNCTION public.account_access_token_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.account_activation a JOIN auth.users u ON u.id=a.user_id
    WHERE a.user_id=(event->>'user_id')::uuid AND
      (NOT a.active OR a.must_change_password OR coalesce(u.encrypted_password,'')='')) THEN
    RETURN jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Account password setup is required or the account is disabled.'));
  END IF;
  RETURN jsonb_build_object('claims',event->'claims');
END;
$$;

REVOKE ALL ON FUNCTION public.start_initial_login(text,text),public.claim_initial_password(text),
  public.release_initial_password(text),public.resolve_login_email(text),public.finish_account_activation(),
  public.account_access_token_hook(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_initial_login(text,text),public.claim_initial_password(text),
  public.release_initial_password(text),public.resolve_login_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- Temporary Auth-email suppression. Admin notifications use the separate Resend
-- API and are unaffected. Disable this hook when customer mail is re-enabled.
CREATE FUNCTION public.suppress_customer_auth_email(event jsonb)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb; $$;
REVOKE ALL ON FUNCTION public.suppress_customer_auth_email(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.suppress_customer_auth_email(jsonb) TO supabase_auth_admin;

-- Names may be edited by their owner, but login identifiers are server-managed.
CREATE FUNCTION public.protect_username()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.username IS DISTINCT FROM OLD.username AND current_user NOT IN ('postgres','supabase_admin','service_role') THEN
    RAISE EXCEPTION 'Username changes require administrative access' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profile_username_guard BEFORE UPDATE OF username ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_username();
