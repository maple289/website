import { useState } from 'react';
import { AlertCircle, CheckCircle2, Film, Globe, LoaderCircle, Lock, Pencil, Play, Trash2 } from 'lucide-react';
import type { Video } from '@/lib/types';
import { formatBytes, timeAgo } from '@/lib/types';
import { StorageImage } from '@/components/StorageImage';

function VideoPoster({ video }: { video: Video }) {
  const [failed, setFailed] = useState(false);
  const placeholder = <div className="mg-placeholder"><Film size={32} /></div>;
  return failed ? placeholder : <StorageImage storagePath={video.preview_path} legacyUrl={video.preview_url} alt={video.file_name}
    loading="lazy" className="mg-image" onError={() => setFailed(true)} fallback={placeholder} />;
}

export function MediaVideoCard({ video, onPlay, onEdit, onDelete, showOwner = false }: {
  video: Video; onPlay: () => void; onEdit?: () => void; onDelete?: () => void; showOwner?: boolean;
}) {
  const ready = video.processing_status === 'ready';
  const failed = video.processing_status === 'error';
  const status = ready ? 'Ready' : failed ? 'Processing Failed' : 'Processing';
  const seconds = Math.max(0, Math.floor(video.duration_seconds ?? 0));
  const duration = seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <article className="mg-card">
    <button className="mg-thumbnail mg-video-thumbnail" onClick={onPlay} disabled={!ready} aria-label={ready ? `Play ${video.file_name}` : `${video.file_name}: ${status}`}>
      {ready ? <VideoPoster key={`${video.id}:${video.preview_path}:${video.preview_url}`} video={video} /> : <div className="mg-placeholder mg-processing">
        {failed ? <AlertCircle size={28} /> : <LoaderCircle size={28} className="animate-spin" />}<span>{status}</span>
      </div>}
      {ready && <span className="mg-play"><Play size={18} fill="currentColor" /></span>}
      <span className={`mg-badge mg-privacy ${video.visibility}`}>
        {video.visibility === 'public' ? <Globe size={11} /> : <Lock size={11} />}{video.visibility === 'public' ? 'Public' : 'Private'}
      </span>
      {ready && video.duration_seconds != null && <span className="mg-duration">{duration}</span>}
    </button>
    <div className="mg-card-body">
      <div className="mg-status-row"><span className={`mg-state ${ready ? 'ready' : failed ? 'failed' : 'processing'}`} role="status">
        {ready ? <CheckCircle2 size={12} /> : failed ? <AlertCircle size={12} /> : <LoaderCircle size={12} className="animate-spin" />}{status}
      </span></div>
      <h3 className="mg-title" title={video.file_name}>{video.file_name}</h3>
      {showOwner && <p className="mg-meta" title={video.owner_email ?? ''}>{video.owner_email ?? 'Unknown'}</p>}
      <p className="mg-meta">{!showOwner && `${formatBytes(video.file_size)} · `}{timeAgo(video.created_at)}</p>
      {failed && video.processing_error && !showOwner && <p className="mg-error">{video.processing_error}</p>}
      {(onEdit || onDelete) && <div className="mg-actions">
        {onEdit && <button onClick={onEdit}><Pencil size={13} />Edit</button>}
        <button onClick={onPlay} disabled={!ready}><Play size={13} />Play</button>
        {onDelete && <button className="mg-delete" onClick={onDelete}><Trash2 size={13} />Delete</button>}
      </div>}
    </div>
  </article>;
}
