-- Associate future file metadata with the Storage catalog transaction. Existing
-- objects are not repaired/backfilled here; the read-only audit reports them.
ALTER TABLE public.user_file_metadata ADD COLUMN source_id uuid
  REFERENCES storage.objects(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX user_file_metadata_source ON public.user_file_metadata(source_id)
  WHERE source_id IS NOT NULL;

CREATE FUNCTION public.sync_file_catalog_metadata() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE object_row storage.objects; account uuid; item_path text; marker boolean;
BEGIN
  IF TG_OP='DELETE' THEN object_row:=OLD; ELSE object_row:=NEW; END IF;
  IF object_row.bucket_id<>'user-files' THEN RETURN NULL; END IF;
  SELECT id INTO account FROM public.profiles WHERE id::text=split_part(object_row.name,'/',1);
  -- Account removal intentionally does not remove physical uploads.
  IF account IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'File owner no longer exists' USING ERRCODE='23503';
  END IF;
  item_path:=object_row.name;
  marker:=right(item_path,8)='/.folder' OR right(item_path,6)='/.keep';
  IF marker THEN item_path:=regexp_replace(item_path,'/(\.folder|\.keep)$',''); END IF;
  IF TG_OP='DELETE' THEN
    IF NOT marker OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='user-files'
      AND starts_with(o.name,item_path||'/')) THEN
      DELETE FROM public.user_file_metadata WHERE owner_id=account AND object_path=item_path;
    END IF;
    RETURN NULL;
  END IF;
  IF TG_OP='UPDATE' AND OLD.name IS DISTINCT FROM NEW.name THEN
    IF marker THEN
      -- Folder moves comprise multiple Storage calls. The existing folder action
      -- relocates its parent metadata/shares after every child has moved.
      RETURN NULL;
    END IF;
    UPDATE public.user_file_metadata SET object_path=item_path,
      source_id=NEW.id,file_size=coalesce((NEW.metadata->>'size')::bigint,0),
      mime_type=coalesce(NEW.metadata->>'mimetype','')
      WHERE owner_id=account AND object_path=OLD.name AND NOT is_folder;
    IF FOUND THEN RETURN NULL; END IF;
  END IF;
  INSERT INTO public.user_file_metadata(owner_id,object_path,is_folder,source_id,file_size,mime_type)
  VALUES(account,item_path,marker,CASE WHEN marker THEN NULL ELSE object_row.id END,
    CASE WHEN marker THEN 0 ELSE coalesce((object_row.metadata->>'size')::bigint,0) END,
    CASE WHEN marker THEN '' ELSE coalesce(object_row.metadata->>'mimetype','') END)
  ON CONFLICT(owner_id,object_path) DO UPDATE SET source_id=EXCLUDED.source_id,
    file_size=EXCLUDED.file_size,mime_type=EXCLUDED.mime_type;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_file_catalog_metadata() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sync_file_catalog_metadata AFTER INSERT OR UPDATE OF name,metadata OR DELETE
ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.sync_file_catalog_metadata();

CREATE FUNCTION public.guard_file_metadata_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source storage.objects;
BEGIN
  IF NEW.object_path ~ '(^|/)(\.|\.\.)(/|$)' OR position('//' IN NEW.object_path)>0
    OR position(chr(92) IN NEW.object_path)>0 THEN
    RAISE EXCEPTION 'Invalid file path' USING ERRCODE='22023';
  END IF;
  IF NEW.is_folder THEN
    IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='user-files'
      AND starts_with(name,NEW.object_path||'/')) THEN
      RAISE EXCEPTION 'Folder does not exist in storage' USING ERRCODE='23503';
    END IF;
    NEW.source_id:=NULL; NEW.file_size:=0; NEW.mime_type:='';
  ELSE
    SELECT * INTO source FROM storage.objects WHERE bucket_id='user-files' AND name=NEW.object_path;
    IF NOT FOUND THEN RAISE EXCEPTION 'File does not exist in storage' USING ERRCODE='23503'; END IF;
    NEW.source_id:=source.id; NEW.file_size:=coalesce((source.metadata->>'size')::bigint,0);
    NEW.mime_type:=coalesce(source.metadata->>'mimetype','');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_file_metadata_source() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_file_metadata_source BEFORE INSERT OR UPDATE ON public.user_file_metadata
FOR EACH ROW EXECUTE FUNCTION public.guard_file_metadata_source();

CREATE FUNCTION public.guard_file_catalog_path() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.bucket_id='user-files' AND (NEW.name ~ '(^|/)(\.|\.\.)(/|$)'
    OR position('//' IN NEW.name)>0 OR position(chr(92) IN NEW.name)>0
    OR right(NEW.name,1)='/') THEN
    RAISE EXCEPTION 'Invalid file path' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_file_catalog_path() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_file_catalog_path BEFORE INSERT OR UPDATE OF name ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.guard_file_catalog_path();

-- The former unpaged select silently stopped at PostgREST's 1,000-row limit
-- and loaded metadata from unrelated folders. Keep browsing scoped and bounded.
CREATE FUNCTION public.file_manager_metadata(p_folder text DEFAULT '',p_view text DEFAULT 'files',p_offset integer DEFAULT 0)
RETURNS SETOF public.user_file_metadata LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT m.* FROM public.user_file_metadata m WHERE m.owner_id=auth.uid() AND (
    (p_view='files' AND starts_with(m.object_path,auth.uid()::text||'/'||CASE WHEN p_folder='' THEN '' ELSE p_folder||'/' END)
      AND position('/' IN substring(m.object_path FROM length(auth.uid()::text||'/'||CASE WHEN p_folder='' THEN '' ELSE p_folder||'/' END)+1))=0)
    OR (p_view='favorites' AND m.is_favorite AND m.trashed_at IS NULL)
    OR (p_view='recent' AND NOT m.is_folder AND m.trashed_at IS NULL)
    OR (p_view='trash' AND m.trashed_at IS NOT NULL)
  ) ORDER BY m.object_path LIMIT 1000 OFFSET greatest(p_offset,0);
$$;
CREATE FUNCTION public.file_manager_storage_bytes() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(sum(file_size),0)::bigint FROM public.user_file_metadata
    WHERE owner_id=auth.uid() AND NOT is_folder AND trashed_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.file_manager_metadata(text,text,integer),public.file_manager_storage_bytes() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.file_manager_metadata(text,text,integer),public.file_manager_storage_bytes() TO authenticated;
NOTIFY pgrst, 'reload schema';
