-- Library previews follow metadata-bound sources. Messenger keeps its existing
-- source/cache namespace and authorization; no attachment is migrated here.
BEGIN;
ALTER TABLE public.file_preview_jobs DROP CONSTRAINT file_preview_jobs_source_bucket_check;
ALTER TABLE public.file_preview_jobs ADD CONSTRAINT file_preview_jobs_source_bucket_check
 CHECK(source_bucket IN ('user-files','users','messenger-attachments'));
ALTER TABLE public.file_preview_jobs ADD COLUMN cache_bucket text NOT NULL DEFAULT 'file-previews'
 CHECK(cache_bucket IN ('file-previews','cache'));
ALTER TABLE public.file_preview_cleanup ADD COLUMN cache_bucket text NOT NULL DEFAULT 'file-previews'
 CHECK(cache_bucket IN ('file-previews','cache'));
ALTER TABLE public.file_preview_cleanup ADD COLUMN source_bucket text
 CHECK(source_bucket IN ('user-files','users','messenger-attachments'));
-- Existing unscoped receipts remain unscoped. Legacy Messenger RPCs insert only
-- path; new trigger-generated receipts explicitly capture their source scope.
ALTER TABLE public.file_preview_cleanup ALTER COLUMN source_bucket SET DEFAULT 'messenger-attachments';
ALTER TABLE streamly_internal.library_storage_control ADD COLUMN pause_preview_claims boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.library_worker_control() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('layout_version',layout_version,'pause_media_claims',pause_media_claims,
   'pause_library_writes',pause_library_writes,'pause_preview_claims',pause_preview_claims)
 FROM streamly_internal.library_storage_control WHERE id;
$$;
ALTER FUNCTION public.library_worker_control() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.library_worker_control() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.library_worker_control() TO service_role;

-- An operator may prepare a byte-identical copy of an existing ready PDF without
-- starting another conversion. The API/worker cannot create this allowlist.
CREATE TABLE streamly_internal.prepared_preview_copies(
 job_id uuid PRIMARY KEY,owner_id uuid NOT NULL,old_source_id uuid NOT NULL,old_source_version text NOT NULL,
 old_cache_bucket text NOT NULL CHECK(old_cache_bucket IN ('file-previews','cache')),
 old_cache_key text NOT NULL,old_cache_object_id uuid NOT NULL,old_cache_version text NOT NULL,
 new_source_id uuid NOT NULL,new_cache_key text NOT NULL UNIQUE,
 bytes bigint NOT NULL CHECK(bytes>0 AND bytes<=52428800),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 new_cache_object_id uuid,new_cache_version text,verified_at timestamptz,activated_at timestamptz,
 CHECK(new_cache_key='previews/'||owner_id||'/'||new_source_id||'/'||job_id||'.pdf'),
 CHECK(verified_at IS NULL OR new_cache_object_id IS NOT NULL AND new_cache_version IS NOT NULL)
);
ALTER TABLE streamly_internal.prepared_preview_copies OWNER TO postgres;
REVOKE ALL ON streamly_internal.prepared_preview_copies FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.queue_file_preview(p_source_id uuid,p_version text,p_extension text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source storage.objects; job public.file_preview_jobs; new_id uuid; owner uuid; destination text; library boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(610010001);
 SELECT * INTO source FROM storage.objects WHERE id=p_source_id AND bucket_id IN ('user-files','users','messenger-attachments') FOR SHARE;
 IF source.id IS NULL OR (coalesce(source.version,'')||':'||source.updated_at::text)<>p_version THEN RAISE EXCEPTION 'Source changed'; END IF;
 library:=source.bucket_id<>'messenger-attachments';
 IF library AND public.get_preview_source_by_id(source.id) IS NULL THEN RAISE EXCEPTION 'File unavailable'; END IF;
 SELECT * INTO job FROM public.file_preview_jobs WHERE source_id=source.id AND source_version=p_version;
 IF job.id IS NOT NULL THEN RETURN to_jsonb(job); END IF;
 IF library AND NOT EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND NOT pause_library_writes) THEN
   RAISE EXCEPTION 'Storage maintenance is in progress' USING ERRCODE='55000'; END IF;
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
 destination:=CASE WHEN library AND EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND layout_version=2)
   THEN 'cache' ELSE 'file-previews' END;
 INSERT INTO public.file_preview_jobs(id,source_id,owner_id,object_path,source_version,source_bucket,extension,preview_path,cache_bucket)
 VALUES(new_id,source.id,owner,source.name,p_version,source.bucket_id,p_extension,
   CASE WHEN destination='cache' THEN 'previews/'||owner||'/'||source.id||'/'||new_id||'.pdf' ELSE new_id||'.pdf' END,destination)
 RETURNING * INTO job;
 RETURN to_jsonb(job);
