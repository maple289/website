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

function attemptCleanup(action: () => unknown) {
  try { void Promise.resolve(action()).catch(() => { /* Browser cleanup must never block closing the player. */ }); }
  catch { /* Try the remaining independent cleanup operations. */ }
}

export function closeVideoPresentation(video: NativeVideo, root: HTMLElement | null) {
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
