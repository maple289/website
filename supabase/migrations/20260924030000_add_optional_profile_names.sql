-- Nullable names keep existing accounts and email-only registration compatible.
ALTER TABLE public.profiles
  ADD COLUMN first_name text CHECK (char_length(first_name) <= 100),
  ADD COLUMN last_name text CHECK (char_length(last_name) <= 100);
ALTER TABLE public.pending_registrations
  ADD COLUMN first_name text CHECK (char_length(first_name) <= 100),
  ADD COLUMN last_name text CHECK (char_length(last_name) <= 100);

-- Preserve restricted insertion: visitors still cannot set approval fields.
GRANT INSERT (first_name, last_name) ON public.pending_registrations TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name)
  VALUES (NEW.id, NEW.email,
    nullif(left(btrim(NEW.raw_user_meta_data ->> 'first_name'), 100), ''),
    nullif(left(btrim(NEW.raw_user_meta_data ->> 'last_name'), 100), ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;

-- Deliberately accepts no user id, email, or role: only edit the caller's names.
CREATE FUNCTION public.update_profile_names(p_first_name text, p_last_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(p_first_name)) > 100 OR char_length(btrim(p_last_name)) > 100 THEN
    RAISE EXCEPTION 'Names must be at most 100 characters' USING ERRCODE = '22023';
  END IF;
  UPDATE public.profiles
  SET first_name = nullif(btrim(p_first_name), ''), last_name = nullif(btrim(p_last_name), '')
  WHERE id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.update_profile_names(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_profile_names(text, text) TO authenticated;
