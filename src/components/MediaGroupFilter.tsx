import type { MediaGroup } from '@/hooks/useMediaGroups';

export function MediaGroupFilter({ groups, selected, loading, error, onSelect, onRetry }: {
  groups: MediaGroup[]; selected: string; loading: boolean; error: boolean; onSelect: (id: string) => void; onRetry: () => void;
}) {
  return <div className="px-3 py-3">
    <label htmlFor="media-group-filter" className="mb-2 block text-sm font-semibold">Messenger group</label>
    <select id="media-group-filter" className="fluent-field w-full px-3 text-sm" value={selected} disabled={loading} onChange={event => onSelect(event.target.value)} aria-describedby="media-group-filter-help">
      <option value="">NONE</option>
      {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
    </select>
    <p id="media-group-filter-help" className="mt-2 text-xs">{loading ? 'Loading groups…' : selected ? 'Showing content shared with this group.' : 'Showing all public content.'}</p>
    {error && <p role="alert" className="mt-2 text-xs">Could not load groups. <button type="button" className="underline" onClick={onRetry}>Retry groups</button></p>}
  </div>;
}
