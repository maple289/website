import { formatBytes, type AnalyticsRow } from '@/lib/analytics';
import { statisticsDate, statisticsNumber, type StatisticsColumn } from '@/lib/statisticsPresentation';

export function StatisticsTable({ columns, rows, sort, direction, onSort, onUser }: {
  columns: StatisticsColumn[]; rows: AnalyticsRow[]; sort: string; direction: string;
  onSort: (key: string) => void; onUser?: (id: string) => void;
}) {
  return <div className="analytics-table-scroll" tabIndex={0} aria-label="Statistics records"><table>
    <thead><tr>{columns.map(column => <th key={column.key} aria-sort={sort === column.key ? direction === 'asc' ? 'ascending' : 'descending' : undefined}>
      {column.sortable ? <button onClick={() => onSort(column.key)}>{column.name}{sort === column.key && (direction === 'asc' ? ' ↑' : ' ↓')}</button> : column.name}
    </th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={String(row.id ?? row.content_id)}>{columns.map(column => {
      const value = column.key === 'resolution' ? row.resolution_width && row.resolution_height ? `${row.resolution_width} × ${row.resolution_height}` : '—' : row[column.key];
      const formatted = column.format === 'date' ? statisticsDate(value)
        : column.format === 'bytes' ? value == null ? '—' : formatBytes(Number(value))
        : column.format === 'number' ? value == null ? '—' : statisticsNumber(value)
        : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value ?? '—').replace(/_/g, ' ');
      return <td key={column.key} title={formatted}>{onUser && column.key === 'display_name'
        ? <button className="analytics-user-link" onClick={() => onUser(String(row.id))}>{formatted}</button> : formatted}</td>;
    })}</tr>)}</tbody>
  </table>{!rows.length && <p className="analytics-empty">No matching records.</p>}</div>;
}
