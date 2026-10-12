// Actual Caddy routes/policy, local synthetic assets, never production hosting.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
if(!process.env.CADDY_BIN)throw Error('Set CADDY_BIN to a verified Caddy binary.');
const root=path.resolve('.runtime/serving-security').replaceAll('\\','/');
await fs.mkdir(root+'/site',{recursive:true});await fs.mkdir(root+'/cache/assets',{recursive:true});
await fs.writeFile(root+'/site/index.html','<!doctype html><title>Serving fixture</title><h1>Fixture</h1><script src="/assets/current-1234.js"></script>');
await fs.writeFile(root+'/cache/assets/current-1234.js','window.__allowed=true;');
await fs.writeFile(root+'/cache/assets/retained-5678.js','window.__retained=true;');
const original=await fs.readFile('docker/Caddyfile','utf8');
const config=`{\n admin off\n persist_config off\n auto_https off\n storage file_system {\n root "${root}/state"\n }\n}\n`+original.replace('{$APP_ADDRESS}','http://127.0.0.1:5297').replaceAll('/asset-cache',root+'/cache').replaceAll('/srv',root+'/site');
await fs.writeFile(root+'/Caddyfile',config);
let logs='';const server=spawn(process.env.CADDY_BIN,['run','--config',root+'/Caddyfile','--adapter','caddyfile'],{windowsHide:true,env:{...process.env,SUPABASE_API_UPSTREAM:'127.0.0.1:9'},stdio:['ignore','ignore','pipe']});
server.stderr.on('data',data=>logs+=data.toString());let browser;
try {
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){try{ready=(await fetch('http://127.0.0.1:5297/healthz')).ok;if(ready)break;}catch{/* startup */}if(server.exitCode!==null)throw Error('Caddy failed: '+logs);await new Promise(resolve=>setTimeout(resolve,50));}
  assert.ok(ready,'Local Caddy ready');
  const missing=await fetch('http://127.0.0.1:5297/assets/missing-9999.js');assert.equal(missing.status,404);assert.equal(await missing.text(),'Asset not found');assert.equal(missing.headers.get('cache-control'),'no-store');
  const retained=await fetch('http://127.0.0.1:5297/assets/retained-5678.js');assert.equal(retained.status,200);assert.match(retained.headers.get('cache-control'),/immutable/);
  const html=await fetch('http://127.0.0.1:5297/');assert.equal(html.headers.get('cache-control'),'no-cache');assert.match(html.headers.get('strict-transport-security'),/31536000/);assert.match(html.headers.get('permissions-policy'),/microphone=\(self\)/);
  browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});const page=await browser.newPage();await page.goto('http://127.0.0.1:5297/');
  assert.equal(await page.evaluate(()=>window.__allowed),true);
  assert.equal(await page.evaluate(async()=>{const script=document.createElement('script');script.textContent='window.__untrusted=true';document.head.append(script);await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));return window.__untrusted===undefined;}),true);
  console.log('PASS actual Caddy: missing asset 404/no-store, retained asset immutable, HTML revalidation, security headers, self JS, blocked inline JS and permitted WASM');
}finally{await browser?.close();server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));}
