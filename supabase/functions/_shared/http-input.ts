export class InputError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function readSmallJson(request: Request, maximum = 8192): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') || 0) > maximum) throw new InputError(413, 'Request too large');
  const reader = request.body?.getReader();
  if (!reader) throw new InputError(400, 'Invalid request');
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new InputError(413, 'Request too large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new InputError(400, 'Invalid request'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError(400, 'Invalid request');
  return body as Record<string, unknown>;
}
