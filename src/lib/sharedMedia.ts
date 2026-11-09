import { authenticatedFetch } from './authSession';
export function publicImageUrl(path: string, bucket: 'user-images' | 'users' = 'user-images'): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/serve-shared-image?public=1&bucket=${bucket}&path=${encodeURIComponent(path)}`;
}
export async function sharedImageUrl(path: string): Promise<string> {
  const response = await authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/serve-shared-image?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Image unavailable or access denied.');
  const data = await response.json();
  if (typeof data.url !== 'string') throw new Error('Image unavailable.');
  return data.url;
}
