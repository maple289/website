-- Extend the existing bounded Office-preview worker, never its public scope.
ALTER TABLE public.file_preview_jobs ADD COLUMN source_bucket text NOT NULL DEFAULT 'user-files'
  CHECK(source_bucket IN ('user-files','messenger-attachments'));
CREATE FUNCTION public.get_preview_source_by_id(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',id,'path',name,'bucket',bucket_id,'version',coalesce(version,'')||':'||updated_at::text,
    'size',coalesce((metadata->>'size')::bigint,0),'mime',coalesce(metadata->>'mimetype','application/octet-stream'))
  FROM storage.objects WHERE id=p_id AND bucket_id IN ('user-files','messenger-attachments');
$$;
REVOKE ALL ON FUNCTION public.get_preview_source_by_id(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_preview_source_by_id(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_file_preview(p_source_id uuid,p_version text,p_extension text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source storage.objects; job public.file_preview_jobs; new_id uuid; owner uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(610010001);
  SELECT * INTO source FROM storage.objects WHERE id=p_source_id AND bucket_id IN ('user-files','messenger-attachments') FOR SHARE;
  IF source.id IS NULL OR (coalesce(source.version,'')||':'||source.updated_at::text)<>p_version THEN RAISE EXCEPTION 'Source changed'; END IF;
  SELECT * INTO job FROM public.file_preview_jobs WHERE source_id=source.id AND source_version=p_version;
  IF job.id IS NOT NULL THEN RETURN to_jsonb(job); END IF;
  IF p_extension NOT IN ('docx','xlsx','xls','pptx') OR lower(regexp_replace(source.name,'^.*\.',''))<>p_extension THEN RAISE EXCEPTION 'Unsupported preview'; END IF;
  IF coalesce((source.metadata->>'size')::bigint,0)>(CASE WHEN p_extension IN ('xlsx','xls') THEN 20971520 ELSE 26214400 END) THEN RAISE EXCEPTION 'Preview size limit exceeded'; END IF;
  IF source.bucket_id='messenger-attachments' THEN
    SELECT coalesce(a.uploader_id,(SELECT member.user_id FROM public.messenger_members member
      WHERE member.conversation_id=a.conversation_id AND public.messenger_active(member.user_id)
      ORDER BY member.joined_at,member.user_id LIMIT 1)) INTO owner
      FROM public.messenger_attachments a JOIN public.messenger_messages m ON m.id=a.message_id
      WHERE a.source_id=source.id AND a.object_path=source.name AND m.deletion_started_at IS NULL;
    IF owner IS NULL THEN RAISE EXCEPTION 'Attachment unavailable'; END IF;
  ELSE owner:=split_part(source.name,'/',1)::uuid; END IF;
  IF (SELECT count(*) FROM public.file_preview_jobs WHERE status IN ('queued','generating'))>=200
    OR (SELECT count(*) FROM public.file_preview_jobs WHERE owner_id=owner AND status IN ('queued','generating'))>=20 THEN RAISE EXCEPTION 'Preview queue is full'; END IF;
  new_id:=gen_random_uuid();
  INSERT INTO public.file_preview_jobs(id,source_id,owner_id,object_path,source_version,source_bucket,extension,preview_path)
    VALUES(new_id,source.id,owner,source.name,p_version,source.bucket_id,p_extension,new_id::text||'.pdf') RETURNING * INTO job;
  RETURN to_jsonb(job);
END $$;
CREATE OR REPLACE FUNCTION public.invalidate_file_previews_storage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF OLD.bucket_id IN ('user-files','messenger-attachments') AND (OLD.name,OLD.updated_at,OLD.version,OLD.metadata)
    IS DISTINCT FROM (NEW.name,NEW.updated_at,NEW.version,NEW.metadata) THEN DELETE FROM public.file_preview_jobs WHERE source_id=OLD.id; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.invalidate_file_previews_metadata() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF TG_OP='UPDATE' THEN
    IF (OLD.object_path,OLD.trashed_at,OLD.file_size,OLD.mime_type) IS NOT DISTINCT FROM (NEW.object_path,NEW.trashed_at,NEW.file_size,NEW.mime_type) THEN RETURN NEW; END IF;
  END IF;
  DELETE FROM public.file_preview_jobs WHERE source_bucket='user-files' AND owner_id=OLD.owner_id AND
    (object_path=OLD.object_path OR (OLD.is_folder AND starts_with(object_path,OLD.object_path||'/'))); RETURN OLD;
END $$;

CREATE FUNCTION public.messenger_attachment(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE attachment public.messenger_attachments; result jsonb;
BEGIN
  SELECT a.* INTO attachment FROM public.messenger_attachments a JOIN public.messenger_messages m ON m.id=a.message_id
    WHERE a.id=p_id AND m.deletion_started_at IS NULL;
  IF attachment.id IS NULL OR NOT public.messenger_member(attachment.conversation_id) THEN RAISE EXCEPTION 'Attachment unavailable' USING ERRCODE='42501'; END IF;
  SELECT public.get_preview_source_by_id(o.id)||jsonb_build_object('name',attachment.name,'conversation_id',attachment.conversation_id)
    INTO result FROM storage.objects o WHERE o.id=attachment.source_id AND o.bucket_id='messenger-attachments' AND o.name=attachment.object_path;
  IF result IS NULL THEN RAISE EXCEPTION 'Attachment unavailable'; END IF; RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.messenger_attachment(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.messenger_attachment(uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
