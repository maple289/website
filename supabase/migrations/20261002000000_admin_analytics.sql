-- Current-content analytics. Source FKs remove derived statistics with the source;
-- no deletion history, soft deletes, anonymous identities, or copied filenames.
CREATE TABLE public.analytics_content (
  content_type text NOT NULL CHECK (content_type IN ('video','photo','file')),
  content_id uuid NOT NULL,
  video_id uuid GENERATED ALWAYS AS (CASE WHEN content_type='video' THEN content_id END) STORED REFERENCES public.videos(id) ON DELETE CASCADE,
  photo_id uuid GENERATED ALWAYS AS (CASE WHEN content_type='photo' THEN content_id END) STORED REFERENCES public.photos(id) ON DELETE CASCADE,
  file_id uuid GENERATED ALWAYS AS (CASE WHEN content_type='file' THEN content_id END) STORED REFERENCES storage.objects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  uploaded_at timestamptz,
  uploaded_bytes bigint NOT NULL DEFAULT 0 CHECK (uploaded_bytes>=0),
  views bigint NOT NULL DEFAULT 0,
  previews bigint NOT NULL DEFAULT 0,
  downloads bigint NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  last_accessed_at timestamptz,
  PRIMARY KEY (content_type,content_id)
);
CREATE INDEX analytics_uploads ON public.analytics_content(uploaded_at,content_type,owner_id) WHERE uploaded_at IS NOT NULL;
CREATE INDEX analytics_owner ON public.analytics_content(owner_id,content_type);
CREATE INDEX analytics_video_fk ON public.analytics_content(video_id) WHERE video_id IS NOT NULL;
CREATE INDEX analytics_photo_fk ON public.analytics_content(photo_id) WHERE photo_id IS NOT NULL;
CREATE INDEX analytics_file_fk ON public.analytics_content(file_id) WHERE file_id IS NOT NULL;
CREATE INDEX analytics_top_views ON public.analytics_content(content_type,views DESC,content_id);
CREATE INDEX analytics_top_files ON public.analytics_content((previews+downloads) DESC,content_id) WHERE content_type='file';
CREATE TABLE public.analytics_events (
  request_id uuid PRIMARY KEY,
  content_type text NOT NULL,
  content_id uuid NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('view','preview','download')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(content_type,content_id) REFERENCES public.analytics_content ON DELETE CASCADE
);
CREATE INDEX analytics_events_time ON public.analytics_events(occurred_at,content_type,action);
CREATE INDEX analytics_events_actor ON public.analytics_events(actor_id,content_type,content_id,action,occurred_at DESC);
CREATE INDEX analytics_events_content ON public.analytics_events(content_type,content_id,occurred_at);
CREATE TABLE public.analytics_viewers (
  content_type text NOT NULL,
  content_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY(content_type,content_id,user_id),
  FOREIGN KEY(content_type,content_id) REFERENCES public.analytics_content ON DELETE CASCADE
);
CREATE TABLE public.analytics_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('login','uploaded','viewed','previewed','downloaded','renamed','visibility_changed','shared','unshared','reaction_added','reaction_changed','reaction_removed','account_created','profile_updated','role_changed','storage_settings_changed')),
  content_type text,
  content_id uuid,
  folder_id uuid REFERENCES public.user_file_metadata(public_id) ON DELETE CASCADE,
  account_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  FOREIGN KEY(content_type,content_id) REFERENCES public.analytics_content ON DELETE CASCADE,
  CHECK ((content_type IS NULL)=(content_id IS NULL))
);
CREATE INDEX analytics_activity_time ON public.analytics_activity(occurred_at DESC,id DESC);
CREATE INDEX analytics_activity_content ON public.analytics_activity(content_type,content_id);
CREATE INDEX analytics_activity_folder ON public.analytics_activity(folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX analytics_activity_account ON public.analytics_activity(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX analytics_activity_actor ON public.analytics_activity(actor_id,occurred_at DESC);
CREATE INDEX analytics_viewers_user ON public.analytics_viewers(user_id);
CREATE TABLE public.analytics_user_activity (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_activity_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.analytics_storage_snapshot (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  collected_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE TABLE public.analytics_config (id boolean PRIMARY KEY DEFAULT true CHECK(id), tracking_started_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.analytics_config DEFAULT VALUES;
CREATE TABLE public.analytics_cache (key text PRIMARY KEY, expires_at timestamptz NOT NULL, data jsonb NOT NULL);

ALTER TABLE public.analytics_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_viewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_user_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_storage_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_content,public.analytics_events,public.analytics_viewers,public.analytics_activity,public.analytics_user_activity,public.analytics_storage_snapshot,public.analytics_config,public.analytics_cache FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.analytics_content,public.analytics_events,public.analytics_viewers,public.analytics_activity,public.analytics_user_activity,public.analytics_storage_snapshot,public.analytics_config,public.analytics_cache TO service_role;
REVOKE ALL ON SEQUENCE public.analytics_activity_id_seq FROM PUBLIC,anon,authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.analytics_activity_id_seq TO service_role;

CREATE FUNCTION public.analytics_touch() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR EXISTS(SELECT 1 FROM public.account_activation WHERE user_id=auth.uid() AND (NOT active OR must_change_password)) THEN RETURN; END IF;
  INSERT INTO public.analytics_user_activity(user_id) VALUES(auth.uid()) ON CONFLICT(user_id) DO UPDATE
    SET last_activity_at=now() WHERE analytics_user_activity.last_activity_at < now()-interval '5 minutes';
END; $$;
REVOKE ALL ON FUNCTION public.analytics_touch() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.analytics_touch() TO authenticated;

-- Internal activity writer: callers never supply actor IDs through a public API.
CREATE FUNCTION public.analytics_log(p_actor uuid,p_action text,p_type text DEFAULT NULL,p_content uuid DEFAULT NULL,p_folder uuid DEFAULT NULL,p_account uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.analytics_activity(actor_id,action,content_type,content_id,folder_id,account_id)
    VALUES(p_actor,p_action,p_type,p_content,p_folder,p_account);
  IF p_actor IS NOT NULL THEN INSERT INTO public.analytics_user_activity(user_id) VALUES(p_actor)
    ON CONFLICT(user_id) DO UPDATE SET last_activity_at=now(); END IF;
END; $$;
REVOKE ALL ON FUNCTION public.analytics_log(uuid,text,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.analytics_source_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE kind text; source uuid; owner uuid; amount bigint; ready boolean;
BEGIN
  IF TG_TABLE_SCHEMA='storage' THEN
    IF NEW.bucket_id<>'user-files' OR NEW.name !~ '^[0-9a-f-]{36}/' OR regexp_replace(NEW.name,'^.*/','') IN ('.folder','.keep') THEN RETURN NEW; END IF;
    kind:='file'; source:=NEW.id; owner:=split_part(NEW.name,'/',1)::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=owner) THEN RETURN NEW; END IF;
    INSERT INTO public.analytics_content(content_type,content_id,owner_id) VALUES(kind,source,owner) ON CONFLICT DO NOTHING;
    IF TG_OP='UPDATE' AND NEW.name IS DISTINCT FROM OLD.name THEN PERFORM public.analytics_log(auth.uid(),'renamed',kind,source); END IF;
  ELSE
    kind:=CASE WHEN TG_TABLE_NAME='videos' THEN 'video' ELSE 'photo' END;
    source:=NEW.id; owner:=NEW.owner_id; amount:=greatest(0,coalesce(NEW.file_size,0));
    ready:=kind='photo' OR coalesce(to_jsonb(NEW)->>'processing_status','ready')='ready';
    INSERT INTO public.analytics_content(content_type,content_id,owner_id) VALUES(kind,source,owner) ON CONFLICT DO NOTHING;
    -- Modern queued uploads are recorded by the completion trigger, after all
    -- processing succeeds. Legacy ready content without a job is also supported.
    IF ready AND NOT EXISTS(SELECT 1 FROM public.media_upload_jobs j WHERE j.id=source AND j.kind IN ('video','photo')) THEN
      UPDATE public.analytics_content SET uploaded_at=NEW.created_at,uploaded_bytes=amount WHERE content_type=kind AND content_id=source AND uploaded_at IS NULL;
      IF FOUND THEN PERFORM public.analytics_log(owner,'uploaded',kind,source); END IF;
    END IF;
    IF TG_OP='UPDATE' THEN
      IF NEW.file_name IS DISTINCT FROM OLD.file_name THEN PERFORM public.analytics_log(auth.uid(),'renamed',kind,source); END IF;
      IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN PERFORM public.analytics_log(auth.uid(),'visibility_changed',kind,source); END IF;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE LOG 'analytics_source_change failed (%)',SQLSTATE; RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.analytics_source_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER analytics_video AFTER INSERT OR UPDATE ON public.videos FOR EACH ROW EXECUTE FUNCTION public.analytics_source_change();
CREATE TRIGGER analytics_photo AFTER INSERT OR UPDATE ON public.photos FOR EACH ROW EXECUTE FUNCTION public.analytics_source_change();
CREATE TRIGGER analytics_file AFTER INSERT OR UPDATE OF name ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.analytics_source_change();

CREATE FUNCTION public.analytics_completed_upload() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source uuid;
BEGIN
  IF NEW.status='complete' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.kind IN ('video','photo') THEN
    source:=(NEW.result->>'id')::uuid;
    UPDATE public.analytics_content SET uploaded_at=coalesce(NEW.finished_at,now()),
      uploaded_bytes=CASE WHEN NEW.kind='video' THEN coalesce((SELECT file_size FROM public.videos WHERE id=source),0) ELSE coalesce((SELECT file_size FROM public.photos WHERE id=source),0) END
      WHERE content_type=NEW.kind AND content_id=source AND uploaded_at IS NULL;
    IF FOUND THEN PERFORM public.analytics_log(NEW.owner_id,'uploaded',NEW.kind,source); END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE LOG 'analytics_completed_upload failed (%)',SQLSTATE; RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.analytics_completed_upload() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER analytics_upload_complete AFTER UPDATE OF status ON public.media_upload_jobs FOR EACH ROW EXECUTE FUNCTION public.analytics_completed_upload();

CREATE FUNCTION public.analytics_record(p_type text,p_action text,p_request_id uuid,p_id uuid DEFAULT NULL,p_path text DEFAULT NULL,p_public_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source uuid:=p_id; path text; allowed boolean:=false; amount bigint; affected integer;
BEGIN
  IF p_request_id IS NULL OR p_type NOT IN ('video','photo','file') OR p_action NOT IN ('view','preview','download','upload') THEN RAISE EXCEPTION 'Invalid analytics event' USING ERRCODE='22023'; END IF;
  IF auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.account_activation WHERE user_id=auth.uid() AND (NOT active OR must_change_password)) THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
  IF p_type='file' THEN
    IF p_action NOT IN ('preview','download','upload') THEN RAISE EXCEPTION 'Invalid file event' USING ERRCODE='22023'; END IF;
    IF p_public_id IS NOT NULL THEN
      path:=public.resolve_public_user_file(p_public_id); allowed:=path IS NOT NULL AND p_action IN ('preview','download');
    ELSIF auth.uid() IS NOT NULL THEN
      path:=p_path;
      IF path IS NULL THEN SELECT name INTO path FROM storage.objects WHERE id=source AND bucket_id='user-files'; END IF;
      allowed:=public.can_read_user_file(path);
    END IF;
    SELECT id,greatest(0,coalesce((metadata->>'size')::bigint,0)) INTO source,amount FROM storage.objects
      WHERE bucket_id='user-files' AND name=path AND regexp_replace(name,'^.*/','') NOT IN ('.folder','.keep');
    allowed:=allowed AND source IS NOT NULL;
    IF p_action='upload' THEN
      allowed:=allowed AND auth.uid() IS NOT NULL AND split_part(path,'/',1)=auth.uid()::text
        AND EXISTS(SELECT 1 FROM public.user_file_metadata WHERE object_path=path AND owner_id=auth.uid() AND NOT is_folder AND trashed_at IS NULL);
    END IF;
  ELSE
    allowed:=p_action='view' AND public.can_access_reaction_media(p_type,source);
    IF p_type='video' THEN allowed:=allowed AND EXISTS(SELECT 1 FROM public.videos WHERE id=source AND coalesce(processing_status,'ready')='ready'); END IF;
  END IF;
  IF NOT coalesce(allowed,false) OR NOT EXISTS(SELECT 1 FROM public.analytics_content WHERE content_type=p_type AND content_id=source) THEN RAISE EXCEPTION 'Content unavailable or access denied' USING ERRCODE='42501'; END IF;
  IF p_action='upload' THEN
    UPDATE public.analytics_content SET uploaded_at=now(),uploaded_bytes=amount WHERE content_type='file' AND content_id=source AND uploaded_at IS NULL;
    IF FOUND THEN PERFORM public.analytics_log(auth.uid(),'uploaded','file',source); END IF;
    RETURN;
  END IF;
  -- Serialize the same registered user's requests to prevent rapid duplicates.
  IF auth.uid() IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||source::text||p_action,0));
    IF EXISTS(SELECT 1 FROM public.analytics_events WHERE actor_id=auth.uid() AND content_type=p_type AND content_id=source AND action=p_action AND occurred_at>now()-interval '30 seconds') THEN RETURN; END IF;
  END IF;
  INSERT INTO public.analytics_events(request_id,content_type,content_id,actor_id,action) VALUES(p_request_id,p_type,source,auth.uid(),p_action) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected=0 THEN RETURN; END IF;
  UPDATE public.analytics_content SET views=views+CASE WHEN p_action='view' THEN 1 ELSE 0 END,
    previews=previews+CASE WHEN p_action='preview' THEN 1 ELSE 0 END,
    downloads=downloads+CASE WHEN p_action='download' THEN 1 ELSE 0 END,
    last_viewed_at=CASE WHEN p_action IN ('view','preview') THEN now() ELSE last_viewed_at END,last_accessed_at=now()
    WHERE content_type=p_type AND content_id=source;
  IF auth.uid() IS NOT NULL AND p_action IN ('view','preview') THEN
    INSERT INTO public.analytics_viewers VALUES(p_type,source,auth.uid()) ON CONFLICT DO NOTHING;
  END IF;
  PERFORM public.analytics_log(auth.uid(),CASE p_action WHEN 'view' THEN 'viewed' WHEN 'preview' THEN 'previewed' ELSE 'downloaded' END,p_type,source);
END; $$;
REVOKE ALL ON FUNCTION public.analytics_record(text,text,uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analytics_record(text,text,uuid,uuid,text,uuid) TO anon,authenticated;

CREATE FUNCTION public.analytics_changes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_data jsonb; kind text; source uuid; folder uuid; actor uuid;
BEGIN
  row_data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME='media_reactions' THEN
    kind:=row_data->>'media_type'; source:=(row_data->>'media_id')::uuid; actor:=(row_data->>'user_id')::uuid;
    -- Never turn FK cascades into deletion activity/history.
    IF NOT EXISTS(SELECT 1 FROM public.analytics_content WHERE content_type=kind AND content_id=source) OR
      (kind='video' AND NOT EXISTS(SELECT 1 FROM public.videos WHERE id=source)) OR
      (kind='photo' AND NOT EXISTS(SELECT 1 FROM public.photos WHERE id=source)) OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor) THEN RETURN NULL; END IF;
    IF TG_OP<>'UPDATE' OR NEW.reaction IS DISTINCT FROM OLD.reaction THEN
      PERFORM public.analytics_log(actor,CASE TG_OP WHEN 'INSERT' THEN 'reaction_added' WHEN 'UPDATE' THEN 'reaction_changed' ELSE 'reaction_removed' END,kind,source);
    END IF;
  ELSIF TG_TABLE_NAME='user_file_shares' THEN
    SELECT public_id INTO folder FROM public.user_file_metadata WHERE object_path=row_data->>'object_path' AND owner_id=(row_data->>'owner_id')::uuid;
    IF folder IS NOT NULL THEN PERFORM public.analytics_log(auth.uid(),CASE WHEN TG_OP='DELETE' THEN 'unshared' ELSE 'shared' END,NULL,NULL,folder); END IF;
  ELSIF TG_TABLE_SCHEMA='auth' THEN
    IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at AND NEW.last_sign_in_at IS NOT NULL THEN PERFORM public.analytics_log(NEW.id,'login'); END IF;
  ELSIF TG_TABLE_NAME='profiles' THEN
    IF auth.uid() IS NULL THEN RETURN NULL; END IF;
    IF TG_OP='INSERT' THEN PERFORM public.analytics_log(auth.uid(),'account_created',NULL,NULL,NULL,NEW.id);
    ELSIF NEW.role IS DISTINCT FROM OLD.role THEN PERFORM public.analytics_log(auth.uid(),'role_changed',NULL,NULL,NULL,NEW.id);
    ELSIF NEW.first_name IS DISTINCT FROM OLD.first_name OR NEW.last_name IS DISTINCT FROM OLD.last_name OR NEW.email IS DISTINCT FROM OLD.email THEN PERFORM public.analytics_log(auth.uid(),'profile_updated',NULL,NULL,NULL,NEW.id); END IF;
  ELSE PERFORM public.analytics_log(coalesce(auth.uid(),NEW.updated_by),'storage_settings_changed'); END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RAISE LOG 'analytics_changes failed (%)',SQLSTATE; RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.analytics_changes() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER analytics_reactions AFTER INSERT OR UPDATE OR DELETE ON public.media_reactions FOR EACH ROW EXECUTE FUNCTION public.analytics_changes();
CREATE TRIGGER analytics_shares AFTER INSERT OR DELETE ON public.user_file_shares FOR EACH ROW EXECUTE FUNCTION public.analytics_changes();
CREATE TRIGGER analytics_login AFTER UPDATE OF last_sign_in_at ON auth.users FOR EACH ROW EXECUTE FUNCTION public.analytics_changes();
CREATE TRIGGER analytics_profiles AFTER INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.analytics_changes();
CREATE TRIGGER analytics_settings AFTER UPDATE ON public.storage_settings FOR EACH ROW EXECUTE FUNCTION public.analytics_changes();

CREATE FUNCTION public.analytics_admin_action(p_actor uuid,p_action text,p_account uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_action NOT IN ('account_created','profile_updated') OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND role='admin') THEN RAISE EXCEPTION 'Invalid administrative activity' USING ERRCODE='42501'; END IF;
  PERFORM public.analytics_log(p_actor,p_action,NULL,NULL,NULL,p_account);
END; $$;
REVOKE ALL ON FUNCTION public.analytics_admin_action(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_admin_action(uuid,text,uuid) TO service_role;

-- Preserve existing authorization/atomic saves, while writing only grants that
-- actually changed. A save of unchanged sharing must not manufacture activity.
CREATE OR REPLACE FUNCTION public.set_user_file_sharing(p_path text,p_recipients uuid[],p_everyone boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM 1 FROM public.user_file_metadata m WHERE m.owner_id=auth.uid() AND m.object_path=p_path AND m.trashed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the owner can manage sharing' USING ERRCODE='42501'; END IF;
  IF cardinality(p_recipients)>100 OR EXISTS(SELECT 1 FROM unnest(p_recipients) r(id) WHERE r.id IS NULL OR r.id=auth.uid() OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=r.id)) THEN RAISE EXCEPTION 'Choose up to 100 existing users other than the owner'; END IF;
  DELETE FROM public.user_file_shares s WHERE s.owner_id=auth.uid() AND s.object_path=p_path
    AND ((s.recipient_id IS NULL AND NOT coalesce(p_everyone,false)) OR (s.recipient_id IS NOT NULL AND NOT (s.recipient_id=ANY(coalesce(p_recipients,'{}'::uuid[])))));
  INSERT INTO public.user_file_shares(owner_id,object_path,recipient_id) SELECT auth.uid(),p_path,r.id FROM(SELECT DISTINCT unnest(p_recipients) AS id) r ON CONFLICT DO NOTHING;
  IF p_everyone THEN INSERT INTO public.user_file_shares(owner_id,object_path,recipient_id) VALUES(auth.uid(),p_path,NULL) ON CONFLICT DO NOTHING; END IF;
END; $$;

-- Backfill only existing successfully published content. Views start at deployment.
INSERT INTO public.analytics_content(content_type,content_id,owner_id,uploaded_at,uploaded_bytes)
  SELECT 'video',v.id,v.owner_id,CASE WHEN coalesce(v.processing_status,'ready')='ready' AND (j.id IS NULL OR j.status='complete') THEN coalesce(j.finished_at,v.created_at) END,greatest(0,coalesce(v.file_size,0))
  FROM public.videos v LEFT JOIN public.media_upload_jobs j ON j.id=v.id;
INSERT INTO public.analytics_content(content_type,content_id,owner_id,uploaded_at,uploaded_bytes)
  SELECT 'photo',p.id,p.owner_id,CASE WHEN j.id IS NULL OR j.status='complete' THEN coalesce(j.finished_at,p.created_at) END,greatest(0,coalesce(p.file_size,0)) FROM public.photos p LEFT JOIN public.media_upload_jobs j ON j.id=p.id;
INSERT INTO public.analytics_content(content_type,content_id,owner_id,uploaded_at,uploaded_bytes)
  SELECT 'file',o.id,p.id,o.created_at,greatest(0,coalesce((o.metadata->>'size')::bigint,0)) FROM storage.objects o
    JOIN public.profiles p ON split_part(o.name,'/',1)=p.id::text WHERE o.bucket_id='user-files' AND regexp_replace(o.name,'^.*/','') NOT IN ('.folder','.keep');

-- Stored object sizes include retained originals, conversions and thumbnails.
-- Configured bucket prefixes are storage keys, not assumed host filesystem paths.
CREATE VIEW public.analytics_media_objects AS
  SELECT v.owner_id,'Videos'::text AS category,k.bucket_id,
    concat_ws('/',nullif(trim(CASE WHEN k.bucket_id='user-videos' THEN s.videos_base_path ELSE s.images_base_path END,'/'),''),k.path) AS name
  FROM public.videos v LEFT JOIN public.storage_settings s ON s.id=1
  CROSS JOIN LATERAL(SELECT DISTINCT bucket_id,path FROM(VALUES ('user-videos',v.storage_path),('user-videos',v.processed_storage_path),('user-images',v.preview_path)) paths(bucket_id,path)) k WHERE k.path IS NOT NULL
  UNION ALL
  SELECT p.owner_id,'Photos','user-images',concat_ws('/',nullif(trim(s.images_base_path,'/'),''),k.path)
  FROM public.photos p LEFT JOIN public.storage_settings s ON s.id=1 CROSS JOIN LATERAL(SELECT DISTINCT path FROM(VALUES(p.storage_path),(p.preview_path),(p.thumbnail_path)) paths(path)) k WHERE k.path IS NOT NULL;
REVOKE ALL ON public.analytics_media_objects FROM PUBLIC,anon,authenticated;
CREATE VIEW public.analytics_object_inventory AS
  SELECT o.id,o.bucket_id,o.name,greatest(0,coalesce((o.metadata->>'size')::bigint,0)) AS bytes,
    coalesce(m.category,CASE WHEN o.bucket_id='user-videos' THEN 'Videos'
      WHEN o.bucket_id='user-images' AND (position('/videos/' IN '/'||o.name)>0 OR position('/video-previews/' IN '/'||o.name)>0) THEN 'Videos'
      WHEN o.bucket_id='user-images' THEN 'Photos' WHEN o.bucket_id='user-files' THEN 'Files'
      WHEN o.bucket_id='file-previews' THEN 'Preview cache' WHEN o.bucket_id='media-staging' THEN 'Temporary / processing' ELSE 'Other application data' END) AS category,
    coalesce(m.owner_id,p.id) AS owner_id
  FROM storage.objects o LEFT JOIN(SELECT DISTINCT ON(bucket_id,name) bucket_id,name,owner_id,category FROM public.analytics_media_objects ORDER BY bucket_id,name,category,owner_id) m ON m.bucket_id=o.bucket_id AND m.name=o.name
  LEFT JOIN public.profiles p ON p.id::text=substring(o.name FROM '(?:^|/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:/|$)');
REVOKE ALL ON public.analytics_object_inventory FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.analytics_object_inventory TO service_role;

CREATE FUNCTION public.analytics_file_type(p_mime text,p_name text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE
    WHEN mime='application/pdf' THEN 'pdf'
    WHEN mime IN ('application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document') THEN 'word'
    WHEN mime IN ('application/vnd.ms-excel','application/msexcel') AND lower(p_name)~'\.csv$' THEN 'csv'
    WHEN mime IN ('application/vnd.ms-excel','application/msexcel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') THEN 'excel'
    WHEN mime IN ('application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation') THEN 'powerpoint'
    WHEN mime IN ('text/csv','application/csv') THEN 'csv'
    WHEN mime LIKE 'image/%' THEN 'image'
    WHEN mime IN ('application/zip','application/x-zip-compressed','application/vnd.rar','application/x-rar-compressed','application/x-7z-compressed','application/x-tar','application/gzip','application/x-gzip','application/x-bzip2','application/x-xz') THEN 'archive'
    WHEN mime IN ('application/json','application/xml','application/rtf') OR mime LIKE 'text/%' THEN CASE WHEN lower(p_name)~'\.(csv|tsv)$' THEN 'csv' ELSE 'text' END
    WHEN mime NOT IN ('','application/octet-stream','binary/octet-stream','application/x-empty') THEN 'other'
    WHEN lower(p_name)~'\.pdf$' THEN 'pdf' WHEN lower(p_name)~'\.(docx?|odt|rtf)$' THEN 'word'
    WHEN lower(p_name)~'\.(xlsx?|xlsm|xlsb|ods)$' THEN 'excel' WHEN lower(p_name)~'\.(pptx?|odp)$' THEN 'powerpoint'
    WHEN lower(p_name)~'\.(csv|tsv)$' THEN 'csv' WHEN lower(p_name)~'\.(jpe?g|png|gif|webp|heic|tiff?|avif|bmp|heif)$' THEN 'image'
    WHEN lower(p_name)~'\.(txt|json|xml|md|log|yaml|yml)$' THEN 'text' WHEN lower(p_name)~'\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$' THEN 'archive' ELSE 'other' END
  FROM(SELECT lower(trim(split_part(coalesce(p_mime,''),';',1))) AS mime) m;
$$;
REVOKE ALL ON FUNCTION public.analytics_file_type(text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.analytics_inventory(p_after uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]'::jsonb) FROM (SELECT id,bucket_id,name,category,owner_id,bytes FROM public.analytics_object_inventory WHERE p_after IS NULL OR id>p_after ORDER BY id LIMIT 1000) r;
$$;
CREATE FUNCTION public.analytics_store_snapshot(p_data jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  INSERT INTO public.analytics_storage_snapshot(id,collected_at,data) VALUES(true,now(),p_data) ON CONFLICT(id) DO UPDATE SET collected_at=now(),data=excluded.data;
$$;
CREATE FUNCTION public.analytics_database_bytes() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT pg_database_size(current_database()); $$;
REVOKE ALL ON FUNCTION public.analytics_inventory(uuid),public.analytics_store_snapshot(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_inventory(uuid),public.analytics_store_snapshot(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.analytics_database_bytes() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_database_bytes() TO service_role;

CREATE VIEW public.analytics_catalog AS
SELECT a.*,v.file_name AS name,v.created_at,v.file_size,v.processed_file_size,v.duration_seconds,
  v.resolution_width,v.resolution_height,v.visibility, v.visibility='public' AS shared,
  'video'::text AS file_type,regexp_replace(lower(v.file_name),'^.*\.','') AS extension,v.mime_type,
  coalesce(v.processing_status,'ready') AS status,
  (SELECT count(*) FROM public.media_reactions r WHERE r.media_type='video' AND r.media_id=v.id) AS reactions,
  (SELECT count(*) FROM public.analytics_viewers u WHERE u.content_type=a.content_type AND u.content_id=a.content_id) AS unique_viewers
FROM public.analytics_content a JOIN public.videos v ON a.content_type='video' AND a.content_id=v.id
UNION ALL
SELECT a.*,p.file_name,p.created_at,p.file_size,NULL::bigint,NULL::double precision,NULL::integer,NULL::integer,p.visibility,p.visibility='public',
  'image',regexp_replace(lower(p.file_name),'^.*\.',''),p.mime_type,'ready',
  (SELECT count(*) FROM public.media_reactions r WHERE r.media_type='photo' AND r.media_id=p.id),
  (SELECT count(*) FROM public.analytics_viewers u WHERE u.content_type=a.content_type AND u.content_id=a.content_id)
FROM public.analytics_content a JOIN public.photos p ON a.content_type='photo' AND a.content_id=p.id
UNION ALL
SELECT a.*,regexp_replace(o.name,'^.*/',''),o.created_at,coalesce((o.metadata->>'size')::bigint,m.file_size,0),NULL::bigint,NULL::double precision,NULL::integer,NULL::integer,
  CASE WHEN public.public_file_root(o.name) IS NOT NULL THEN 'public' WHEN sh.shared THEN 'shared' ELSE 'private' END,coalesce(sh.shared,false),
  public.analytics_file_type(coalesce(nullif(m.mime_type,''),o.metadata->>'mimetype',''),o.name),
  CASE WHEN regexp_replace(o.name,'^.*/','') LIKE '%.%' THEN regexp_replace(lower(o.name),'^.*\.','') ELSE '' END,
  coalesce(m.mime_type,o.metadata->>'mimetype',''),'ready',0::bigint,
  (SELECT count(*) FROM public.analytics_viewers u WHERE u.content_type=a.content_type AND u.content_id=a.content_id)
FROM public.analytics_content a JOIN storage.objects o ON a.content_type='file' AND a.content_id=o.id
LEFT JOIN public.user_file_metadata m ON m.object_path=o.name AND m.owner_id=a.owner_id
LEFT JOIN LATERAL(SELECT true AS shared FROM public.user_file_shares s JOIN public.user_file_metadata sm USING(owner_id,object_path)
  WHERE s.owner_id=a.owner_id AND sm.trashed_at IS NULL AND (o.name=s.object_path OR (sm.is_folder AND starts_with(o.name,s.object_path||'/'))) LIMIT 1) sh ON true
WHERE NOT EXISTS(SELECT 1 FROM public.user_file_metadata t WHERE t.owner_id=a.owner_id AND t.trashed_at IS NOT NULL AND (t.object_path=o.name OR (t.is_folder AND starts_with(o.name,t.object_path||'/'))));
REVOKE ALL ON public.analytics_catalog FROM PUBLIC,anon,authenticated;

CREATE VIEW public.analytics_users AS
SELECT p.id,p.email AS username,coalesce(nullif(concat_ws(' ',nullif(p.first_name,''),nullif(p.last_name,'')),''),split_part(p.email,'@',1)) AS display_name,
  p.email,p.role,p.created_at,u.last_sign_in_at AS last_login,greatest(ua.last_activity_at,u.last_sign_in_at) AS last_activity,
  CASE WHEN u.banned_until>now() OR ac.active=false THEN 'Disabled' WHEN ac.must_change_password THEN 'Password required' ELSE 'Active' END AS status,
  coalesce(c.videos,0) AS videos,coalesce(c.photos,0) AS photos,coalesce(c.files,0) AS files,
  coalesce(s.video_storage,0) AS video_storage,coalesce(s.photo_storage,0) AS photo_storage,coalesce(s.file_storage,0) AS file_storage,
  coalesce(s.total_storage,0) AS total_storage,coalesce(c.views,0) AS views,coalesce(c.uploads,0) AS uploads
FROM public.profiles p JOIN auth.users u ON u.id=p.id LEFT JOIN public.account_activation ac ON ac.user_id=p.id LEFT JOIN public.analytics_user_activity ua ON ua.user_id=p.id
LEFT JOIN(SELECT owner_id,count(*) FILTER(WHERE content_type='video') AS videos,count(*) FILTER(WHERE content_type='photo') AS photos,count(*) FILTER(WHERE content_type='file') AS files,
  sum(views+previews) AS views,count(*) FILTER(WHERE uploaded_at IS NOT NULL) AS uploads FROM public.analytics_catalog GROUP BY owner_id) c ON c.owner_id=p.id
LEFT JOIN(SELECT owner_id,sum(bytes) FILTER(WHERE category='Videos') AS video_storage,sum(bytes) FILTER(WHERE category='Photos') AS photo_storage,
  sum(bytes) FILTER(WHERE category='Files') AS file_storage,sum(bytes) FILTER(WHERE category IN ('Videos','Photos','Files')) AS total_storage FROM public.analytics_object_inventory GROUP BY owner_id) s ON s.owner_id=p.id;
REVOKE ALL ON public.analytics_users FROM PUBLIC,anon,authenticated;
