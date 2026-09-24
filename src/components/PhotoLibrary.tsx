import { FileDropArea } from '@/components/FileDropArea';
import { useCallback, useEffect, useState } from 'react';
import { Globe, Image as ImageIcon, Loader2, Lock, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Photo } from '@/lib/types';
import { formatBytes, timeAgo } from '@/lib/types';
import { StorageImage } from '@/components/StorageImage';
import { PhotoUploadModal } from '@/components/PhotoUploadModal';
import { EditPhotoModal } from '@/components/EditPhotoModal';
import { PhotoViewer } from '@/components/PhotoViewer';
import { useAuth } from '@/hooks/useAuth';
import { resolveBucketPath } from '@/lib/storageSettings';

export function PhotoLibrary({ searchTerm }: { searchTerm: string }) {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
  const [success, setSuccess] = useState('');
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    if (!user) {
      setPhotos([]);
      setLoading(false);
      return;
    }
    const { data, error: loadError } = await supabase.from('photos').select('*').eq('owner_id', user.id).order('created_at', { ascending: false });
    setError(loadError ? 'Could not load your photos.' : null);
    if (!loadError) setPhotos(data ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const refresh = (event: Event) => { if ((event as CustomEvent).detail === 'photo') void load(); };
    window.addEventListener('media-uploaded', refresh);
    return () => window.removeEventListener('media-uploaded', refresh);
  }, [load]);

  const filteredPhotos = photos.filter((photo) => {
    const term = searchTerm.trim().toLowerCase();
    return !term || photo.file_name.toLowerCase().includes(term);
  });

  const toggleVisibility = async (photo: Photo) => {
    const visibility = photo.visibility === 'public' ? 'private' : 'public';
    const { error: updateError } = await supabase.from('photos').update({ visibility }).eq('id', photo.id);
    if (updateError) setError('Could not change photo visibility.');
    else load();
  };

  const remove = async (photo: Photo) => {
    if (!window.confirm(`Delete "${photo.file_name}" permanently?`)) return;
    const { error: deleteError } = await supabase.from('photos').delete().eq('id', photo.id);
    if (deleteError) {
      setError('Could not delete the photo.');
      return;
    }
    await supabase.storage.from('user-images').remove([
      await resolveBucketPath(photo.storage_path, 'images'),
      await resolveBucketPath(photo.preview_path, 'images'),
      await resolveBucketPath(photo.thumbnail_path, 'images'),
    ]);
    load();
  };

  return (
    <FileDropArea appearance="media" message="Drop photos here to upload" enabled={!!user && !showUpload && !editingPhoto && viewingIndex === null} onFiles={(files) => { setDroppedFiles(files); setShowUpload(true); }}>
    <div className="mg-page">
      <div className="mg-toolbar">
        <div><h1 className="text-2xl font-semibold tracking-[-0.04em]">My Photos</h1><p className="mt-1 text-sm text-[#888]">Your photos, organized in one place.</p></div>
        <button onClick={() => { setDroppedFiles([]); setShowUpload(true); }} className="flex h-11 items-center gap-2 rounded-xl bg-[#ff3d46] px-4 text-sm font-semibold text-white"><Upload size={17} /> Upload photo</button>
      </div>
      {success && <div role="status" className="mb-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{success}</div>}
      {error && <div className="mb-5 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">{error}</div>}
      {loading ? <div className="flex justify-center py-24"><Loader2 className="animate-spin text-[#ff3d46]" /></div> : filteredPhotos.length === 0 ? (
        <div className="mg-empty rounded-2xl border border-dashed py-24 text-center"><ImageIcon className="mx-auto mb-3 text-[#555]" size={38} /><p className="text-[#aaa]">{searchTerm ? 'No matching photos' : 'Your photo library is empty'}</p>{!searchTerm && <button onClick={() => { setDroppedFiles([]); setShowUpload(true); }} className="mx-auto mt-5 flex items-center gap-2 rounded-xl bg-[#ff3d46] px-5 py-2.5 text-sm font-semibold"><Plus size={17} /> Upload photo</button>}</div>
      ) : (
        <div className="mg-grid">
          {filteredPhotos.map((photo, index) => (
            <article key={photo.id} className="mg-card">
              <button onClick={() => setViewingIndex(index)} className="mg-thumbnail">
                <StorageImage storagePath={photo.preview_path ?? photo.thumbnail_path ?? photo.storage_path} alt={photo.file_name} className="mg-image" loading="lazy" fallback={<ImageIcon className="mx-auto text-[#555]" />} />
                <span className={`mg-badge mg-privacy ${photo.visibility}`}>{photo.visibility === 'public' ? <Globe size={11} /> : <Lock size={11} />}{photo.visibility === 'public' ? 'Public' : 'Private'}</span>
              </button>
              <div className="mg-card-body"><h3 className="mg-title" title={photo.file_name}>{photo.file_name}</h3><p className="mg-meta">{formatBytes(photo.file_size)} · {timeAgo(photo.created_at)}</p>
                <div className="mg-actions">
                  <button onClick={() => toggleVisibility(photo)} className="flex items-center gap-1.5 rounded-full bg-[#242424] px-3 py-1.5 text-xs text-[#aaa]">{photo.visibility === 'public' ? <Globe size={13} /> : <Lock size={13} />}{photo.visibility === 'public' ? 'Public' : 'Private'}</button>
                  {photo.owner_id === user?.id && <button onClick={() => { setSuccess(''); setError(null); setEditingPhoto(photo); }} className="flex items-center gap-1.5 rounded-full bg-[#242424] px-3 py-1.5 text-xs font-medium text-[#aaa] transition hover:bg-[#2a2a2a] hover:text-white"><Pencil size={13} /> Edit</button>}
                  <button onClick={() => remove(photo)} className="flex items-center gap-1.5 rounded-full bg-[#242424] px-3 py-1.5 text-xs text-[#aaa] hover:text-[#ff737b]"><Trash2 size={13} /> Delete</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {editingPhoto && <div className="mg-dialog"><EditPhotoModal key={editingPhoto.id} photo={editingPhoto} onClose={() => setEditingPhoto(null)} onSaved={(updated) => { setPhotos((current) => current.map((photo) => photo.id === updated.id ? updated : photo)); setEditingPhoto(null); setError(null); setSuccess('Photo changes saved.'); }} /></div>}
      {showUpload && <div className="mg-dialog"><PhotoUploadModal initialFiles={droppedFiles} onItemUploaded={() => void load()} onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); load(); }} /></div>}
      {viewingIndex !== null && viewingIndex < filteredPhotos.length && (
        <PhotoViewer photos={filteredPhotos} startIndex={viewingIndex} onClose={() => setViewingIndex(null)} />
      )}
    </div>
    </FileDropArea>
  );
}
