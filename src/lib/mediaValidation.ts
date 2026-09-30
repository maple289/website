export type MediaKind = 'video' | 'photo';
export const videoExtensions = ['mp4','mov','avi','mkv','wmv','webm','mpeg','mpg','m4v','3gp','3g2','ts','mts','m2ts','ogv','flv','vob','rm','rmvb','mxf','nut','asf','f4v','divx','qt'];
export const photoExtensions = ['jpg','jpeg','png','gif','webp','bmp','tif','tiff','heic','heif','avif'];
export const VIDEO_ACCEPT = videoExtensions.map(value => '.' + value).join(',') + ',video/*';
export const PHOTO_ACCEPT = photoExtensions.map(value => '.' + value).join(',');
const generic = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
export function mediaTypeError(file: Pick<File,'name'|'type'|'size'>, kind: MediaKind): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.type.toLowerCase();
  const prefix = kind === 'video' ? 'video/' : 'image/';
  const extra = kind === 'video' && ['application/x-matroska','application/ogg','application/mxf','application/vnd.rn-realmedia',
    'application/x-troff-msvideo','application/x-msvideo','application/vnd.ms-asf'].includes(mime);
  const extensions = kind === 'video' ? videoExtensions : photoExtensions;
  const knownMime = mime.startsWith(prefix) || extra;
  if ((!knownMime && !generic.has(mime)) || (!knownMime && !extensions.includes(extension)) || (kind === 'photo' && !extensions.includes(extension))) {
    return `"${file.name}" cannot be uploaded here. The ${kind === 'video' ? 'Videos section accepts video' : 'Photos section accepts image'} files only. Choose a supported format.`;
  }
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > (kind === 'video' ? 10 * 1024 ** 3 : 25 * 1024 ** 2)) return `"${file.name}" exceeds the ${kind === 'video' ? '10 GB video' : '25 MB image'} limit.`;
  return null;
}

function signature(bytes: Uint8Array): 'photo' | 'video' | null {
  const text = new TextDecoder('latin1').decode(bytes);
  const starts = (...values: number[]) => values.every((value,index) => bytes[index] === value);
  if (text.slice(4,8) === 'ftyp') {
    return /avif|avis|heic|heix|hevc|hevx|mif1|msf1/.test(text.slice(8,64)) ? 'photo' : 'video';
  }
  if (starts(255,216,255) || starts(137,80,78,71,13,10,26,10) || /^GIF8[79]a/.test(text) ||
      text.startsWith('BM') || starts(73,73,42,0) || starts(77,77,0,42) || starts(73,73,43,0) || starts(77,77,0,43) ||
      (text.startsWith('RIFF') && text.slice(8,12)==='WEBP')) return 'photo';
  if ((text.startsWith('RIFF') && text.slice(8,12)==='AVI ') || starts(0x1a,0x45,0xdf,0xa3) ||
      starts(0x30,0x26,0xb2,0x75,0x8e,0x66,0xcf,0x11) || text.startsWith('FLV') ||
      text.startsWith('OggS') || text.startsWith('.RMF') || text.startsWith('nut/multimedia container') ||
      starts(6,14,43,52) || starts(0,0,1) || ['moov','mdat','wide','free'].includes(text.slice(4,8)) ||
      (bytes[0]===0x47 && bytes[188]===0x47) || (bytes[4]===0x47 && bytes[196]===0x47)) return 'video';
  return null;
}
const checked = new WeakMap<File, Set<MediaKind>>();
export async function validateMediaFile(file: File, kind: MediaKind): Promise<void> {
  if (checked.get(file)?.has(kind)) return;
  const error = mediaTypeError(file,kind);
  if (error) throw new Error(error);
  const header = new Uint8Array(await file.slice(0,4096).arrayBuffer());
  const detected = signature(header);
  if (detected !== kind) throw new Error(`"${file.name}" cannot be uploaded here. ${detected ? 'The ' + (kind === 'video' ? 'Videos section accepts video' : 'Photos section accepts image') + ' files only.' : 'Its content is not a recognizable supported ' + (kind === 'video' ? 'video' : 'image') + '; the file may be corrupted or incorrectly named.'}`);
  // Do not require browser video codecs (e.g. MKV/WMV) or HEIF/TIFF decoding.
  // Common browser image formats can be rejected before any network transfer.
  if (kind === 'photo' && new TextDecoder().decode(header.slice(4,8)) !== 'ftyp' && !(header[0] === 73 || header[0] === 77) && typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { throw new Error(`"${file.name}" cannot be decoded as an image. It may be corrupted.`); }
    const pixels = bitmap.width * bitmap.height; bitmap.close();
    if (pixels > 40_000_000) throw new Error(`"${file.name}" exceeds the 40 megapixel image limit.`);
  }
  const kinds = checked.get(file) ?? new Set<MediaKind>(); kinds.add(kind); checked.set(file,kinds);
}
