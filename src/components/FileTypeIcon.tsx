import { File, FileArchive, FileAudio, FileImage, FileVideo, Folder } from 'lucide-react';
import type { FileEntry } from '@/lib/fileTree';
import { fileCategory, fileCategoryLabels } from '@/lib/fileTypes';

const documents = {
  pdf: { label: 'PDF', color: '#DC4545' }, word: { label: 'W', color: '#2563B8' },
  excel: { label: 'X', color: '#188451' }, powerpoint: { label: 'P', color: '#CB5735' },
  text: { label: 'TXT', color: '#64748B' }, csv: { label: 'CSV', color: '#0D8C88' },
};

export function FileTypeIcon({ entry, size = 24, className = '' }: {
  entry: Pick<FileEntry, 'name' | 'mimeType' | 'isFolder'>; size?: number; className?: string;
}) {
  const category = fileCategory(entry), label = fileCategoryLabels[category];
  const common = { size, role: 'img', 'aria-label': label, className: `shrink-0 ${className}` };
  if (category === 'folder') return <Folder {...common} strokeWidth={1.5} className={`fill-[#FFD45A] text-[#D99A18] drop-shadow-sm ${common.className}`} />;
  if (category in documents) {
    const document = documents[category as keyof typeof documents];
    return <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={label} className={common.className}>
      <path d="M6 2.5h9l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1-1.5Z" fill={document.color} fillOpacity=".08" stroke={document.color} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M15 2.5V8h5" fill="none" stroke={document.color} strokeWidth="1.4" strokeLinejoin="round" />
      <rect x="1.5" y="10" width="17" height="9" rx="2" fill={document.color} />
      <text x="10" y="16.6" textAnchor="middle" fill="white" fontFamily="Arial, sans-serif" fontSize={document.label.length > 1 ? '5.7' : '7.5'} fontWeight="700">{document.label}</text>
    </svg>;
  }
  if (category === 'image') return <FileImage {...common} color="#8960C5" />;
  if (category === 'archive') return <FileArchive {...common} color="#B7791F" />;
  if (category === 'audio') return <FileAudio {...common} color="#C07E19" />;
  if (category === 'video') return <FileVideo {...common} color="#C35076" />;
  return <File {...common} color="#94A3B8" />;
}
