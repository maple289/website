import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, BarChart3, ChevronLeft, ChevronRight, FileText, HardDrive, Image, LayoutDashboard, LoaderCircle, RefreshCw, Search, Users, Video } from 'lucide-react';
import { fetchAnalytics, formatBytes, type AnalyticsFilters, type AnalyticsPage, type AnalyticsRow, type AnalyticsSection, type ContentType, type Dashboard, type Metric, type StorageSnapshot } from '@/lib/analytics';
import { BarChart, DistributionChart, TimeChart } from './AnalyticsCharts';
import './AdminStatistics.css';

const sections: { id: AnalyticsSection; name: string; icon: typeof Users }[] = [
  { id: 'overview', name: 'Overview', icon: LayoutDashboard }, { id: 'users', name: 'Users', icon: Users },
  { id: 'videos', name: 'Videos', icon: Video }, { id: 'photos', name: 'Photos', icon: Image },
  { id: 'files', name: 'Files', icon: FileText }, { id: 'storage', name: 'Storage', icon: HardDrive }, { id: 'activity', name: 'Activity', icon: Activity },
];
const date = (value: unknown) => value ? new Date(String(value)).toLocaleString() : '—';
const number = (value: unknown) => Number(value ?? 0).toLocaleString();
type Column = { key: string; name: string; format?: 'date' | 'bytes' | 'number'; sortable?: boolean };
const col = (key: string, name: string, format?: Column['format'], sortable = true): Column => ({ key, name, format, sortable });
const userColumns = [col('display_name', 'Name'), col('email', 'Email / username'), col('created_at', 'Created', 'date'), col('last_login', 'Last login', 'date'), col('last_activity', 'Last activity', 'date'), col('status', 'Account status', undefined, false),
  col('videos', 'Videos', 'number'), col('photos', 'Photos', 'number'), col('files', 'Files', 'number'), col('video_storage', 'Video storage', 'bytes', false), col('photo_storage', 'Photo storage', 'bytes', false), col('file_storage', 'File storage', 'bytes', false), col('total_storage', 'Total storage', 'bytes'), col('views', 'Content views', 'number'), col('uploads', 'Uploads', 'number')];
const mediaColumns = [col('name', 'Name'), col('owner', 'Owner'), col('created_at', 'Uploaded', 'date'), col('file_size', 'Original size', 'bytes'), col('visibility', 'Visibility', undefined, false), col('shared', 'Shared', undefined, false), col('status', 'Processing state', undefined, false), col('views', 'Views', 'number'), col('unique_viewers', 'Registered viewers', 'number', false), col('reactions', 'Reactions', 'number'), col('last_viewed_at', 'Last viewed', 'date')];
const fileColumns = [col('name', 'Name'), col('owner', 'Owner'), col('file_type', 'Type', undefined, false), col('extension', 'Extension', undefined, false), col('created_at', 'Uploaded', 'date'), col('file_size', 'Size', 'bytes'), col('visibility', 'Access', undefined, false), col('previews', 'Previews', 'number'), col('downloads', 'Downloads', 'number'), col('last_accessed_at', 'Last accessed', 'date')];
const activityColumns = [col('occurred_at', 'Timestamp', 'date', false), col('username', 'User', undefined, false), col('action', 'Action', undefined, false), col('content_type', 'Content type', undefined, false), col('name', 'Content / account', undefined, false)];

function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(value), 300); return () => clearTimeout(timer); }, [value]);
  return debounced;
}

function useStatistics<T>(section: AnalyticsSection | 'user' | 'owners', filters: AnalyticsFilters, refresh: number, enabled = true) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const key = JSON.stringify(filters);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    void fetchAnalytics<T>(section, JSON.parse(key), controller.signal).then(result => { if (!controller.signal.aborted) { setData(result); setLoading(false); } }, failure => { if (!controller.signal.aborted) { setError(failure.message); setLoading(false); } });
    return () => controller.abort();
  }, [section, key, refresh, enabled]);
  return { data, error, loading };
}

