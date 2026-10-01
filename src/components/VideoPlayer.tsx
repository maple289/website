import { TaskModal } from '@/components/TaskModal';
import { MediaReactions } from './MediaReactions';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Play, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Video } from '@/lib/types';
import { getPlayableUrl } from '@/lib/types';
import { useVideoVolume } from '@/hooks/useVideoVolume';

type VideoPlayerProps = {
  video: Video;
  onClose: () => void;
};

export function VideoPlayer({ video, onClose }: VideoPlayerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);

  useVideoVolume(videoRef, url);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setUrl(null);
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const playable = await getPlayableUrl(video.id, token);
        if (!active) return;
        if (playable) {
          setUrl(playable);
          setLoading(false);
        } else if (video.processing_status === 'processing') {
          setError('This video is still being processed. Please check back in a moment.');
          setLoading(false);
        } else if (video.processing_status === 'error') {
          setError('This video could not be processed and is unavailable.');
          setLoading(false);
        } else {
          setError('Unable to load this video. It may be private or no longer available.');
          setLoading(false);
        }
      } catch {
        if (active) { setError('Unable to load this video. Check your connection and try again.'); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [video.id, video.processing_status, attempt]);



  return (
    <TaskModal aria-label="Video player" className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-md" />
      <div className="video-player-surface relative w-full max-w-4xl max-h-[95dvh] overflow-y-auto rounded-2xl border bg-[#0a0a0a] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4">
          <h3 className="truncate text-base font-semibold tracking-[-0.02em]">{video.file_name}</h3>
          <button aria-label="Close video player" onClick={onClose} className="min-h-11 min-w-11 shrink-0 rounded-full p-2 text-[#a7a7a7] hover:bg-[#2a2a2a] hover:text-white"><X size={20} /></button>
        </div>
        <div className="aspect-video w-full bg-black">
          {loading ? (
            <div className="flex h-full items-center justify-center"><Loader2 size={32} className="animate-spin text-blue-400" /></div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <Play size={40} className="text-[#444]" />
              <p role="alert" className="px-4 text-center text-sm text-[#888]">{error}</p>
              <button onClick={() => setAttempt(value => value + 1)} className="min-h-11 rounded-xl border border-slate-600 px-5 text-sm text-white">Retry</button>
            </div>
          ) : (
            <video ref={videoRef} src={url ?? undefined} controls autoPlay className="h-full w-full" />
          )}
        </div>
        <div className="video-reactions"><MediaReactions mediaType="video" mediaId={video.id} mediaName={video.file_name} /></div>
      </div>
    </TaskModal>
  );
}
