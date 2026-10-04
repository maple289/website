import { Activity, Cpu, Film, MemoryStick } from 'lucide-react';
import type { SystemLoad } from '@/hooks/useSystemLoad';
import './SystemLoadWidget.css';

type Props = { data: SystemLoad | null; error: string | null; compact?: boolean };
const percent = (value: number | null) => value === null ? '—' : `${Math.round(value)}%`;
const gib = (value: number) => (value / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 });

function Meter({ value, label }: { value: number | null; label: string }) {
  const bounded = value === null ? null : Math.min(100, Math.max(0, value));
  return <div className={`system-load-meter ${bounded !== null && bounded >= 95 ? 'is-high' : bounded !== null && bounded >= 85 ? 'is-elevated' : ''}`}
    role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={bounded ?? undefined} aria-valuetext={bounded === null ? 'Sampling' : percent(bounded)}>
    <span style={{ width: `${bounded ?? 0}%` }} />
  </div>;
}

export function SystemLoadWidget({ data, error, compact = false }: Props) {
  const available = data?.collectedAt != null;
  const stale = data?.stale || Boolean(error);
  const memoryAvailable = data?.memoryUsedBytes != null && data.memoryTotalBytes != null;
  return <section className={`system-load-widget ${compact ? 'is-compact' : 'admin-panel'}`} aria-label={compact ? 'System Load sidebar' : 'System Load'}>
    <header className="system-load-heading">
      <h2><Activity size={compact ? 15 : 20} aria-hidden="true" />System Load</h2>
      <span className={`system-load-status ${available && !stale ? 'is-live' : ''}`}>{available ? stale ? 'Delayed' : 'Live' : 'Waiting'}</span>
    </header>
    {!compact && <p className="system-load-intro">Ubuntu VM utilization across all detected logical CPUs. Readings refresh every 3 seconds.</p>}
    {error && <p className="system-load-notice" role="status">{error}</p>}
    {!available ? <p className="system-load-notice" role="status">{error ? 'Waiting for system readings…' : 'Collecting system readings…'}</p> : <>
      {stale && <p className="system-load-notice">Showing the last reading; live monitoring is delayed.</p>}
      <div className="system-load-overall">
        <div className="system-load-label"><span><Cpu size={14} aria-hidden="true" />Overall CPU</span><strong>{percent(data.cpuOverall)}</strong></div>
        <Meter value={data.cpuOverall} label="Overall CPU utilization" />
      </div>
      <p className="system-load-cpu-count">{data.cpus.length} logical {data.cpus.length === 1 ? 'CPU' : 'CPUs'}</p>
      <div className="system-load-cpus">{data.cpus.map(cpu => <div key={cpu.id} className="system-load-cpu">
        <span>CPU {cpu.id + 1}</span><Meter value={cpu.usage} label={`CPU ${cpu.id + 1} utilization`} /><strong>{percent(cpu.usage)}</strong>
      </div>)}</div>
      <div className="system-load-memory">
        <div className="system-load-label"><span><MemoryStick size={14} aria-hidden="true" />RAM</span><strong>{percent(data.memoryPercent)}</strong></div>
        <Meter value={data.memoryPercent} label="RAM utilization" />
        {memoryAvailable && <p>{gib(data.memoryUsedBytes!)} / {gib(data.memoryTotalBytes!)} GiB</p>}
      </div>
      <div className="system-load-processing">
        <h3><Film size={14} aria-hidden="true" />Video Processing</h3>
        <dl><div><dt>Converting</dt><dd>{data.videoProcessing.converting}</dd></div><div><dt>Queued</dt><dd>{data.videoProcessing.queued}</dd></div></dl>
        {!compact && <p>Active jobs include upload validation and conversion. CPU and RAM readings cover the whole VM.</p>}
      </div>
      <p className="system-load-updated">Updated {new Date(data.collectedAt!).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
    </>}
  </section>;
}
