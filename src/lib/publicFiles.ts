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

export async function downloadFile(entry: FileEntry, maximumBytes?: number): Promise<{ data: Blob | null; error: Error | null }> {
  if (!entry.id && maximumBytes === undefined) return supabase.storage.from('user-files').download(entry.path);
  try {
    let url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/serve-public-file?id=${encodeURIComponent(entry.id ?? '')}`;
    if (!entry.id) {
      const { data, error } = await supabase.storage.from('user-files').createSignedUrl(entry.path, 60);
      if (error || !data?.signedUrl) throw new Error('This file is no longer available.');
      url = data.signedUrl;
    }
    const response = await fetch(url, {
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` }, cache: 'no-store',
    });
    if (!response.ok) throw new Error('This public file is no longer available.');
    // Only allow existing safe preview types; HTML/SVG are never inline documents.
    const type = /^(image\/(png|jpeg|gif|webp|avif)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf|text\/plain)$/.test(entry.mimeType) ? entry.mimeType : 'application/octet-stream';
    if (maximumBytes === undefined) return { data: new Blob([await response.arrayBuffer()], { type }), error: null };
    if (Number(response.headers.get('content-length') || 0) > maximumBytes) {
      await response.body?.cancel(); throw new Error('This folder exceeds the 64 MB browser archive limit. Download its files individually.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('This file could not be downloaded.');
    const parts: BlobPart[] = []; let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > maximumBytes) { await reader.cancel(); throw new Error('This folder exceeds the 64 MB browser archive limit. Download its files individually.'); }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    return { data: new Blob(parts, { type }), error: null };
  } catch (error) { return { data: null, error: error instanceof Error ? error : new Error('This file is no longer available.') }; }
}
