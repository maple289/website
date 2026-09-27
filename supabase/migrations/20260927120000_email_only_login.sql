-- Email is the only account identifier. Preserve activation, permissions and
-- existing function grants while removing the separate username requirement.
BEGIN;

CREATE OR REPLACE FUNCTION public.approve_pending_account(p_registration_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.pending_registrations%ROWTYPE;
  account_id uuid := gen_random_uuid();
  account_email text;
  metadata jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.pending_registrations WHERE id=p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending registration not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Registration has already been reviewed'; END IF;
  account_email := lower(btrim(r.email));
  IF account_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Registration email is invalid'; END IF;
  -- Serialize against concurrent Auth API inserts as well as other approvals.
  LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=account_email) OR
     EXISTS(SELECT 1 FROM public.profiles WHERE lower(email)=account_email) THEN
    RAISE EXCEPTION 'An account with this email already exists' USING ERRCODE='23505';
  END IF;
  metadata := jsonb_build_object('first_name', r.first_name, 'last_name', r.last_name);
  INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,
    raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at,is_sso_user,is_anonymous)
  VALUES ('00000000-0000-0000-0000-000000000000',account_id,'authenticated','authenticated',account_email,NULL,now(),
    '','','','','',jsonb_build_object('provider','email','providers',jsonb_build_array('email')),metadata,false,now(),now(),false,false);
  INSERT INTO auth.identities (id,provider_id,user_id,identity_data,provider,created_at,updated_at)
  VALUES (gen_random_uuid(),account_id::text,account_id,jsonb_build_object('sub',account_id::text,'email',account_email,'email_verified',true,'phone_verified',false),'email',now(),now());
  -- The existing auth.users trigger creates the profile. Its role must be user.
  UPDATE public.profiles SET role='user',first_name=r.first_name,last_name=r.last_name WHERE id=account_id;
  INSERT INTO public.account_activation(user_id,registration_id,registration_snapshot,approved_by)
  VALUES(account_id,r.id,to_jsonb(r),auth.uid());
  IF NOT EXISTS(SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id=u.id
    JOIN public.account_activation a ON a.user_id=u.id WHERE u.id=account_id
    AND u.encrypted_password IS NULL AND p.role='user' AND a.must_change_password AND a.active) THEN
    RAISE EXCEPTION 'Account verification failed';
  END IF;
  DELETE FROM public.pending_registrations WHERE id=r.id;
  RETURN jsonb_build_object('user_id',account_id,'email',account_email,'must_change_password',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_initial_login(p_identifier text,p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE account_id uuid;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  SELECT u.id INTO account_id FROM auth.users u JOIN public.profiles p ON p.id=u.id
  JOIN public.account_activation a ON a.user_id=u.id
  WHERE lower(u.email)=lower(btrim(p_identifier))
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

CREATE OR REPLACE FUNCTION public.resolve_login_email(p_identifier text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.email::text FROM auth.users u JOIN public.profiles p ON p.id=u.id
  LEFT JOIN public.account_activation a ON a.user_id=u.id
  WHERE lower(u.email)=lower(btrim(p_identifier))
    AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
    AND coalesce(a.active,true) AND NOT coalesce(a.must_change_password,false)
    AND coalesce(u.encrypted_password,'')<>'' LIMIT 1;
$$;

-- The inspected production columns contain no values. Stop rather than silently
-- losing legacy identifiers if another environment has populated them.
LOCK TABLE public.profiles, public.pending_registrations IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE username IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.pending_registrations WHERE username IS NOT NULL) THEN
    RAISE EXCEPTION 'Username columns contain legacy data; archive those identifiers before applying this migration';
  END IF;
END;
$$;
DROP TRIGGER profile_username_guard ON public.profiles;
DROP FUNCTION public.protect_username();
-- RESTRICT is intentional: unexpected dependencies must stop the transaction.
ALTER TABLE public.profiles DROP COLUMN username RESTRICT;
ALTER TABLE public.pending_registrations DROP COLUMN username RESTRICT;
-- Associated username-only constraints/indexes are removed with their columns.
-- Existing email uniqueness, RLS and Auth identities remain authoritative.
COMMIT;
