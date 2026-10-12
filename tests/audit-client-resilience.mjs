import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const compile=async(file)=>ts.transpileModule((await fs.readFile(file,'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/import\.meta\.env\.VITE_SUPABASE_URL/g,'"https://fixture.invalid"'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const entry={path:'owner/file.txt',name:'file.txt',mimeType:'text/plain',size:0};
const publicModule={};let signed=0,cancelled=0,fixture;
new Function('exports','supabase','supabaseAnonKey','fetch',await compile('src/lib/publicFiles.ts'))(publicModule,
 {storage:{from:()=>({createSignedUrl:async()=>{signed++;return {data:{signedUrl:'https://fixture.invalid/authorized'},error:null};}})}},'fixture-anon',async()=>fixture);
fixture=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(9));},cancel(){cancelled++;}}),{headers:{'Content-Length':'9'}});
assert.match((await publicModule.downloadFile(entry,8)).error.message,/64 MB/);assert.equal(cancelled,1);
fixture=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(4));c.enqueue(new Uint8Array(6));},cancel(){cancelled++;}}));
assert.match((await publicModule.downloadFile(entry,8)).error.message,/64 MB/);assert.equal(cancelled,2);
fixture=new Response('small');assert.equal((await publicModule.downloadFile(entry,8)).data.size,5);assert.equal(signed,3);
console.log('PASS authorized archive downloads reject oversized headers and unknown-length streams, cancel reads, and accept small files');
const folderModule={};let downloads=0;
new Function('exports','loadFileChildren','downloadFile',await compile('src/lib/folderDownloads.ts'))(folderModule,async()=>({entries:[{...entry,size:65*1024*1024}],hasMore:false}),async()=>{downloads++;throw Error('must not fetch');});
await assert.rejects(folderModule.downloadFolderArchive({...entry,isFolder:true},'owner'),/64 MB/);assert.equal(downloads,0);
console.log('PASS large folder entries are rejected before downloading payloads');
let calls=0,clock=0,failed=true,value='/prefix/';const settingsModule={};
const fakeDate=class extends Date{static now(){return clock;}};
new Function('exports','supabase','supabaseAnonKey','window','Date',await compile('src/lib/storageSettings.ts'))(settingsModule,
 {rpc:async()=>{calls++;return failed?{data:null,error:{}}:{data:value,error:null};}},'fixture-anon',new EventTarget(),fakeDate);
await assert.rejects(settingsModule.fetchStorageBasePath('videos'),/Could not load/);
failed=false;assert.equal(await settingsModule.fetchStorageBasePath('videos'),'prefix');assert.equal(calls,2);
value='next';assert.equal(await settingsModule.fetchStorageBasePath('videos'),'prefix');assert.equal(calls,2);
clock=30001;assert.equal(await settingsModule.fetchStorageBasePath('videos'),'next');assert.equal(calls,3);
settingsModule.invalidateStorageSettings();assert.equal(await settingsModule.fetchStorageBasePath('videos'),'next');assert.equal(calls,4);
console.log('PASS storage failures are not cached; successful prefixes normalize, expire and invalidate explicitly');
