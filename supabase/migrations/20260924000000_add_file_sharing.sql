-- Read-only sharing. NULL recipient means all authenticated users, never anon.
CREATE TABLE public.user_file_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  object_path text NOT NULL,
  recipient_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, object_path)
    REFERENCES public.user_file_metadata(owner_id, object_path)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (recipient_id IS NULL OR recipient_id <> owner_id)
);
CREATE UNIQUE INDEX user_file_shares_user ON public.user_file_shares(owner_id, object_path, recipient_id) WHERE recipient_id IS NOT NULL;
CREATE UNIQUE INDEX user_file_shares_everyone ON public.user_file_shares(owner_id, object_path) WHERE recipient_id IS NULL;
CREATE INDEX user_file_shares_recipient ON public.user_file_shares(recipient_id);
ALTER TABLE public.user_file_shares ENABLE ROW LEVEL SECURITY;
-- All changes go through the owner-checking, atomic RPC below.
REVOKE ALL ON public.user_file_shares FROM anon, authenticated;

CREATE FUNCTION public.can_read_user_file(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    split_part(p_path, '/', 1) = auth.uid()::text
    OR (
      NOT EXISTS (
        SELECT 1 FROM public.user_file_metadata t
        WHERE t.trashed_at IS NOT NULL
          AND (t.object_path = p_path OR (t.is_folder AND starts_with(p_path, t.object_path || '/')))
      )
      AND EXISTS (
        SELECT 1 FROM public.user_file_shares s
        JOIN public.user_file_metadata m USING (owner_id, object_path)
        WHERE (s.recipient_id = auth.uid() OR s.recipient_id IS NULL)
          AND m.trashed_at IS NULL
          AND (p_path = s.object_path OR (m.is_folder AND starts_with(p_path, s.object_path || '/')))
      )
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_user_file(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_user_file(text) TO authenticated;

CREATE POLICY user_files_select_shared ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'user-files' AND public.can_read_user_file(name));
CREATE POLICY user_file_metadata_select_shared ON public.user_file_metadata FOR SELECT TO authenticated
USING (public.can_read_user_file(object_path));
-- Existing INSERT/UPDATE/DELETE policies remain strictly owner-only.

CREATE FUNCTION public.search_file_share_users(p_path text, p_query text)
RETURNS TABLE(id uuid, email text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_file_metadata m WHERE m.owner_id = auth.uid() AND m.object_path = p_path AND m.trashed_at IS NULL) THEN
    RAISE EXCEPTION 'Only the owner can manage sharing' USING ERRCODE = '42501';
  END IF;
  -- A bounded user directory for sharing, without exposing roles or auth data.
  RETURN QUERY SELECT p.id, p.email FROM public.profiles p
    WHERE p.id <> auth.uid() AND length(trim(p_query)) >= 2
      AND position(lower(trim(p_query)) IN lower(p.email)) > 0
    ORDER BY p.email, p.id LIMIT 20;
END;
$$;

CREATE FUNCTION public.get_user_file_sharing(p_path text)
RETURNS TABLE(recipient_id uuid, email text, source_path text, inherited boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_file_metadata m WHERE m.owner_id = auth.uid() AND m.object_path = p_path) THEN
    RAISE EXCEPTION 'Only the owner can manage sharing' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT s.recipient_id, p.email, s.object_path, s.object_path <> p_path
    FROM public.user_file_shares s
    JOIN public.user_file_metadata m USING (owner_id, object_path)
    LEFT JOIN public.profiles p ON p.id = s.recipient_id
    WHERE s.owner_id = auth.uid() AND m.trashed_at IS NULL
      AND (s.object_path = p_path OR (m.is_folder AND starts_with(p_path, s.object_path || '/')))
    ORDER BY s.object_path, p.email NULLS FIRST;
END;
$$;

CREATE FUNCTION public.set_user_file_sharing(p_path text, p_recipients uuid[], p_everyone boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Lock the item so concurrent saves cannot merge or partially replace grants.
  PERFORM 1 FROM public.user_file_metadata m WHERE m.owner_id = auth.uid() AND m.object_path = p_path AND m.trashed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the owner can manage sharing' USING ERRCODE = '42501';
  END IF;
  IF cardinality(p_recipients) > 100 OR EXISTS (
    SELECT 1 FROM unnest(p_recipients) r(id)
    WHERE r.id IS NULL OR r.id = auth.uid() OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.id)
  ) THEN RAISE EXCEPTION 'Choose up to 100 existing users other than the owner'; END IF;
  DELETE FROM public.user_file_shares s WHERE s.owner_id = auth.uid() AND s.object_path = p_path;
  INSERT INTO public.user_file_shares(owner_id, object_path, recipient_id)
    SELECT auth.uid(), p_path, r.id FROM (SELECT DISTINCT unnest(p_recipients) AS id) r;
  IF p_everyone THEN
    INSERT INTO public.user_file_shares(owner_id, object_path, recipient_id) VALUES (auth.uid(), p_path, NULL);
  END IF;
END;
$$;

CREATE FUNCTION public.get_file_share_indicators(p_paths text[])
RETURNS TABLE(object_path text, everyone boolean, shared boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT paths.path, bool_or(s.recipient_id IS NULL), true
  FROM (SELECT DISTINCT unnest(p_paths[1:1000]) AS path) paths
  JOIN public.user_file_shares s ON true
  JOIN public.user_file_metadata m USING (owner_id, object_path)
  WHERE public.can_read_user_file(paths.path) AND m.trashed_at IS NULL
    AND (s.object_path = paths.path OR (m.is_folder AND starts_with(paths.path, s.object_path || '/')))
  GROUP BY paths.path;
$$;

CREATE FUNCTION public.list_shared_user_files(p_folder text DEFAULT '', p_offset integer DEFAULT 0)
RETURNS SETOF public.user_file_metadata
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.* FROM public.user_file_metadata m
  WHERE m.owner_id <> auth.uid() AND m.trashed_at IS NULL AND public.can_read_user_file(m.object_path)
    AND CASE WHEN p_folder <> '' THEN
      public.can_read_user_file(p_folder) AND regexp_replace(m.object_path, '/[^/]+$', '') = p_folder
    ELSE
      EXISTS (SELECT 1 FROM public.user_file_shares s WHERE s.owner_id = m.owner_id AND s.object_path = m.object_path AND (s.recipient_id = auth.uid() OR s.recipient_id IS NULL))
      AND NOT EXISTS (
        SELECT 1 FROM public.user_file_shares s JOIN public.user_file_metadata parent USING(owner_id, object_path)
        WHERE s.owner_id = m.owner_id AND parent.is_folder AND parent.trashed_at IS NULL
          AND starts_with(m.object_path, s.object_path || '/') AND (s.recipient_id = auth.uid() OR s.recipient_id IS NULL)
      )
    END
  ORDER BY m.is_folder DESC, m.object_path LIMIT 51 OFFSET greatest(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION public.search_file_share_users(text,text), public.get_user_file_sharing(text), public.set_user_file_sharing(text,uuid[],boolean), public.get_file_share_indicators(text[]), public.list_shared_user_files(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_file_share_users(text,text), public.get_user_file_sharing(text), public.set_user_file_sharing(text,uuid[],boolean), public.get_file_share_indicators(text[]), public.list_shared_user_files(text,integer) TO authenticated;

-- The existing search now sees owned and shared items through the same RLS as browsing.
CREATE OR REPLACE FUNCTION public.search_user_files(p_query text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(object_path text, name text, location text, is_folder boolean, file_size bigint, mime_type text, updated_at timestamptz, is_favorite boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT m.object_path, regexp_replace(m.object_path, '^.*/', ''),
    CASE WHEN position('/' IN substr(m.object_path, length(m.owner_id::text) + 2)) = 0 THEN ''
      ELSE regexp_replace(substr(m.object_path, length(m.owner_id::text) + 2), '/[^/]+$', '') END,
    m.is_folder, m.file_size, m.mime_type, m.updated_at, m.is_favorite
  FROM public.user_file_metadata m
  WHERE m.trashed_at IS NULL AND length(trim(p_query)) > 0
    AND lower(regexp_replace(m.object_path, '^.*/', '')) LIKE '%' || replace(replace(replace(lower(trim(p_query)), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' ESCAPE E'\\'
  ORDER BY m.updated_at DESC, m.object_path
  LIMIT least(greatest(p_limit, 1), 101) OFFSET greatest(p_offset, 0);
$$;
