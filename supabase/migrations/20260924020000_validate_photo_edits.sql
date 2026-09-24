BEGIN;

-- Legacy uploads may already share display names. Leave those rows untouched,
-- but enforce uniqueness for newly uploaded/renamed photos, including races.
ALTER TABLE public.photos ADD COLUMN edit_name_key text;
CREATE UNIQUE INDEX photos_edited_name_unique ON public.photos(owner_id, edit_name_key);

CREATE FUNCTION public.photo_name_base(p_name text, p_extension text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_extension <> '' AND lower(right(btrim(p_name), length(p_extension))) = lower(p_extension)
    THEN left(btrim(p_name), length(btrim(p_name)) - length(p_extension))
    ELSE regexp_replace(btrim(p_name), '\.(jpe?g|png|gif|webp|avif)$', '', 'i') END;
$$;

CREATE FUNCTION public.validate_photo_name() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE original_extension text; base text; candidate text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.file_name IS NOT DISTINCT FROM OLD.file_name THEN
      -- Clients cannot remove the key to bypass the unique constraint.
      NEW.edit_name_key := OLD.edit_name_key;
      RETURN NEW;
    END IF;
    original_extension := coalesce(substring(OLD.storage_path FROM '\.[a-zA-Z0-9]+$'), '');
  ELSE
    original_extension := coalesce(substring(NEW.storage_path FROM '\.[a-zA-Z0-9]+$'), '');
  END IF;
  base := public.photo_name_base(NEW.file_name, original_extension);
  IF base IS NULL OR base = '' OR base ~ '^\.' OR base ~ '[. ]$'
    OR base ~ '[<>:"/|?*]' OR position(chr(92) IN base) > 0 OR base ~ '[[:cntrl:]]'
    OR base ~* '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)'
    OR octet_length(base || original_extension) > 255 THEN
    RAISE EXCEPTION 'Invalid photo name' USING ERRCODE = '22023';
  END IF;
  NEW.file_name := base || original_extension;
  candidate := lower(NEW.file_name);
  -- Check names uploaded before this migration, which have no uniqueness key.
  -- Existing owner RLS limits this query to the editor's own library.
  IF EXISTS (
    SELECT 1 FROM public.photos p WHERE p.owner_id = NEW.owner_id AND p.id <> NEW.id
      AND p.edit_name_key IS NULL
      AND lower(public.photo_name_base(p.file_name, coalesce(substring(p.storage_path FROM '\.[a-zA-Z0-9]+$'), ''))
        || coalesce(substring(p.storage_path FROM '\.[a-zA-Z0-9]+$'), '')) = candidate
  ) THEN
    RAISE EXCEPTION 'A photo with this name already exists' USING ERRCODE = '23505';
  END IF;
  NEW.edit_name_key := candidate;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_photo_name BEFORE INSERT OR UPDATE ON public.photos
FOR EACH ROW EXECUTE FUNCTION public.validate_photo_name();
-- Trigger invocation itself requires no caller EXECUTE grant. The pure helper
-- remains callable so the invoker-security trigger can normalize names.
REVOKE ALL ON FUNCTION public.validate_photo_name() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.photo_name_base(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_name_base(text, text) TO authenticated, service_role;

-- Existing photos UPDATE policies require auth.uid() = owner_id in both USING
-- and WITH CHECK. Existing visibility constraints and public SELECT policies
-- continue to govern privacy; no additional editing privileges are granted.
COMMIT;
