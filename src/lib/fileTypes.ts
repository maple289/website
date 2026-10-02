import type { FileEntry } from './fileTree';

export type FileCategory = 'folder' | 'pdf' | 'word' | 'excel' | 'powerpoint' | 'text' | 'csv' | 'image' | 'archive' | 'audio' | 'video' | 'other';
const mimeCategories: Record<string, FileCategory> = {
  'application/pdf': 'pdf', 'application/msword': 'word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.ms-excel': 'excel', 'application/msexcel': 'excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.ms-powerpoint': 'powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'powerpoint',
  'text/csv': 'csv', 'application/csv': 'csv', 'application/json': 'text',
  'application/xml': 'text', 'application/rtf': 'text',
  'application/zip': 'archive', 'application/x-zip-compressed': 'archive',
  'application/vnd.rar': 'archive', 'application/x-rar-compressed': 'archive',
  'application/x-7z-compressed': 'archive', 'application/x-tar': 'archive',
  'application/gzip': 'archive', 'application/x-gzip': 'archive',
  'application/x-bzip2': 'archive', 'application/x-xz': 'archive',
};
const extensionCategories: Record<string, FileCategory> = {};
for (const [category, extensions] of Object.entries({
  pdf: 'pdf', word: 'doc docx odt rtf', excel: 'xls xlsx xlsm xlsb ods',
  powerpoint: 'ppt pptx odp', csv: 'csv tsv', text: 'txt text log json xml yaml yml md',
  image: 'jpg jpeg png gif webp bmp tif tiff heic heif avif svg ico',
  archive: 'zip rar 7z tar gz tgz bz2 xz', audio: 'mp3 wav m4a aac ogg flac wma aiff opus',
  video: 'mp4 mov avi mkv wmv webm mpeg mpg m4v 3gp ts mts m2ts ogv',
})) for (const extension of extensions.split(' ')) extensionCategories[extension] = category as FileCategory;

export function fileExtension(name: string): string {
  const position = name.lastIndexOf('.');
  return position > 0 ? name.slice(position + 1).toLowerCase() : '';
}

// Prefer specific stored MIME metadata. Missing/generic MIME values use the
// final extension, never a substring such as "report.pdf.exe". This is display
// classification only; preview authorization/content validation remain server-side.
export function fileCategory(entry: Pick<FileEntry, 'name' | 'mimeType' | 'isFolder'>): FileCategory {
  if (entry.isFolder) return 'folder';
  const mime = entry.mimeType.toLowerCase().split(';')[0].trim();
  // Windows sometimes labels CSV with Excel's legacy MIME. The final CSV
  // extension disambiguates that shared type; specific modern MIME wins below.
  if (['application/vnd.ms-excel', 'application/msexcel'].includes(mime) && fileExtension(entry.name) === 'csv') return 'csv';
  if (mimeCategories[mime]) return mimeCategories[mime];
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const extension = extensionCategories[fileExtension(entry.name)];
  if (!mime || ['application/octet-stream', 'binary/octet-stream', 'application/x-empty'].includes(mime)) return extension ?? 'other';
  if (mime === 'text/plain') return extension === 'csv' ? 'csv' : 'text';
  if (mime.startsWith('text/')) return 'text';
  return 'other';
}

export const fileCategoryLabels: Record<FileCategory, string> = {
  folder: 'Folder', pdf: 'PDF document', word: 'Word document', excel: 'Excel workbook',
  powerpoint: 'PowerPoint presentation', text: 'Text document', csv: 'CSV spreadsheet',
  image: 'Image', archive: 'Archive', audio: 'Audio', video: 'Video', other: 'File',
};
