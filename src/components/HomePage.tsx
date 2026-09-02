import { useEffect, useState } from 'react';
import { Film, Globe, Loader as Loader2, Play } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Video } from '@/lib/types';
import { timeAgo } from '@/lib/types';
import { VideoPlayer } from '@/components/VideoPlayer';
import { StorageImage } from '@/components/StorageImage';
import { PublicPhotoGallery } from '@/components/PublicPhotoGallery';

export function HomePage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [search] = useState('');
  const [playingVideo, setPlayingVideo] = useState<Video | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('visibility', 'public')
      .order('created_at', { ascending: false });
    if (!error) setVideos(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = videos.filter((v) => {
    const term = search.trim().toLowerCase();
    return !term || v.file_name.toLowerCase().includes(term) || (v.owner_email ?? '').toLowerCase().includes(term);
  });

  return (
    <div className="mx-auto max-w-[1560px] px-5 pb-14 lg:px-8">
      <section className="py-8 sm:py-10">
        <div className="mb-7">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#ff6971]">Public Gallery</p>
          <h1 className="text-[27px] font-semibold tracking-[-0.04em] sm:text-[34px]">Discover videos</h1>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-[#ff3d46]" /></div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#3b3b3b] py-24 text-center">
            <Film className="mx-auto mb-4 text-[#707070]" size={40} />
            <p className="text-lg font-medium">No public videos yet</p>
            <p className="mt-2 text-sm text-[#888]">Videos marked as public by users will appear here.</p>
          </div>
        ) : (
          <div className="grid gap-x-5 gap-y-10 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((v) => (
              <article key={v.id} className="group min-w-0 cursor-pointer" onClick={() => setPlayingVideo(v)}>
                <div className="relative aspect-video overflow-hidden rounded-xl bg-[#202020]">
                  <StorageImage
                    storagePath={v.preview_path}
                    legacyUrl={v.preview_url}
                    alt={v.file_name}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
                    fallback={<div className="flex h-full w-full items-center justify-center text-[#555]"><Film size={36} /></div>}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ff3d46]/90 text-white"><Play size={22} fill="white" /></div>
                  </div>
                  <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/85 px-2 py-1 text-[11px] font-semibold text-white">
                    <Globe size={11} /> Public
                  </span>
                </div>
                <div className="mt-4 flex gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#3a3a3a] to-[#222] text-sm font-semibold text-[#ccc]">
                    {(v.owner_email ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-2 text-[15px] font-semibold leading-[1.45] tracking-[-0.01em] text-[#f1f1f1]">{v.file_name}</h3>
                    <p className="mt-1.5 text-[13px] text-[#9c9c9c]">{v.owner_email ?? 'Unknown'}</p>
                    <p className="mt-0.5 text-[13px] text-[#858585]">{timeAgo(v.created_at)}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <PublicPhotoGallery />

      {playingVideo && (
        <VideoPlayer video={playingVideo} onClose={() => setPlayingVideo(null)} />
      )}
    </div>
  );
}
