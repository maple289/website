// Browser discovery is separate from storage: all methods produce one validated plan.
export type UploadSource = { path: string; file?: File };
export type UploadSelection = { items: UploadSource[]; notice?: string };
type Entry = {
  name: string; isFile: boolean; isDirectory: boolean;
  file: (ok: (file: File) => void, fail: (error: DOMException) => void) => void;
  createReader: () => { readEntries: (ok: (entries: Entry[]) => void, fail: (error: DOMException) => void) => void };
};
export type DirectoryHandle = {
  kind: 'directory'; name: string;
  values: () => AsyncIterable<DirectoryHandle | { kind: 'file'; name: string; getFile: () => Promise<File> }>;
};
export const folderPickerNotice = 'This browser supplies files and their paths only. Empty folders are not included. For empty folders, use directory drag-and-drop where supported, or New folder.';

export function validateUploadPath(path: string): string {
  if (path.split('/').some(part => !part || ['.', '..', '.folder', '.keep'].includes(part) || /[\\\p{Cc}]/u.test(part))) {
    throw new Error(`Invalid upload path: ${path}`);
  }
  return path;
}

export function planUploads(sources: UploadSource[]): UploadSource[] {
  const entries = new Map<string, UploadSource>();
  const explicitPaths = new Set<string>();
  const directory = (path: string) => {
    if (entries.get(path)?.file) throw new Error(`A file and folder have the same path: ${path}`);
    entries.set(path, { path });
  };
  for (const source of sources) {
    validateUploadPath(source.path);
    if (explicitPaths.has(source.path)) throw new Error(`Duplicate upload path: ${source.path}`);
    explicitPaths.add(source.path);
    const parts = source.path.split('/');
    for (let i = 1; i < parts.length; i++) directory(parts.slice(0, i).join('/'));
    if (!source.file) directory(source.path);
    else {
      if (entries.has(source.path)) throw new Error(`Duplicate upload path: ${source.path}`);
      if (parts[parts.length - 1] !== source.file.name) throw new Error('File name does not match its upload path.');
      entries.set(source.path, source);
    }
  }
  return [...entries.values()].sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.path.split('/').length - b.path.split('/').length);
}

export function selectFiles(files: FileList | File[], folder = false): UploadSelection {
  const items = Array.from(files).map(file => {
    if (folder && (!file.webkitRelativePath || !file.webkitRelativePath.includes('/'))) throw new Error('Folder paths are unavailable. Use Add files or a supported desktop browser.');
    return { path: folder ? file.webkitRelativePath : file.name, file };
  });
  if (folder && !items.length) throw new Error('No files were supplied. Empty folders cannot be uploaded using this browser’s folder selector. Use New folder.');
  return { items: planUploads(items), notice: folder ? folderPickerNotice : undefined };
}

export async function selectDirectory(handle: DirectoryHandle): Promise<UploadSelection> {
  const items: UploadSource[] = [];
  async function visit(directory: DirectoryHandle, path: string): Promise<void> {
    validateUploadPath(path); items.push({ path });
    for await (const child of directory.values()) {
      if (child.kind === 'directory') await visit(child, `${path}/${child.name}`);
      else items.push({ path: `${path}/${child.name}`, file: await child.getFile() });
    }
  }
  await visit(handle, handle.name);
  return { items: planUploads(items) };
}

// Capture entries while the drop event's data store is readable, BEFORE awaiting.
// Directory readers return batches (often 100 entries); read until the empty batch.
export async function selectDrop(data: DataTransfer): Promise<UploadSelection> {
  const dropped = Array.from(data.items).filter(item => item.kind === 'file').map(item => ({
    entry: item.webkitGetAsEntry?.() as Entry | null, file: item.getAsFile(), type: item.type,
  }));
  if (!dropped.length) throw new Error('Directory information is unavailable. Use Add files or Add Folder.');
  const items: UploadSource[] = [];
  async function visit(entry: Entry, parent = ''): Promise<void> {
    const path = parent + entry.name; validateUploadPath(path);
    if (entry.isDirectory) {
      items.push({ path });
      const reader = entry.createReader();
      for (;;) {
        const children = await new Promise<Entry[]>((ok, fail) => reader.readEntries(ok, fail));
        if (!children.length) break;
        for (const child of children) await visit(child, path + '/');
      }
    } else if (entry.isFile) items.push({ path, file: await new Promise<File>((ok, fail) => entry.file(ok, fail)) });
    else throw new Error(`Cannot identify dropped item: ${path}. Use Add files or Add Folder.`);
  }
  for (const item of dropped) {
    if (item.entry) await visit(item.entry);
    else if (item.file && item.type) items.push({ path: item.file.name, file: item.file });
    else throw new Error('This browser cannot identify dropped directories or untyped files safely. Use Add files or Add Folder.');
  }
  return { items: planUploads(items) };
}

export async function runUploadPlan(items: UploadSource[], perform: (item: UploadSource, index: number) => Promise<void>, failed: (index: number, error: Error) => void) {
  const blocked = new Set<string>();
  for (const [index, item] of items.entries()) {
    try {
      if ([...blocked].some(path => item.path.startsWith(path + '/'))) throw new Error('Parent folder failed. Its contents were not uploaded.');
      await perform(item, index);
    } catch (cause) {
      if (!item.file) blocked.add(item.path);
      failed(index, cause instanceof Error ? cause : new Error('Upload failed. Check the destination before retrying.'));
    }
  }
}
