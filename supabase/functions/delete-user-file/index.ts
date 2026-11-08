import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Apikey, X-Client-Info',
  'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return json({});
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: { user }, error } = await client.auth.getUser((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
    if (error || !user) return json({ error: 'Please sign in to permanently delete files.' }, 401);
    const text = await req.text();
    if (text.length > 4096) return json({ error: 'Invalid request' }, 400);
    const body = JSON.parse(text), path = body.path;
    if (typeof path !== 'string' || path.length >= 2048 || !path.startsWith(user.id + '/')
      || path.split('/').some(part => !part || part === '.' || part === '..' || /[\\\p{Cc}]/u.test(part))
      || typeof body.is_folder !== 'boolean' || typeof body.trashed_at !== 'string' || !Number.isFinite(Date.parse(body.trashed_at))) {
      return json({ error: 'Invalid item. Refresh Trash before deleting it.' }, 400);
    }
    const { data: id, error: beginError } = await client.rpc('begin_user_file_deletion', {
      p_owner: user.id, p_path: path, p_folder: body.is_folder, p_trashed_at: body.trashed_at,
    });
    if (beginError) return json({ error: beginError.code === '40001' ? 'This item or a related transfer changed. Refresh Trash or finish the transfer before retrying.' : 'File not found or deletion is unavailable. Please retry shortly.' }, beginError.code === '42501' ? 403 : 409);
    if (!id) return json({ deleted: true });
    const args = { p_id: id, p_owner: user.id };
    for (let page = 0; page < 20; page++) {
      const { data: objects, error: resolution } = await client.rpc('user_file_deletion_objects', args).limit(100);
      if (resolution || !objects) throw resolution || new Error('Cleanup unavailable');
      if (!objects.length) {
        const { error: finishError } = await client.rpc('finish_user_file_deletion', args);
        if (finishError) throw finishError;
        return json({ deleted: true });
      }
      if (objects.some((object: { bucket_id: string; name: string }) => !['user-files','users'].includes(object.bucket_id)
        || !object.name.startsWith(user.id + '/') || object.name.split('/').some(part => !part || part === '.' || part === '..' || /[\\\p{Cc}]/u.test(part)))) throw new Error('Unexpected location');
      for (const bucket of ['user-files','users']) {
        const paths = objects.filter((object: { bucket_id: string }) => object.bucket_id === bucket).map((object: { name: string }) => object.name);
        if (!paths.length) continue;
        const { error: removal } = await client.storage.from(bucket).remove(paths);
        if (removal) throw removal;
      }
    }
    return json({ pending: true }, 202);
  } catch {
    return json({ error: 'Permanent deletion is incomplete. Some files may already be removed. Retry the saved deletion to finish; completed removals are skipped.' }, 500);
  }
});
