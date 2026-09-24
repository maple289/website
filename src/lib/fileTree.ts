import { supabase } from '@/lib/supabase';

export type FileEntry = {
  name: string; path: string; isFolder: boolean; size: number; updatedAt: string;
  mimeType: string; favorite: boolean; trashedAt: string | null;
};
export type FileMetadata = {
  object_path: string; is_folder: boolean; is_favorite: boolean; file_size: number;
  mime_type: string; trashed_at: string | null; created_at: string; updated_at: string;
};
export type FilePage = { entries: FileEntry[]; nextOffset: number; hasMore: boolean };
export const metadataColumns = 'object_path,is_folder,is_favorite,file_size,mime_type,trashed_at,created_at,updated_at';
export const fromMetadata = (row: FileMetadata): FileEntry => ({
  path: row.object_path, name: row.object_path.split('/').pop() ?? '', isFolder: row.is_folder,
  size: row.file_size, updatedAt: row.updated_at, mimeType: row.mime_type,
  favorite: row.is_favorite, trashedAt: row.trashed_at,
});

// Only one level at a time. Both APIs enforce the existing database/storage RLS.
export async function loadFileChildren(path: string, userId: string, offset = 0): Promise<FilePage> {
  if (!path.startsWith(`${userId}/`) && path !== userId) {
    const { data, error } = await supabase.rpc('list_shared_user_files', { p_folder: path, p_offset: offset });
    if (error) throw error;
    const rows = (data ?? []) as FileMetadata[];
    return { entries: rows.slice(0, 50).map(fromMetadata), nextOffset: offset + 50, hasMore: rows.length > 50 };
  }
  const { data, error } = await supabase.storage.from('user-files').list(path, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw error;
  const objects = (data ?? []).filter((item) => item.name !== '.folder' && item.name !== '.keep');
  const paths = objects.map((item) => `${path}/${item.name}`);
  const { data: rows, error: metaError } = paths.length
    ? await supabase.from('user_file_metadata').select(metadataColumns).in('object_path', paths)
    : { data: [], error: null };
  if (metaError) throw metaError;
  const byPath = new Map((rows ?? []).map((row) => [row.object_path, row]));
  return {
    entries: objects.map((item): FileEntry => {
      const objectPath = `${path}/${item.name}`;
      const meta = byPath.get(objectPath);
      return { path: objectPath, name: item.name, isFolder: !item.id,
        size: meta?.file_size ?? item.metadata?.size ?? 0,
        mimeType: meta?.mime_type ?? item.metadata?.mimetype ?? '',
        updatedAt: meta?.updated_at ?? item.updated_at ?? '',
        favorite: meta?.is_favorite ?? false, trashedAt: meta?.trashed_at ?? null };
    }).filter((item) => !item.trashedAt),
    nextOffset: offset + 100, hasMore: data?.length === 100,
  };
}

export function ancestorPaths(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(1, -1).map((_, index) => parts.slice(0, index + 2).join('/'));
}

// Search already finds all matches on the server. Query only parent metadata to
// reveal their hierarchy. Inaccessible shared ancestors never become tree nodes.
export async function searchTreeEntries(matches: FileEntry[], userId: string, signal: AbortSignal): Promise<FileEntry[]> {
  const paths = [...new Set(matches.flatMap((entry) => ancestorPaths(entry.path)))];
  const entries = new Map(matches.map((entry) => [entry.path, entry]));
  for (const path of paths.filter((value) => value.startsWith(`${userId}/`))) {
    if (!entries.has(path)) entries.set(path, { path, name: path.split('/').pop()!, isFolder: true, size: 0, updatedAt: '', mimeType: '', favorite: false, trashedAt: null });
  }
  const sharedPaths = paths.filter((value) => !value.startsWith(`${userId}/`));
  for (let offset = 0; offset < sharedPaths.length; offset += 100) {
    const { data, error } = await supabase.from('user_file_metadata').select(metadataColumns).in('object_path', sharedPaths.slice(offset, offset + 100)).is('trashed_at', null).abortSignal(signal);
    if (error) throw error;
    for (const row of data ?? []) if (row.is_folder && !entries.has(row.object_path)) entries.set(row.object_path, fromMetadata(row));
  }
  return [...entries.values()];
}

// Folder operations must include unexpanded descendants, not just cached tree rows.
export async function getFileMetadataTree(entry: FileEntry, userId: string): Promise<FileMetadata[]> {
  const { data, error } = await supabase.from('user_file_metadata').select(metadataColumns).eq('owner_id', userId).eq('object_path', entry.path);
  if (error) throw error;
  const rows = [...(data ?? [])] as FileMetadata[];
  if (entry.isFolder) {
    const prefix = entry.path.replace(/[\\%_]/g, '\\$&') + '/%';
    for (let offset = 0; ; offset += 500) {
      const { data: page, error: pageError } = await supabase.from('user_file_metadata').select(metadataColumns).eq('owner_id', userId).like('object_path', prefix).order('object_path').range(offset, offset + 499);
      if (pageError) throw pageError;
      rows.push(...(page ?? []));
      if ((page?.length ?? 0) < 500) break;
    }
  }
  return rows;
}
