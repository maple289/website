import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Apikey, X-Client-Info',
  'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });

// Called only by the existing explicit deletion confirmation. Authentication,
// current ownership and account status are independently checked on the server.
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return json({});
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: { user }, error } = await client.auth.getUser((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
    if (error || !user) return json({ error: 'Please sign in to delete a photo.' }, 401);
    const body = await req.text();
    if (body.length > 1024) return json({ error: 'Invalid request' }, 400);
    const id = JSON.parse(body).id;
    if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return json({ error: 'Invalid photo' }, 400);
    const { data: photo, error: lookup } = await client.from('photos').select('id,owner_id').eq('id', id).maybeSingle();
    if (lookup) throw lookup;
    if (!photo || photo.owner_id !== user.id) return json({ error: 'Photo not found or access denied.' }, 403);
    const { data: active, error: accountError } = await client.rpc('active_account', { p_user: user.id });
    if (accountError || !active) return json({ error: 'Account is not allowed to delete.' }, 403);
    for (let page = 0; page < 100; page++) {
      const { data: objects, error: resolution } = await client.rpc('photo_deletion_objects', { p_id: id, p_owner: user.id }).limit(100);
      if (resolution || !objects) throw resolution || new Error('Cleanup unavailable');
      if (!objects.length) {
        const { data: deleted, error: deletion } = await client.from('photos').delete().eq('id', id).eq('owner_id', user.id).select('id').maybeSingle();
        if (deletion || !deleted) throw deletion || new Error('Photo changed');
        return json({ deleted: true });
      }
      if (objects.some((object: { bucket_id: string }) => !['user-images','users'].includes(object.bucket_id))) throw new Error('Unexpected bucket');
      for (const bucket of ['user-images','users']) {
        const paths = objects.filter((object: { bucket_id: string }) => object.bucket_id === bucket).map((object: { name: string }) => object.name);
        if (!paths.length) continue;
        const { error: removal } = await client.storage.from(bucket).remove(paths);
        if (removal) throw removal;
      }
    }
    throw new Error('Cleanup limit reached');
  } catch {
    return json({ error: 'Deletion is incomplete. Some stored files may already be removed. The photo record is kept where possible; retry to finish deleting it.' }, 500);
  }
});
