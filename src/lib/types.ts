export type Video = {
  id: string;
  owner_id: string;
  owner_email: string | null;
  file_name: string;
  storage_path: string;
  preview_url: string | null;
  visibility: 'public' | 'private';
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
};

export type AppConfig = {
  root_folder: string;
  updated_at: string;
};

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

const serveMediaUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/serve-media`;

export async function getPlayableUrl(videoId: string, token?: string): Promise<string | null> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${serveMediaUrl}?id=${encodeURIComponent(videoId)}`, { headers });
  if (!res.ok) return null;
  const data = await res.json();
  return data.url ?? null;
}
