import type { ReactNode } from 'react';
import { Grid2X2, LayoutGrid } from 'lucide-react';
import type { Sort, Filter, Density } from '@/hooks/useGalleryView';

export function GalleryToolbar({ title, scope, subtitle, view, actions, allowFilter = false }: {
  title: string; scope: string; subtitle: string; actions?: ReactNode; allowFilter?: boolean;
  view: { sort: Sort; setSort: (value: Sort) => void; filter: Filter; setFilter: (value: Filter) => void; density: Density; setDensity: (value: Density) => void };
}) {
  return <div className="mg-toolbar">
    <div className="mg-heading"><p className="mg-eyebrow">{scope}</p><h1>{title}</h1><p className="mg-subtitle">{subtitle}</p></div>
    <div className="mg-toolbar-controls">
      <label className="mg-select-label"><span>Sort</span><select aria-label="Sort media" value={view.sort} onChange={event => view.setSort(event.target.value as Sort)}>
        <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option>
      </select></label>
      {allowFilter && <label className="mg-select-label"><span>Show</span><select aria-label="Filter media by privacy" value={view.filter} onChange={event => view.setFilter(event.target.value as Filter)}>
        <option value="all">All media</option><option value="public">Public</option><option value="private">Private</option>
      </select></label>}
      <div className="mg-density" role="group" aria-label="Gallery density">
        <button aria-label="Comfortable gallery" title="Comfortable gallery" aria-pressed={view.density === 'comfortable'} onClick={() => view.setDensity('comfortable')}><LayoutGrid size={18} /></button>
        <button aria-label="Compact gallery" title="Compact gallery" aria-pressed={view.density === 'compact'} onClick={() => view.setDensity('compact')}><Grid2X2 size={18} /></button>
      </div>
      {actions}
    </div>
  </div>;
}

export function GalleryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="mg-load-error" role="alert"><p>{message}</p><button onClick={onRetry}>Retry</button></div>;
}
