export function uploadFailureMessage(status = 0, timedOut = false): string {
  if (timedOut || status === 408 || status === 504) return 'Upload timed out. The server or proxy did not respond in time. Retry on a stable connection; contact the administrator if it repeats.';
  if (status === 401 || status === 403) return 'Upload was not authorized. Sign in again and retry.';
  if (status === 413) return 'The server or reverse proxy rejected the upload size. Contact the administrator to check upload limits.';
  if (status === 415) return 'The server rejected this media type. Check that this is a supported video or image.';
  if (status === 409) return 'An upload with this identifier already exists. Check your gallery before retrying.';
  if (status === 429) return 'Too many upload requests. Wait briefly and retry.';
  if (status >= 500) return `The upload service is unavailable (HTTP ${status}). Retry shortly.`;
  if (status) return `Upload failed (HTTP ${status}). Please retry or report this status to the administrator.`;
  return 'The upload connection was interrupted before a server response was received. Check your connection. If it repeats, ask the administrator to check the HTTPS/proxy upload logs; the browser cannot identify the server error.';
}
