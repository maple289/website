-- Capability links never grant access through the normal content/storage RLS.
CREATE TABLE public.temporary_content_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('video','photo','file','folder')),
  content_id text NOT NULL,
  video_id uuid REFERENCES public.videos(id) ON DELETE CASCADE,
  photo_id uuid REFERENCES public.photos(id) ON DELETE CASCADE,
  file_path text,
  FOREIGN KEY(owner_id,file_path) REFERENCES public.user_file_metadata(owner_id,object_path) ON UPDATE CASCADE ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at = created_at + interval '24 hours'),
  CHECK ((content_type='video' AND video_id IS NOT NULL AND photo_id IS NULL AND file_path IS NULL)
    OR (content_type='photo' AND photo_id IS NOT NULL AND video_id IS NULL AND file_path IS NULL)
    OR (content_type IN ('file','folder') AND file_path IS NOT NULL AND video_id IS NULL AND photo_id IS NULL))
);
CREATE UNIQUE INDEX temporary_content_shares_active ON public.temporary_content_shares(owner_id,content_type,content_id) WHERE revoked_at IS NULL;
ALTER TABLE public.temporary_content_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.temporary_content_shares FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.temporary_content_shares TO service_role;

CREATE FUNCTION public.sync_temporary_share_identity() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN NEW.content_id:=coalesce(NEW.video_id::text,NEW.photo_id::text,NEW.file_path); RETURN NEW; END;
$$;
REVOKE ALL ON FUNCTION public.sync_temporary_share_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sync_temporary_share_identity BEFORE INSERT OR UPDATE ON public.temporary_content_shares
FOR EACH ROW EXECUTE FUNCTION public.sync_temporary_share_identity();

