import { useState } from 'react';
import { formatBytes, type Dashboard, type Metric } from '@/lib/analytics';

const colors = ['#2563eb', '#0d9488', '#a855f7', '#f59e0b', '#e11d48', '#64748b'];
const count = (value: number) => value.toLocaleString();

export function BarChart({ title, data, bytes = false }: { title: string; data: Metric[]; bytes?: boolean }) {
  const maximum = Math.max(1, ...data.map(item => item.value));
  const total = data.reduce((n, item) => n + item.value, 0);
  return <section className="analytics-panel"><h3>{title}</h3>{!data.length ? <p className="analytics-empty">No data available.</p> : <div className="analytics-bars" role="list">{data.map((item, index) => <div className="analytics-bar" key={item.id ?? item.label} role="listitem">
    <div className="analytics-bar-label"><span title={item.label}>{item.label}</span><strong>{bytes ? formatBytes(item.value) : count(item.value)}</strong></div>
    <div className="analytics-bar-track" aria-hidden="true"><div style={{ width: `${item.value / maximum * 100}%`, background: colors[index % colors.length] }} /></div>
    {!bytes && total > 0 && <span className="analytics-percent">{(item.value / total * 100).toFixed(1)}%</span>}
  </div>)}</div>}</section>;
}

export function DistributionChart({ title, data, bytes = false }: { title: string; data: Metric[]; bytes?: boolean }) {
  const total = data.reduce((n, item) => n + item.value, 0);
  let offset = 0;
  return <section className="analytics-panel"><h3>{title}</h3><div className="analytics-distribution">
    <svg viewBox="0 0 160 160" role="img" aria-label={`${title}: ${data.map(item => `${item.label} ${bytes ? formatBytes(item.value) : item.value}`).join(', ')}`}>
      <circle cx="80" cy="80" r="57" fill="none" stroke="#e2e8f0" strokeWidth="20" />
      {total > 0 && data.map((item, index) => { const length = item.value / total * 358.14; const start = offset; offset += length; return <circle key={item.label} cx="80" cy="80" r="57" fill="none" stroke={colors[index % colors.length]} strokeWidth="20" strokeDasharray={`${length} ${358.14 - length}`} strokeDashoffset={-start} transform="rotate(-90 80 80)"><title>{item.label}: {bytes ? formatBytes(item.value) : count(item.value)}</title></circle>; })}
      <text x="80" y="78" textAnchor="middle" fontSize="18" fill="#0f172a" fontWeight="650">{bytes ? formatBytes(total) : count(total)}</text><text x="80" y="97" textAnchor="middle" fontSize="10" fill="#64748b">{bytes ? 'stored' : 'items'}</text>
    </svg>
    <table><thead><tr><th>Type</th><th>{bytes ? 'Size' : 'Count'}</th><th>%</th></tr></thead><tbody>{data.map((item, index) => <tr key={item.label}><td><span className="analytics-dot" style={{ background: colors[index % colors.length] }} />{item.label}</td><td>{bytes ? formatBytes(item.value) : count(item.value)}</td><td>{total ? (item.value / total * 100).toFixed(1) : '0'}%</td></tr>)}</tbody></table>
  </div></section>;
}

export function TimeChart({ title, series, metric, types = ['video', 'photo', 'file'] }: { title: string; series: Dashboard['series']; metric: 'uploads' | 'views'; types?: ('video' | 'photo' | 'file')[] }) {
  const [visible, setVisible] = useState([true, true, true]);
  const keys = types.map(type => `${type}_${metric}`);
  const maximum = Math.max(1, ...series.flatMap(row => keys.map((key, i) => visible[i] ? Number(row[key] ?? 0) : 0)));
  const w = 640, h = 195, x = (index: number) => 35 + index / Math.max(1, series.length - 1) * (w - 50), y = (value: number) => h - 25 - value / maximum * (h - 45);
  const label = (date: string) => date.replace('T', ' ').slice(0, series.length <= 48 ? 16 : 10);
  return <section className="analytics-panel"><h3>{title}</h3><div className="analytics-chart-legend">{types.map((name, i) => <button key={name} aria-pressed={visible[i]} onClick={() => setVisible(current => current.map((item, index) => index === i ? !item : item))}><span className="analytics-dot" style={{ background: visible[i] ? colors[i] : '#cbd5e1' }} />{name[0].toUpperCase() + name.slice(1)}s</button>)}</div>
    <svg className="analytics-time-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${title}. Exact values are in the table below.`}>
      {[0, .5, 1].map(fraction => <g key={fraction}><line x1="35" x2={w - 15} y1={y(maximum * fraction)} y2={y(maximum * fraction)} stroke="#e2e8f0" strokeDasharray="3 4" /><text x="28" y={y(maximum * fraction) + 4} textAnchor="end" fill="#64748b" fontSize="11">{(maximum * fraction).toLocaleString(undefined, { maximumFractionDigits: 1 })}</text></g>)}
      {keys.map((key, index) => visible[index] && <g key={key}><polyline points={series.map((row, i) => `${x(i)},${y(Number(row[key]))}`).join(' ')} fill="none" stroke={colors[index]} strokeWidth="2.5" strokeLinejoin="round" />{series.length <= 48 && series.map((row, i) => <circle key={row.date} cx={x(i)} cy={y(Number(row[key]))} r="3" fill={colors[index]}><title>{label(row.date)}: {Number(row[key])} {key.replace('_', ' ')}</title></circle>)}</g>)}
      {series.length > 0 && <><text x="35" y={h - 5} fill="#64748b" fontSize="10">{label(series[0].date)}</text><text x={w - 15} y={h - 5} textAnchor="end" fill="#64748b" fontSize="10">{label(series[series.length - 1].date)}</text></>}
    </svg>
    <details className="analytics-values"><summary>Exact values</summary><div className="analytics-table-scroll"><table><thead><tr><th>Date / time</th>{types.map(type => <th key={type}>{type[0].toUpperCase() + type.slice(1)}s</th>)}</tr></thead><tbody>{series.map(row => <tr key={row.date}><td>{label(row.date)}</td>{keys.map(key => <td key={key}>{count(Number(row[key]))}</td>)}</tr>)}</tbody></table></div></details>
  </section>;
}
