// Execute the real upload module with only transport/decoder boundaries mocked.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const owner='11111111-1111-4111-8111-111111111111';
const source=(await readFile('src/lib/mediaUploads.ts','utf8')).replace(/^import .*;\r?\n/gm,'')
 .replace(/import\.meta\.env\.VITE_SUPABASE_URL/g,JSON.stringify('https://fixture.test'))
 .replace(/import\.meta\.env\.VITE_SUPABASE_ANON_KEY/g,JSON.stringify('fixture-anon'));
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
async function scenario({bucket='staging',large=false,status=202,network=false,forgedPrefix=false,preview=false}={}){
 const exported={},uploads=[],removals=[],reservations=[],queues=[],events=[];let id;
 const supabase={auth:{getSession:async()=>({data:{session:{access_token:'verified-session'}}})},
  rpc:async(name,args)=>{assert.equal(name,'reserve_media_upload');id=args.p_id;reservations.push(args);
   return {data:{bucket,prefix:(bucket==='staging'?'uploads/':'')+(forgedPrefix?'another-owner':owner)+'/'+id},error:null};},
  storage:{from:target=>({remove:async paths=>{removals.push({bucket:target,paths});return {error:null};}})}};
 class XHR{
  status=201;upload={};headers={};open(method,url){this.method=method;this.url=url;}
  setRequestHeader(key,value){this.headers[key]=value;}
  send(body){assert.equal(this.headers.Authorization,'Bearer verified-session');uploads.push({method:this.method,url:this.url,body,headers:this.headers});this.onload();}
 }
 class TusUpload{
  constructor(file,options){this.options=options;this.file=file;}
  start(){uploads.push({metadata:this.options.metadata});this.options.onSuccess();}
 }
 const fetch=async(url,options)=>{
  assert.equal(url,'https://fixture.test/functions/v1/queue-media-upload');
  assert.equal(options.headers.Authorization,'Bearer verified-session');queues.push(JSON.parse(options.body));
  if(network)throw Error('Fixture lost response');
  return Response.json(status===202?{id,status:'queued'}:{error:'Fixture queue failure'},{status});
 };
 new Function('exports','supabase','validateMediaFile','dataUrlToBlob','uploadFailureMessage','XMLHttpRequest','tus','fetch','window',code)(
  exported,supabase,async()=>{},async()=>new Blob(['preview'],{type:'image/png'}),()=> 'Fixture upload failed',XHR,{Upload:TusUpload},fetch,
  {dispatchEvent:event=>events.push(event.type)});
 const result=await exported.uploadVideo({file:new File([large?new Uint8Array(7*1024*1024):'source'],'original.mov',{type:'video/quicktime'}),
  user:{id:owner},fileName:'Original.mov',visibility:'private',previewImage:preview?'data:image/png;base64,fixture':null,onProgress:()=>{}})
  .then(()=>({okay:true})).catch(error=>({error}));
 return {...result,uploads,removals,reservations,queues,events,id};
}
for(const bucket of ['media-staging','staging']){
 for(const large of [false,true]){
  const result=await scenario({bucket,large});assert.equal(result.okay,true);
  assert.equal(result.reservations.length,1);assert.equal(result.queues.length,1);assert.equal(result.removals.length,0);
  const expected=(bucket==='staging'?'uploads/':'')+owner+'/'+result.id+'/source';
  if(large){assert.equal(result.uploads[0].metadata.bucketName,bucket);assert.equal(result.uploads[0].metadata.objectName,expected);}
  else assert.equal(result.uploads[0].url,'https://fixture.test/storage/v1/object/'+bucket+'/'+expected);
  assert.deepEqual(result.events,['media-processing']);
 }
}
for(const bad of [{bucket:'users'},{bucket:'staging',forgedPrefix:true}]){
 const result=await scenario(bad);assert.ok(result.error);assert.equal(result.uploads.length,0);assert.equal(result.queues.length,0);assert.equal(result.removals.length,0);
}
console.log('PASS ordinary/TUS uploads use only the server-reserved staging bucket/key; mismatched owner or permanent bucket is rejected before uploading');
let result=await scenario({status:409,preview:true});assert.ok(result.error);
assert.deepEqual(result.removals,[{bucket:'staging',paths:['uploads/'+owner+'/'+result.id+'/source','uploads/'+owner+'/'+result.id+'/preview']}]);
for(const settings of [{status:503},{network:true}]){result=await scenario(settings);assert.ok(result.error);assert.equal(result.removals.length,0);}
console.log('PASS confirmed queue rejection cleans only the new attempt; ambiguous queue/server failures retain inputs for recovery without touching permanent media');
