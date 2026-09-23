import { supabase, supabaseAnonKey } from '@/lib/supabase';

export type StorageSettings = {
  videos_base_path: string;
  images_base_path: string;
  file_server_url: string;
  updated_at: string | null;
};

const storageFnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storage-settings`;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${data.session?.access_token ?? ''}`,
  };
}

export async function fetchStorageSettings(): Promise<StorageSettings | null> {
  const headers = await getAuthHeaders();
  const res = await fetch(storageFnUrl, { headers });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || typeof data.videos_base_path !== 'string') return null;
  return {
    videos_base_path: data.videos_base_path,
    images_base_path: data.images_base_path,
    file_server_url: typeof data.file_server_url === 'string' ? data.file_server_url : '',
    updated_at: data.updated_at ?? null,
  };
}

export async function saveStorageSettings(
  videosPath: string,
  imagesPath: string,
  fileServerUrl: string,
): Promise<{ ok: true; settings: StorageSettings } | { ok: false; error: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(storageFnUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      videos_base_path: videosPath,
      images_base_path: imagesPath,
      file_server_url: fileServerUrl,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { ok: false, error: data.error ?? 'Could not save storage settings.' };
  }
  return {
    ok: true,
    settings: {
      videos_base_path: data.videos_base_path,
      images_base_path: data.images_base_path,
      file_server_url: data.file_server_url ?? '',
      updated_at: data.updated_at,
    },
  };
}

let cachedVideosBase: string | null = null;
let cachedImagesBase: string | null = null;
let cachedFileServerUrl: string | null = null;

export async function fetchFileServerUrl(): Promise<string> {
  if (cachedFileServerUrl !== null) return cachedFileServerUrl;
  const { data, error } = await supabase.rpc('get_file_server_url');
  const url = error || !data ? '' : (data as string);
  cachedFileServerUrl = url;
  return url;
}

export async function fetchStorageBasePath(kind: 'videos' | 'images'): Promise<string> {
  if (kind === 'videos' && cachedVideosBase !== null) return cachedVideosBase;
  if (kind === 'images' && cachedImagesBase !== null) return cachedImagesBase;
  const { data, error } = await supabase.rpc('get_storage_base_path', { p_kind: kind });
  const base = error || !data ? '' : (data as string);
  if (kind === 'videos') cachedVideosBase = base;
  else cachedImagesBase = base;
  return base;
}

export async function resolveBucketPath(dbPath: string, kind: 'videos' | 'images'): Promise<string> {
  const base = await fetchStorageBasePath(kind);
  return base ? `${base}/${dbPath}` : dbPath;
}
