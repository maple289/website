import { useEffect, useState } from 'react';
import { Loader2, Play, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Video } from '@/lib/types';
import { getPlayableUrl } from '@/lib/types';

type VideoPlayerProps = {
  video: Video;
  onClose: () => void;
};

export function VideoPlayer({ video, onClose }: VideoPlayerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const playable = await getPlayableUrl(video.id, token);
      if (!active) return;
      if (playable) {
        setUrl(playable);
        setLoading(false);
      } else {
        setError('Unable to load this video. It may be private or no longer available.');
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [video.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-[#2e2e2e] bg-[#0a0a0a] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4">
          <h3 className="truncate text-base font-semibold tracking-[-0.02em]">{video.file_name}</h3>
          <button onClick={onClose} className="rounded-full p-2 text-[#a7a7a7] hover:bg-[#2a2a2a] hover:text-white"><X size={20} /></button>
        </div>
        <div className="aspect-video w-full bg-black">
          {loading ? (
            <div className="flex h-full items-center justify-center"><Loader2 size={32} className="animate-spin text-[#ff3d46]" /></div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <Play size={40} className="text-[#444]" />
              <p className="text-sm text-[#888]">{error}</p>
            </div>
          ) : (
            <video src={url ?? undefined} controls autoPlay className="h-full w-full" />
          )}
        </div>
      </div>
    </div>
  );
}