export function AdminStatistics() {
  const [section, setSection] = useState<AnalyticsSection>('overview'), [userId, setUserId] = useState<string>();
  const [range, setRange] = useState('30'), [from, setFrom] = useState(''), [to, setTo] = useState(''), [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState(''), [sort, setSort] = useState(''), [direction, setDirection] = useState<'asc' | 'desc'>('desc'), [page, setPage] = useState(0);
  const [owner, setOwner] = useState(''), [visibility, setVisibility] = useState(''), [fileType, setFileType] = useState(''), [topType, setTopType] = useState<ContentType>('video'), [storageOrder, setStorageOrder] = useState<'asc' | 'desc'>('desc');
  const [filterDates, setFilterDates] = useState(false);
  const debouncedSearch = useDebounced(search);
  const dates = useMemo(() => {
    const end = new Date(); end.setHours(24, 0, 0, 0);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    if (range === 'custom') {
      if (!from || !to) return null;
      const first = new Date(`${from}T00:00:00`), last = new Date(`${to}T00:00:00`); last.setDate(last.getDate() + 1);
      return Number.isFinite(first.getTime()) && last > first && last.getTime() - first.getTime() <= 366 * 86400000 ? { from: first.toISOString(), to: last.toISOString() } : null;
    }
    if (range === 'month') start.setDate(1);
    else start.setDate(start.getDate() - (Number(range) - 1));
    return { from: start.toISOString(), to: end.toISOString() };
  }, [range, from, to]);
  const base = dates ?? { from: '', to: '' };
  const dashboard = useStatistics<Dashboard>(userId ? 'user' : 'overview', { ...base, owner: userId ?? (owner || undefined), sort: 'storage_users', direction: storageOrder }, refresh, !!dates);
  const tab = useStatistics<AnalyticsPage>(section, { ...base, page, search: debouncedSearch, sort, direction, owner: userId ?? (owner || undefined), visibility, fileType, filterDates }, refresh, !!dates && ['users', 'videos', 'photos', 'files', 'activity'].includes(section) && !userId);
  const storage = useStatistics<{ storage: StorageSnapshot | null; database_bytes: number }>('storage', base, refresh, !!dates && section === 'storage');
  const changeSection = (next: AnalyticsSection) => { setSection(next); setUserId(undefined); setPage(0); setSort(''); setSearch(''); setOwner(''); setVisibility(''); setFileType(''); setFilterDates(false); };
  const data = dates ? dashboard.data : null;
  const tableColumns = section === 'users' ? userColumns : section === 'activity' ? activityColumns : section === 'files' ? fileColumns : section === 'videos' ? [...mediaColumns.slice(0, 4), col('processed_file_size', 'Playable size', 'bytes'), col('duration_seconds', 'Duration (seconds)', 'number', false), col('resolution', 'Resolution', undefined, false), ...mediaColumns.slice(4)] : mediaColumns;
  const sortBy = (key: string) => { setDirection(sort === key && direction === 'desc' ? 'asc' : 'desc'); setSort(key); setPage(0); };

  return <div className="analytics-shell">
    <header className="analytics-heading"><div><span className="analytics-eyebrow">ADMINISTRATOR INSIGHTS</span><h2><BarChart3 size={25} />Statistics &amp; Analytics</h2><p>Current content, activity and storage at a glance.</p></div><button onClick={() => setRefresh(n => n + 1)} disabled={dashboard.loading || tab.loading && ['users', 'videos', 'photos', 'files', 'activity'].includes(section)}><RefreshCw size={17} />Refresh</button></header>
    <nav className="analytics-nav" aria-label="Statistics sections">{sections.map(item => <button key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => changeSection(item.id)}><item.icon size={17} />{item.name}</button>)}</nav>
    <div className="analytics-range"><label>Date range<select value={range} onChange={event => { setRange(event.target.value); setPage(0); }}><option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="month">This month</option><option value="custom">Custom range</option></select></label>{range === 'custom' && <><label>From<input type="date" value={from} onInput={event => { setFrom(event.currentTarget.value); setPage(0); }} /></label><label>Through<input type="date" value={to} onInput={event => { setTo(event.currentTarget.value); setPage(0); }} /></label></>}<span>Charts use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Week begins Monday.</span></div>
    {!dates && <p className="analytics-notice">Choose a valid date range of up to one year.</p>}
    {dashboard.error && <p role="alert" className="analytics-error">{dashboard.error}</p>}
    {!!data?.storage?.data.errors.length && <p role="alert" className="analytics-error">Storage measurements are incomplete. See Storage for details.</p>}
    {dates && dashboard.loading && <p role="status" className="analytics-loading"><LoaderCircle className="animate-spin" size={20} />Loading statistics…</p>}

    {data && userId && <UserDetail data={data} onBack={() => setUserId(undefined)} />}
    {data && !userId && section === 'overview' && <>
      <SummaryCards data={data} onSelect={changeSection} />
      <div className="analytics-grid"><TimeChart title="Successful uploads" series={data.series} metric="uploads" /><TimeChart title="Content views / previews" series={data.series} metric="views" /><DistributionChart title="Content distribution" data={data.distribution} /><DistributionChart title="Storage by content type" data={data.storage?.data.categories ?? []} bytes /></div>
      <div className="analytics-chart-controls"><label>Most viewed content<select value={topType} onChange={event => setTopType(event.target.value as ContentType)}><option value="video">Videos</option><option value="photo">Photos</option><option value="file">Files (previews + downloads)</option></select></label><label>Storage by user<select value={storageOrder} onChange={event => setStorageOrder(event.target.value as 'asc' | 'desc')}><option value="desc">Largest first</option><option value="asc">Smallest first</option></select></label></div>
      <div className="analytics-grid"><BarChart title="Most viewed content" data={data.top[topType]} /><BarChart title="Storage by user · first 20" data={data.storage_by_user.slice(0, 20)} bytes /></div>
    </>}

    {!!dates && !userId && ['users', 'videos', 'photos', 'files', 'activity'].includes(section) && <>
      <div className="analytics-filters"><label className="analytics-search"><span><Search size={16} />Search {section === 'users' ? 'name / email' : section === 'activity' ? 'user / action' : 'name / owner / email'}</span><input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Search…" maxLength={256} /></label>
        {dates && ['videos', 'photos', 'files', 'activity'].includes(section) && <OwnerFilter dates={dates} value={owner} onChange={id => { setOwner(id); setPage(0); }} />}
        {['videos', 'photos', 'files'].includes(section) && <label>Access<select value={visibility} onChange={event => { setVisibility(event.target.value); setPage(0); }}><option value="">All</option><option value="public">Public</option><option value="private">Private</option>{section === 'files' && <option value="shared">Shared</option>}</select></label>}
        {['videos', 'photos', 'files'].includes(section) && <label>Upload dates<select value={String(filterDates)} onChange={event => { setFilterDates(event.target.value === 'true'); setPage(0); }}><option value="false">All dates</option><option value="true">Selected date range</option></select></label>}
        {section === 'files' && <label>File type<select value={fileType} onChange={event => { setFileType(event.target.value); setPage(0); }}><option value="">All types</option>{['pdf', 'word', 'excel', 'powerpoint', 'image', 'text', 'csv', 'archive', 'other'].map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}</select></label>}
      </div>
      <section className="analytics-panel analytics-records"><h3>{sections.find(item => item.id === section)?.name} statistics</h3>{section !== 'activity' && <p className="analytics-subtext">{filterDates ? 'Current content uploaded in the selected date range.' : 'Current content across all dates.'} Select a column heading to sort; scroll the table to see all details.</p>}
        {tab.error ? <p role="alert" className="analytics-error">{tab.error}</p> : tab.loading ? <p className="analytics-loading" role="status"><LoaderCircle className="animate-spin" size={18} />Loading records…</p> : <>
          <RecordsTable columns={tableColumns} rows={tab.data?.rows ?? []} sort={sort} direction={direction} onSort={sortBy} onUser={section === 'users' ? id => setUserId(id) : undefined} />
          <div className="analytics-pagination"><span>{number(tab.data?.total)} records · Page {page + 1} of {Math.max(1, Math.ceil((tab.data?.total ?? 0) / 25))}</span><button disabled={!page} onClick={() => setPage(n => n - 1)} aria-label="Previous page"><ChevronLeft size={18} /></button><button disabled={(page + 1) * 25 >= (tab.data?.total ?? 0)} onClick={() => setPage(n => n + 1)} aria-label="Next page"><ChevronRight size={18} /></button></div>
        </>}
      </section>
      {data && ['videos', 'photos'].includes(section) && <div className="analytics-grid"><BarChart title={`Top ${section} by views`} data={data.top[section === 'videos' ? 'video' : 'photo']} /><TimeChart title={`${section === 'videos' ? 'Video' : 'Photo'} uploads over time`} series={data.series} metric="uploads" types={[section === 'videos' ? 'video' : 'photo']} /></div>}
      {data && section === 'photos' && <BarChart title="Photo storage by user" data={data.storage_by_user.map(item => ({ ...item, value: Number((item as Metric & { photo_storage: number }).photo_storage) })).slice(0, 20)} bytes />}
      {data && section === 'files' && <div className="analytics-grid"><DistributionChart title="File types" data={data.file_types} /><BarChart title="Most accessed files" data={data.top.file} /></div>}
      {data && section === 'files' && <BarChart title="Largest files" data={data.largest_files} bytes />}
      {data && section === 'users' && <BarChart title="Storage by user" data={data.storage_by_user.slice(0, 20)} bytes />}
    </>}

    {!userId && section === 'storage' && <StorageDetails snapshot={storage.data?.storage ?? data?.storage ?? null} error={storage.error} />}
    {data && !userId && section === 'storage' && <><div className="analytics-chart-controls"><label>Storage by user<select value={storageOrder} onChange={event => setStorageOrder(event.target.value as 'asc' | 'desc')}><option value="desc">Largest first</option><option value="asc">Smallest first</option></select></label></div><BarChart title="Stored content by user · first 20" data={data.storage_by_user.slice(0, 20)} bytes /></>}
    <footer className="analytics-footnote">{data ? <>Totals and top-content charts cover current content across all dates. Summaries may be cached for 30 seconds. Views and activity tracking began {date(data.tracking_started_at)}. Unique viewers count registered user IDs only. Active users have activity within 30 days. Existing successful content supplies historical upload dates; older copied files cannot be distinguished from uploads. {data.storage && <>Disk inventory collected {date(data.storage.collected_at)}; refreshes every {Math.round(data.storage.data.interval_seconds / 60)} minutes.</>}</> : 'Analytics are available to administrators only.'}</footer>
  </div>;
}

