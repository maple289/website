export type NativeVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitPresentationMode?: 'inline' | 'fullscreen' | 'picture-in-picture';
  webkitSetPresentationMode?: (mode: 'inline' | 'fullscreen' | 'picture-in-picture') => void;
  webkitSupportsPresentationMode?: (mode: 'inline' | 'fullscreen' | 'picture-in-picture') => boolean;
  webkitEnterFullscreen?: () => void;
  webkitEnterFullScreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitExitFullScreen?: () => void;
};
export type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void | Promise<void>;
  webkitCancelFullScreen?: () => void;
};
export type NativeFullscreenState = { mode: 'unknown' | 'fullscreen' | 'inline' | 'picture-in-picture' };

const pendingPresentation = new WeakMap<HTMLVideoElement, { promise: Promise<void>; settle: () => void }>();
export function beginVideoPresentation(video: HTMLVideoElement) {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  const operation = { promise, settle: () => {
    if (pendingPresentation.get(video) === operation) pendingPresentation.delete(video);
    resolve();
  } };
  pendingPresentation.set(video, operation);
  return operation;
}

export async function waitForVideoPresentation(video: HTMLVideoElement, signal: AbortSignal) {
  const operation = pendingPresentation.get(video);
  if (!operation) return;
  await new Promise<void>((resolve, reject) => {
    const aborted = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { signal.removeEventListener('abort', aborted); aborted(); return; }
    void operation.promise.then(() => { signal.removeEventListener('abort', aborted); resolve(); });
  });
}

export function isNativeVideoFullscreen(video: NativeVideo, state: NativeFullscreenState) {
  // An exit event is authoritative even if WebKit's readonly flags lag behind.
  if (state.mode !== 'unknown') return state.mode === 'fullscreen';
  return video.webkitPresentationMode === 'fullscreen' || !!video.webkitDisplayingFullscreen;
}

export function updateNativePresentation(video: NativeVideo, state: NativeFullscreenState) {
  if (video.webkitPresentationMode) state.mode = video.webkitPresentationMode;
}

export async function exitPlayerPictureInPicture(video: NativeVideo, state: NativeFullscreenState, signal: AbortSignal) {
  const doc = video.ownerDocument;
  const active = () => doc.pictureInPictureElement === video || state.mode === 'picture-in-picture' ||
    (state.mode === 'unknown' && video.webkitPresentationMode === 'picture-in-picture');
  if (!active()) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      video.removeEventListener('leavepictureinpicture', left);
      video.removeEventListener('webkitpresentationmodechanged', changed);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve();
    };
    const changed = () => { updateNativePresentation(video, state); if (!active()) finish(); };
    const left = () => { state.mode = 'inline'; if (!active()) finish(); };
    const aborted = () => finish(new DOMException('Aborted', 'AbortError'));
    // Bound cleanup failure; never schedule a new entry or estimate playback end.
    const timer = setTimeout(() => active() ? finish(new Error('Picture-in-picture did not exit.')) : finish(), 2000);
    video.addEventListener('leavepictureinpicture', left);
    video.addEventListener('webkitpresentationmodechanged', changed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    try {
      const exit = doc.pictureInPictureElement === video && doc.exitPictureInPicture
        ? doc.exitPictureInPicture()
        : video.webkitSetPresentationMode ? video.webkitSetPresentationMode('inline')
        : Promise.reject(new Error('Picture-in-picture exit is unavailable.'));
      void Promise.resolve(exit).then(changed, finish);
    } catch (error) { finish(error); }
  });
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
