-- Keep private tombstones/reply IDs and existing attachment-cleanup queues.
-- Deleted rows are never conversation cards, including historical placeholders.
CREATE OR REPLACE FUNCTION public.messenger_message_visible(p_message uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.messenger_active(auth.uid()) AND EXISTS(
    SELECT 1 FROM public.messenger_messages m JOIN public.messenger_members own
      ON own.conversation_id=m.conversation_id AND own.user_id=auth.uid()
    JOIN public.messenger_conversations c ON c.id=m.conversation_id
    WHERE m.id=p_message AND m.deleted_at IS NULL AND m.deletion_started_at IS NULL
      AND m.sequence>greatest(own.cleared_sequence,c.cleared_sequence)
      AND NOT EXISTS(SELECT 1 FROM public.messenger_message_hides h WHERE h.message_id=m.id AND h.user_id=auth.uid()));
$$;

-- Calls wrap this serializer; retain that wrapper and its metadata. A deleted
-- original is represented only inside replies, without exposing its old body.
CREATE OR REPLACE FUNCTION public.messenger_message_json_before_calls(p public.messenger_messages) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',p.id,'conversation_id',p.conversation_id,'sender_id',p.sender_id,
    'sender_name',coalesce(public.messenger_name(p.sender_id),'Deleted user'),'sequence',p.sequence,
    'body',CASE WHEN p.deleted_at IS NOT NULL OR p.deletion_started_at IS NOT NULL THEN '' ELSE p.body END,
    'created_at',p.created_at,'edited_at',p.edited_at,'deleted',p.deleted_at IS NOT NULL,
    'deleting',p.deletion_started_at IS NOT NULL AND p.deleted_at IS NULL,
    'reply',(SELECT jsonb_build_object('id',r.id,'sender_name',coalesce(public.messenger_name(r.sender_id),'Deleted user'),
      'body',CASE WHEN r.deleted_at IS NOT NULL OR r.deletion_started_at IS NOT NULL THEN 'Original message deleted'
        WHEN NOT public.messenger_message_visible(r.id) THEN 'This message is unavailable.' ELSE left(r.body,200) END)
      FROM public.messenger_messages r WHERE r.id=p.reply_to AND r.conversation_id=p.conversation_id),
    'attachments',CASE WHEN p.deleted_at IS NOT NULL OR p.deletion_started_at IS NOT NULL THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(
      jsonb_build_object('id',a.id,'name',a.name,'mime_type',a.mime_type,'file_size',a.file_size,'available',a.source_id IS NOT NULL)
      ORDER BY a.created_at) FROM public.messenger_attachments a WHERE a.message_id=p.id),'[]'::jsonb) END,
    'reactions',CASE WHEN p.deleted_at IS NOT NULL OR p.deletion_started_at IS NOT NULL THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(
      jsonb_build_object('user_id',r.user_id,'name',coalesce(public.messenger_name(r.user_id),'User'),'reaction',r.reaction))
      FROM public.messenger_reactions r WHERE r.message_id=p.id),'[]'::jsonb) END);
$$;

-- Existing authorized deletion RPCs already broadcast changed/deleted to every
-- member and changed/hidden only to the deleting account's private channels.
-- All message queries, snapshots, inbox previews and attachment access share
-- messenger_message_visible, so no stale row can return on reload/pagination.
-- CREATE OR REPLACE preserves the existing restricted grants.
NOTIFY pgrst,'reload schema';
