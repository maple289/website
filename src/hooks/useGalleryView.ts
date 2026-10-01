import { useState } from 'react';

type GalleryItem = { file_name: string; created_at: string; visibility: 'public' | 'private' };
export type Sort = 'newest' | 'oldest' | 'name';
export type Filter = 'all' | 'public' | 'private';
export type Density = 'comfortable' | 'compact';

export function useGalleryView<T extends GalleryItem>(items: T[], searchTerm: string) {
  const [sort, setSort] = useState<Sort>('newest');
  const [filter, setFilter] = useState<Filter>('all');
  const [density, setDensity] = useState<Density>(() => {
    try { return localStorage.getItem('myhostage-gallery-density') === 'compact' ? 'compact' : 'comfortable'; }
    catch { return 'comfortable'; }
  });
  const term = searchTerm.trim().toLowerCase();
  const visible = items.filter(item => (!term || item.file_name.toLowerCase().includes(term)) && (filter === 'all' || item.visibility === filter));
  visible.sort((a, b) => sort === 'name'
    ? a.file_name.localeCompare(b.file_name, undefined, { numeric: true, sensitivity: 'base' }) || b.created_at.localeCompare(a.created_at)
    : (sort === 'oldest' ? 1 : -1) * a.created_at.localeCompare(b.created_at));
  const changeDensity = (value: Density) => {
    setDensity(value);
    try { localStorage.setItem('myhostage-gallery-density', value); } catch { /* Preferences can remain local to this visit. */ }
  };
  return { visible, sort, setSort, filter, setFilter, density, setDensity: changeDensity };
}

