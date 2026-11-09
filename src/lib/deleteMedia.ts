import { supabase, supabaseAnonKey } from './supabase';
import type { Photo, Video } from './types';

export async function deleteVideo(id: string) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Please sign in to delete a video.');
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-video`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey,
        Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ id }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to delete the video. Please retry.');
    if (result.deleted) {
      window.dispatchEvent(new CustomEvent('video-deleted', { detail: id }));
      return;
    }
    if (!result.pending) throw new Error('Deletion could not be confirmed. Please retry.');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Conversion is still stopping. The deletion request is saved. Retry shortly to finish cleanup.');
}

// Called only by a confirmed action. Storage and row policies remain authoritative.
// Keep the database record until storage cleanup succeeds, so failures stay visible
// and the user can retry. Storage deletion is idempotent for already removed paths.
export async function deleteMedia(type: 'video' | 'photo', item: Video | Photo, ownerId: string) {
  if (item.owner_id !== ownerId) throw new Error('You do not have permission to delete this item.');
  if (type === 'video') return deleteVideo(item.id);
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Please sign in to delete a photo.');
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-photo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey,
      Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ id: item.id }),
  });
  const result = await response.json();
  if (!response.ok || !result.deleted) throw new Error(result.error || 'Unable to delete this photo. Retry to finish cleanup.');
}
