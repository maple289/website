// Actual Caddy response headers with a local synthetic upstream, no live data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
if(!process.env.CADDY_BIN)throw Error('Set CADDY_BIN to the installed, verified Caddy binary.');
const root=path.resolve('.runtime/public-preview-cache').replaceAll('\\','/');await mkdir(root,{recursive:true});
const upstream=createServer((req,res)=>{
  if(req.method==='POST'){res.statusCode=req.url.includes('get_storage_base_path')?401:403;res.setHeader('Content-Type','application/json');res.end('{"message":"denied"}');}
  else{res.setHeader('Content-Type','image/webp');res.setHeader('Cache-Control','public, max-age=3600');res.setHeader('ETag','"fixture"');res.end('fixture bytes');}
});
await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
const original=await readFile('docker/Caddyfile','utf8');
const config=`{\n admin off\n persist_config off\n auto_https off\n storage file_system {\n root "${root}/state"\n }\n}\n`+original.replace('{$APP_ADDRESS}','http://127.0.0.1:5298');
await writeFile(root+'/Caddyfile',config);
let logs='';const caddy=spawn(process.env.CADDY_BIN,['run','--config',root+'/Caddyfile','--adapter','caddyfile'],{windowsHide:true,env:{...process.env,SUPABASE_API_UPSTREAM:'127.0.0.1:'+upstream.address().port},stdio:['ignore','ignore','pipe']});caddy.stderr.on('data',d=>logs+=d);
try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:5298/healthz')).ok){ready=true;break;}}catch{}if(caddy.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,50));}
  assert.ok(ready);
  for(const endpoint of ['/rest/v1/rpc/get_storage_base_path','/storage/v1/object/sign/user-images/public/preview.webp']){
    const r=await fetch('http://127.0.0.1:5298'+endpoint,{method:'POST',headers:{Authorization:'Bearer fixture-anon','Content-Type':'application/json'},body:'{}'});
    assert.ok([401,403].includes(r.status));assert.match(r.headers.get('cache-control'),/no-store/);assert.match(r.headers.get('vary'),/Authorization/);
  }
  const image=await fetch('http://127.0.0.1:5298/storage/v1/object/sign/user-images/public/preview.webp?token=fixture');
  assert.equal(image.status,200);assert.equal(image.headers.get('cache-control'),'public, max-age=3600');assert.equal(image.headers.get('etag'),'"fixture"');assert.equal(image.headers.get('content-type'),'image/webp');
  console.log('PASS Caddy: prefix/signing 401/403 are no-store and vary by Authorization; signed image GET keeps public caching and ETag');
}finally{
  caddy.kill();await new Promise(r=>caddy.exitCode!==null?r():caddy.once('exit',r));await new Promise(r=>upstream.close(r));
}
