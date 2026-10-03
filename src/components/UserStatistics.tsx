import { useEffect, useMemo, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, FileText, Image, LayoutDashboard, LoaderCircle, RefreshCw, Search, Video } from 'lucide-react';
import { fetchPersonalAnalytics, formatBytes, type AnalyticsPage, type PersonalDashboard, type PersonalFilters, type PersonalSection } from '@/lib/analytics';
import { BarChart, DistributionChart, TimeChart } from './AnalyticsCharts';
import { StatisticsTable } from './StatisticsTable';
import { statisticsColumn as col, statisticsDate, statisticsNumber as number } from '@/lib/statisticsPresentation';
import './AdminStatistics.css';
import './UserStatistics.css';

const sections = [
  { id: 'overview', name: 'Overview', icon: LayoutDashboard }, { id: 'videos', name: 'My Videos', icon: Video },
  { id: 'photos', name: 'My Photos', icon: Image }, { id: 'files', name: 'My Files', icon: FileText },
] as const;
const mediaColumns = [col('name', 'Name'), col('created_at', 'Uploaded', 'date'), col('file_size', 'File size', 'bytes'),
  col('visibility', 'Public / Private', undefined, false), col('shared', 'Shared', undefined, false), col('status', 'Processing state', undefined, false),
  col('views', 'Views', 'number'), col('reactions', 'Reactions', 'number'), col('last_viewed_at', 'Last viewed', 'date')];
const fileColumns = [col('name', 'Name'), col('file_type', 'Type', undefined, false), col('extension', 'Extension', undefined, false),
  col('created_at', 'Uploaded', 'date'), col('file_size', 'File size', 'bytes'), col('visibility', 'Access', undefined, false),
  col('shared', 'Shared', undefined, false), col('previews', 'Previews', 'number'), col('downloads', 'Downloads', 'number'), col('last_accessed_at', 'Last accessed', 'date')];
const fileTypes = ['pdf', 'word', 'excel', 'powerpoint', 'image', 'text', 'csv', 'archive', 'other'];

function usePersonalQuery<T>(section: PersonalSection, filters: PersonalFilters, refresh: number, enabled: boolean) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const key = JSON.stringify(filters);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    void fetchPersonalAnalytics<T>(section, JSON.parse(key), controller.signal).then(result => {
      if (!controller.signal.aborted) { setData(result); setLoading(false); }
    }, failure => {
      if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : 'Your statistics could not be loaded.'); setLoading(false); }
    });
    return () => controller.abort();
  }, [section, key, refresh, enabled]);
  return { data, error, loading };
}