END;
$$;
ALTER FUNCTION public.queue_file_preview(uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.queue_file_preview(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_file_preview(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_file_preview() RETURNS SETOF public.file_preview_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE next_id uuid; control streamly_internal.library_storage_control;
BEGIN
 PERFORM pg_advisory_xact_lock(610010001);
 SELECT * INTO control FROM streamly_internal.library_storage_control WHERE id;
 IF NOT FOUND OR control.pause_preview_claims THEN RETURN; END IF;
 UPDATE public.file_preview_jobs SET status='failed',error='Preview generation was interrupted. You can still download the original file.',finished_at=now()
 WHERE status='generating' AND started_at<now()-interval '5 minutes'
   AND (source_bucket='messenger-attachments' OR NOT control.pause_library_writes);
 IF EXISTS(SELECT 1 FROM public.file_preview_jobs WHERE status='generating') THEN RETURN; END IF;
 SELECT id INTO next_id FROM public.file_preview_jobs WHERE status='queued'
   AND (source_bucket='messenger-attachments' OR NOT control.pause_media_claims AND NOT control.pause_library_writes)
 ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 RETURN QUERY UPDATE public.file_preview_jobs SET status='generating',started_at=now() WHERE id=next_id RETURNING *;
END;
$$;
ALTER FUNCTION public.claim_file_preview() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_file_preview() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_file_preview() TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_file_preview_cleanup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.file_preview_cleanup(path,cache_bucket,source_bucket)
 VALUES(OLD.preview_path,OLD.cache_bucket,OLD.source_bucket) ON CONFLICT(path) DO NOTHING;
 INSERT INTO public.file_preview_cleanup(path,cache_bucket,source_bucket)
 SELECT c.new_cache_key,'cache',OLD.source_bucket FROM streamly_internal.prepared_preview_copies c WHERE c.job_id=OLD.id
 ON CONFLICT(path) DO NOTHING;
 RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_file_previews_storage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.bucket_id IN ('user-files','users','messenger-attachments') AND
   (OLD.name,OLD.updated_at,OLD.version,OLD.metadata) IS DISTINCT FROM (NEW.name,NEW.updated_at,NEW.version,NEW.metadata) THEN
   DELETE FROM public.file_preview_jobs WHERE source_id=OLD.id;
 END IF;
 RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.invalidate_file_previews_metadata() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (OLD.object_path,OLD.trashed_at,OLD.file_size,OLD.mime_type)
   IS NOT DISTINCT FROM (NEW.object_path,NEW.trashed_at,NEW.file_size,NEW.mime_type) THEN RETURN NEW; END IF;
 DELETE FROM public.file_preview_jobs WHERE source_bucket IN ('user-files','users') AND owner_id=OLD.owner_id AND
   (source_id=OLD.source_id OR object_path=OLD.object_path OR
     source_bucket='users' AND object_path=OLD.owner_id||'/files/'||substring(OLD.object_path FROM length(OLD.owner_id::text)+2)
     OR OLD.is_folder AND (starts_with(object_path,OLD.object_path||'/') OR
       source_bucket='users' AND starts_with(object_path,OLD.owner_id||'/files/'||substring(OLD.object_path FROM length(OLD.owner_id::text)+2)||'/')));
 RETURN OLD;
END;
$$;

CREATE FUNCTION public.file_preview_cleanup_candidates() RETURNS SETOF public.file_preview_cleanup
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT c.* FROM public.file_preview_cleanup c WHERE c.source_bucket='messenger-attachments'
   OR EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND NOT pause_media_claims AND NOT pause_library_writes)
 ORDER BY c.created_at,c.path LIMIT 50;
$$;
ALTER FUNCTION public.file_preview_cleanup_candidates() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.file_preview_cleanup_candidates() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.file_preview_cleanup_candidates() TO service_role;

-- Preserve the legacy cache reconciler, including Messenger's derived-cache
-- behavior. During a library drain, defer orphan scanning; known Messenger
-- deletion receipts remain available through the scoped queue above.
DO $$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.reconcile_file_preview_cache()'::regprocedure);
 definition:=replace(definition,'CREATE OR REPLACE FUNCTION public.reconcile_file_preview_cache()',
   'CREATE FUNCTION streamly_internal.reconcile_legacy_preview_cache()');
 IF position('CREATE FUNCTION streamly_internal.reconcile_legacy_preview_cache()' IN definition)=0 THEN
   RAISE EXCEPTION 'Unexpected legacy preview reconciler'; END IF;
 EXECUTE definition;
END $$;
ALTER FUNCTION streamly_internal.reconcile_legacy_preview_cache() OWNER TO postgres;
REVOKE ALL ON FUNCTION streamly_internal.reconcile_legacy_preview_cache() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.reconcile_file_preview_cache() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND NOT pause_media_claims AND NOT pause_library_writes) THEN
   PERFORM streamly_internal.reconcile_legacy_preview_cache();
 END IF;
 -- New cache objects are removed only by concrete job-deletion receipts. No
 -- age/extension sweep of unknown objects is introduced for the new namespace.
END;
$$;
ALTER FUNCTION public.reconcile_file_preview_cache() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reconcile_file_preview_cache() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_file_preview_cache() TO service_role;

CREATE FUNCTION public.guard_library_preview_job_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE scope text;
BEGIN
 IF TG_OP='DELETE' THEN scope:=OLD.source_bucket; ELSE scope:=NEW.source_bucket; END IF;
 IF scope IN ('user-files','users') AND
   (session_user NOT IN ('postgres','supabase_admin') OR current_setting('role',true) IN ('anon','authenticated','service_role'))
   AND NOT EXISTS(SELECT 1 FROM streamly_internal.library_storage_control WHERE id AND NOT pause_library_writes) THEN
   RAISE EXCEPTION 'Storage maintenance is in progress' USING ERRCODE='55000'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
ALTER FUNCTION public.guard_library_preview_job_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_library_preview_job_write() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_library_preview_job_write BEFORE INSERT OR UPDATE OR DELETE ON public.file_preview_jobs
 FOR EACH ROW EXECUTE FUNCTION public.guard_library_preview_job_write();

CREATE FUNCTION public.guard_library_cache_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.file_preview_jobs;
BEGIN
 IF NEW.bucket_id<>'cache' THEN RETURN NEW; END IF;
 -- Hold the job while the Storage catalog transaction commits, so deleting a
 -- source/job cannot acknowledge cache cleanup before its upload becomes visible.
 SELECT j.* INTO job FROM public.file_preview_jobs j WHERE j.source_bucket IN ('user-files','users') AND (
   j.status='generating' AND j.cache_bucket='cache' AND j.preview_path=NEW.name
   OR j.status='ready' AND EXISTS(SELECT 1 FROM streamly_internal.prepared_preview_copies c WHERE c.job_id=j.id
     AND c.owner_id=j.owner_id AND c.old_source_id=j.source_id AND c.old_source_version=j.source_version AND c.new_cache_key=NEW.name))
 FOR SHARE;
 IF job.id IS NULL THEN RAISE EXCEPTION 'Cache upload no longer belongs to an active job' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END;
$$;
ALTER FUNCTION public.guard_library_cache_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_library_cache_write() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_library_cache_write BEFORE INSERT OR UPDATE ON storage.objects
 FOR EACH ROW EXECUTE FUNCTION public.guard_library_cache_write();
NOTIFY pgrst,'reload schema';
COMMIT;
