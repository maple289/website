import { supabase, supabaseAnonKey } from './supabase';
import { resolveBucketPath } from './storageSettings';
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
  let storageChanged = false;
  try {
    const photo = item as Photo;
    const groups = [{ bucket: 'user-images', kind: 'images' as const, paths: [photo.storage_path, photo.preview_path, photo.thumbnail_path] }];
    for (const group of groups) {
      const paths = [...new Set(await Promise.all(group.paths.filter((path): path is string => !!path).map((path) => resolveBucketPath(path, group.kind))))];
      if (!paths.length) continue;
      const { error } = await supabase.storage.from(group.bucket).remove(paths);
      if (error) throw error;
      storageChanged = true;
    }
    const { data, error } = await supabase.from('photos').delete()
      .eq('id', item.id).eq('owner_id', ownerId).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('The item no longer exists or your permission has changed.');
  } catch {
    throw new Error(storageChanged
      ? 'Deletion was not completed. Some stored files may already have been removed. The media record has been kept where possible; retry to finish deleting it.'
      : 'Unable to delete this item. Check your connection and permissions, then try again.');
  }
}
