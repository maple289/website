-- Latest VM counters only; no history, user data changes or storage traversal.
CREATE TABLE public.analytics_system_load (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  collected_at timestamptz NOT NULL,
  data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')
);
ALTER TABLE public.analytics_system_load ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_system_load FROM PUBLIC,anon,authenticated,service_role;
-- Frequent activity counts read only current jobs, not completed-job history.
CREATE INDEX media_jobs_active_video ON public.media_upload_jobs(status)
  WHERE kind='video' AND status IN ('queued','processing');

CREATE FUNCTION public.analytics_store_system_load(p_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data)<>'object'
    OR jsonb_typeof(p_data->'cpus') IS DISTINCT FROM 'array'
    OR (p_data->>'cpuCount')::integer IS DISTINCT FROM jsonb_array_length(p_data->'cpus')
    OR jsonb_array_length(p_data->'cpus')=0
    OR (p_data->>'memoryTotalBytes')::bigint IS NULL OR (p_data->>'memoryTotalBytes')::bigint<=0
    OR (p_data->>'memoryUsedBytes')::bigint IS NULL OR (p_data->>'memoryUsedBytes')::bigint<0
    OR (p_data->>'memoryUsedBytes')::bigint>(p_data->>'memoryTotalBytes')::bigint THEN
    RAISE EXCEPTION 'Invalid system load snapshot' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.analytics_system_load(id,collected_at,data)
    VALUES(true,clock_timestamp(),p_data)
    ON CONFLICT(id) DO UPDATE SET collected_at=excluded.collected_at,data=excluded.data;
END;
$$;
REVOKE ALL ON FUNCTION public.analytics_store_system_load(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_store_system_load(jsonb) TO service_role;

CREATE FUNCTION public.admin_system_load()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' AS $$
DECLARE result jsonb; collected timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))
    OR EXISTS(SELECT 1 FROM public.account_activation WHERE user_id=auth.uid() AND (NOT active OR must_change_password)) THEN
    RAISE EXCEPTION 'Active administrator account required' USING ERRCODE='42501';
  END IF;
  SELECT s.data,s.collected_at INTO result,collected FROM public.analytics_system_load s WHERE s.id=true;
  RETURN coalesce(result,jsonb_build_object('cpuOverall',NULL,'cpuCount',NULL,'cpus','[]'::jsonb,
    'memoryUsedBytes',NULL,'memoryTotalBytes',NULL,'memoryPercent',NULL,'sampleSeconds',NULL))
    || jsonb_build_object('collectedAt',collected,'stale',collected IS NULL OR collected<clock_timestamp()-interval '15 seconds',
      'videoProcessing',(SELECT jsonb_build_object('converting',count(*) FILTER(WHERE status='processing'),
        'queued',count(*) FILTER(WHERE status='queued')) FROM public.media_upload_jobs WHERE kind='video' AND status IN ('queued','processing')));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_system_load() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_system_load() TO authenticated;
NOTIFY pgrst, 'reload schema';
