-- Persist both email representations and the sending identity. Retried requests
-- reuse exactly the same payload and provider idempotency key.
ALTER TABLE public.registration_email_deliveries ADD COLUMN plain_text text;
ALTER TABLE public.registration_email_deliveries ADD COLUMN sender text;

CREATE OR REPLACE FUNCTION public.approve_pending_account(p_registration_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.pending_registrations%ROWTYPE;
  account_id uuid := gen_random_uuid();
  account_email text;
  metadata jsonb;
  existing jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  -- Serialize duplicate approvals, including the retry after the pending row
  -- has been deleted. Existing activation state is the authoritative receipt.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_registration_id::text, 0));
  SELECT jsonb_build_object('user_id',a.user_id,'email',u.email,
    'first_name',a.registration_snapshot->>'first_name','must_change_password',a.must_change_password)
  INTO existing FROM public.account_activation a JOIN auth.users u ON u.id=a.user_id
  JOIN public.profiles p ON p.id=u.id
  WHERE a.registration_id=p_registration_id AND a.active AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=now());
  IF existing IS NOT NULL THEN RETURN existing; END IF;
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
  RETURN jsonb_build_object('user_id',account_id,'email',account_email,'first_name',r.first_name,'must_change_password',true);
END;
$$;

