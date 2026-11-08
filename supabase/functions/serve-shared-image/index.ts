import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, If-None-Match",
  "Access-Control-Expose-Headers": "ETag", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
const hash = async (token: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), b => b.toString(16).padStart(2, "0")).join("");
const safePath = (path: unknown): path is string => typeof path === 'string' && path.length < 2048 && path.split('/').every(part => !!part && part !== '.' && part !== '..' && !/[\\\p{Cc}]/u.test(part));
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (!['GET','HEAD'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
  try {
    const base = Deno.env.get('SUPABASE_URL')!, key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(base, key, { auth: { persistSession: false } }), url = new URL(req.url);
    const capability = url.searchParams.get('access');
    const publicRequest = url.searchParams.get('public') === '1';
    if (capability || publicRequest) {
      if (capability && !/^[a-f0-9]{64}$/.test(capability)) return json({ error: 'Image unavailable' }, 404);
      const path = url.searchParams.get('path'), bucket = url.searchParams.get('bucket');
      if (publicRequest && (capability || !safePath(path) || !['user-images','users'].includes(bucket || ''))) return json({ error: 'Image unavailable' }, 404);
      const { data, error } = capability
        ? await admin.rpc('check_shared_image', { p_hash: await hash(capability) })
        : await admin.rpc('resolve_public_library_image', { p_path: path, p_bucket: bucket });
      if (error || !data || !safePath(data.object_path)) return json({ error: 'Image unavailable or access expired' }, 403);
      if (!['user-images','users'].includes(data.bucket)) return json({ error: 'Image unavailable' }, 404);
      const upstream = await fetch(`${base}/storage/v1/object/authenticated/${data.bucket}/${data.object_path.split('/').map(encodeURIComponent).join('/')}`, {
        method: req.method, headers: { Authorization: `Bearer ${key}`, apikey: key,
          ...(publicRequest && req.headers.has('If-None-Match') ? { 'If-None-Match': req.headers.get('If-None-Match')! } : {}) }, redirect: 'error', signal: req.signal });
      if (!upstream.ok && upstream.status !== 304) return json({ error: 'Image unavailable' }, 404);
      const cacheHeaders = publicRequest ? { 'Cache-Control': 'public, max-age=0, must-revalidate',
        ...(upstream.headers.has('ETag') ? { ETag: upstream.headers.get('ETag')! } : {}) } : {};
      const mime = upstream.headers.get('Content-Type')?.split(';')[0] || data.mime;
      // Never redirect to Storage: it would turn a revocable grant into a signed URL.
      return new Response(upstream.status === 304 || req.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: { ...headers, ...cacheHeaders,
        'Content-Type': /^image\/(jpeg|png|webp|gif|bmp|tiff|heic|heif|avif)$/i.test(mime) ? mime : 'application/octet-stream',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(data.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}` } });
    }
    const path = url.searchParams.get('path');
    if (!safePath(path) || req.method === 'HEAD') return json({ error: 'Image path required' }, 400);
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const client = createClient(base, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth.user) return json({ error: 'Please sign in' }, 401);
    // Decode only after the server verified the session JWT.
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof claims.session_id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(claims.session_id)) return json({ error: 'Please sign in' }, 401);
    const { data, error } = await admin.rpc('resolve_shared_image', { p_path: path, p_user: auth.user.id, p_session: claims.session_id });
    if (error || !data) return json({ error: 'Image unavailable or access denied' }, 403);
    const { data: budget, error: budgetError } = await admin.rpc('claim_public_request', { p_bucket: 'shared-image', p_seconds: 60, p_limit: 4000 });
    if (budgetError || !budget) return json({ error: 'Please retry shortly' }, 429);
    const access = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    const { error: saved } = await admin.from('image_access_grants').insert({ token_hash: await hash(access), object_path: path, user_id: auth.user.id, session_id: claims.session_id });
    if (saved) return json({ error: 'Image unavailable' }, 503);
    await admin.from('image_access_grants').delete().lt('expires_at', new Date().toISOString());
    return json({ url: `${new URL(Deno.env.get('SUPABASE_PUBLIC_URL') || req.url).origin}/functions/v1/serve-shared-image?access=${access}` });
  } catch { return json({ error: 'Image unavailable' }, 503); }
});
