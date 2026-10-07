function appBasePath(base: string): string {
  const path = new URL(base || '/', 'https://app.invalid/').pathname;
  return path.endsWith('/') ? path : `${path}/`;
}

export function temporarySharePath(token: string, base: string): string {
  return `${appBasePath(base)}share/${encodeURIComponent(token)}`;
}

export function temporaryShareRoute(pathname: string, base: string): { token: string } | null {
  const prefix = `${appBasePath(base)}share/`;
  if (pathname !== prefix.slice(0, -1) && !pathname.startsWith(prefix)) return null;
  // Malformed share routes still render the isolated unavailable-link page.
  return { token: pathname.slice(prefix.length).match(/^([a-f0-9]{64})\/?$/)?.[1] ?? '' };
}
