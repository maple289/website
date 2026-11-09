import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const path=owner+'/Documents',stamp='2026-11-07T12:00:00Z',receipt='33333333-3333-4333-8333-333333333333';
let handler,objects=[],removed=[],finished=0,begun=0,failBucket=null,beginCode=null,hasReceipt=true,repeat=false;
const client={auth:{getUser:async token=>({data:{user:token==='verified'?{id:owner}:null},error:null})},
 rpc:(name,args)=>{
  if(name==='begin_user_file_deletion') {
   begun++;assert.deepEqual(args,{p_owner:owner,p_path:path,p_folder:true,p_trashed_at:stamp});
   return Promise.resolve({data:hasReceipt?receipt:null,error:beginCode?{code:beginCode}:null});
  }
  assert.deepEqual(args,{p_id:receipt,p_owner:owner});
  if(name==='user_file_deletion_objects')return {limit:async n=>{assert.equal(n,100);return {data:objects.slice(0,n),error:null};}};
  assert.equal(name,'finish_user_file_deletion');assert.equal(objects.length,0);finished++;return Promise.resolve({error:null});
 },storage:{from:bucket=>({remove:async paths=>{
  if(bucket===failBucket)return {error:{message:'private backend detail'}};
  removed.push({bucket,paths});if(!repeat)objects=objects.filter(o=>o.bucket_id!==bucket||!paths.includes(o.name));return {error:null};
 }})}};
const code=ts.transpileModule((await readFile('supabase/functions/delete-user-file/index.ts','utf8')).replace(/^import .*;\r?\n/gm,''),
 {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
new Function('Deno','createClient',code)({env:{get:()=> 'fixture'},serve:fn=>handler=fn},()=>client);
const request=(overrides={},token='verified')=>handler(new Request('https://fixture.test/delete-user-file',{
 method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({path,is_folder:true,trashed_at:stamp,...overrides})}));
assert.equal((await request({},'forged')).status,401);assert.equal(begun,0);
for(const invalid of [{path:other+'/Documents'},{path:owner+'/../other'},{path:owner+'/a\\b'},
 {path:owner+'/a\u0000b'},{path:owner+'//a'},{is_folder:'true'},{trashed_at:'invalid'}]) {
 assert.equal((await request(invalid)).status,400);assert.equal(begun,0);
}
beginCode='42501';assert.equal((await request()).status,403);assert.equal(removed.length,0);
beginCode='40001';assert.equal((await request()).status,409);beginCode=null;
objects=[{bucket_id:'user-files',name:path+'/old.docx'},{bucket_id:'users',name:owner+'/files/Documents/current.docx'}];
failBucket='users';let response=await request({owner_id:other});assert.equal(response.status,500);
assert.equal(finished,0);assert.equal(objects.length,1);assert.equal(removed.length,1);
assert.ok(!(await response.text()).includes('private backend detail'));
failBucket=null;response=await request();assert.equal(response.status,200);assert.equal(finished,1);
assert.deepEqual(removed.map(o=>o.bucket),['user-files','users']);
hasReceipt=false;assert.equal((await request()).status,200);assert.equal(finished,1,'An acknowledged completed receipt can be retried without repeating storage removal');hasReceipt=true;
for(const invalid of [{bucket_id:'messenger-attachments',name:path+'/file'},
 {bucket_id:'users',name:other+'/files/Documents/file'},{bucket_id:'users',name:owner+'/files/../secret'}]) {
 objects=[invalid];const count=removed.length;assert.equal((await request()).status,500);assert.equal(removed.length,count);
}
objects=[{bucket_id:'users',name:owner+'/files/Documents/current.docx'}];repeat=true;
const count=removed.length;assert.equal((await request()).status,202);assert.equal(removed.length-count,20);assert.equal(finished,1);
assert.equal((await handler(new Request('https://fixture.test/delete-user-file',{method:'DELETE'}))).status,405);
console.log('PASS file deletion verifies actor, derives owner, validates Trash identity, rejects foreign locations, preserves partial retries and bounds pending cleanup');
