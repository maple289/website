// Local proof of authorization design using real SQL bodies and Edge handlers.
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import ts from 'typescript';
const { PGlite }=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const id='11111111-1111-4111-8111-111111111111';
const results=[];
const extract=(source,name)=>source.match(new RegExp('CREATE(?: OR REPLACE)? FUNCTION (?:public\\.)?'+name+'\\([\\s\\S]*?\\$\\$;'))?.[0];
try {
 await db.exec(`CREATE SCHEMA auth; CREATE ROLE authenticated; CREATE TABLE profiles(id uuid PRIMARY KEY,role text,email text);
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,encrypted_password text,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz DEFAULT now());
 CREATE TABLE account_activation(user_id uuid,active boolean,must_change_password boolean,setup_token_hash text,setup_expires_at timestamptz,setup_claimed_at timestamptz,last_setup_request_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${id}'::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated;
 INSERT INTO profiles VALUES('${id}','admin','fixture@example.invalid');
 INSERT INTO auth.users(id,email,encrypted_password,deleted_at,banned_until) VALUES('${id}','fixture@example.invalid','',NULL,now()+interval '1 day');
 INSERT INTO account_activation(user_id,active,must_change_password) VALUES('${id}',false,true);`);
 await db.exec(extract(await readFile('supabase/migrations/20260824213348_add_admin_profiles_and_storage_config.sql','utf8'),'is_admin'));
 await db.exec('SET ROLE authenticated');
 const value=(await db.query('SELECT public.is_admin() allowed')).rows[0].allowed;
 assert.equal(value,true);results.push({check:'is_admin for disabled/banned account with an existing actor claim',result:'authorization still returns true',classification:'confirmed SQL authorization gap; live JWT lifetime not probed'});
 await db.exec(`RESET ROLE; CREATE TABLE photos(id int,owner_id uuid,visibility text); ALTER TABLE photos ENABLE ROW LEVEL SECURITY; GRANT SELECT ON photos TO authenticated;
 INSERT INTO photos VALUES(1,'${id}','private'); UPDATE profiles SET role='user';`);
 const photoPolicies=await readFile('supabase/migrations/20260901210225_configure_image_storage.sql','utf8');
 await db.exec(photoPolicies.match(/CREATE POLICY "photos_select_own"[\s\S]*?;/)[0]);
 await db.exec('SET ROLE authenticated');
 assert.equal((await db.query('SELECT * FROM photos')).rows.length,1);
 results.push({check:'existing authenticated actor claim for disabled regular owner',result:'actual photo ownership RLS still returns private content',classification:'confirmed RLS authorization gap; no production account disabled'});
 await db.exec('RESET ROLE; UPDATE auth.users SET banned_until=NULL; UPDATE account_activation SET active=true');
 await db.exec(extract(await readFile('supabase/migrations/20260927120000_email_only_login.sql','utf8'),'start_initial_login'));
 const allowed=(await db.query("SELECT start_initial_login('fixture@example.invalid',$1) allowed",['a'.repeat(64)])).rows[0].allowed;
 assert.equal(allowed,true);
 // Invoke the actual unauthenticated login branch with a synthetic service RPC.
 let handler;
 const source=(await readFile('supabase/functions/account-login/index.ts','utf8')).replace(/^import .*;\r?\n/gm,'');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const createClient=()=>({rpc:async(name)=>({data:name==='start_initial_login'?allowed:null,error:null})});
 new Function('Deno','createClient',code)({env:{get:()=>''},serve:f=>handler=f},createClient);
 const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',identifier:'fixture@example.invalid',password:''})}));
 const body=await response.json();
 assert.equal(response.status,200);assert.equal(body.requires_password_setup,true);assert.ok(/^[0-9a-f]{64}$/.test(body.setup_token));
 results.push({check:'approved initial account, unauthenticated email-only login',result:'actual handler issues first-password capability without proof of mailbox possession',classification:'confirmed design vulnerability in local reproduction; no production account targeted'});
 console.log(JSON.stringify(results,null,2));await writeFile('audit/20261011/auth-boundaries.json',JSON.stringify(results,null,2));
} finally {await db.close();}
