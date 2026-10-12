// Finite, serial, read-only production probes. No login, uploads or mutations.
import { readFile, writeFile } from 'node:fs/promises';
const env = Object.fromEntries((await readFile('.env','utf8')).split(/\r?\n/).filter(x=>x && !x.startsWith('#') && x.includes('=')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const origin = 'https://myhostage.ca';
let key = env.VITE_SUPABASE_ANON_KEY;
const results = [];
async function probe(label, path, options={}) {
  const start=performance.now();
  try {
    const response=await fetch(origin+path,{...options,redirect:'manual',signal:AbortSignal.timeout(15000)});
    const body=await response.text();
    const headers=Object.fromEntries(['content-type','content-length','cache-control','content-security-policy','strict-transport-security','x-content-type-options','x-frame-options','referrer-policy','permissions-policy','server','location','access-control-allow-origin'].map(k=>[k,response.headers.get(k)]));
    let parsed; try{parsed=JSON.parse(body);}catch{}
    const item={label,status:response.status,milliseconds:Math.round(performance.now()-start),bytes:Buffer.byteLength(body),headers,...(Array.isArray(parsed)?{rowCount:parsed.length}:{}),...(parsed?.code?{errorCode:parsed.code}:{})};
    results.push(item); return {item,body,parsed};
  } catch(error) {results.push({label,error:error.name});return {};}
}
await probe('root','/');
const home=await probe('frontend','/video/');
await probe('healthz','/healthz');
const script=home.body?.match(/src="([^"]+\.js)"/);
if(script) {
  const initial=await probe('frontend-main-asset',script[1]);
  // The bundled anon key is deliberately public. Use that production key for
  // RLS probes; never print it or read any signed-in browser credentials.
  for(const candidate of initial.body?.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)??[]) {
    try {if(JSON.parse(Buffer.from(candidate.split('.')[1],'base64url')).role==='anon') {key=candidate;break;}}catch{}
  }
  const messenger=initial.body?.match(/(?:assets\/)?(Messenger-[A-Za-z0-9_-]+\.js)/);
  if(messenger) {
    const asset=await probe('frontend-messenger-asset','/video/assets/'+messenger[1]);
    asset.item.completeCardRemovalText=asset.body?.includes('Remove this complete message for everyone.');
    asset.item.legacyDeletedPlaceholderText=asset.body?.includes('This message was deleted');
  }
}
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
await probe('auth-settings','/auth/v1/settings',{headers});
for(const table of ['videos','photos','profiles','pending_registrations','messenger_messages','messenger_attachments','temporary_content_shares','storage_settings']) {
  const data=await probe('anonymous-'+table,'/rest/v1/'+table+'?select=*&limit=5',{headers});
  if(['videos','photos'].includes(table) && Array.isArray(data.parsed)) data.item.nonPublicRows=data.parsed.filter(x=>x.visibility!=='public').length;
}
for(const endpoint of ['admin-users','storage-settings','messenger-media','messenger-calls']) await probe('anonymous-'+endpoint,'/functions/v1/'+endpoint,{headers});
for(const [rpc,body] of [['messenger_rpc',{p_action:'inbox',p_conversation:null,p_data:{}}],['list_public_user_files',{p_folder:null,p_query:'',p_offset:0}]]) {
  const data=await probe('anonymous-rpc-'+rpc,'/rest/v1/rpc/'+rpc,{method:'POST',headers,body:JSON.stringify(body)});
  if(Array.isArray(data.parsed)) data.item.responseFieldNames=[...new Set(data.parsed.flatMap(x=>Object.keys(x)))];
}
await probe('invalid-public-file','/functions/v1/serve-public-file?id=00000000-0000-4000-8000-000000000000',{headers});
await probe('invalid-temporary-link','/functions/v1/temporary-share?token='+'0'.repeat(64),{headers});
await probe('temporary-route-frontend','/video/share/'+'0'.repeat(64));
await probe('legacy-root-share-route','/share/'+'0'.repeat(64));
await writeFile('audit/20261011/public-health.json',JSON.stringify({time:new Date().toISOString(),sourceCommit:'5c26cf7',results},null,2));
console.log(JSON.stringify(results.map(({headers,...r})=>({...r,securityHeaders:{csp:!!headers?.['content-security-policy'],hsts:!!headers?.['strict-transport-security'],nosniff:headers?.['x-content-type-options'],frame:headers?.['x-frame-options'],referrer:headers?.['referrer-policy']}})),null,2));
