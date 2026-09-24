import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileEntry } from '@/lib/fileTree';

export type FileView = 'files' | 'recent' | 'favorites' | 'shared' | 'trash';
type Location = { view: FileView; folder: string; sharedFolder: string; publicFolder: FileEntry | null };
const root: Location = { view: 'files', folder: '', sharedFolder: '', publicFolder: null };
const marker = 'fileManagerNavigation';

function readLocation(guest: boolean): Location {
  const query = new URLSearchParams(window.location.hash.split('?')[1]);
  if (guest) {
    const path = query.get('public') ?? '';
    if (!/^public(?:\/[0-9a-f-]{36})+$/i.test(path)) return root;
    const cached = window.history.state?.[marker]?.publicFolder as FileEntry | undefined;
    return { ...root, publicFolder: cached?.path === path ? cached : {
      id: path.split('/').pop(), path, name: 'Public folder', isFolder: true,
      size: 0, updatedAt: '', mimeType: '', favorite: false, trashedAt: null,
    } };
  }
  const view = query.get('view') as FileView;
  return { ...root, view: ['files', 'recent', 'favorites', 'shared', 'trash'].includes(view) ? view : 'files',
    folder: view === 'shared' ? '' : query.get('folder') ?? '', sharedFolder: view === 'shared' ? query.get('folder') ?? '' : '' };
}

function urlFor(location: Location): string {
  const query = new URLSearchParams();
  if (location.publicFolder) query.set('public', location.publicFolder.path);
  else {
    if (location.view !== 'files') query.set('view', location.view);
    const path = location.view === 'shared' ? location.sharedFolder : location.folder;
    if (path) query.set('folder', path);
  }
  return `#/files${query.size ? `?${query}` : ''}`;
}

export function useFileNavigation(guest: boolean, onNavigate: () => void) {
  const [location, setLocation] = useState(() => readLocation(guest));
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const lastUrl = useRef(window.location.hash);

  useEffect(() => {
    const sync = () => {
      if (window.location.hash.split('?')[0] !== '#/files') return;
      const next = readLocation(guest);
      const url = urlFor(next);
      if (!window.history.state?.[marker]) {
        // A pasted/deep-linked folder needs a Files root behind it, otherwise
        // the first browser Back would leave Files immediately.
        window.history.replaceState({ ...window.history.state, [marker]: {} }, '', '#/files');
        if (url !== '#/files') window.history.pushState({ [marker]: { publicFolder: next.publicFolder } }, '', url);
      } else if (url !== window.location.hash) {
        // Drop invalid or inapplicable parameters, including a signed-in
        // user's folder URL after switching to guest access.
        window.history.replaceState({ [marker]: { publicFolder: next.publicFolder } }, '', url);
      }
      if (lastUrl.current !== url) {
        lastUrl.current = url;
        onNavigateRef.current();
        setLocation(next);
      }
    };
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, [guest]);

  const navigate = useCallback((next: Partial<Location>) => {
    const destination = { ...root, ...next };
    const url = urlFor(destination);
    if (url === window.location.hash) return;
    window.history.pushState({ [marker]: { publicFolder: destination.publicFolder } }, '', url);
    lastUrl.current = url;
    onNavigateRef.current();
    setLocation(destination);
  }, []);

  return { ...location, navigate, back: () => window.history.back(), forward: () => window.history.forward() };
}
