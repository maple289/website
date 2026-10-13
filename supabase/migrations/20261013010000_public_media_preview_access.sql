-- Public cards already expose their resource keys. Resolving the configured
-- prefix must also work anonymously; no admin settings/table access is granted.
GRANT EXECUTE ON FUNCTION public.get_storage_base_path(text) TO anon;

-- Match the same public resource to its exact configured Storage key. A prefix
-- does not make the bucket public, nor authorize arbitrary sibling objects.
CREATE FUNCTION public.can_read_public_image(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.photos p LEFT JOIN public.storage_settings s ON s.id=1
    WHERE p.visibility='public' AND p_name IN (
      concat_ws('/',nullif(btrim(s.images_base_path,'/'),''),p.storage_path),
      concat_ws('/',nullif(btrim(s.images_base_path,'/'),''),p.preview_path),
      concat_ws('/',nullif(btrim(s.images_base_path,'/'),''),p.thumbnail_path))
    UNION ALL
    SELECT 1 FROM public.videos v LEFT JOIN public.storage_settings s ON s.id=1
    WHERE v.visibility='public' AND v.preview_path IS NOT NULL
      AND p_name=concat_ws('/',nullif(btrim(s.images_base_path,'/'),''),v.preview_path)
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_public_image(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_public_image(text) TO anon,authenticated;
DROP POLICY IF EXISTS user_images_read_public ON storage.objects;
CREATE POLICY user_images_read_public ON storage.objects FOR SELECT TO anon,authenticated
  USING(bucket_id='user-images' AND public.can_read_public_image(name));
NOTIFY pgrst,'reload schema';
