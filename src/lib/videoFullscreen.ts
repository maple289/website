export type NativeVideo = HTMLVideoElement & {
  webkitSupportsFullscreen?: boolean;
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
export type FullscreenSurface = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };

const pageViewports = new WeakMap<HTMLElement, () => void>();
const viewportProperties = ['--video-viewport-left', '--video-viewport-top', '--video-viewport-width', '--video-viewport-height'];

function trackPageViewport(surface: HTMLElement) {
  const doc = surface.ownerDocument as FullscreenDocument, view = doc.defaultView;
  const viewport = view?.visualViewport;
  if (!view || !viewport || !view.matchMedia('(pointer: coarse)').matches) return;
  let frame = 0;
  const clear = () => { for (const name of viewportProperties) surface.style.removeProperty(name); };
  const update = () => {
    frame = 0;
    // Real element fullscreen is sized by the browser. Only fit the mobile
    // page fallback to the visible area, which can differ from 100vw/100dvh.
    if (doc.fullscreenElement || doc.webkitFullscreenElement) { clear(); return; }
    // Do not chase a pinch with layout changes or counteract accessibility zoom.
    if (Math.abs(viewport.scale - 1) > .01) return;
    const values = [viewport.offsetLeft, viewport.offsetTop, viewport.width, viewport.height];
    if (!values.every(Number.isFinite) || viewport.width <= 0 || viewport.height <= 0) return;
    values.forEach((value, i) => surface.style.setProperty(viewportProperties[i], `${value}px`));
  };
  const schedule = () => { if (!frame) frame = view.requestAnimationFrame(update); };
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  view.addEventListener('resize', schedule);
  view.addEventListener('orientationchange', schedule);
  doc.addEventListener('fullscreenchange', schedule);
  doc.addEventListener('webkitfullscreenchange', schedule);
  update();
  return () => {
    view.cancelAnimationFrame(frame);
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    view.removeEventListener('resize', schedule);
    view.removeEventListener('orientationchange', schedule);
    doc.removeEventListener('fullscreenchange', schedule);
    doc.removeEventListener('webkitfullscreenchange', schedule);
    clear();
  };
}

export function setVideoPageFullscreen(surface: HTMLElement, fullscreen: boolean) {
  surface.classList.toggle('video-page-fullscreen', fullscreen);
  surface.closest('[data-task-modal]')?.classList.toggle('video-page-fullscreen-layer', fullscreen);
  if (fullscreen && !pageViewports.has(surface)) {
    const stop = trackPageViewport(surface);
    if (stop) pageViewports.set(surface, stop);
  } else if (!fullscreen) {
    pageViewports.get(surface)?.();
    pageViewports.delete(surface);
  }
}

function attemptCleanup(action: () => unknown) {
  try { void Promise.resolve(action()).catch(() => { /* Browser cleanup must never block closing the player. */ }); }
  catch { /* Try the remaining independent cleanup operations. */ }
}

export function closeVideoPresentation(video: NativeVideo, root: HTMLElement | null) {
  const surface = video.closest<HTMLElement>('.video-fullscreen-surface');
  if (surface) setVideoPageFullscreen(surface, false);
  const doc = video.ownerDocument as FullscreenDocument;
  if (doc.pictureInPictureElement === video && doc.exitPictureInPicture) attemptCleanup(() => doc.exitPictureInPicture());
  const element = doc.fullscreenElement ?? doc.webkitFullscreenElement;
  const ownsFullscreen = !!element && (!!root?.contains(element) || element.contains(video));
  const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen ?? doc.webkitCancelFullScreen;
  if (ownsFullscreen && exit) attemptCleanup(() => exit.call(doc));
  if (video.webkitDisplayingFullscreen || video.webkitPresentationMode === 'fullscreen' || video.webkitPresentationMode === 'picture-in-picture') {
    if (video.webkitSetPresentationMode) attemptCleanup(() => video.webkitSetPresentationMode!('inline'));
    if (video.webkitExitFullscreen) attemptCleanup(() => video.webkitExitFullscreen!());
    if (video.webkitExitFullScreen && video.webkitExitFullScreen !== video.webkitExitFullscreen) attemptCleanup(() => video.webkitExitFullScreen!());
  }
}

export function releaseVideo(video: HTMLVideoElement) {
  attemptCleanup(() => video.pause());
  attemptCleanup(() => video.removeAttribute('src'));
  attemptCleanup(() => video.load());
}
