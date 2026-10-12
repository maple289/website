BEGIN;
CREATE TABLE public.file_operation_receipts(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan jsonb NOT NULL,versions jsonb NOT NULL,destinations jsonb NOT NULL DEFAULT '{}',objects_done jsonb NOT NULL DEFAULT '[]',metadata_done jsonb NOT NULL DEFAULT '[]',
  started_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,cancelled_at timestamptz);
CREATE INDEX file_operation_pending ON public.file_operation_receipts(owner_id,created_at) WHERE completed_at IS NULL AND cancelled_at IS NULL;
ALTER TABLE public.file_operation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.file_operation_receipts FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.file_operation_objects(p_plan jsonb) RETURNS TABLE(source text,destination text,copying boolean)
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 WITH RECURSIVE branches(data) AS(SELECT p_plan UNION ALL SELECT data->'preserveTrash' FROM branches WHERE jsonb_typeof(data->'preserveTrash')='object')
 SELECT value,data->>'destination'||substring(value FROM length(data->>'source')+1),(data->>'copy')::boolean
 FROM branches,jsonb_array_elements_text(data->'objects');
$$;
CREATE FUNCTION public.file_operation_metadata(p_plan jsonb) RETURNS TABLE(source text,destination text,folder boolean,trashed_at timestamptz,trash_original_path text)
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 WITH RECURSIVE branches(data) AS(SELECT p_plan UNION ALL SELECT data->'preserveTrash' FROM branches WHERE jsonb_typeof(data->'preserveTrash')='object')
 SELECT value->>'object_path',data->>'destination'||substring(value->>'object_path' FROM length(data->>'source')+1),(value->>'is_folder')::boolean,
   CASE WHEN coalesce((data->>'restore')::boolean,false) THEN NULL ELSE (value->>'trashed_at')::timestamptz END,
   CASE WHEN coalesce((data->>'restore')::boolean,false) OR (data->>'copy')::boolean THEN NULL ELSE value->>'trash_original_path' END
 FROM branches,jsonb_array_elements(data->'metadata');