CREATE FUNCTION public.assert_temporary_share_owner(p_type text,p_content text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in' USING ERRCODE='42501'; END IF;
  IF p_type='video' THEN
    PERFORM 1 FROM public.videos WHERE id::text=p_content AND owner_id=auth.uid() AND processing_status='ready' FOR UPDATE;
  ELSIF p_type='photo' THEN
    PERFORM 1 FROM public.photos WHERE id::text=p_content AND owner_id=auth.uid() FOR UPDATE;
  ELSIF p_type IN ('file','folder') THEN
    PERFORM 1 FROM public.user_file_metadata m WHERE m.owner_id=auth.uid() AND m.object_path=p_content
      AND m.is_folder=(p_type='folder') AND NOT EXISTS(SELECT 1 FROM public.user_file_metadata t
        WHERE t.owner_id=m.owner_id AND t.trashed_at IS NOT NULL
        AND (t.object_path=m.object_path OR (t.is_folder AND starts_with(m.object_path,t.object_path||'/')))) FOR UPDATE;
  ELSE RAISE EXCEPTION 'Invalid content type'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the owner can share available content' USING ERRCODE='42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_temporary_share_owner(text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_temporary_share(p_type text,p_content text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.assert_temporary_share_owner(p_type,p_content);
  SELECT jsonb_build_object('id',s.id,'expires_at',s.expires_at) INTO result
    FROM public.temporary_content_shares s WHERE s.owner_id=auth.uid() AND s.content_type=p_type
    AND (s.content_id=p_content OR s.file_path=p_content) AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp();
  RETURN result;
END;
$$;
CREATE FUNCTION public.create_temporary_share(p_type text,p_content text,p_hash text,p_previous uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stamp timestamptz; result public.temporary_content_shares; previous uuid;
BEGIN
  PERFORM public.assert_temporary_share_owner(p_type,p_content);
  stamp:=clock_timestamp();
  SELECT id INTO previous FROM public.temporary_content_shares s WHERE s.owner_id=auth.uid()
    AND s.content_type=p_type AND (s.content_id=p_content OR s.file_path=p_content) AND s.revoked_at IS NULL AND s.expires_at>stamp;
  IF previous IS NOT NULL AND previous IS DISTINCT FROM p_previous THEN
    RAISE EXCEPTION 'An active link already exists. Refresh and confirm replacement.' USING ERRCODE='40001';
  END IF;
  UPDATE public.temporary_content_shares SET revoked_at=stamp WHERE owner_id=auth.uid()
    AND content_type=p_type AND (content_id=p_content OR file_path=p_content) AND revoked_at IS NULL;
  INSERT INTO public.temporary_content_shares(owner_id,content_type,content_id,video_id,photo_id,file_path,token_hash,created_at,expires_at)
    VALUES(auth.uid(),p_type,p_content,CASE WHEN p_type='video' THEN p_content::uuid END,
      CASE WHEN p_type='photo' THEN p_content::uuid END,CASE WHEN p_type IN ('file','folder') THEN p_content END,
      p_hash,stamp,stamp+interval '24 hours') RETURNING * INTO result;
  RETURN jsonb_build_object('id',result.id,'expires_at',result.expires_at);
END;
$$;
CREATE FUNCTION public.revoke_temporary_share(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.temporary_content_shares SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=p_id AND owner_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the owner can revoke this link' USING ERRCODE='42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.get_temporary_share(text,text),public.create_temporary_share(text,text,text,uuid),public.revoke_temporary_share(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_temporary_share(text,text),public.create_temporary_share(text,text,text,uuid),public.revoke_temporary_share(uuid) TO authenticated;

-- Server-authorized plan: no recipient may copy/move shared content, and no
-- operation may create an implicit destination, escape the owner or merge trees.
CREATE FUNCTION public.plan_file_operation(p_source text,p_destination text,p_copy boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.user_file_metadata; parent text; objects jsonb; rows jsonb;
BEGIN
  SELECT * INTO item FROM public.user_file_metadata WHERE owner_id=auth.uid() AND object_path=p_source;
  IF NOT FOUND OR NOT starts_with(p_destination,auth.uid()::text||'/') THEN
    RAISE EXCEPTION 'You do not have permission for this operation' USING ERRCODE='42501';
  END IF;
  IF p_destination ~ '(^|/)(\.|\.\.)(/|$)' OR position('//' IN p_destination)>0
    OR position(chr(92) IN p_destination)>0 OR right(p_destination,1)='/'
    OR regexp_replace(p_destination,'^.*/','') IN ('.folder','.keep') THEN RAISE EXCEPTION 'Invalid destination'; END IF;
  IF (p_destination=p_source AND NOT p_copy) OR (item.is_folder AND starts_with(p_destination,p_source||'/')) THEN
    RAISE EXCEPTION 'A folder cannot be placed inside itself or its subfolders';
  END IF;
  parent:=regexp_replace(p_destination,'/[^/]+$','');
  IF parent<>auth.uid()::text AND NOT EXISTS(SELECT 1 FROM public.user_file_metadata
    WHERE owner_id=auth.uid() AND object_path=parent AND is_folder AND trashed_at IS NULL) THEN
    RAISE EXCEPTION 'Choose an existing destination folder you own' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.user_file_metadata t WHERE t.owner_id=auth.uid() AND t.trashed_at IS NOT NULL
    AND (t.object_path=p_source OR (t.is_folder AND starts_with(p_source,t.object_path||'/')) OR t.object_path=parent
      OR (t.is_folder AND starts_with(parent,t.object_path||'/')))) THEN RAISE EXCEPTION 'Items in Trash cannot be copied or moved'; END IF;
  IF EXISTS(SELECT 1 FROM public.user_file_metadata WHERE owner_id=auth.uid() AND object_path=p_destination)
    OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='user-files' AND (name=p_destination OR starts_with(name,p_destination||'/'))) THEN
    RETURN jsonb_build_object('conflict',true);
  END IF;
  SELECT jsonb_agg(name ORDER BY CASE WHEN name ~ '/(\.folder|\.keep)$' THEN 1 ELSE 0 END,name) INTO objects
    FROM storage.objects WHERE bucket_id='user-files' AND (name=p_source OR (item.is_folder AND starts_with(name,p_source||'/')));
  IF objects IS NULL THEN RAISE EXCEPTION 'The source item no longer exists'; END IF;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY length(m.object_path) DESC) INTO rows FROM public.user_file_metadata m
    WHERE m.owner_id=auth.uid() AND (m.object_path=p_source OR (item.is_folder AND starts_with(m.object_path,p_source||'/')));
  RETURN jsonb_build_object('conflict',false,'objects',objects,'metadata',rows);
END;
$$;
REVOKE ALL ON FUNCTION public.plan_file_operation(text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.plan_file_operation(text,text,boolean) TO authenticated;

CREATE FUNCTION public.valid_file_clipboard(p_path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_file_metadata m WHERE m.owner_id=auth.uid() AND m.object_path=p_path
    AND NOT EXISTS(SELECT 1 FROM public.user_file_metadata t WHERE t.owner_id=m.owner_id AND t.trashed_at IS NOT NULL
      AND (t.object_path=p_path OR (t.is_folder AND starts_with(p_path,t.object_path||'/')))));
$$;
REVOKE ALL ON FUNCTION public.valid_file_clipboard(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.valid_file_clipboard(text) TO authenticated;

CREATE FUNCTION public.temporary_share_children(p_hash text,p_relative text DEFAULT '',p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE link public.temporary_content_shares; parent text; result jsonb;
BEGIN
  SELECT * INTO link FROM public.temporary_content_shares WHERE token_hash=p_hash AND content_type='folder'
    AND revoked_at IS NULL AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_relative<>'' AND (p_relative ~ '(^|/)(\.|\.\.)(/|$)' OR position('//' IN p_relative)>0 OR position(chr(92) IN p_relative)>0
    OR left(p_relative,1)='/' OR right(p_relative,1)='/') THEN RETURN NULL; END IF;
  parent:=link.file_path||CASE WHEN p_relative='' THEN '' ELSE '/'||p_relative END;
  IF NOT EXISTS(SELECT 1 FROM public.user_file_metadata WHERE owner_id=link.owner_id AND object_path=parent AND is_folder)
    OR EXISTS(SELECT 1 FROM public.user_file_metadata t WHERE t.owner_id=link.owner_id AND t.trashed_at IS NOT NULL
      AND (t.object_path=parent OR (t.is_folder AND starts_with(parent,t.object_path||'/')))) THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('name',regexp_replace(m.object_path,'^.*/',''),
    'relative',substring(m.object_path FROM length(link.file_path)+2),'isFolder',m.is_folder)), '[]'::jsonb) INTO result
    FROM (SELECT * FROM public.user_file_metadata WHERE owner_id=link.owner_id AND trashed_at IS NULL
      AND regexp_replace(object_path,'/[^/]+$','')=parent ORDER BY is_folder DESC,object_path LIMIT 101 OFFSET greatest(p_offset,0)) m;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.temporary_share_children(text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_share_children(text,text,integer) TO service_role;
NOTIFY pgrst,'reload schema';
