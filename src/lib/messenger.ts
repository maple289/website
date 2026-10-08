import { supabase, supabaseAnonKey } from '@/lib/supabase';
import type { FileEntry } from '@/lib/fileTree';
import { boundedPreviewBlob } from '@/lib/filePreviews';
export { analyticsRequestId as chatRequestId } from '@/lib/analytics';

export type ChatUser = { id: string; name: string };
export type ChatMember = ChatUser & { role: 'owner' | 'admin' | 'member'; joined_sequence: number; delivered_sequence: number; read_sequence: number; online: boolean; last_seen: string | null; blocked: boolean };
export type ChatAttachment = { id: string; name: string; mime_type: string; file_size: number; available?: boolean };
export type ChatReaction = { user_id: string; name: string; reaction: string };
export type ChatMessage = { id: string; conversation_id: string; sender_id: string | null; sender_name: string; sequence: number; body: string; created_at: string; edited_at: string | null; deleting: boolean; reply: { id: string; sender_name: string; body: string } | null; attachments: ChatAttachment[]; reactions: ChatReaction[] };
export type Conversation = { id: string; kind: 'direct' | 'group'; name: string; updated_at: string; last_sequence: number; muted: boolean; role: ChatMember['role']; can_send: boolean; unread: number; latest: ChatMessage | null; members: ChatMember[] };
export type ChatEvent = { conversation_id: string; message_id?: string | null; kind?: string };
export const chatReactions = [
  { id: 'like', emoji: '👍', name: 'Like' }, { id: 'love', emoji: '❤️', name: 'Love' },
  { id: 'lol', emoji: '😂', name: 'LOL' }, { id: 'smile', emoji: '🙂', name: 'Smile' },
  { id: 'wow', emoji: '😮', name: 'Wow' }, { id: 'sad', emoji: '😢', name: 'Sad' },
];
export class ChatRequestError extends Error {
  constructor(message: string, readonly uncertain: boolean, readonly code = '') { super(message); }
}
export async function chatRequest<T>(action: string, conversation?: string | null, data: Record<string, unknown> = {}): Promise<T> {
  const { data: result, error } = await supabase.rpc('messenger_rpc', { p_action: action, p_conversation: conversation ?? null, p_data: data });
  if (error) {
    // Only deliberate database validation messages may reach the interface.
    throw new ChatRequestError(error.code === 'P0001' || error.code === '42501' ? error.message : 'Messages could not be updated. Please try again.', !error.code, error.code);
  }
  return result as T;
}
async function chatFetch(params: URLSearchParams, options: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in to use Messages.');
  options.signal?.throwIfAborted();
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/messenger-media?${params}`, {
    ...options, cache: 'no-store', headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${session.access_token}`, ...options.headers },
  });
  if (!response.ok && response.status !== 202) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'The request could not be completed. Please try again.');
  }
  return response;
}
export async function chatOperation(action: string, data: Record<string, unknown>): Promise<void> {
  await chatFetch(new URLSearchParams(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }) });
}
export const attachmentEntry = (a: ChatAttachment): FileEntry => ({ name: a.name, path: a.id, isFolder: false, size: a.file_size, mimeType: a.mime_type, updatedAt: '', favorite: false, trashedAt: null });
export const chatPreview = (entry: FileEntry, content: boolean, signal: AbortSignal) => chatFetch(new URLSearchParams({ id: entry.path, ...(content ? { content: '1' } : {}) }), { signal });
export async function chatVideo(entry: FileEntry, signal: AbortSignal): Promise<Blob> {
  const response = await chatFetch(new URLSearchParams({ id: entry.path, video: '1' }), { signal });
  return boundedPreviewBlob(response, 'video', signal);
}
export async function downloadChatAttachment(a: ChatAttachment): Promise<void> {
  const controller = new AbortController();
  const response = await chatFetch(new URLSearchParams({ id: a.id, download: '1' }), { signal: controller.signal });
  const blob = await boundedPreviewBlob(response, 'video', controller.signal);
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = a.name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export type PendingAttachment = ChatAttachment & { state: 'uploading' | 'ready' | 'failed'; progress: number; error?: string };

// Ordinary Storage POST uses INSERT-only permissions. No signed URLs, upserts,
// public reads or resumable HEAD requests are needed for private attachments.
export async function uploadChatAttachment(conversation: string, file: File, signal: AbortSignal, progress: (value: number) => void): Promise<ChatAttachment> {
  if (!file.size || file.size > 100 * 1048576) throw new Error('Each attachment must be between 1 byte and 100 MB.');
  const reservation = await chatRequest<{ id: string; path: string }>('prepare-attachment', conversation, { name: file.name, size: file.size, mime: file.type });
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Please sign in.');
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      const finish = (error?: Error) => { signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(); };
      xhr.open('POST', `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/messenger-attachments/${reservation.path.split('/').map(encodeURIComponent).join('/')}`);
      xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`); xhr.setRequestHeader('apikey', supabaseAnonKey);
      xhr.setRequestHeader('x-upsert', 'false'); xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.timeout = 10 * 60 * 1000;
      xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
      xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? undefined : new Error(`Upload failed (${xhr.status}). Please try again.`));
      xhr.onerror = () => finish(new Error('Upload interrupted. Check your connection and try again.'));
      xhr.ontimeout = () => finish(new Error('Upload timed out. Please try a smaller file.'));
      xhr.onabort = () => finish(new DOMException('Upload cancelled', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      xhr.send(file);
      if (signal.aborted) xhr.abort();
    });
    return { id: reservation.id, name: file.name, mime_type: file.type || 'application/octet-stream', file_size: file.size, available: true };
  } catch (error) {
    await chatRequest('cancel-attachment', conversation, { id: reservation.id }).catch(() => undefined);
    throw error;
  }
}
export const chatError = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed. Please try again.';
export const chatSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
export const openConversation = (id?: string) => { window.location.hash = id ? `#/messages?conversation=${encodeURIComponent(id)}` : '#/messages'; };
