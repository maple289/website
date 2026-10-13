export type NativeVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitPresentationMode?: 'inline' | 'fullscreen' | 'picture-in-picture';
  webkitSetPresentationMode?: (mode: 'inline') => void;
  webkitExitFullscreen?: () => void;
  webkitExitFullScreen?: () => void;
};
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void | Promise<void>;
  webkitCancelFullScreen?: () => void;
};
export type NativeFullscreenState = { mode: 'unknown' | 'fullscreen' | 'inline' };

export function isNativeVideoFullscreen(video: NativeVideo, state: NativeFullscreenState) {
  // An exit event is authoritative even if WebKit's readonly flags lag behind.
  if (state.mode !== 'unknown') return state.mode === 'fullscreen';
  return video.webkitPresentationMode === 'fullscreen' || !!video.webkitDisplayingFullscreen;
}

export function updateNativePresentation(video: NativeVideo, state: NativeFullscreenState) {
  if (video.webkitPresentationMode) state.mode = video.webkitPresentationMode === 'fullscreen' ? 'fullscreen' : 'inline';
}

export async function exitPlayerFullscreen(video: NativeVideo, root: HTMLElement | null, state: NativeFullscreenState, signal: AbortSignal) {
  const doc = video.ownerDocument as FullscreenDocument;
  const element = () => doc.fullscreenElement ?? doc.webkitFullscreenElement;
  const ownsFullscreen = () => !!element() && (!!root?.contains(element()!) || !!element()?.contains(video));
  const active = () => ownsFullscreen() || isNativeVideoFullscreen(video, state);
  if (!active()) return;
  const exits: Array<() => void | Promise<void>> = [];
  const documentExit = doc.exitFullscreen ?? doc.webkitExitFullscreen ?? doc.webkitCancelFullScreen;
  if (ownsFullscreen() && documentExit) exits.push(() => documentExit.call(doc));
  if (isNativeVideoFullscreen(video, state) || element() === video) {
    if (video.webkitSetPresentationMode) exits.push(() => video.webkitSetPresentationMode!('inline'));
    if (video.webkitExitFullscreen) exits.push(() => video.webkitExitFullscreen!());
    if (video.webkitExitFullScreen && video.webkitExitFullScreen !== video.webkitExitFullscreen) exits.push(() => video.webkitExitFullScreen!());
  }
  let failure = new Error('Fullscreen exit is unavailable.');
  for (const exit of exits) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!active()) return;
    try {
      await new Promise<void>((resolve, reject) => {
        const previousPresentation = video.webkitPresentationMode;
        const previousDisplaying = video.webkitDisplayingFullscreen;
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          doc.removeEventListener('fullscreenchange', changed);
          doc.removeEventListener('webkitfullscreenchange', changed);
          video.removeEventListener('webkitendfullscreen', nativeExited);
          video.removeEventListener('webkitpresentationmodechanged', presentationChanged);
          signal.removeEventListener('abort', aborted);
          if (error) reject(error); else resolve();
        };
        const changed = () => { if (!active()) finish(); };
        const nativeExited = () => { state.mode = 'inline'; changed(); };
        const presentationChanged = () => { updateNativePresentation(video, state); changed(); };
        const aborted = () => finish(new DOMException('Aborted', 'AbortError'));
        // This bounds an API exit attempt, never playback duration. Try another
        // supported API if an advertised method is ineffective or rejects.
        const timer = setTimeout(() => {
          // Preserve flag-only exits on browsers that omit the native event.
          if ((previousPresentation === 'fullscreen' && video.webkitPresentationMode === 'inline') ||
            (previousDisplaying === true && video.webkitDisplayingFullscreen === false)) state.mode = 'inline';
          if (active()) finish(new Error('Fullscreen did not exit.')); else finish();
        }, 2000);
        doc.addEventListener('fullscreenchange', changed);
        doc.addEventListener('webkitfullscreenchange', changed);
        video.addEventListener('webkitendfullscreen', nativeExited);
        video.addEventListener('webkitpresentationmodechanged', presentationChanged);
        signal.addEventListener('abort', aborted, { once: true });
        try { void Promise.resolve(exit()).then(changed, error => active() ? finish(error) : finish()); }
        catch (error) { if (active()) finish(error instanceof Error ? error : failure); else finish(); }
      });
      return;
    } catch (error) {
      if (signal.aborted) throw error;
      failure = error instanceof Error ? error : failure;
    }
  }
  if (active()) throw failure;
}
