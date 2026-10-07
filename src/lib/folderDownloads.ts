import { loadFileChildren, type FileEntry } from './fileTree';
import { downloadFile } from './publicFiles';

// ZIP STORE records use the browser's Blob parts without another full copy of
// each payload. Fail explicitly beyond ZIP32 limits instead of corrupting data.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const header = (length: number) => { const bytes = new Uint8Array(length); return { bytes, view: new DataView(bytes.buffer) }; };
export async function downloadFolderArchive(root: FileEntry, userId: string): Promise<Blob> {
  const parts: BlobPart[] = [], central: BlobPart[] = [];
  let size = 0, centralSize = 0, count = 0;
  const visited = new Set<string>();
  const append = async (name: string, payload: Blob) => {
    const encoded = new TextEncoder().encode(name);
    if (encoded.length > 65535 || count >= 65535 || size + payload.size + encoded.length + 30 > 0xffffffff) throw new Error('This folder is too large for a browser ZIP download. Download its files individually.');
    let checksum = 0xffffffff;
    const reader = payload.stream().getReader();
    for (;;) { const { value, done } = await reader.read(); if (done) break; for (const byte of value) checksum = crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8); }
    checksum = (checksum ^ 0xffffffff) >>> 0;
    const local = header(30); local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true); local.view.setUint16(6, 0x800, true);
    local.view.setUint16(12, 33, true); local.view.setUint32(14, checksum, true); local.view.setUint32(18, payload.size, true); local.view.setUint32(22, payload.size, true); local.view.setUint16(26, encoded.length, true);
    const directory = header(46); directory.view.setUint32(0, 0x02014b50, true); directory.view.setUint16(4, 20, true); directory.view.setUint16(6, 20, true); directory.view.setUint16(8, 0x800, true);
    directory.view.setUint16(14, 33, true); directory.view.setUint32(16, checksum, true); directory.view.setUint32(20, payload.size, true); directory.view.setUint32(24, payload.size, true); directory.view.setUint16(28, encoded.length, true); directory.view.setUint32(42, size, true);
    parts.push(local.bytes, encoded, payload); central.push(directory.bytes, encoded);
    size += 30 + encoded.length + payload.size; centralSize += 46 + encoded.length; count++;
  };
  const walk = async (folder: FileEntry, relative: string) => {
    if (visited.has(folder.path)) throw new Error('Folder listing changed. Please try again.');
    visited.add(folder.path);
    await append(`${relative}/`, new Blob([]));
    for (let offset = 0;;) {
      const page = await loadFileChildren(folder.path, userId, offset);
      for (const child of page.entries) {
        if (!child.name || /[\\/]/.test(child.name) || child.name === '.' || child.name === '..') throw new Error('Invalid file name in folder.');
        const name = `${relative}/${child.name}`;
        if (child.isFolder) await walk(child, name);
        else { const { data, error } = await downloadFile(child); if (error || !data) throw new Error(error?.message ?? 'File unavailable.'); await append(name, data); }
      }
      if (!page.hasMore) break;
      offset = page.nextOffset;
    }
  };
  await walk(root, root.name);
  if (size + centralSize > 0xffffffff) throw new Error('This folder is too large for a browser ZIP download.');
  const end = header(22); end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, count, true); end.view.setUint16(10, count, true); end.view.setUint32(12, centralSize, true); end.view.setUint32(16, size, true);
  return new Blob([...parts, ...central, end.bytes], { type: 'application/zip' });
}
