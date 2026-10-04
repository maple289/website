-- Follow-up only: do not alter deployed migrations or rewrite existing users.
CREATE OR REPLACE FUNCTION public.set_user_role(target uuid, new_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_role text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change roles' USING ERRCODE = '42501';
  END IF;
  IF new_role IS NULL OR new_role NOT IN ('user','admin') THEN
    RAISE EXCEPTION 'Invalid role' USING ERRCODE = '22023';
  END IF;
  LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
  -- Recheck after waiting: the caller may have been demoted concurrently.
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  SELECT role INTO target_role FROM public.profiles WHERE id=target;
  IF target_role IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF target_role='admin' AND new_role='user' AND NOT EXISTS(
    SELECT 1 FROM public.profiles WHERE role='admin' AND id<>target
  ) THEN RAISE EXCEPTION 'The last administrator cannot be demoted'; END IF;
  UPDATE public.profiles SET role=new_role WHERE id=target;
END;
$$;
REVOKE ALL ON FUNCTION public.set_user_role(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid,text) TO authenticated;

-- Email is the Auth login identifier. Synchronize its profile copy in the same
-- transaction rather than relying on a later admin/browser request.
CREATE FUNCTION public.sync_profile_auth_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.profiles SET email=NEW.email WHERE id=NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_profile_auth_email() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sync_profile_auth_email AFTER UPDATE OF email ON auth.users
FOR EACH ROW WHEN(OLD.email IS DISTINCT FROM NEW.email) EXECUTE FUNCTION public.sync_profile_auth_email();

-- Auth app_metadata is writable only by the server/admin Auth API, unlike
-- user_metadata. Create the requested admin-managed role with the Auth account
-- and profile together; do not rely on a second profile upsert.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.profiles(id,email,role,first_name,last_name)
  VALUES(NEW.id,NEW.email,
    CASE WHEN NEW.raw_app_meta_data->>'streamly_role'='admin' THEN 'admin' ELSE 'user' END,
    nullif(left(btrim(NEW.raw_user_meta_data->>'first_name'),100),''),
    nullif(left(btrim(NEW.raw_user_meta_data->>'last_name'),100),''))
  ON CONFLICT(id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated,service_role;

-- Auth's built-in email key is case-sensitive. Its profile trigger and email
-- sync run in the same transaction, so this enforces the application's single
-- email login identity without changing Supabase-managed Auth constraints.
CREATE UNIQUE INDEX profiles_login_email_unique ON public.profiles(lower(btrim(email)))
  WHERE email IS NOT NULL;

ALTER TABLE public.pending_registrations ADD CONSTRAINT pending_registration_status_valid
CHECK(status IN ('pending','approved','rejected')) NOT VALID;
ALTER TABLE public.pending_registrations VALIDATE CONSTRAINT pending_registration_status_valid;
NOTIFY pgrst, 'reload schema';