export function UserStatistics() {
  const [section, setSection] = useState<PersonalSection>('overview');
  const [range, setRange] = useState('30'), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [refresh, setRefresh] = useState(() => Date.now());
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const [sort, setSort] = useState('created_at'), [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [visibility, setVisibility] = useState(''), [fileType, setFileType] = useState(''), [filterDates, setFilterDates] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setQuery(search), 300); return () => clearTimeout(timer); }, [search]);
  const dates = useMemo(() => {
    const start = new Date(refresh); start.setHours(0, 0, 0, 0);
    const end = new Date(refresh); end.setHours(24, 0, 0, 0);
    if (range === 'custom') {
      if (!from || !to) return null;
      const first = new Date(`${from}T00:00:00`), last = new Date(`${to}T00:00:00`); last.setDate(last.getDate() + 1);
      return Number.isFinite(first.getTime()) && last > first && last.getTime() - first.getTime() <= 366 * 86400000
        ? { from: first.toISOString(), to: last.toISOString() } : null;
    }
    if (range === 'month') start.setDate(1); else start.setDate(start.getDate() - (Number(range) - 1));
    return { from: start.toISOString(), to: end.toISOString() };
  }, [range, from, to, refresh]);
  const base = dates ?? { from: '', to: '' };
  const dashboard = usePersonalQuery<PersonalDashboard>('overview', base, refresh, !!dates);
  const records = usePersonalQuery<AnalyticsPage>(section, { ...base, page, search: query, sort, direction, visibility, fileType, filterDates }, refresh, !!dates && section !== 'overview');
  const data = dates ? dashboard.data : null;
  const changeSection = (next: PersonalSection) => {
    setSection(next); setPage(0); setSearch(''); setQuery(''); setSort('created_at'); setDirection('desc');
    setVisibility(''); setFileType(''); setFilterDates(false);
  };
  const sortOptions = [['created_at:desc', 'Newest'], ['created_at:asc', 'Oldest'], ['file_size:desc', 'Largest'], ['name:asc', 'Name A–Z'],
    ...(section === 'files' ? [['previews:desc', 'Most previews'], ['downloads:desc', 'Most downloads'], ['last_accessed_at:desc', 'Last accessed']]
      : [['views:desc', 'Most viewed'], ['reactions:desc', 'Most reactions'], ['last_viewed_at:desc', 'Last viewed']])];
  const sortValue = `${sort}:${direction}`;
  const columns = section === 'files' ? fileColumns : section === 'videos'
    ? [...mediaColumns.slice(0, 3), col('duration_seconds', 'Duration (seconds)', 'number', false), ...mediaColumns.slice(3)] : mediaColumns;
  const metrics: [string, string, PersonalSection][] = data ? [
    ['My Videos', number(data.overview.videos), 'videos'], ['My Photos', number(data.overview.photos), 'photos'], ['My Files', number(data.overview.files), 'files'],
    ['Video Views', number(data.overview.video_views), 'videos'], ['Photo Views', number(data.overview.photo_views), 'photos'],
    ['File Previews / Downloads', `${number(data.overview.file_previews)} / ${number(data.overview.file_downloads)}`, 'files'],
    ['My Storage Used', formatBytes(data.overview.storage_used), 'overview'], ['Uploads This Month', number(data.overview.uploads_month), 'overview'],
    ['Reactions Received', number(data.overview.reactions), 'overview'],
  ] : [];

  return <section className="user-statistics analytics-shell" aria-label="My statistics">
    <header className="analytics-heading"><div><span className="analytics-eyebrow">YOUR CONTENT</span><h1><BarChart3 size={25} />My Statistics</h1><p>Views, uploads and storage for content you own.</p></div>
      <button aria-label="Refresh my statistics" disabled={!!dates && (dashboard.loading || section !== 'overview' && records.loading)} onClick={() => setRefresh(Date.now())}><RefreshCw size={17} />Refresh</button>
    </header>
    <nav className="analytics-nav" aria-label="My statistics sections">{sections.map(item => <button key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => changeSection(item.id)}><item.icon size={17} />{item.name}</button>)}</nav>
    <div className="analytics-range"><label>Date range<select value={range} onChange={event => { setRange(event.target.value); setPage(0); }}>
      <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="month">This month</option><option value="custom">Custom range</option>
    </select></label>{range === 'custom' && <><label>From<input type="date" value={from} onInput={event => { setFrom(event.currentTarget.value); setPage(0); }} /></label><label>Through<input type="date" value={to} onInput={event => { setTo(event.currentTarget.value); setPage(0); }} /></label></>}
      <span>Charts use {Intl.DateTimeFormat().resolvedOptions().timeZone}.</span>
    </div>
    {!dates && <p className="analytics-notice">Choose a valid date range of up to one year.</p>}
    {dates && dashboard.error && <p className="analytics-error" role="alert">{dashboard.error}</p>}
    {dates && dashboard.loading && <p className="analytics-loading" role="status"><LoaderCircle className="animate-spin" size={20} />Loading your statistics…</p>}
    {data && <div className="analytics-summary">{metrics.map(([label, value, target]) => <button key={label} onClick={() => changeSection(target)}><span>{label}</span><strong>{value}</strong><ChevronRight size={15} /></button>)}</div>}

    {data && section === 'overview' && <>
      <div className="analytics-grid"><TimeChart title="My successful uploads" series={data.series} metric="uploads" /><TimeChart title="Views of my content" series={data.series} metric="views" labels={{ file: 'File previews / downloads' }} /></div>
      <div className="analytics-grid"><DistributionChart title="My storage breakdown" data={data.personal_storage} bytes /><DistributionChart title="My file types" data={data.file_types} /></div>
      <div className="analytics-grid"><BarChart title="My most viewed videos" data={data.top.video} /><BarChart title="My most viewed photos" data={data.top.photo} /></div>
      <div className="analytics-grid"><BarChart title="My most reacted videos" data={data.most_reacted.video} /><BarChart title="My most reacted photos" data={data.most_reacted.photo} /></div>
    </>}

    {dates && section !== 'overview' && <>
      <div className="analytics-filters">
        <label className="analytics-search"><span><Search size={16} />Search my {section}</span><input type="search" placeholder="Search by name…" value={search} maxLength={256} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
        <label>Sort<select value={sortValue} onChange={event => { const [key, order] = event.target.value.split(':'); setSort(key); setDirection(order as 'asc' | 'desc'); setPage(0); }}>
          {!sortOptions.some(([value]) => value === sortValue) && <option value={sortValue}>Selected column order</option>}{sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Access<select value={visibility} onChange={event => { setVisibility(event.target.value); setPage(0); }}><option value="">All</option><option value="public">Public</option><option value="private">Private</option>{section === 'files' && <option value="shared">Shared</option>}</select></label>
        <label>Upload dates<select value={String(filterDates)} onChange={event => { setFilterDates(event.target.value === 'true'); setPage(0); }}><option value="false">All dates</option><option value="true">Selected date range</option></select></label>
        {section === 'files' && <label>File type<select value={fileType} onChange={event => { setFileType(event.target.value); setPage(0); }}><option value="">All types</option>{fileTypes.map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}</select></label>}
      </div>
      <section className="analytics-panel analytics-records"><h2>{sections.find(item => item.id === section)?.name} statistics</h2><p className="analytics-subtext">{filterDates ? 'Content uploaded in the selected date range.' : 'Current content across all upload dates.'} Select a column heading to sort; scroll the table for more details.</p>
        {records.error ? <p className="analytics-error" role="alert">{records.error}</p> : records.loading ? <p className="analytics-loading" role="status"><LoaderCircle className="animate-spin" size={18} />Loading your records…</p> : <>
          <StatisticsTable columns={columns} rows={records.data?.rows ?? []} sort={sort} direction={direction} onSort={key => { setDirection(sort === key && direction === 'desc' ? 'asc' : 'desc'); setSort(key); setPage(0); }} />
          <div className="analytics-pagination"><span>{number(records.data?.total)} records · Page {page + 1} of {Math.max(1, Math.ceil((records.data?.total ?? 0) / 25))}</span>
            <button aria-label="Previous page" disabled={!page} onClick={() => setPage(n => n - 1)}><ChevronLeft size={18} /></button><button aria-label="Next page" disabled={(page + 1) * 25 >= (records.data?.total ?? 0)} onClick={() => setPage(n => n + 1)}><ChevronRight size={18} /></button>
          </div>
        </>}
      </section>
      {data && section !== 'files' && <>
        <div className="analytics-grid"><BarChart title={`My most viewed ${section}`} data={data.top[section === 'videos' ? 'video' : 'photo']} /><BarChart title={`My most reacted ${section}`} data={data.most_reacted[section === 'videos' ? 'video' : 'photo']} /></div>
        <div className="analytics-grid"><TimeChart title={`My ${section === 'videos' ? 'video' : 'photo'} uploads`} series={data.series} metric="uploads" types={[section === 'videos' ? 'video' : 'photo']} />
          <section className="analytics-panel"><h3>My {section === 'videos' ? 'video' : 'photo'} storage</h3><p>{formatBytes(data.personal_storage.find(item => item.label === (section === 'videos' ? 'Videos' : 'Photos'))?.value ?? 0)}</p><p className="analytics-subtext">Stored originals{section === 'videos' ? ' and playable videos' : ''}.</p></section>
        </div>
      </>}
      {data && section === 'files' && <div className="analytics-grid"><DistributionChart title="My file types" data={data.file_types} /><BarChart title="My most accessed files" data={data.top.file} /></div>}
    </>}
    <footer className="analytics-footnote">Totals and top charts cover your current content across all dates. Date ranges apply to history charts and, when selected, upload-date filtering. Only successful uploads count as uploads. Storage includes your current originals and playable videos; cached previews, thumbnails, processing files and Trash are excluded. Views before tracking was enabled are unavailable. File history combines previews and downloads; their totals are shown separately. Summaries may be cached for 30 seconds.{data && <> Updated {statisticsDate(data.generated_at)}.</>}</footer>
  </section>;
}
