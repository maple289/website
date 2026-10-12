// Actual Edge deletion branch, mocked Auth only. No production requests.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';
const admins=new Set(['a','b']);let handler,checked=0,release;
const barrier=new Promise(resolve=>release=resolve);
const createClient=(_base,key,options)=>key==='anon'?{
 auth:{getUser:async()=>({data:{user:{id:options.global.headers.Authorization.slice(7)}},error:null})}
}:{
 from:()=>({select(){return this;},eq(){return this;},async single(){checked++;if(checked===2)release();await barrier;return {data:{role:'admin'},error:null};}}),
 auth:{admin:{deleteUser:async id=>{admins.delete(id);return {error:null};}}}
};
const code=ts.transpileModule((await readFile('supabase/functions/admin-users/index.ts','utf8')).replace(/^import .*;\r?\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
new Function('Deno','createClient',code)({env:{get:k=>k==='SUPABASE_ANON_KEY'?'anon':'service'},serve:f=>handler=f},createClient);
const responses=await Promise.all([['a','b'],['b','a']].map(([actor,target])=>handler(new Request('https://fixture.invalid/admin-users?id='+target,{method:'DELETE',headers:{Authorization:'Bearer '+actor}}))));
assert.ok(responses.every(r=>r.status===200));assert.equal(admins.size,0);
const result={check:'two administrators concurrently delete each other',responseStatuses:responses.map(r=>r.status),remainingAdministrators:admins.size,scope:'real Edge branch with mocked Auth; repository migration review found no last-admin DELETE guard; live account deletion not attempted'};
await writeFile('audit/20261011/admin-deletion-race.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
