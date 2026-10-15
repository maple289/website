import { useRef, type RefObject } from 'react';
import { Maximize, Minimize, PictureInPicture2 } from 'lucide-react';
import { useVideoPresentation } from '@/hooks/useVideoPresentation';
import { useVideoControlsAutoHide } from '@/hooks/useVideoControlsAutoHide';
import './VideoPresentationControls.css';

export function VideoPresentationControls({ videoRef, surfaceRef, source }: {
  videoRef: RefObject<HTMLVideoElement>; surfaceRef: RefObject<HTMLElement>; source: string | null | undefined;
}) {
  const mode = useVideoPresentation(videoRef, surfaceRef, source);
  const controlsRef = useRef<HTMLDivElement>(null);
  useVideoControlsAutoHide(videoRef, surfaceRef, controlsRef, source, mode.fullscreen, mode.error);
  const style = 'flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-white/15 disabled:opacity-50';
  return <div ref={controlsRef} className="video-presentation-controls shrink-0 bg-black px-2 py-1 text-white">
    <div className="flex flex-wrap items-center justify-end gap-1">
      {mode.canFullscreen && <button type="button" className={style} aria-label={mode.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={mode.pip ? 'Exit picture-in-picture first' : undefined} disabled={mode.pip} onClick={mode.toggleFullscreen}>
        {mode.fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}{mode.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      </button>}
      {mode.canPip && <button type="button" className={style} aria-label={mode.pip ? 'Exit picture-in-picture' : 'Enter picture-in-picture'}
        title={mode.fullscreen ? 'Exit fullscreen first' : undefined} disabled={mode.fullscreen} onClick={mode.togglePip}>
        <PictureInPicture2 size={18} />{mode.pip ? 'Exit PiP' : 'Picture-in-picture'}
      </button>}
    </div>
    {mode.error && <p role="alert" className="px-3 py-1 text-sm text-amber-300">{mode.error}</p>}
  </div>;
}