function OwnerFilter({ dates, value, onChange }: { dates: AnalyticsFilters; value: string; onChange: (id: string) => void }) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(0), [selected, setSelected] = useState('');
  const query = useDebounced(search);
  const owners = useStatistics<AnalyticsPage>('owners', { ...dates, search: query, page }, 0);
  return <div className="analytics-owner-filter"><label>Owner / user<input type="search" placeholder="Find by name or email" value={search} maxLength={256} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label><label className="sr-only" htmlFor="analytics-owner">Select owner</label><select id="analytics-owner" value={value} onChange={event => { const row = owners.data?.rows.find(item => item.id === event.target.value); setSelected(String(row?.name ?? selected)); onChange(event.target.value); }}><option value="">All users</option>{value && !owners.data?.rows.some(item => item.id === value) && <option value={value}>{selected || 'Selected user'}</option>}{owners.data?.rows.map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.name)} · {String(row.email)}</option>)}</select><div className="analytics-owner-pages"><button disabled={!page || owners.loading} onClick={() => setPage(n => n - 1)} aria-label="Previous owners"><ChevronLeft size={15} /></button><span>{owners.loading ? 'Loading…' : `${owners.data?.total ?? 0} users`}</span><button disabled={owners.loading || (page + 1) * 25 >= (owners.data?.total ?? 0)} onClick={() => setPage(n => n + 1)} aria-label="More owners"><ChevronRight size={15} /></button></div>{owners.error && <span role="alert">{owners.error}</span>}</div>;
}

