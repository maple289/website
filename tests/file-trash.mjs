// Local UI + real PostgreSQL planning/catalog triggers. No production connection.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], envPrefix: [],
  resolve: { alias: { '@': path.resolve('src') } },
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://upload-test.supabase.co'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('fixture-anon') },
  server: { host: '127.0.0.1', port: 5219, strictPort: true } });
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
const allowed = new Set(['owner_id','object_path','is_folder','is_favorite','file_size','mime_type','trashed_at','trash_original_path','updated_at']);
try {
  await server.listen();
  for (const width of [1440, 390]) {
    const db = new PGlite();
    const query = async (sql, values = []) => (await db.query(sql, values)).rows;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
        CREATE SCHEMA auth; CREATE SCHEMA storage;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon,service_role;
        CREATE TABLE public.profiles(id uuid PRIMARY KEY);
        CREATE TABLE public.videos(id uuid PRIMARY KEY,owner_id uuid,processing_status text);
        CREATE TABLE public.photos(id uuid PRIMARY KEY,owner_id uuid);
        CREATE TABLE public.user_file_metadata(owner_id uuid,object_path text,is_folder boolean,trashed_at timestamptz,is_favorite boolean DEFAULT false,file_size bigint DEFAULT 7,mime_type text DEFAULT 'text/plain',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),PRIMARY KEY(owner_id,object_path));
        CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb DEFAULT '{"size":7,"mimetype":"text/plain"}',UNIQUE(bucket_id,name));
        INSERT INTO public.profiles VALUES ('${owner}'),('${other}');
        GRANT SELECT,INSERT,UPDATE,DELETE ON public.user_file_metadata,storage.objects TO authenticated;
        ALTER TABLE public.user_file_metadata ENABLE ROW LEVEL SECURITY;
        CREATE POLICY owner_metadata ON public.user_file_metadata TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
        CREATE POLICY owner_storage ON storage.objects TO authenticated USING(starts_with(name,auth.uid()::text||'/')) WITH CHECK(starts_with(name,auth.uid()::text||'/'));`);
      for (const migration of ['20261003130000_file_catalog_integrity.sql','20261007010000_content_context_actions.sql','20261007020000_reuse_trashed_file_names.sql']) {
        await db.exec(await fs.readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
      }
      await query('INSERT INTO storage.objects(bucket_id,name) SELECT $1,unnest($2::text[])', ['user-files',
        ['test/.folder','test/OEM Mode.txt','everyone/.folder','test/Tree/.folder','test/Tree/Sub/.folder','test/Tree/Sub/leaf.txt'].map(name => `${owner}/${name}`)]);
      await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}';`);
      await assert.rejects(query('SELECT public.internal_plan_file_operation($1,$2,false,true)', [`${owner}/test/OEM Mode.txt`,`${owner}/everyone/OEM Mode.txt`]), /permission denied/);
      await assert.rejects(query('SELECT public.plan_file_restore($1,$2)', [`${owner}/test/OEM Mode.txt`,`${owner}/everyone/OEM Mode.txt`]), /Only an item in Trash/);
      await assert.rejects(query('SELECT public.plan_file_operation($1,$2,true)', [`${owner}/test/OEM Mode.txt`,`${other}/OEM Mode.txt`]), /permission/);

      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [], moves = [];
      let failCopy = false, failRemove = false;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://upload-test.supabase.co/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const body = request.postData() ? request.postDataJSON() : {};
        try {
          const rpc = url.pathname.split('/rpc/')[1];
          if (rpc) {
            const args = {
              file_manager_metadata: [body.p_folder ?? '',body.p_view ?? 'files',body.p_offset ?? 0],
              file_manager_storage_bytes: [], valid_file_clipboard: [body.p_path],
              plan_file_operation: [body.p_source,body.p_destination,body.p_copy],
              plan_file_restore: [body.p_source,body.p_destination],
            }[rpc];
            if (!args) return route.fulfill({ json: rpc === 'get_temporary_share' ? null : [] });
            const calls = args.map((_, i) => '$' + (i + 1)).join(',');
            if (rpc === 'file_manager_metadata') return route.fulfill({ json: await query(`SELECT * FROM public.${rpc}(${calls})`, args) });
            return route.fulfill({ json: (await query(`SELECT public.${rpc}(${calls}) AS result`, args))[0].result });
          }
          if (url.pathname.endsWith('/object/list/user-files')) {
            const rows = await query("SELECT * FROM storage.objects WHERE bucket_id='user-files' AND starts_with(name,$1) ORDER BY name", [body.prefix + '/']);
            const entries = new Map();
            for (const row of rows) {
              const rest = row.name.slice(body.prefix.length + 1), name = rest.split('/')[0];
              entries.set(name, { name, id: rest.includes('/') ? null : row.id, metadata: rest.includes('/') ? null : row.metadata });
            }
            return route.fulfill({ json: [...entries.values()].slice(body.offset ?? 0, (body.offset ?? 0) + (body.limit ?? 100)) });
          }
          if (url.pathname.endsWith('/object/copy') || url.pathname.endsWith('/object/move')) {
            const copy = url.pathname.endsWith('/copy');
            if (copy && failCopy) { failCopy = false; throw new Error('Fixture copy failure after Trash preservation'); }
            const rows = copy
              ? await query("INSERT INTO storage.objects(bucket_id,name,metadata) SELECT bucket_id,$2,metadata FROM storage.objects WHERE bucket_id='user-files' AND name=$1 RETURNING name", [body.sourceKey,body.destinationKey])
              : await query("UPDATE storage.objects SET name=$2 WHERE bucket_id='user-files' AND name=$1 RETURNING name", [body.sourceKey,body.destinationKey]);
            assert.equal(rows.length, 1);
            if (!copy) moves.push(body.sourceKey);
            return route.fulfill({ json: { Key: body.destinationKey } });
          }
          if (request.method() === 'DELETE' && url.pathname.endsWith('/object/user-files')) {
            if (failRemove) { failRemove = false; throw new Error('Fixture permanent-delete failure'); }
            return route.fulfill({ json: await query("DELETE FROM storage.objects WHERE bucket_id='user-files' AND name=ANY($1::text[]) RETURNING name", [body.prefixes]) });
          }
          if (url.pathname.includes('/rest/v1/user_file_metadata')) {
            const values = [], conditions = [];
            for (const field of ['owner_id','object_path']) {
              const filter = url.searchParams.get(field);
              if (!filter) continue;
              if (filter.startsWith('eq.')) { values.push(filter.slice(3)); conditions.push(`${field}=$${values.length}`); }
              else if (filter.startsWith('in.')) {
                values.push((filter.slice(4,-1).match(/"(?:\\.|[^"])*"|[^,]+/g) ?? []).map(value => value.startsWith('"') ? JSON.parse(value) : value));
                conditions.push(`${field}=ANY($${values.length}::text[])`);
              }
              else if (filter.startsWith('like.')) { values.push(filter.slice(5)); conditions.push(`${field} LIKE $${values.length}`); }
              else throw new Error('Unexpected fixture filter: ' + filter);
            }
            const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
            if (request.method() === 'GET') {
              const rows = await query('SELECT * FROM public.user_file_metadata' + where + ' ORDER BY object_path', values);
              return route.fulfill({ json: request.headers().accept?.includes('vnd.pgrst.object') ? rows[0] ?? {} : rows });
            }
            const fields = Object.keys(body);
            assert.ok(fields.every(field => allowed.has(field)));
            if (request.method() === 'PATCH') {
              const assignments = fields.map(field => { values.push(body[field]); return `${field}=$${values.length}`; });
              await query('UPDATE public.user_file_metadata SET ' + assignments.join(',') + where, values);
            } else if (request.method() === 'POST') {
              await query(`INSERT INTO public.user_file_metadata(${fields.join(',')}) VALUES(${fields.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT(owner_id,object_path) DO UPDATE SET ${fields.filter(field => !['owner_id','object_path'].includes(field)).map(field => `${field}=EXCLUDED.${field}`).join(',')}`, fields.map(field => body[field]));
            } else if (request.method() === 'DELETE') await query('DELETE FROM public.user_file_metadata' + where, values);
            return route.fulfill({ body: '' });
          }
          return route.fulfill({ json: [] });
        } catch (error) {
          return route.fulfill({ status: 400, json: { message: error.message, error: error.message } });
        }
      });
      const menu = page.getByRole('menu');
      const action = page.getByRole('dialog', { name: 'File or folder action', exact: true });
      const conflict = page.getByRole('dialog', { name: 'Name conflict', exact: true });
      const confirmation = page.getByRole('alertdialog');
      const openFolder = async name => { await page.getByRole('button', { name: 'File Storage', exact: true }).click(); await page.locator('.fm-card').filter({ has: page.getByText(name, { exact: true }) }).click(); };
      const choose = async (name, command) => { await page.getByRole('button', { name: 'Actions for ' + name, exact: true }).click(); await menu.getByRole('menuitem', { name: command, exact: true }).click(); };
      const paste = async name => { await page.getByRole('button', { name: 'Paste', exact: true }).click(); await action.waitFor({ state: 'hidden' }); await page.getByRole('button', { name: 'Actions for ' + name, exact: true }).waitFor(); };
      const rowsAt = async name => query('SELECT * FROM public.user_file_metadata WHERE object_path=$1', [`${owner}/${name}`]);
      await page.goto('http://127.0.0.1:5219/tests/content-context.html#/files');
      await openFolder('test');
      await choose('OEM Mode.txt', 'Copy');
      await openFolder('everyone');
      await paste('OEM Mode.txt');
      await choose('OEM Mode.txt', 'Move to Trash');
      await page.keyboard.press('Escape'); assert.ok(await confirmation.isVisible());
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal((await rowsAt('everyone/OEM Mode.txt'))[0].trashed_at, null);
      await choose('OEM Mode.txt', 'Move to Trash');
      await confirmation.getByRole('button', { name: 'Move to Trash', exact: true }).click();
      await confirmation.waitFor({ state: 'hidden' });
      await page.getByText('This folder is empty', { exact: true }).waitFor();
      assert.ok((await rowsAt('everyone/OEM Mode.txt'))[0].trashed_at);
      failCopy = true;
      await page.getByRole('button', { name: 'Paste', exact: true }).click();
      await action.getByRole('alert').waitFor();
      assert.match(await action.getByRole('alert').innerText(), /Fixture copy failure/);
      assert.equal(await conflict.count(), 0);
      const archived = (await query('SELECT * FROM public.user_file_metadata WHERE trash_original_path=$1', [`${owner}/everyone/OEM Mode.txt`]))[0];
      assert.ok(archived.trashed_at);
      assert.equal(archived.file_size, 7);
      await action.getByRole('button', { name: 'Continue', exact: true }).click();
      await action.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Actions for OEM Mode.txt', exact: true }).waitFor();
      assert.equal(moves.filter(source => source === `${owner}/everyone/OEM Mode.txt`).length, 1);
      assert.equal((await rowsAt('everyone/OEM Mode.txt'))[0].trashed_at, null);
      assert.equal((await rowsAt('test/OEM Mode.txt'))[0].trashed_at, null);
      console.log(`PASS ${width}px: copy → paste → confirmed Delete → paste; Trash payload preserved, no false conflict, retry skips preservation`);

      await page.getByRole('button', { name: 'Trash', exact: true }).click();
      await choose('OEM Mode.txt', 'Restore');
      await conflict.getByRole('button', { name: 'Cancel', exact: true }).click();
      await action.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.ok((await query('SELECT trashed_at FROM public.user_file_metadata WHERE object_path=$1', [archived.object_path]))[0].trashed_at);
      await choose('OEM Mode.txt', 'Restore');
      await conflict.getByRole('button', { name: 'Keep both', exact: true }).click();
      await action.waitFor({ state: 'hidden' });
      await page.getByText('Trash is empty', { exact: true }).waitFor();
      assert.equal((await rowsAt('everyone/OEM Mode (copy).txt'))[0].trashed_at, null);
      assert.equal((await rowsAt('everyone/OEM Mode (copy).txt'))[0].trash_original_path, null);
      console.log(`PASS ${width}px: Trash retains the original name; Restore Cancel preserves it; Keep both never overwrites the current file`);

      await openFolder('test');
      await choose('Tree', 'Copy');
      await openFolder('everyone');
      await paste('Tree');
      await choose('Tree', 'Move to Trash');
      assert.match(await confirmation.innerText(), /All of their contents/);
      await confirmation.getByRole('button', { name: 'Move to Trash', exact: true }).click();
      await confirmation.waitFor({ state: 'hidden' });
      await paste('Tree');
      const archiveTree = (await query('SELECT * FROM public.user_file_metadata WHERE trash_original_path=$1', [`${owner}/everyone/Tree`]))[0];
      const treeRows = await query('SELECT * FROM public.user_file_metadata WHERE starts_with(object_path,$1)', [archiveTree.object_path + '/']);
      assert.equal(treeRows.length, 2); assert.ok(treeRows.every(row => row.trashed_at && row.trash_original_path));
      assert.ok((await rowsAt('everyone/Tree/Sub/leaf.txt'))[0]);
      await assert.rejects(query('SELECT public.plan_file_operation($1,$2,true)', [archiveTree.object_path,`${owner}/test/Blocked`]), /Items in Trash/);
      await assert.rejects(query('SELECT public.plan_file_restore($1,$2)', [archiveTree.object_path,`${other}/Tree`]), /permission/);
      await page.getByRole('button', { name: 'Trash', exact: true }).click();
      await choose('Tree', 'Delete forever');
      failRemove = true;
      await confirmation.getByRole('button', { name: 'Delete Folder', exact: true }).click();
      await confirmation.getByRole('alert').waitFor();
      assert.match(await confirmation.innerText(), /Fixture permanent-delete failure/);
      await page.keyboard.press('Escape'); assert.ok(await confirmation.isVisible());
      await confirmation.getByRole('button', { name: 'Delete Folder', exact: true }).click();
      await confirmation.waitFor({ state: 'hidden' });
      await page.getByText('Trash is empty', { exact: true }).waitFor();
      assert.equal((await query('SELECT * FROM storage.objects WHERE starts_with(name,$1)', [archiveTree.object_path + '/'])).length, 0);
      assert.equal((await query('SELECT * FROM public.user_file_metadata WHERE object_path=$1 OR starts_with(object_path,$1||\'/\')', [archiveTree.object_path])).length, 0);
      assert.ok((await rowsAt('everyone/Tree/Sub/leaf.txt'))[0]);
      assert.ok((await rowsAt('test/Tree/Sub/leaf.txt'))[0]);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: complete folder preservation; permanent Delete requires confirmation, retains failure and deletes only the trashed tree`);
    } catch (error) {
      const current = context.pages()[0];
      if (current) console.error((await current.locator('body').innerText()).slice(-5000));
      throw error;
    } finally { await context.close(); await db.close(); }
  }
} finally { await browser.close(); await server.close(); }
