import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Apikey, Content-Type, Range, X-Client-Info',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
  'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
const hash = async (token: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), x => x.toString(16).padStart(2, '0')).join('');
const safePath = (path: string, owner: string) => path.startsWith(`${owner}/`) && !path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'));
const unavailable = () => json({ error: 'This share link is no longer available.' }, 404);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  const base = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  try {
    if (req.method === 'POST') {
      const authorization = req.headers.get('Authorization') ?? '';
      const client = createClient(base, anon, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
      const { data: { user }, error: authError } = await client.auth.getUser();
      if (authError || !user) return json({ error: 'Please sign in again.' }, 401);
      const body = await req.json();
      if (!['video','photo','file','folder'].includes(body.type) || typeof body.id !== 'string' || body.id.length > 2048) return json({ error: 'Invalid content.' }, 400);
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
      const { data, error } = await client.rpc('create_temporary_share', { p_type: body.type, p_content: body.id, p_hash: await hash(token), p_previous: body.previous ?? null });
      if (error) return json({ error: error.code === '40001' ? 'An active link already exists. Close and reopen this dialog to confirm replacement.' : 'Only the owner can share available content.' }, error.code === '40001' ? 409 : 403);
      return json({ ...data, token });
    }
    if (!['GET','HEAD'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
    const url = new URL(req.url);
    const token = url.searchParams.get('token') ?? '';
    if (!/^[a-f0-9]{64}$/.test(token)) return unavailable();
    const admin = createClient(base, key, { auth: { persistSession: false } });
    const { data: link, error } = await admin.from('temporary_content_shares').select('*').eq('token_hash', await hash(token)).maybeSingle();
    if (error || !link || link.revoked_at) return unavailable();
    if (Date.now() >= Date.parse(link.expires_at)) return json({ error: 'This share link has expired.' }, 410);
    let path = '', bucket = '', name = '', mime = '';
    const child = url.searchParams.get('child') ?? '';
    if (link.content_type === 'video' || link.content_type === 'photo') {
      if (child) return unavailable();
      const video = link.content_type === 'video';
      const { data: item } = await admin.from(video ? 'videos' : 'photos').select('*').eq('id', video ? link.video_id : link.photo_id).eq('owner_id', link.owner_id).maybeSingle();
      if (!item || (video && item.processing_status !== 'ready') || !safePath(video ? item.processed_storage_path || item.storage_path : item.storage_path, link.owner_id)) return unavailable();
      name = item.file_name;
      mime = video && item.processed_storage_path ? 'video/mp4' : item.mime_type;
      bucket = video ? 'user-videos' : 'user-images';
      path = video ? item.processed_storage_path || item.storage_path : item.storage_path;
      const { data: settings } = await admin.from('storage_settings').select('videos_base_path,images_base_path').eq('id', 1).maybeSingle();
      const prefix = video ? settings?.videos_base_path : settings?.images_base_path;
      if (prefix) path = `${prefix}/${path}`;
    } else {
      const { data: root } = await admin.from('user_file_metadata').select('object_path,is_folder,trashed_at').eq('owner_id', link.owner_id).eq('object_path', link.file_path).maybeSingle();
      if (!root || root.trashed_at || root.is_folder !== (link.content_type === 'folder') || !safePath(root.object_path, link.owner_id)) return unavailable();
      if (child && (!root.is_folder || child.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\')))) return unavailable();
      path = root.object_path + (child ? `/${child}` : '');
      // Verify every ancestor, including ancestors above the shared root.
      const segments = path.split('/');
      const ancestors = segments.slice(1).map((_, i) => segments.slice(0, i + 2).join('/'));
      const { data: trash, error: trashError } = await admin.from('user_file_metadata').select('object_path').eq('owner_id', link.owner_id).in('object_path', ancestors).not('trashed_at', 'is', null);
      if (trashError || trash?.length) return unavailable();
      const { data: item } = await admin.from('user_file_metadata').select('object_path,is_folder,mime_type').eq('owner_id', link.owner_id).eq('object_path', path).maybeSingle();
      if (!item) return unavailable();
      if (item.is_folder) {
        const offset = Math.max(0, Math.min(Number(url.searchParams.get('offset')) || 0, 1000000));
        // Exact parent matching avoids wildcard/prefix injection and never lists
        // siblings of the capability root. Opaque relative names are all we return.
        const { data: children, error: childrenError } = await admin.rpc('temporary_share_children', { p_hash: link.token_hash, p_relative: child, p_offset: offset });
        if (childrenError || !children) return unavailable();
        return json({ type: 'folder', name: path.split('/').pop(), entries: children.slice(0, 100), hasMore: children.length > 100 });
      }
      bucket = 'user-files'; name = path.split('/').pop()!; mime = item.mime_type;
    }
    if (path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) return unavailable();
    const streamUrl = `${base}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
    const metadata = url.searchParams.get('metadata') === '1';
    if (metadata) return json({ type: link.content_type === 'folder' ? 'file' : link.content_type, name, mime });
    const upstream = await fetch(streamUrl, { method: req.method, headers: { Authorization: `Bearer ${key}`, apikey: key, ...(req.headers.has('Range') ? { Range: req.headers.get('Range')! } : {}) }, redirect: 'error', signal: req.signal });
    if (!upstream.ok && upstream.status !== 416) return unavailable();
    // No signed URL escapes this boundary. Expiration/revocation is checked on
    // every range/download request. Previously received bytes cannot be recalled.
    const inline = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm)|audio\/(mpeg|mp4|ogg|wav)|application\/pdf|text\/plain)$/.test(mime ?? '') && !url.searchParams.has('download');
    const streamHeaders: Record<string,string> = { ...headers, 'Content-Type': inline ? mime : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      'Content-Security-Policy': "default-src 'none'; sandbox" };
    for (const header of ['Content-Range','Content-Length','Accept-Ranges']) { const value = upstream.headers.get(header); if (value) streamHeaders[header] = value; }
    return new Response(upstream.body, { status: upstream.status, headers: streamHeaders });
  } catch { return unavailable(); }
});
