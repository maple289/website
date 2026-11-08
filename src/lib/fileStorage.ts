import { supabase } from './supabase';

export type FileLocation = { bucket: 'user-files' | 'users'; path: string; id: string | null };
export type FileObject = { name: string; id: string | null; metadata: { size?: number; mimetype?: string } | null;
  created_at: string | null; updated_at: string | null };

// Paths presented in the file manager remain virtual owner-relative paths.
// The server resolves current permissions and the physical bucket/key each time.
export async function resolveFileLocation(path: string, write = false): Promise<FileLocation> {
  const { data, error } = await supabase.rpc('resolve_user_file_location', { p_path: path, p_write: write });
  if (error) throw new Error(error.message);
  if (!data || !['user-files','users'].includes(data.bucket) || typeof data.path !== 'string'
    || data.path.split('/').some((part: string) => !part || part === '.' || part === '..' || /[\\\p{Cc}]/u.test(part))) {
    throw new Error('File storage is unavailable. Refresh the file list and try again.');
  }
  return data as FileLocation;
}

export async function listFileObjects(path: string, limit = 100, offset = 0) {
  const { data, error } = await supabase.rpc('file_manager_objects', { p_folder: path, p_limit: limit, p_offset: offset });
  return { data: data as FileObject[] | null, error };
}
