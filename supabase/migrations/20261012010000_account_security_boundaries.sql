-- Forward-only security controls. Do not alter previously deployed migrations.
BEGIN;

CREATE FUNCTION public.active_account(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM auth.users u LEFT JOIN public.account_activation a ON a.user_id=u.id
    WHERE u.id=p_user AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
      AND coalesce(a.active,true) AND NOT coalesce(a.must_change_password,false));
$$;
REVOKE ALL ON FUNCTION public.active_account(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.active_account(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.active_account(auth.uid()) AND EXISTS(
    SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin');
$$;

-- Existing bearer tokens must not bypass disablement through older owner policies.
-- storage.objects is the supported application policy surface. Supabase owns
-- internal Storage tables (including migrations); do not change their policies.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname='public' OR (n.nspname='storage' AND c.relname='objects'))
      AND c.relkind IN ('r','p') AND c.relrowsecurity LOOP
    EXECUTE format('CREATE POLICY active_account_required ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.active_account(auth.uid())) WITH CHECK (public.active_account(auth.uid()))',item.nspname,item.relname);
  END LOOP;
END $$;

-- Also gate SECURITY DEFINER RPCs, which deliberately bypass table RLS.
CREATE FUNCTION public.enforce_active_account() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'='authenticated'
     AND NOT public.active_account(auth.uid()) THEN
    RAISE EXCEPTION 'An active account is required' USING ERRCODE='42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_active_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_active_account() TO anon,authenticated,service_role;
DO $$ DECLARE existing text; BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN
    SELECT setting INTO existing FROM pg_db_role_setting s,
      unnest(s.setconfig) AS setting
      WHERE s.setrole='authenticator'::regrole AND setting LIKE 'pgrst.db_pre_request=%' LIMIT 1;
    IF existing IS NOT NULL AND existing NOT IN ('pgrst.db_pre_request=','pgrst.db_pre_request=public.enforce_active_account') THEN
      RAISE EXCEPTION 'Existing PostgREST pre-request hook must be composed with enforce_active_account before installing this migration';
    END IF;
    ALTER ROLE authenticator SET pgrst.db_pre_request='public.enforce_active_account';
  END IF;
END $$;

-- Serialize DELETE, demotion and disablement against the same administrator set.
CREATE FUNCTION public.guard_last_active_administrator() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid; losing boolean;
BEGIN
  IF TG_TABLE_SCHEMA='auth' THEN
    target:=OLD.id;
    losing:=TG_OP='DELETE';
    IF TG_OP='UPDATE' THEN losing:=NEW.deleted_at IS NOT NULL OR (NEW.banned_until IS NOT NULL AND NEW.banned_until>now()); END IF;
  ELSIF TG_TABLE_NAME='profiles' THEN
    target:=OLD.id;
    losing:=TG_OP='DELETE';
    IF TG_OP='UPDATE' THEN losing:=NEW.role IS DISTINCT FROM 'admin'; END IF;
  ELSE
    target:=OLD.user_id;
    losing:=NOT NEW.active OR NEW.must_change_password;
  END IF;
  IF losing AND EXISTS(SELECT 1 FROM public.profiles WHERE id=target AND role='admin')
     AND public.active_account(target) THEN
    LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE role='admin' AND id<>target AND public.active_account(id)) THEN
      RAISE EXCEPTION 'The last active administrator cannot be removed or disabled' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_last_active_administrator() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_administrator_auth_delete BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_active_administrator();
CREATE TRIGGER guard_administrator_auth_disable BEFORE UPDATE OF deleted_at,banned_until ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_active_administrator();
CREATE TRIGGER guard_administrator_profile_delete BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_active_administrator();
CREATE TRIGGER guard_administrator_profile_role BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_active_administrator();
CREATE TRIGGER guard_administrator_activation BEFORE UPDATE OF active,must_change_password ON public.account_activation
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_active_administrator();

-- Old public responses contained setup capabilities; invalidate those outstanding
-- capabilities before installing the mailbox-only issuer. No user/data is removed.
UPDATE public.account_activation SET setup_token_hash=NULL,setup_expires_at=NULL,setup_claimed_at=NULL,last_setup_request_at=NULL
  WHERE must_change_password;
-- Retire the old issuer before any old function process can expose another code
-- during rollout. Old deployments fail closed until the new handler is loaded.
CREATE OR REPLACE FUNCTION public.start_initial_login(p_identifier text,p_token_hash text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT false $$;
CREATE FUNCTION public.issue_initial_password_email(p_identifier text,p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE account_id uuid;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  SELECT u.id INTO account_id FROM auth.users u JOIN public.profiles p ON p.id=u.id
    JOIN public.account_activation a ON a.user_id=u.id
    WHERE lower(u.email)=lower(btrim(p_identifier)) AND a.active AND a.must_change_password
      AND coalesce(u.encrypted_password,'')='' AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until<=now()) AND u.email_confirmed_at IS NOT NULL
      AND p.role='user' FOR UPDATE OF a;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.account_activation SET setup_token_hash=p_token_hash,setup_expires_at=now()+interval '15 minutes',
    setup_claimed_at=NULL,last_setup_request_at=now() WHERE user_id=account_id
      AND (last_setup_request_at IS NULL OR last_setup_request_at<now()-interval '60 seconds')
      AND (setup_claimed_at IS NULL OR setup_claimed_at<now()-interval '2 minutes');
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_initial_password_email(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_initial_password_email(text,text) TO service_role;

CREATE TABLE public.public_request_budgets(bucket text NOT NULL,window_start timestamptz NOT NULL,requests integer NOT NULL,
  PRIMARY KEY(bucket,window_start));
ALTER TABLE public.public_request_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_request_budgets FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.claim_public_request(p_bucket text,p_seconds integer,p_limit integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE slot timestamptz; total integer;
BEGIN
  IF p_seconds<1 OR p_limit<1 OR length(p_bucket)>150 THEN RETURN false; END IF;
  slot:=to_timestamp(floor(extract(epoch FROM now())/p_seconds)*p_seconds);
  INSERT INTO public.public_request_budgets VALUES(p_bucket,slot,1)
    ON CONFLICT(bucket,window_start) DO UPDATE SET requests=public.public_request_budgets.requests+1
    RETURNING requests INTO total;
  DELETE FROM public.public_request_budgets WHERE window_start<now()-interval '2 days';
  RETURN total<=p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_public_request(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_public_request(text,integer,integer) TO service_role;

NOTIFY pgrst,'reload config';
NOTIFY pgrst,'reload schema';
COMMIT;
