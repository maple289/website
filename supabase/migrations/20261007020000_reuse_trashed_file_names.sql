-- Trash retains payloads. Reusing a deleted name must preserve that payload
-- under a unique path before writing the incoming item, never overwrite it.
ALTER TABLE public.user_file_metadata ADD COLUMN trash_original_path text;
ALTER TABLE public.user_file_metadata ADD CONSTRAINT file_trash_original_owner
  CHECK (trash_original_path IS NULL OR starts_with(trash_original_path,owner_id::text||'/'));

CREATE FUNCTION public.internal_plan_file_operation(p_source text,p_destination text,p_copy boolean,p_restore boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.user_file_metadata; occupied public.user_file_metadata;
  parent text; objects jsonb; rows jsonb; preservation jsonb; backup text;
BEGIN
  SELECT * INTO item FROM public.user_file_metadata WHERE owner_id=auth.uid() AND object_path=p_source;
  IF NOT FOUND OR NOT starts_with(p_destination,auth.uid()::text||'/') THEN
    RAISE EXCEPTION 'You do not have permission for this operation' USING ERRCODE='42501';
  END IF;
  IF p_destination ~ '(^|/)(\.|\.\.)(/|$)' OR position('//' IN p_destination)>0
    OR position(chr(92) IN p_destination)>0 OR right(p_destination,1)='/'
    OR regexp_replace(p_destination,'^.*/','') IN ('.folder','.keep') THEN RAISE EXCEPTION 'Invalid destination'; END IF;
  IF (p_destination=p_source AND NOT p_copy AND NOT p_restore)
    OR (item.is_folder AND starts_with(p_destination,p_source||'/')) THEN
    RAISE EXCEPTION 'A folder cannot be placed inside itself or its subfolders';
  END IF;
  parent:=regexp_replace(p_destination,'/[^/]+$','');
  IF parent<>auth.uid()::text AND NOT EXISTS(SELECT 1 FROM public.user_file_metadata
    WHERE owner_id=auth.uid() AND object_path=parent AND is_folder AND trashed_at IS NULL) THEN
    RAISE EXCEPTION 'Choose an existing destination folder you own' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.user_file_metadata t WHERE t.owner_id=auth.uid() AND t.trashed_at IS NOT NULL
    AND (t.object_path=parent OR (t.is_folder AND starts_with(parent,t.object_path||'/')))) THEN
    RAISE EXCEPTION 'The destination is in Trash';
  END IF;
  IF p_restore THEN
    IF p_copy OR item.trashed_at IS NULL THEN RAISE EXCEPTION 'Only an item in Trash can be restored'; END IF;
  ELSIF EXISTS(SELECT 1 FROM public.user_file_metadata t WHERE t.owner_id=auth.uid() AND t.trashed_at IS NOT NULL
    AND (t.object_path=p_source OR (t.is_folder AND starts_with(p_source,t.object_path||'/')))) THEN
    RAISE EXCEPTION 'Items in Trash cannot be copied or moved';
  END IF;

  SELECT * INTO occupied FROM public.user_file_metadata WHERE owner_id=auth.uid() AND object_path=p_destination;
  IF NOT (p_restore AND p_source=p_destination) AND (
    FOUND OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='user-files'
      AND (name=p_destination OR starts_with(name,p_destination||'/')))) THEN
    -- Only a fully trashed, catalogued tree may be preserved automatically.
    -- Unknown/live objects still require the normal explicit conflict choice.
    IF occupied.trashed_at IS NULL OR EXISTS(
      SELECT 1 FROM public.user_file_metadata m WHERE m.owner_id=auth.uid()
        AND (m.object_path=p_destination OR starts_with(m.object_path,p_destination||'/')) AND m.trashed_at IS NULL
    ) OR EXISTS(
      SELECT 1 FROM storage.objects o WHERE o.bucket_id='user-files'
        AND (o.name=p_destination OR starts_with(o.name,p_destination||'/'))
        AND NOT EXISTS(SELECT 1 FROM public.user_file_metadata m WHERE m.owner_id=auth.uid()
          AND m.object_path=regexp_replace(o.name,'/(\.folder|\.keep)$','') AND m.trashed_at IS NOT NULL)
    ) THEN RETURN jsonb_build_object('conflict',true); END IF;
    LOOP
      backup:=p_destination||' (deleted '||gen_random_uuid()::text||')';
      EXIT WHEN NOT EXISTS(SELECT 1 FROM public.user_file_metadata WHERE owner_id=auth.uid() AND object_path=backup)
        AND NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='user-files' AND (name=backup OR starts_with(name,backup||'/')));
    END LOOP;
    SELECT jsonb_agg(name ORDER BY CASE WHEN name ~ '/(\.folder|\.keep)$' THEN 1 ELSE 0 END,name) INTO objects
      FROM storage.objects WHERE bucket_id='user-files' AND (name=p_destination OR starts_with(name,p_destination||'/'));
    SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('trash_original_path',coalesce(m.trash_original_path,m.object_path)) ORDER BY length(m.object_path) DESC)
      INTO rows FROM public.user_file_metadata m WHERE m.owner_id=auth.uid()
        AND (m.object_path=p_destination OR starts_with(m.object_path,p_destination||'/'));
    preservation:=jsonb_build_object('source',p_destination,'destination',backup,'copy',false,
      'objects',coalesce(objects,'[]'::jsonb),'metadata',rows);
  END IF;

  SELECT jsonb_agg(name ORDER BY CASE WHEN name ~ '/(\.folder|\.keep)$' THEN 1 ELSE 0 END,name) INTO objects
    FROM storage.objects WHERE bucket_id='user-files' AND (name=p_source OR (item.is_folder AND starts_with(name,p_source||'/')));
  IF objects IS NULL THEN RAISE EXCEPTION 'The source item no longer exists'; END IF;
  IF p_restore AND p_source=p_destination THEN objects:='[]'::jsonb; END IF;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY length(m.object_path) DESC) INTO rows FROM public.user_file_metadata m
    WHERE m.owner_id=auth.uid() AND (m.object_path=p_source OR (item.is_folder AND starts_with(m.object_path,p_source||'/')));
  RETURN jsonb_build_object('conflict',false,'source',p_source,'destination',p_destination,'copy',p_copy,
    'restore',p_restore,'objects',objects,'metadata',rows,'preserveTrash',preservation);
END;
$$;
REVOKE ALL ON FUNCTION public.internal_plan_file_operation(text,text,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.plan_file_operation(p_source text,p_destination text,p_copy boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT public.internal_plan_file_operation(p_source,p_destination,p_copy,false);
$$;
CREATE FUNCTION public.plan_file_restore(p_source text,p_destination text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT public.internal_plan_file_operation(p_source,p_destination,false,true);
$$;
REVOKE ALL ON FUNCTION public.plan_file_restore(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.plan_file_restore(text,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
