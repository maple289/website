import { supabase, supabaseAnonKey } from '@/lib/supabase';
import type { FileEntry } from '@/lib/fileTree';

export type PreviewKind = 'pdf' | 'image' | 'text' | 'csv' | 'office' | 'video';
const formats: Record<string, PreviewKind> = {
  pdf: 'pdf', jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
  txt: 'text', json: 'text', xml: 'text', csv: 'csv', docx: 'office', xlsx: 'office', xls: 'office', pptx: 'office',
};
export function filePreviewKind(entry: FileEntry): PreviewKind | undefined {
  if (entry.isFolder) return undefined;
  return (entry.name.includes('.') ? formats[entry.name.split('.').pop()?.toLowerCase() ?? ''] : undefined) ??
    (entry.mimeType.startsWith('video/') ? 'video' : undefined);
}

export type PreviewStatus = { status: 'available' | 'generating' | 'failed' | 'unsupported'; kind?: PreviewKind; mime?: string; message?: string; queued?: boolean };

// Every status and content request re-authorizes the original. No cached Storage
// URLs or job IDs are exposed. Public entries retain their opaque identifier.
export async function requestFilePreview(entry: FileEntry, content: boolean, signal: AbortSignal): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  signal.throwIfAborted();
  const params = new URLSearchParams(entry.id ? { id: entry.id } : { path: entry.path });
  if (content) params.set('content', '1');
  return fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/file-preview?${params}`, {
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${session?.access_token ?? supabaseAnonKey}` },
    cache: 'no-store', signal,
  });
}

export async function boundedPreviewBlob(response: Response, kind: PreviewKind, signal: AbortSignal): Promise<Blob> {
  const maximum = (kind === 'text' || kind === 'csv' ? 2 : kind === 'image' ? 50 : 100) * 1048576;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Preview could not be loaded.');
  const chunks: ArrayBuffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) throw new Error('This file is too large to preview. You can still download the original file.');
      chunks.push(new Uint8Array(value).buffer);
    }
  } catch (error) { await reader.cancel(); throw error; }
  return new Blob(chunks, { type: response.headers.get('content-type') ?? 'application/octet-stream' });
}

export function decodePreviewText(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes);
  const encoding = data[0] === 0xff && data[1] === 0xfe ? 'utf-16le' : data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : 'utf-8';
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error('This text file uses an unsupported encoding or contains invalid text. You can still download it.'); }
}

// Read only a bounded table. Values are rendered as React text, never HTML or
// spreadsheet formulas. Quoted commas, escaped quotes and multiline cells work.
export function parsePreviewCsv(text: string): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, truncated = false;
  const addCell = () => { if (row.length < 50) row.push(cell.slice(0, 2000)); else truncated = true; if (cell.length > 2000) truncated = true; cell = ''; };
  const addRow = () => { addCell(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || !cell) quoted = !quoted;
      else cell += char;
    } else if (char === ',' && !quoted) addCell();
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      addRow();
      if (rows.length >= 200) return { rows, truncated: truncated || i < text.length - 1 };
    } else cell += char;
  }
  if (quoted) throw new Error('This CSV has an unfinished quoted field. You can still download the original file.');
  if (cell || row.length) addRow();
  return { rows, truncated };
}
