// Execute the actual Edge handler; stub only Auth, PostgREST and Storage I/O.
// Live SQL authorization and revocation are covered by group-sharing-db.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
const source=await readFile(new URL('../supabase/functions/serve-shared-image/index.ts',import.meta.url),'utf8');
let handler,allowed=true,session=true,saveFailure=false,streamed=0,authenticated=0;
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',path=`media/${owner}/photo.jpg`,rows=new Map();
const hash=async text=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
const validToken='header.'+Buffer.from(JSON.stringify({session_id:sid})).toString('base64url')+'.signature';
const resource={path:owner+'/photo.jpg',name:'Original photo.jpg',mime:'image/jpeg'};
const admin={
 rpc:async(name,args)=>{
  if(name==='resolve_shared_image'){
   assert.equal(args.p_user,owner);assert.equal(args.p_session,sid);
   return {data:allowed&&session&&args.p_path===path?resource:null,error:null};
  }
  if(name==='check_shared_image')return {data:allowed&&session&&rows.has(args.p_hash)?{...resource,object_path:rows.get(args.p_hash).object_path}:null,error:null};
  if(name==='claim_public_request')return {data:true,error:null};
  throw Error('Unexpected RPC '+name);
 },
 from:table=>{
  assert.equal(table,'image_access_grants');return {
   insert:async row=>{assert.equal(row.user_id,owner);assert.equal(row.session_id,sid);assert.equal(row.object_path,path);if(!saveFailure)rows.set(row.token_hash,row);return {error:saveFailure?{message:'fixture'}:null};},
   delete:()=>({lt:async()=>({error:null})}),
  };
 }
};
const createClient=(_base,key)=>key==='private-server-key'?admin:{auth:{getUser:async token=>{authenticated++;return token===validToken?{data:{user:{id:owner}},error:null}:{data:{user:null},error:{message:'denied'}};}}};
const storage=async(url,options)=>{streamed++;assert.equal(url,`http://backend.test/storage/v1/object/authenticated/user-images/${path}`);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer private-server-key');return new Response(options.method==='HEAD'?null:'image bytes',{headers:{'Content-Type':'image/jpeg'}});};
const env={SUPABASE_URL:'http://backend.test',SUPABASE_SERVICE_ROLE_KEY:'private-server-key',SUPABASE_ANON_KEY:'public-key',SUPABASE_PUBLIC_URL:'https://myhostage.test'};
const compiled=ts.transpileModule(source.replace(/^import .*;\r?\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
new Function('Deno','createClient','fetch','crypto',compiled)({serve:fn=>handler=fn,env:{get:name=>env[name]}},createClient,storage,webcrypto);
const request=(query,options={})=>handler(new Request('https://myhostage.test/functions/v1/serve-shared-image?'+query,options));
assert.equal((await request('path='+encodeURIComponent(path))).status,401);
assert.equal((await request('path=../private',{headers:{Authorization:'Bearer '+validToken}})).status,400);
assert.equal((await request('path='+encodeURIComponent(path),{method:'POST'})).status,405);
assert.equal((await request('',{method:'OPTIONS'})).status,200);
const headers={Authorization:'Bearer '+validToken};
assert.equal((await request('path='+encodeURIComponent(path.replace('photo.jpg','other.jpg')),{headers})).status,403);
let response=await request('path='+encodeURIComponent(path)+'&user_id=forged&session_id=forged',{headers});assert.equal(response.status,200);
const {url}=await response.json(),access=new URL(url).searchParams.get('access');
assert.match(access,/^[a-f0-9]{64}$/);assert.ok(rows.has(await hash(access)));assert.ok(!JSON.stringify([...rows.values()]).includes(access));
assert.equal(new URL(url).origin,'https://myhostage.test');
console.log('PASS authenticated issuance binds verified user/session, exact resource path, hash-only storage; invalid/anonymous/forged requests fail closed');
response=await handler(new Request(url));assert.equal(response.status,200);assert.equal(await response.text(),'image bytes');
assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Location'),null);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');assert.match(response.headers.get('Access-Control-Allow-Headers'),/Authorization/i);
assert.match(response.headers.get('Content-Disposition'),/Original%20photo.jpg/);
assert.equal((await handler(new Request(url,{method:'HEAD'}))).status,200);
const before=streamed;allowed=false;assert.equal((await handler(new Request(url))).status,403);assert.equal(streamed,before);
allowed=true;session=false;assert.equal((await handler(new Request(url))).status,403);assert.equal(streamed,before);
session=true;assert.equal((await request('access='+'f'.repeat(64))).status,403);assert.equal((await request('access=invalid')).status,404);
saveFailure=true;assert.equal((await request('path='+encodeURIComponent(path),{headers})).status,503);
assert.ok(authenticated>=4);
console.log('PASS saved URL reauthorizes on GET/HEAD; removed group/session blocks Storage; no signed redirect or cache; save failure never issues a capability');
