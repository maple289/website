-- Check the authoritative Auth accounts as well as legacy profile records.
-- Only the registration backend may call this lookup directly.
CREATE OR REPLACE FUNCTION public.registration_email_exists(p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=lower(btrim(p_email)))
      OR EXISTS(SELECT 1 FROM public.profiles WHERE lower(email)=lower(btrim(p_email)));
$$;
REVOKE ALL ON FUNCTION public.registration_email_exists(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registration_email_exists(text) TO service_role;
