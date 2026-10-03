import { supabase } from './supabase';
import type { FileEntry } from './fileTree';

export type ContentType = 'video' | 'photo' | 'file';
export type AnalyticsSection = 'overview' | 'users' | 'videos' | 'photos' | 'files' | 'storage' | 'activity';
export type Metric = { label: string; value: number; id?: string };
export type StorageSnapshot = { collected_at: string; data: { disks: { label: string; capacity: number; used: number; available: number; usage_percent: number }[]; categories: Metric[]; users: { id: string; value: number }[]; errors: string[]; interval_seconds: number; measurement: string } };
export type AnalyticsRow = Record<string, string | number | boolean | null>;
export type Dashboard = {
  overview: Record<string, number>; series: { date: string; [key: string]: number | string }[];
  distribution: Metric[]; file_types: Metric[]; storage_by_user: Metric[];
  top: Record<ContentType, Metric[]>; storage: StorageSnapshot | null;
  largest_files: Metric[];
  tracking_started_at: string; generated_at: string; timezone: string; user: AnalyticsRow | null;
};
export type AnalyticsPage = { rows: AnalyticsRow[]; total: number; page: number; page_size: number };
export type AnalyticsFilters = { from: string; to: string; page?: number; search?: string; sort?: string; direction?: 'asc' | 'desc'; owner?: string; visibility?: string; fileType?: string; filterDates?: boolean };

export async function fetchAnalytics<T>(section: AnalyticsSection | 'user' | 'owners', filters: AnalyticsFilters, signal?: AbortSignal): Promise<T> {
  const query = supabase.rpc('admin_analytics', {
    p_section: section, p_from: filters.from, p_to: filters.to, p_page: filters.page ?? 0,
    p_search: filters.search ?? '', p_sort: filters.sort ?? '', p_direction: filters.direction ?? 'desc',
    p_owner: filters.owner ?? null, p_visibility: filters.visibility ?? '', p_file_type: filters.fileType ?? '',
    p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    p_filter_dates: filters.filterDates ?? false,
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw new Error(error.code === '42501' ? 'Administrator access is required.' : 'Statistics could not be loaded. Please try again.');
  return data as T;
}

// Best effort only: analytics must never interrupt playback, previews or uploads.
// A nonce is retained for one viewer opening; server-side permission checks and
// registered-user throttling also apply. No anonymous identity is stored.
export function analyticsRequestId(): string {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    // getRandomValues also supports existing HTTP LAN access. Analytics must
    // never break a viewer just because randomUUID requires a secure context.
    const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch { return ''; }
}
export function recordMediaView(type: 'video' | 'photo', id: string, requestId: string) {
  void sendEvent({ p_type: type, p_action: 'view', p_id: id, p_request_id: requestId });
}
export function recordFileEvent(entry: Pick<FileEntry, 'id' | 'path'>, action: 'preview' | 'download' | 'upload', requestId = analyticsRequestId()) {
  void sendEvent({ p_type: 'file', p_action: action, p_request_id: requestId, p_public_id: entry.id ?? null, p_path: entry.id ? null : entry.path });
}
async function sendEvent(body: Record<string, string | null>) {
  if (!body.p_request_id) return;
  try {
    const { error } = await supabase.rpc('analytics_record', body);
    if (error) console.warn('Content activity could not be recorded.');
  } catch { /* Content operation remains successful if analytics is unavailable. */ }
}
export function touchActivity() {
  void supabase.rpc('analytics_touch').then(() => {}, () => {});
}
export function formatBytes(value: number) {
  if (!Number.isFinite(value)) return 'Unavailable';
  if (value === 0) return '0 B';
  const unit = Math.min(4, Math.max(0, Math.floor(Math.log(value) / Math.log(1024))));
  return `${(value / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 2 : 0 })} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}
