import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react';
import { ancestorPaths, loadFileChildren, searchTreeEntries, type FileEntry, type FilePage } from '@/lib/fileTree';

type Branch = FilePage & { loading?: boolean; error?: string };
type Node = { entry: FileEntry; children: Node[] };

function hierarchy(entries: FileEntry[]): Node[] {
  const nodes = new Map(entries.map((entry) => [entry.path, { entry, children: [] } as Node]));
  const roots: Node[] = [];
  for (const node of nodes.values()) {
    const parentPath = ancestorPaths(node.entry.path).reverse().find((path) => nodes.get(path)?.entry.isFolder);
    if (parentPath) nodes.get(parentPath)!.children.push(node); else roots.push(node);
  }
  const sort = (list: Node[]) => {
    list.sort((a, b) => Number(b.entry.isFolder) - Number(a.entry.isFolder) || a.entry.name.localeCompare(b.entry.name) || a.entry.path.localeCompare(b.entry.path));
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

export function FileTree({ entries, userId, query, label, renderEntry, onEntriesChange, onOpen, onSelect, selected }: {
  entries: FileEntry[]; userId: string; query: string; label: string;
  renderEntry: (entry: FileEntry) => ReactNode; onEntriesChange: (entries: FileEntry[]) => void;
  onOpen: (entry: FileEntry) => void; onSelect: (entry: FileEntry) => void; selected: string[];
}) {
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchEntries, setSearchEntries] = useState<FileEntry[]>([]);
  const [searchError, setSearchError] = useState('');
  const [revealing, setRevealing] = useState(false);
  const generation = useRef({ version: 0 });
  const pending = useRef(new Set<string>());
  const tree = useRef<HTMLDivElement>(null);
  const searching = Boolean(query.trim());

  useEffect(() => {
    const requests = pending.current;
    const lifecycle = generation.current;
    return () => { lifecycle.version++; requests.clear(); onEntriesChange([]); };
  }, [onEntriesChange]);

  useEffect(() => {
    const controller = new AbortController();
    setSearchError('');
    setSearchEntries([]);
    if (!searching) { setRevealing(false); return; }
    setRevealing(true);
    searchTreeEntries(entries, userId, controller.signal).then((rows) => {
      if (controller.signal.aborted) return;
      setSearchEntries(rows);
      setExpanded(new Set(rows.filter((entry) => entry.isFolder).map((entry) => entry.path)));
    }).catch((error) => {
      if (!controller.signal.aborted) { setSearchEntries(entries); setSearchError(error.message ?? 'Could not reveal parent folders.'); }
    }).finally(() => { if (!controller.signal.aborted) setRevealing(false); });
    return () => controller.abort();
  }, [entries, searching, query, userId]);

  const allEntries = useMemo(() => {
    if (searching) return searchEntries;
    const rows = new Map(entries.map((entry) => [entry.path, entry]));
    for (const branch of Object.values(branches)) for (const entry of branch.entries) rows.set(entry.path, entry);
    return [...rows.values()];
  }, [entries, branches, searching, searchEntries]);
  const roots = useMemo(() => hierarchy(allEntries), [allEntries]);
  const matches = useMemo(() => new Set(entries.map((entry) => entry.path)), [entries]);
  useEffect(() => { onEntriesChange(allEntries); }, [allEntries, onEntriesChange]);

  const loadBranch = useCallback(async (path: string, offset = 0) => {
    if (pending.current.has(path)) return;
    const version = generation.current.version;
    pending.current.add(path);
    setBranches((current) => ({ ...current, [path]: { ...current[path], entries: current[path]?.entries ?? [], nextOffset: offset, hasMore: false, loading: true, error: undefined } }));
    try {
      const page = await loadFileChildren(path, userId, offset);
      if (version !== generation.current.version) return;
      setBranches((current) => ({ ...current, [path]: { ...page, entries: offset ? [...(current[path]?.entries ?? []), ...page.entries] : page.entries } }));
    } catch (error) {
      if (version !== generation.current.version) return;
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Could not load folder.';
      setBranches((current) => ({ ...current, [path]: { ...current[path], loading: false, error: message } }));
    } finally { if (version === generation.current.version) pending.current.delete(path); }
  }, [userId]);

  const toggle = (entry: FileEntry) => {
    const opening = !expanded.has(entry.path);
    setExpanded((current) => { const next = new Set(current); if (opening) next.add(entry.path); else next.delete(entry.path); return next; });
    if (opening && !searching && !branches[entry.path]) void loadBranch(entry.path);
  };

  const renderNodes = (nodes: Node[], depth = 0): ReactNode => nodes.map(({ entry, children }) => {
    const expandable = entry.isFolder && !entry.trashedAt;
    const open = expanded.has(entry.path);
    const branch = branches[entry.path];
    return <div key={entry.path} role="treeitem" aria-label={entry.name} aria-level={depth + 1} aria-expanded={expandable ? open : undefined} aria-selected={selected.includes(entry.path)} tabIndex={0} data-path={entry.path}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const rows = Array.from(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
        const index = rows.indexOf(event.currentTarget);
        if (event.key === 'ArrowDown') { event.preventDefault(); rows[index + 1]?.focus(); }
        if (event.key === 'ArrowUp') { event.preventDefault(); rows[index - 1]?.focus(); }
        if (event.key === 'Home') { event.preventDefault(); rows[0]?.focus(); }
        if (event.key === 'End') { event.preventDefault(); rows[rows.length - 1]?.focus(); }
        if (event.key === 'ArrowRight' && expandable) { event.preventDefault(); if (!open) toggle(entry); else event.currentTarget.querySelector<HTMLElement>('[role="treeitem"]')?.focus(); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); if (expandable && open) toggle(entry); else event.currentTarget.parentElement?.closest<HTMLElement>('[role="treeitem"]')?.focus(); }
        if (event.key === 'Enter') { event.preventDefault(); onOpen(entry); }
        if (event.key === ' ') { event.preventDefault(); onSelect(entry); }
      }}>
      <div className="fm-tree-row" data-match={searching && matches.has(entry.path)} style={{ paddingLeft: Math.min(depth, 8) * 14 }}>
        {expandable ? <button type="button" aria-label={`${open ? 'Collapse' : 'Expand'} ${entry.name}`} aria-expanded={open} className="fm-tree-toggle" onClick={() => toggle(entry)}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button> : <span className="fm-tree-toggle" />}
        {renderEntry(entry)}
      </div>
      {open && expandable && <div role="group">
        {renderNodes(children, depth + 1)}
        {!searching && branch?.loading && <p role="status" className="flex items-center gap-2 px-9 py-2 text-xs text-slate-500"><LoaderCircle size={14} className="animate-spin" />Loading {entry.name}…</p>}
        {!searching && branch?.error && <div role="alert" className="px-9 py-2 text-xs text-rose-700">{branch.error} <button className="font-semibold underline" onClick={() => void loadBranch(entry.path, branch.nextOffset)}>Retry</button></div>}
        {!searching && branch && !branch.loading && !branch.error && branch.entries.length === 0 && !branch.hasMore && <p className="px-9 py-2 text-xs text-slate-500">This folder is empty.</p>}
        {!searching && branch?.hasMore && !branch.loading && <button onClick={() => void loadBranch(entry.path, branch.nextOffset)} className="mx-9 my-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-blue-700">Load more in {entry.name}</button>}
      </div>}
    </div>;
  });

  return <div className="fm-tree">
    <p className="mb-2 text-xs text-slate-500">{searching ? 'Matching items and their accessible parent folders. Clear search to browse all contents.' : 'Expand with the arrow. Click a name to open it.'}</p>
    {revealing && <p role="status" className="py-2 text-xs text-blue-700">Revealing matching paths…</p>}
    {searchError && <p role="alert" className="py-2 text-xs text-rose-700">{searchError}</p>}
    <div ref={tree} role="tree" aria-label={label} aria-multiselectable="true">{renderNodes(roots)}</div>
  </div>;
}
