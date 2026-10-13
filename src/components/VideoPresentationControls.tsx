import { useEffect, useState, type RefObject } from 'react';
import { Maximize, Minimize, PictureInPicture2, Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { useVideoPresentation } from '@/hooks/useVideoPresentation';
import './VideoPresentationControls.css';

function timeLabel(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function VideoPresentationControls({ videoRef, surfaceRef, source, closing }: {
  videoRef: RefObject<HTMLVideoElement>; surfaceRef: RefObject<HTMLElement>;
  source: string | null | undefined; closing: boolean;
}) {
  const mode = useVideoPresentation(videoRef, surfaceRef, source);
  const [playback, setPlayback] = useState({ paused: true, muted: false, volume: 1, time: 0, duration: 0 });
  const [playError, setPlayError] = useState('');
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let active = true;
    const update = () => {
      if (active) setPlayback({ paused: video.paused, muted: video.muted, volume: video.volume,
        time: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0 });
    };
    const playing = () => { setPlayError(''); update(); };
    const events = ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'pause', 'volumechange', 'ended'];
    for (const name of events) video.addEventListener(name, update);
    video.addEventListener('playing', playing);
    update(); setPlayError('');
    return () => {
      active = false;
      for (const name of events) video.removeEventListener(name, update);
      video.removeEventListener('playing', playing);
    };
  }, [source, videoRef]);
  const busy = closing || mode.fullscreenPending || mode.pipPending;
  const style = 'flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-white/15 disabled:opacity-50';
  return <div className="video-presentation-controls shrink-0 bg-black px-2 py-1 text-white">
    <div className="flex items-center gap-3 px-3">
      <input type="range" aria-label="Video position" min={0} max={playback.duration || 0} step={0.1}
        value={Math.min(playback.time, playback.duration)} disabled={closing || !playback.duration}
        className="min-h-11 min-w-0 flex-1 accent-blue-400" onChange={event => {
          if (videoRef.current) videoRef.current.currentTime = Number(event.target.value);
        }} />
      <span className="shrink-0 text-xs tabular-nums">{timeLabel(playback.time)} / {timeLabel(playback.duration)}</span>
    </div>
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" className={style} aria-label={playback.paused ? 'Play video' : 'Pause video'} disabled={closing} onClick={() => {
        const video = videoRef.current;
        if (!video) return;
        if (!video.paused) video.pause();
        else void video.play().catch(reason => {
          if (videoRef.current !== video) return;
          setPlayError('Playback could not start. Please try again.');
          if (import.meta.env.DEV) console.warn('Video playback request failed', reason);
        });
      }}>{playback.paused ? <Play size={18} /> : <Pause size={18} />}</button>
      <button type="button" className={style} aria-label={playback.muted ? 'Unmute video' : 'Mute video'} disabled={closing} onClick={() => {
        if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
      }}>{playback.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
      <input type="range" aria-label="Video volume" min={0} max={1} step={0.05} value={playback.volume} disabled={closing}
        className="video-volume-slider min-h-11 w-20 accent-blue-400" onChange={event => {
          if (videoRef.current) videoRef.current.volume = Number(event.target.value);
        }} />
      <span className="flex-1" />
      {mode.canFullscreen && <button type="button" className={style} aria-label={mode.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={mode.pip ? 'Exit picture-in-picture first' : undefined} disabled={busy || mode.pip} onClick={mode.toggleFullscreen}>
        {mode.fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}{mode.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      </button>}
      {mode.canPip && <button type="button" className={style} aria-label={mode.pip ? 'Exit picture-in-picture' : 'Enter picture-in-picture'}
        title={mode.fullscreen ? 'Exit fullscreen first' : undefined} disabled={busy || mode.fullscreen} onClick={mode.togglePip}>
        <PictureInPicture2 size={18} />{mode.pip ? 'Exit PiP' : 'Picture-in-picture'}
      </button>}
    </div>
    {(mode.error || playError) && <p role="alert" className="px-3 py-1 text-sm text-amber-300">{mode.error || playError}</p>}
  </div>;
}
