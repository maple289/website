import { useEffect, useState } from 'react';
import { Globe, Image as ImageIcon, Loader2, Lock, Plus, Trash2, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Photo } from '@/lib/types';
import { formatBytes, timeAgo } from '@/lib/types';
import { StorageImage } from '@/components/StorageImage';
import { PhotoUploadModal } from '@/components/PhotoUploadModal';
import { PhotoViewer } from '@/components/PhotoViewer';
import { useAuth } from '@/hooks/useAuth';

export function PhotoLibrary() {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [viewing, setViewing] = useState<Photo | null>(null);

  const load = async () => {
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
  };

  useEffect(() => { load(); }, [user]);

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
    await supabase.storage.from('user-images').remove([photo.storage_path, photo.preview_path, photo.thumbnail_path]);
    load();
  };

  return (
    <div className="mx-auto max-w-[1560px] px-5 py-8 lg:px-8">
      <div className="mb-7 flex items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-[-0.04em]">My Photos</h1><p className="mt-1 text-sm text-[#888]">Originals, previews, and thumbnails are stored separately.</p></div>
        <button onClick={() => setShowUpload(true)} className="flex h-11 items-center gap-2 rounded-xl bg-[#ff3d46] px-4 text-sm font-semibold text-white"><Upload size={17} /> Upload photo</button>
      </div>
      {error && <div className="mb-5 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">{error}</div>}
      {loading ? <div className="flex justify-center py-24"><Loader2 className="animate-spin text-[#ff3d46]" /></div> : photos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#3b3b3b] py-24 text-center"><ImageIcon className="mx-auto mb-3 text-[#555]" size={38} /><p className="text-[#aaa]">Your photo library is empty</p><button onClick={() => setShowUpload(true)} className="mx-auto mt-5 flex items-center gap-2 rounded-xl bg-[#ff3d46] px-5 py-2.5 text-sm font-semibold"><Plus size={17} /> Upload photo</button></div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {photos.map((photo) => (
            <article key={photo.id} className="overflow-hidden rounded-2xl border border-[#272727] bg-[#161616]">
              <button onClick={() => setViewing(photo)} className="block aspect-[4/3] w-full overflow-hidden bg-[#202020]">
                <StorageImage storagePath={photo.thumbnail_path} alt={photo.file_name} className="h-full w-full object-cover transition duration-500 hover:scale-[1.03]" fallback={<ImageIcon className="mx-auto text-[#555]" />} />
              </button>
              <div className="p-4"><h3 className="truncate text-sm font-semibold">{photo.file_name}</h3><p className="mt-1 text-xs text-[#777]">{formatBytes(photo.file_size)} · {timeAgo(photo.created_at)}</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => toggleVisibility(photo)} className="flex items-center gap-1.5 rounded-full bg-[#242424] px-3 py-1.5 text-xs text-[#aaa]">{photo.visibility === 'public' ? <Globe size={13} /> : <Lock size={13} />}{photo.visibility === 'public' ? 'Public' : 'Private'}</button>
                  <button onClick={() => remove(photo)} className="flex items-center gap-1.5 rounded-full bg-[#242424] px-3 py-1.5 text-xs text-[#aaa] hover:text-[#ff737b]"><Trash2 size={13} /> Delete</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {showUpload && <PhotoUploadModal onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); load(); }} />}
      {viewing && <PhotoViewer photo={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
