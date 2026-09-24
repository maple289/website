-- Reactions never broaden access to media or expose profile/email records.
CREATE TABLE public.media_reactions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('video', 'photo')),
  media_id uuid NOT NULL,
  video_id uuid GENERATED ALWAYS AS (CASE WHEN media_type = 'video' THEN media_id END) STORED REFERENCES public.videos(id) ON DELETE CASCADE,
  photo_id uuid GENERATED ALWAYS AS (CASE WHEN media_type = 'photo' THEN media_id END) STORED REFERENCES public.photos(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (reaction IN ('like', 'dislike', 'smile', 'lol', 'love', 'angry')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_type, media_id, user_id)
);
CREATE INDEX media_reactions_details ON public.media_reactions(media_type, media_id, reaction, user_id);
CREATE INDEX media_reactions_user ON public.media_reactions(user_id);
ALTER TABLE public.media_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_reactions FROM PUBLIC, anon, authenticated;

-- Mirrors videos/photos SELECT policies: public, owner, or authenticated admin.
-- Internal only: every exposed reaction RPC checks access before reading/writing.
CREATE FUNCTION public.can_access_reaction_media(p_type text, p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.videos v WHERE p_type = 'video' AND v.id = p_id
      AND (v.visibility = 'public' OR v.owner_id = auth.uid() OR (auth.uid() IS NOT NULL AND public.is_admin()))
    UNION ALL
    SELECT 1 FROM public.photos p WHERE p_type = 'photo' AND p.id = p_id
      AND (p.visibility = 'public' OR p.owner_id = auth.uid() OR (auth.uid() IS NOT NULL AND public.is_admin()))
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_reaction_media(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_media_reactions(p_type text, p_ids uuid[])
RETURNS TABLE(media_id uuid, counts jsonb, own_reaction text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_type NOT IN ('video', 'photo') OR coalesce(cardinality(p_ids), 0) > 100 THEN
    RAISE EXCEPTION 'Invalid reaction request' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT ids.id,
    coalesce((SELECT jsonb_object_agg(c.reaction, c.total) FROM (
      SELECT r.reaction, count(*) AS total FROM public.media_reactions r
      WHERE r.media_type = p_type AND r.media_id = ids.id GROUP BY r.reaction
    ) c), '{}'::jsonb),
    (SELECT r.reaction FROM public.media_reactions r WHERE r.media_type = p_type
      AND r.media_id = ids.id AND r.user_id = auth.uid())
  FROM (SELECT DISTINCT unnest(p_ids) AS id) ids
  WHERE public.can_access_reaction_media(p_type, ids.id);
END;
$$;

CREATE FUNCTION public.set_media_reaction(p_type text, p_id uuid, p_reaction text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access_reaction_media(p_type, p_id) THEN
    RAISE EXCEPTION 'Media unavailable or access denied' USING ERRCODE = '42501';
  END IF;
  IF p_reaction IS NOT NULL AND p_reaction NOT IN ('like', 'dislike', 'smile', 'lol', 'love', 'angry') THEN
    RAISE EXCEPTION 'Invalid reaction' USING ERRCODE = '22023';
  END IF;
  IF p_reaction IS NULL THEN
    DELETE FROM public.media_reactions WHERE media_type = p_type AND media_id = p_id AND user_id = auth.uid();
  ELSE
    INSERT INTO public.media_reactions(user_id, media_type, media_id, reaction)
    VALUES(auth.uid(), p_type, p_id, p_reaction)
    ON CONFLICT (media_type, media_id, user_id) DO UPDATE
      SET reaction = EXCLUDED.reaction, updated_at = now();
  END IF;
END;
$$;

CREATE FUNCTION public.get_media_reaction_users(p_type text, p_id uuid, p_reaction text, p_after uuid DEFAULT NULL)
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.can_access_reaction_media(p_type, p_id) THEN
    RAISE EXCEPTION 'Media unavailable or access denied' USING ERRCODE = '42501';
  END IF;
  IF p_reaction NOT IN ('like', 'dislike', 'smile', 'lol', 'love', 'angry') THEN
    RAISE EXCEPTION 'Invalid reaction' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT r.user_id,
    coalesce(nullif(btrim(p.first_name), ''), nullif(btrim(p.last_name), ''),
      nullif(split_part(p.email, '@', 1), ''), 'User')
  FROM public.media_reactions r LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.media_type = p_type AND r.media_id = p_id AND r.reaction = p_reaction
    AND (p_after IS NULL OR r.user_id > p_after)
  -- One extra row tells the client whether another page exists.
  ORDER BY r.user_id LIMIT 51;
END;
$$;
REVOKE ALL ON FUNCTION public.get_media_reactions(text, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_media_reaction(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_media_reaction_users(text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_media_reactions(text, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_media_reaction_users(text, uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_media_reaction(text, uuid, text) TO authenticated;
