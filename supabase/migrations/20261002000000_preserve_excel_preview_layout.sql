-- Extend the existing protected queue; no source objects or permissions change.
ALTER TABLE public.file_preview_jobs DROP CONSTRAINT file_preview_jobs_extension_check;
ALTER TABLE public.file_preview_jobs ADD CONSTRAINT file_preview_jobs_extension_check
  CHECK (extension IN ('docx','xlsx','xls','pptx'));

CREATE OR REPLACE FUNCTION public.queue_file_preview(p_source_id uuid, p_version text, p_extension text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE source storage.objects; job public.file_preview_jobs; new_id uuid; owner uuid;
BEGIN
  -- Serialize queue inserts; repeated requests reuse one job, including failures.
  PERFORM pg_catalog.pg_advisory_xact_lock(610010001);
  SELECT * INTO source FROM storage.objects WHERE id = p_source_id AND bucket_id = 'user-files' FOR SHARE;
  IF source.id IS NULL OR (coalesce(source.version, '') || ':' || source.updated_at::text) <> p_version THEN
    RAISE EXCEPTION 'Source changed';
  END IF;
  SELECT * INTO job FROM public.file_preview_jobs WHERE source_id = source.id AND source_version = p_version;
  IF job.id IS NOT NULL THEN RETURN to_jsonb(job); END IF;
  IF p_extension NOT IN ('docx','xlsx','xls','pptx') OR lower(regexp_replace(source.name, '^.*\.', '')) <> p_extension THEN
    RAISE EXCEPTION 'Unsupported preview';
  END IF;
  IF coalesce((source.metadata->>'size')::bigint, 0) > (CASE WHEN p_extension IN ('xlsx','xls') THEN 20971520 ELSE 26214400 END) THEN
    RAISE EXCEPTION 'Preview size limit exceeded';
  END IF;
  owner := split_part(source.name, '/', 1)::uuid;
  IF (SELECT count(*) FROM public.file_preview_jobs WHERE status IN ('queued','generating')) >= 200
    OR (SELECT count(*) FROM public.file_preview_jobs WHERE owner_id = owner AND status IN ('queued','generating')) >= 20 THEN
    RAISE EXCEPTION 'Preview queue is full';
  END IF;
  new_id := gen_random_uuid();
  INSERT INTO public.file_preview_jobs(id, source_id, owner_id, object_path, source_version, extension, preview_path)
    VALUES(new_id, source.id, owner, source.name, p_version, p_extension, new_id::text || '.pdf') RETURNING * INTO job;
  RETURN to_jsonb(job);
END;
$$;

-- Derived Excel PDFs use the new layout-aware renderer. The existing delete
-- trigger queues only their cached PDFs for cleanup; original workbooks stay intact.
DELETE FROM public.file_preview_jobs WHERE extension IN ('xlsx','xls');
