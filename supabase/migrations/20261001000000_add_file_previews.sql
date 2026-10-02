-- Previews are derived data. Only the server can inspect jobs or read cached PDFs.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('file-previews', 'file-previews', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.file_preview_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES storage.objects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  object_path text NOT NULL,
  source_version text NOT NULL,
  extension text NOT NULL CHECK (extension IN ('docx', 'xlsx', 'pptx')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','generating','ready','failed')),
  preview_path text NOT NULL UNIQUE,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE(source_id, source_version)
);
CREATE INDEX IF NOT EXISTS file_preview_queue ON public.file_preview_jobs(created_at) WHERE status = 'queued';
CREATE TABLE IF NOT EXISTS public.file_preview_cleanup (
  path text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.file_preview_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_preview_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.file_preview_jobs, public.file_preview_cleanup FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.file_preview_jobs, public.file_preview_cleanup TO service_role;

-- The edge function authorizes the original first using can_read_user_file or
-- resolve_public_user_file. This resolver is never callable by a browser.
CREATE OR REPLACE FUNCTION public.get_file_preview_source(p_path text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', o.id, 'path', o.name,
    'version', coalesce(o.version, '') || ':' || o.updated_at::text,
    'size', coalesce((o.metadata->>'size')::bigint, 0),
    'mime', coalesce(o.metadata->>'mimetype', 'application/octet-stream'))
  FROM storage.objects o WHERE o.bucket_id = 'user-files' AND o.name = p_path;
$$;

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
  IF p_extension NOT IN ('docx','xlsx','pptx') OR lower(regexp_replace(source.name, '^.*\.', '')) <> p_extension THEN
    RAISE EXCEPTION 'Unsupported preview';
  END IF;
  IF coalesce((source.metadata->>'size')::bigint, 0) > (CASE WHEN p_extension = 'xlsx' THEN 20971520 ELSE 26214400 END) THEN
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

CREATE OR REPLACE FUNCTION public.claim_file_preview() RETURNS SETOF public.file_preview_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE next_id uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(610010002);
  -- One conversion across worker instances, not merely one thread per process.
  UPDATE public.file_preview_jobs SET status='failed', error='Preview generation was interrupted. You can still download the original file.', finished_at=now()
    WHERE status='generating' AND started_at < now() - interval '5 minutes';
  IF EXISTS (SELECT 1 FROM public.file_preview_jobs WHERE status='generating') THEN RETURN; END IF;
  SELECT id INTO next_id FROM public.file_preview_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  RETURN QUERY UPDATE public.file_preview_jobs SET status='generating', started_at=now() WHERE id=next_id RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_file_preview_cleanup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.file_preview_cleanup(path) VALUES(OLD.preview_path) ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS file_preview_deleted ON public.file_preview_jobs;
CREATE TRIGGER file_preview_deleted AFTER DELETE ON public.file_preview_jobs
FOR EACH ROW EXECUTE FUNCTION public.enqueue_file_preview_cleanup();

CREATE OR REPLACE FUNCTION public.invalidate_file_previews_storage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.bucket_id='user-files' AND (OLD.name, OLD.updated_at, OLD.version, OLD.metadata)
    IS DISTINCT FROM (NEW.name, NEW.updated_at, NEW.version, NEW.metadata) THEN
    DELETE FROM public.file_preview_jobs WHERE source_id=OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS file_preview_source_changed ON storage.objects;
CREATE TRIGGER file_preview_source_changed AFTER UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.invalidate_file_previews_storage();

CREATE OR REPLACE FUNCTION public.invalidate_file_previews_metadata() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    -- Favorite changes are not file replacements. File moves, Trash, type/size
    -- changes invalidate the derived cache, including folder descendants.
    IF (OLD.object_path, OLD.trashed_at, OLD.file_size, OLD.mime_type)
      IS NOT DISTINCT FROM (NEW.object_path, NEW.trashed_at, NEW.file_size, NEW.mime_type) THEN RETURN NEW; END IF;
  END IF;
  DELETE FROM public.file_preview_jobs WHERE owner_id=OLD.owner_id AND
    (object_path=OLD.object_path OR (OLD.is_folder AND starts_with(object_path, OLD.object_path || '/')));
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS file_preview_metadata_changed ON public.user_file_metadata;
CREATE TRIGGER file_preview_metadata_changed AFTER UPDATE OR DELETE ON public.user_file_metadata
FOR EACH ROW EXECUTE FUNCTION public.invalidate_file_previews_metadata();

-- Reconcile a late worker upload after cancellation, crashes, and expired failures.
CREATE OR REPLACE FUNCTION public.reconcile_file_preview_cache() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.file_preview_cleanup(path)
    SELECT o.name FROM storage.objects o WHERE o.bucket_id='file-previews'
      AND o.created_at < now() - interval '5 minutes'
      AND NOT EXISTS(SELECT 1 FROM public.file_preview_jobs j WHERE j.preview_path=o.name AND j.status IN ('generating','ready'))
    ON CONFLICT DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.get_file_preview_source(text), public.queue_file_preview(uuid,text,text),
  public.claim_file_preview(), public.reconcile_file_preview_cache(), public.enqueue_file_preview_cleanup(),
  public.invalidate_file_previews_storage(), public.invalidate_file_previews_metadata() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_file_preview_source(text), public.queue_file_preview(uuid,text,text),
  public.claim_file_preview(), public.reconcile_file_preview_cache() TO service_role;
