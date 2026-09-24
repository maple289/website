import { supabase, supabaseAnonKey } from '@/lib/supabase';
import type { FileEntry, FilePage } from '@/lib/fileTree';

export async function loadPublicFiles(path = '', offset = 0, query = ''): Promise<FilePage> {
  const { data, error } = await supabase.rpc('list_public_user_files', {
    p_folder: query ? null : path.split('/').pop() || null, p_query: query, p_offset: offset,
  });
  if (error) throw new Error('Public files are unavailable. Please try again later.');
  const rows = (data ?? []) as FileEntry[];
  return { entries: rows.slice(0, 50), hasMore: rows.length > 50, nextOffset: offset + 50 };
}

export async function downloadFile(entry: FileEntry): Promise<{ data: Blob | null; error: Error | null }> {
  if (!entry.id) return supabase.storage.from('user-files').download(entry.path);
  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/serve-public-file?id=${encodeURIComponent(entry.id)}`, {
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` }, cache: 'no-store',
    });
    if (!response.ok) throw new Error('This public file is no longer available.');
    // Only allow existing safe preview types; HTML/SVG are never inline documents.
    const type = /^(image\/(png|jpeg|gif|webp|avif)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf|text\/plain)$/.test(entry.mimeType) ? entry.mimeType : 'application/octet-stream';
    return { data: new Blob([await response.arrayBuffer()], { type }), error: null };
  } catch { return { data: null, error: new Error('This public file is no longer available.') }; }
}