function SummaryCards({ data, onSelect }: { data: Dashboard; onSelect: (section: AnalyticsSection) => void }) {
  const disks = data.storage?.data.disks;
  const capacity = disks?.reduce((n, disk) => n + disk.capacity, 0) ?? 0, used = disks?.reduce((n, disk) => n + disk.used, 0) ?? 0;
  const metrics: [string, string, AnalyticsSection][] = [
    ['Total users', number(data.overview.users), 'users'], ['Active users · 30 days', number(data.overview.active_users), 'users'], ['Videos', number(data.overview.videos), 'videos'], ['Photos', number(data.overview.photos), 'photos'], ['Files', number(data.overview.files), 'files'],
    ['Application storage used', data.storage ? formatBytes(data.storage.data.categories.reduce((n, item) => n + item.value, 0)) : 'Collecting…', 'storage'], ['Free disk space', disks?.length ? formatBytes(disks.reduce((n, disk) => n + disk.available, 0)) : 'Unavailable', 'storage'], ['Disk usage', capacity ? `${(used / capacity * 100).toFixed(1)}%` : 'Unavailable', 'storage'],
    ['Video views', number(data.overview.video_views), 'videos'], ['Photo views', number(data.overview.photo_views), 'photos'], ['File views / previews', number(data.overview.file_previews), 'files'], ['File downloads', number(data.overview.file_downloads), 'files'], ['Uploads today', number(data.overview.uploads_today), 'activity'], ['Uploads this week', number(data.overview.uploads_week), 'activity'], ['Uploads this month', number(data.overview.uploads_month), 'activity'],
  ];
  return <div className="analytics-summary">{metrics.map(([label, value, section]) => <button key={label} onClick={() => onSelect(section)}><span>{label}</span><strong>{value}</strong><ChevronRight size={15} /></button>)}</div>;
}

