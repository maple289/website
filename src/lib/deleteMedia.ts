import { supabase } from './supabase';
import { resolveBucketPath } from './storageSettings';
import type { Photo, Video } from './types';

// Called only by a confirmed action. Storage and row policies remain authoritative.
// Keep the database record until storage cleanup succeeds, so failures stay visible
// and the user can retry. Storage deletion is idempotent for already removed paths.
export async function deleteMedia(type: 'video' | 'photo', item: Video | Photo, ownerId: string) {
  if (item.owner_id !== ownerId) throw new Error('You do not have permission to delete this item.');
  let storageChanged = false;
  try {
    const video = type === 'video' ? item as Video : null;
    const photo = type === 'photo' ? item as Photo : null;
    const groups = video ? [
      { bucket: 'user-videos', kind: 'videos' as const, paths: [video.storage_path, video.processed_storage_path] },
      { bucket: 'user-images', kind: 'images' as const, paths: [video.preview_path] },
    ] : [{ bucket: 'user-images', kind: 'images' as const, paths: [photo!.storage_path, photo!.preview_path, photo!.thumbnail_path] }];
    for (const group of groups) {
      const paths = [...new Set(await Promise.all(group.paths.filter((path): path is string => !!path).map((path) => resolveBucketPath(path, group.kind))))];
      if (!paths.length) continue;
      const { error } = await supabase.storage.from(group.bucket).remove(paths);
      if (error) throw error;
      storageChanged = true;
    }
    const { data, error } = await supabase.from(type === 'video' ? 'videos' : 'photos').delete()
      .eq('id', item.id).eq('owner_id', ownerId).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('The item no longer exists or your permission has changed.');
  } catch {
    throw new Error(storageChanged
      ? 'Deletion was not completed. Some stored files may already have been removed. The media record has been kept where possible; retry to finish deleting it.'
      : 'Unable to delete this item. Check your connection and permissions, then try again.');
  }
}
