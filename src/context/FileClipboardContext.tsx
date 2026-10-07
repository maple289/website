/* eslint-disable react-refresh/only-export-components -- Provider and its paired hook. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import type { FileEntry } from '@/lib/fileTree';
type Clipboard = { owner: string; entry: FileEntry } | null;
const FileClipboardContext = createContext<{ clipboard: Clipboard; copy: (entry: FileEntry) => void; clear: () => void } | null>(null);
export function FileClipboardProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const id = user?.id;
  const [clipboard, setClipboard] = useState<Clipboard>(null);
  useEffect(() => { setClipboard(null); }, [id]);
  const copy = useCallback((entry: FileEntry) => { if (id && entry.path.startsWith(`${id}/`) && !entry.trashedAt) setClipboard({ owner: id, entry: { ...entry } }); }, [id]);
  const clear = useCallback(() => setClipboard(null), []);
  const value = useMemo(() => ({ clipboard: clipboard?.owner === id ? clipboard : null, copy, clear }), [clipboard, id, copy, clear]);
  return <FileClipboardContext.Provider value={value}>{children}</FileClipboardContext.Provider>;
}
export function useFileClipboard() {
  const value = useContext(FileClipboardContext);
  // Isolated embedded File Managers can keep a local clipboard. The main app
  // uses the provider so its clipboard survives section navigation.
  const { user } = useAuth();
  const [local, setLocal] = useState<Clipboard>(null);
  const id = user?.id;
  useEffect(() => { setLocal(null); }, [id]);
  const copy = useCallback((entry: FileEntry) => { if (id && entry.path.startsWith(`${id}/`) && !entry.trashedAt) setLocal({ owner: id, entry: { ...entry } }); }, [id]);
  const clear = useCallback(() => setLocal(null), []);
  return value ?? { clipboard: local?.owner === id ? local : null,
    copy, clear };
}
