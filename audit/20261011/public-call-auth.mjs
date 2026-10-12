// One read-only call configuration probe; no call/credential creation.
import fs from 'node:fs/promises';
const origin='https://myhostage.ca';
const page=await (await fetch(origin+'/video/',{signal:AbortSignal.timeout(15000)})).text();
const script=page.match(/src="([^"]+\.js)"/)?.[1];
if(!script)throw new Error('Public frontend entrypoint unavailable');
const source=await (await fetch(new URL(script,origin),{signal:AbortSignal.timeout(15000)})).text();
const key=(source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]).find(value=>{
 try{return JSON.parse(Buffer.from(value.split('.')[1],'base64url')).role==='anon';}catch{return false;}
});
if(!key)throw new Error('Public anon API key unavailable');
const response=await fetch(origin+'/functions/v1/messenger-calls',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({action:'configuration'}),signal:AbortSignal.timeout(15000)});
const result={check:'Unauthenticated POST call configuration',status:response.status,cacheControl:response.headers.get('cache-control'),credentialsStored:false};
await fs.writeFile('audit/20261011/public-call-auth.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
