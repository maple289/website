// Actual handler with deterministic Auth/DB/Storage transport only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
let handler,user=owner,active=true,exists=true,failBucket='users',removed=[],rowDeletes=0;
let objects=[{bucket_id:'user-images',name:owner+'/old/photo.jpg'},{bucket_id:'users',name:owner+'/photos/'+id+'/photo.jpg'}];
const client={auth:{getUser:async token=>({data:{user:token==='verified'?{id:user}:null},error:null})},
  rpc:(name,args)=>{
    if(name==='active_account'){assert.equal(args.p_user,user);return Promise.resolve({data:active,error:null});}
    assert.equal(name,'photo_deletion_objects');assert.deepEqual(args,{p_id:id,p_owner:owner});
    return {limit:async size=>({data:objects.slice(0,size),error:null})};
  },
  from:table=>{assert.equal(table,'photos');let action='select';const filters={};
    const query={select:()=>query,eq:(key,value)=>{filters[key]=value;return query;},delete:()=>{action='delete';return query;},
      maybeSingle:async()=>{assert.equal(filters.id,id);if(action==='delete'){
        assert.equal(filters.owner_id,owner);assert.equal(objects.length,0,'Keep the record until all active/retained objects are removed');rowDeletes++;exists=false;
        return {data:{id},error:null};
      }return {data:exists?{id,owner_id:owner}:null,error:null};}};return query;},
  storage:{from:bucket=>({remove:async paths=>{
    if(bucket===failBucket)return {error:{message:'fixture private detail'}};
    removed.push({bucket,paths});objects=objects.filter(object=>object.bucket_id!==bucket||!paths.includes(object.name));return {error:null};
  }})}};
const code=ts.transpileModule((await readFile('supabase/functions/delete-photo/index.ts','utf8')).replace(/^import .*;\r?\n/gm,''),
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
new Function('Deno','createClient',code)({env:{get:()=> 'fixture'},serve:fn=>handler=fn},()=>client);
const request=(body={id},token='verified')=>handler(new Request('https://fixture.test/delete-photo',{
  method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)}));
assert.equal((await request({id},'forged')).status,401);
user='33333333-3333-4333-8333-333333333333';assert.equal((await request()).status,403);assert.equal(removed.length,0);
user=owner;active=false;assert.equal((await request()).status,403);assert.equal(removed.length,0);active=true;
assert.equal((await request({id:'../other'})).status,400);
let response=await request();assert.equal(response.status,500);assert.equal(exists,true);assert.equal(rowDeletes,0);
assert.deepEqual(removed.map(item=>item.bucket),['user-images']);assert.equal(objects.length,1);
assert.ok(!(await response.text()).includes('fixture private detail'));
failBucket=null;response=await request();assert.equal(response.status,200);assert.deepEqual(await response.json(),{deleted:true});
assert.equal(exists,false);assert.equal(rowDeletes,1);assert.deepEqual(removed.map(item=>item.bucket),['user-images','users']);
assert.equal((await request()).status,403,'A missing row must never authorize other retained objects');
assert.equal((await handler(new Request('https://fixture.test/delete-photo',{method:'DELETE'}))).status,405);
console.log('PASS photo deletion rechecks verified actor, active account and owner; partial cleanup retains the row and retry removes only remaining objects before deletion');