function RecordsTable({ columns, rows, sort, direction, onSort, onUser }: { columns: Column[]; rows: AnalyticsRow[]; sort: string; direction: string; onSort: (key: string) => void; onUser?: (id: string) => void }) {
  return <div className="analytics-table-scroll" tabIndex={0} aria-label="Statistics records"><table><thead><tr>{columns.map(column => <th key={column.key} aria-sort={sort === column.key ? direction === 'asc' ? 'ascending' : 'descending' : undefined}>{column.sortable ? <button onClick={() => onSort(column.key)}>{column.name}{sort === column.key && (direction === 'asc' ? ' ↑' : ' ↓')}</button> : column.name}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={String(row.id ?? row.content_id)}>{columns.map(column => { const value = column.key === 'resolution' ? row.resolution_width && row.resolution_height ? `${row.resolution_width} × ${row.resolution_height}` : '—' : row[column.key]; const formatted = column.format === 'date' ? date(value) : column.format === 'bytes' ? value == null ? '—' : formatBytes(Number(value)) : column.format === 'number' ? value == null ? '—' : number(value) : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value ?? '—').replace(/_/g, ' '); return <td key={column.key} title={formatted}>{onUser && column.key === 'display_name' ? <button className="analytics-user-link" onClick={() => onUser(String(row.id))}>{formatted}</button> : formatted}</td>; })}</tr>)}</tbody></table>{!rows.length && <p className="analytics-empty">No matching records.</p>}</div>;
}

function UserDetail({ data, onBack }: { data: Dashboard; onBack: () => void }) {
  const user = data.user;
  if (!user) return <section className="analytics-panel"><button onClick={onBack}><ArrowLeft size={16} />Back to users</button><p>User is no longer available.</p></section>;
  return <><button className="analytics-back" onClick={onBack}><ArrowLeft size={17} />Back to users</button><section className="analytics-panel"><h3>{String(user.display_name)}</h3><p>{String(user.email)} · {String(user.role)} · {String(user.status)}</p><p className="analytics-subtext">Created {date(user.created_at)} · Last login {date(user.last_login)} · Last activity {date(user.last_activity)}</p><div className="analytics-summary">{[['Videos', user.videos], ['Photos', user.photos], ['Files', user.files], ['Total storage', formatBytes(Number(user.total_storage))], ['Content views', user.views], ['Uploads', user.uploads]].map(([name, value]) => <div key={String(name)}><span>{name}</span><strong>{String(value)}</strong></div>)}</div></section><div className="analytics-grid"><DistributionChart title="User storage" data={[{ label: 'Videos', value: Number(user.video_storage) }, { label: 'Photos', value: Number(user.photo_storage) }, { label: 'Files', value: Number(user.file_storage) }]} bytes /><TimeChart title="User successful uploads" series={data.series} metric="uploads" /></div></>;
}

function StorageDetails({ snapshot, error }: { snapshot: StorageSnapshot | null; error: string }) {
  return <>{error && <p className="analytics-error" role="alert">{error}</p>}{!snapshot ? <p className="analytics-notice">Storage inventory is being collected. Capacity is not estimated from database records.</p> : <>
    <div className="analytics-grid">{snapshot.data.disks.map(disk => <section className="analytics-panel" key={disk.label}><h3>{disk.label}</h3><strong>{formatBytes(disk.used)} / {formatBytes(disk.capacity)}</strong><div className="analytics-capacity" role="progressbar" aria-label={`${disk.label} used`} aria-valuenow={disk.usage_percent} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${disk.usage_percent}%`, background: disk.usage_percent > 90 ? '#e11d48' : '#2563eb' }} /></div><p>{disk.usage_percent}% used · {formatBytes(disk.available)} available</p></section>)}</div>
    <div className="analytics-grid"><DistributionChart title="Application storage breakdown" data={snapshot.data.categories} bytes /><BarChart title="Storage categories" data={snapshot.data.categories} bytes /></div><p className="analytics-notice">{snapshot.data.measurement} Retained originals and thumbnails are included. Files in the existing Trash still occupy storage. Filesystems shared by storage locations are counted once. Collected {date(snapshot.collected_at)}.</p>
    {Date.now() - Date.parse(snapshot.collected_at) > Math.max(1200, snapshot.data.interval_seconds * 2) * 1000 && <p role="alert" className="analytics-error">Storage inventory is overdue. These are the last collected measurements; check the analytics collector service.</p>}
    {!!snapshot.data.errors.length && <p role="alert" className="analytics-error">Some measurements are incomplete: {snapshot.data.errors.join('; ')}.</p>}
  </>}</>;
}