$$;
REVOKE ALL ON FUNCTION public.file_operation_objects(jsonb),public.file_operation_metadata(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.begin_file_operation(p_id uuid,p_source text,p_destination text,p_copy boolean,p_restore boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE payload jsonb; snapshot jsonb; receipt public.file_operation_receipts;
BEGIN
 IF NOT public.active_account(auth.uid()) THEN RAISE EXCEPTION 'An active account is required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,176));
 SELECT * INTO receipt FROM public.file_operation_receipts WHERE id=p_id AND owner_id=auth.uid();
 IF FOUND THEN
   IF receipt.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Transfer tracking was stopped'; END IF;
   RETURN receipt.plan||jsonb_build_object('operationId',receipt.id,'objectsDone',receipt.objects_done,'metadataDone',receipt.metadata_done);
 END IF;
 payload:=public.internal_plan_file_operation(p_source,p_destination,p_copy,p_restore);
 IF (payload->>'conflict')::boolean THEN RETURN payload; END IF;
 IF EXISTS(SELECT 1 FROM public.file_operation_receipts r WHERE owner_id=auth.uid() AND completed_at IS NULL AND cancelled_at IS NULL AND started_at IS NOT NULL
   AND (p_destination=r.plan->>'destination' OR starts_with(p_destination,(r.plan->>'destination')||'/') OR starts_with(r.plan->>'destination',p_destination||'/'))) THEN
   RAISE EXCEPTION 'Resume the existing transfer to this destination first';
 END IF;
 IF (SELECT count(*) FROM public.file_operation_objects(payload))>5000 THEN RAISE EXCEPTION 'Transfer up to 5000 objects at a time. Select a smaller folder.'; END IF;
 SELECT jsonb_object_agg(x.source,jsonb_build_object('id',o.id,'version',o.version,'updated_at',o.updated_at)) INTO snapshot
 FROM public.file_operation_objects(payload) x JOIN storage.objects o ON o.bucket_id='user-files' AND o.name=x.source;
 INSERT INTO public.file_operation_receipts(id,owner_id,plan,versions) VALUES(p_id,auth.uid(),payload,coalesce(snapshot,'{}'));
 RETURN payload||jsonb_build_object('operationId',p_id,'objectsDone','[]'::jsonb,'metadataDone','[]'::jsonb);
END;
$$;

CREATE FUNCTION public.file_operation_step(p_id uuid,p_source text,p_metadata boolean DEFAULT false,p_commit boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt public.file_operation_receipts; item record; current_object storage.objects; original storage.objects;
BEGIN
 IF NOT public.active_account(auth.uid()) THEN RAISE EXCEPTION 'An active account is required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,176));
 SELECT * INTO receipt FROM public.file_operation_receipts WHERE id=p_id AND owner_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='42501'; END IF;
 IF receipt.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Transfer tracking was stopped'; END IF;
 IF receipt.started_at IS NULL AND EXISTS(SELECT 1 FROM public.file_operation_receipts r WHERE owner_id=auth.uid() AND id<>p_id AND completed_at IS NULL AND cancelled_at IS NULL AND started_at IS NOT NULL
   AND (r.plan->>'destination'=receipt.plan->>'destination' OR starts_with(r.plan->>'destination',(receipt.plan->>'destination')||'/') OR starts_with(receipt.plan->>'destination',(r.plan->>'destination')||'/'))) THEN
   RAISE EXCEPTION 'Resume the existing transfer to this destination first';
 END IF;
 IF receipt.completed_at IS NOT NULL THEN RETURN true; END IF;
 UPDATE public.file_operation_receipts SET started_at=coalesce(started_at,now()) WHERE id=p_id;
 IF p_metadata THEN
   SELECT * INTO item FROM public.file_operation_metadata(receipt.plan) WHERE source=p_source;
   IF NOT FOUND THEN RAISE EXCEPTION 'Invalid transfer step' USING ERRCODE='42501'; END IF;
   IF receipt.metadata_done ? p_source THEN RETURN true; END IF;
   IF p_commit THEN
     IF NOT EXISTS(SELECT 1 FROM public.user_file_metadata WHERE owner_id=auth.uid() AND object_path=item.destination AND is_folder=item.folder
       AND trashed_at IS NOT DISTINCT FROM item.trashed_at AND trash_original_path IS NOT DISTINCT FROM item.trash_original_path) THEN
       RAISE EXCEPTION 'Folder metadata has not completed';
     END IF;
     UPDATE public.file_operation_receipts SET metadata_done=metadata_done||jsonb_build_array(p_source) WHERE id=p_id;
     RETURN true;
   END IF;
   RETURN false;
 END IF;
 SELECT * INTO item FROM public.file_operation_objects(receipt.plan) WHERE source=p_source;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid transfer step' USING ERRCODE='42501'; END IF;
 IF receipt.objects_done ? p_source THEN
   IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='user-files' AND name=item.destination AND id=(receipt.destinations->>p_source)::uuid) THEN RAISE EXCEPTION 'A completed destination changed. Review the transfer before continuing'; END IF;
   RETURN true;
 END IF;
 SELECT * INTO current_object FROM storage.objects WHERE bucket_id='user-files' AND name=item.destination;
 IF current_object.id IS NOT NULL THEN
   IF NOT item.copying AND current_object.id=(receipt.versions->p_source->>'id')::uuid THEN
     UPDATE public.file_operation_receipts SET objects_done=objects_done||jsonb_build_array(p_source),destinations=jsonb_set(destinations,ARRAY[p_source],to_jsonb(current_object.id),true) WHERE id=p_id;
     RETURN true; -- A committed Move whose response was lost is identified by catalog UUID.
   END IF;
   IF NOT p_commit THEN RAISE EXCEPTION 'Destination exists without a confirmed copy receipt. Review it before continuing; it will not be overwritten'; END IF;
 ELSE
   IF p_commit THEN RAISE EXCEPTION 'Storage transfer has not completed'; END IF;
 END IF;
 SELECT * INTO original FROM storage.objects WHERE bucket_id='user-files' AND name=p_source;
 IF original.id IS DISTINCT FROM (receipt.versions->p_source->>'id')::uuid OR original.version IS DISTINCT FROM receipt.versions->p_source->>'version'
   OR original.updated_at IS DISTINCT FROM (receipt.versions->p_source->>'updated_at')::timestamptz THEN
   RAISE EXCEPTION 'The original item changed. Review the transfer before continuing';
 END IF;
 IF p_commit THEN
   UPDATE public.file_operation_receipts SET objects_done=objects_done||jsonb_build_array(p_source),destinations=jsonb_set(destinations,ARRAY[p_source],to_jsonb(current_object.id),true) WHERE id=p_id;
   RETURN true;
 END IF;
 RETURN false;
END;
$$;

CREATE FUNCTION public.finish_file_operation(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt public.file_operation_receipts;
BEGIN
 IF NOT public.active_account(auth.uid()) THEN RAISE EXCEPTION 'An active account is required' USING ERRCODE='42501'; END IF;
 SELECT * INTO receipt FROM public.file_operation_receipts WHERE id=p_id AND owner_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='42501'; END IF;
 IF receipt.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Transfer tracking was stopped'; END IF;
 IF EXISTS(SELECT 1 FROM public.file_operation_objects(receipt.plan) WHERE NOT(receipt.objects_done ? source))
   OR EXISTS(SELECT 1 FROM public.file_operation_metadata(receipt.plan) WHERE NOT(receipt.metadata_done ? source)) THEN
   RAISE EXCEPTION 'Transfer still has unfinished steps';
 END IF;
 IF EXISTS(SELECT 1 FROM public.file_operation_objects(receipt.plan) x WHERE NOT EXISTS(
   SELECT 1 FROM storage.objects o WHERE o.bucket_id='user-files' AND o.name=x.destination AND o.id=(receipt.destinations->>x.source)::uuid)) THEN
   RAISE EXCEPTION 'A completed destination changed. Review the transfer before continuing';
 END IF;
 IF EXISTS(SELECT 1 FROM public.file_operation_metadata(receipt.plan) x WHERE NOT EXISTS(
   SELECT 1 FROM public.user_file_metadata m WHERE m.owner_id=auth.uid() AND m.object_path=x.destination AND m.is_folder=x.folder
     AND m.trashed_at IS NOT DISTINCT FROM x.trashed_at AND m.trash_original_path IS NOT DISTINCT FROM x.trash_original_path)) THEN
   RAISE EXCEPTION 'Destination metadata changed. Review the transfer before continuing';
 END IF;
 UPDATE public.file_operation_receipts SET completed_at=coalesce(completed_at,now()) WHERE id=p_id;
END;
$$;
CREATE FUNCTION public.unfinished_file_operations() RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT plan||jsonb_build_object('operationId',id,'objectsDone',objects_done,'metadataDone',metadata_done)
 FROM public.file_operation_receipts WHERE owner_id=auth.uid() AND public.active_account(auth.uid()) AND started_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL ORDER BY created_at LIMIT 20;
$$;
CREATE FUNCTION public.stop_file_operation_tracking(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.active_account(auth.uid()) THEN RAISE EXCEPTION 'An active account is required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,176));
 UPDATE public.file_operation_receipts SET cancelled_at=coalesce(cancelled_at,now()) WHERE id=p_id AND owner_id=auth.uid() AND completed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.stop_file_operation_tracking(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stop_file_operation_tracking(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.begin_file_operation(uuid,text,text,boolean,boolean),public.file_operation_step(uuid,text,boolean,boolean),public.finish_file_operation(uuid),public.unfinished_file_operations() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.begin_file_operation(uuid,text,text,boolean,boolean),public.file_operation_step(uuid,text,boolean,boolean),public.finish_file_operation(uuid),public.unfinished_file_operations() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
