-- GoTrue v2.189 writes app_metadata after inserting auth.users during its
-- create-user transaction. Complete the initial server-selected admin role at
-- that write, too. Never read user_metadata for authorization.
CREATE FUNCTION public.initialize_profile_auth_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.raw_app_meta_data->>'streamly_role' IS NULL
    AND NEW.raw_app_meta_data->>'streamly_role'='admin' THEN
    UPDATE public.profiles SET role='admin' WHERE id=NEW.id AND role='user';
  END IF;
  -- Later role changes remain governed by set_user_role, including its
  -- last-administrator protection. Re-saving metadata must not undo a demotion.
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.initialize_profile_auth_role() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER initialize_profile_auth_role AFTER UPDATE OF raw_app_meta_data ON auth.users
FOR EACH ROW WHEN(OLD.raw_app_meta_data IS DISTINCT FROM NEW.raw_app_meta_data)
EXECUTE FUNCTION public.initialize_profile_auth_role();
NOTIFY pgrst, 'reload schema';
