import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, GET, HEAD, OPTIONS',
 'Access-Control-Allow-Headers':'Authorization, Apikey, Content-Type, X-Client-Info, Range, If-None-Match',
 'Access-Control-Expose-Headers':'Content-Range, Accept-Ranges, Content-Length, ETag',
 'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json'}});
const safePath=(value:unknown):value is string=>typeof value==='string'&&value.length<2048&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[\\\p{Cc}]/u.test(p));
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(!['POST','GET','HEAD'].includes(req.method))return json({error:'Method not allowed'},405);
 try {
  const url=new URL(req.url),operation=req.headers.get('X-Library-Storage-Operation'),bucket=req.headers.get('X-Library-Storage-Bucket');
  // Kong strips only the operation/bucket prefix. Keep the object key in the
  // URI so Unicode and percent escapes do not pass through HTTP header encoding.
  let key:string;try{key=decodeURIComponent(url.pathname.match(/\/library-storage-sign(?:\/(.*))?$/)?.[1]||'');}catch{return json({error:'Invalid object'},400);}
  if(operation!=='object/sign'||!['user-videos','user-images','user-files','users'].includes(bucket||'')||!safePath(key))return json({error:'Unsupported signing request'},400);
  const base=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin=createClient(base,serviceKey,{auth:{persistSession:false}});
  let resource;
  if(req.method==='POST') {
   const body=await req.text();if(body.length>2048)return json({error:'Invalid signing request'},400);
   const options=JSON.parse(body);if(options.transform||options.paths||!Number.isSafeInteger(options.expiresIn)||options.expiresIn<1)return json({error:'Unsupported signing request'},400);
   let userId:string|null=null,sessionId:string|null=null;
   const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
   if(token&&token!==anon) {
    const client=createClient(base,anon,{auth:{persistSession:false}});
    const {data,error}=await client.auth.getUser(token);if(error||!data.user)return json({error:'Please sign in'},401);
    const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    if(!uuid(claims.session_id))return json({error:'Please sign in'},401);
    userId=data.user.id;sessionId=claims.session_id;
   }
   const {data,error}=await admin.rpc('resolve_library_storage_link',{p_bucket:bucket,p_key:key,p_user:userId,p_session:sessionId});
   if(error||!data)return json({error:'Object unavailable or access denied'},403);resource=data;
   const {data:budget,error:budgetError}=await admin.rpc('claim_public_request',{p_bucket:'library-storage-link',p_seconds:60,p_limit:4000});
   if(budgetError||!budget)return json({error:'Please retry shortly'},429);
   let query='public=1&type='+resource.resource_type+'&role='+resource.media_role;
   if(!resource.public) {
    if(!userId||!sessionId)return json({error:'Please sign in'},401);
    const access=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    const {error:saved}=await admin.from('library_storage_link_grants').insert({token_hash:await hash(access),
     resource_type:resource.resource_type,resource_id:resource.resource_id,media_role:resource.media_role,user_id:userId,session_id:sessionId,
     expires_at:new Date(Date.now()+Math.min(options.expiresIn,3600)*1000).toISOString()});
    if(saved)return json({error:'Signing unavailable'},503);query='access='+access;
    await admin.from('library_storage_link_grants').delete().lt('expires_at',new Date().toISOString());
   }
   // Storage SDK prepends its /storage/v1 base to signedURL. Preserve the old
   // route shape while replacing provider JWTs with live-authorized reads.
   return json({signedURL:'/object/sign/'+bucket+'/'+resource.resource_id+'?'+query});
  }
  const access=url.searchParams.get('access');
  if(access&&!/^[a-f0-9]{64}$/.test(access))return json({error:'Object unavailable'},403);
  const identityLink=url.searchParams.has('type')||url.searchParams.has('role');
  if(identityLink&&(!uuid(key)||!['video','photo','file'].includes(url.searchParams.get('type')||'')
   ||!['original','final','preview','thumbnail','file'].includes(url.searchParams.get('role')||'')))return json({error:'Invalid object'},400);
  const result=access?await admin.rpc('check_library_storage_link',{p_hash:await hash(access)})
   :identityLink?await admin.rpc('resolve_public_library_link',{p_type:url.searchParams.get('type'),p_id:key,p_role:url.searchParams.get('role')})
   :await admin.rpc('resolve_library_storage_link',{p_bucket:bucket,p_key:key,p_user:null,p_session:null});
  if(result.error||!result.data||!access&&!result.data.public)return json({error:'Object unavailable or access expired'},403);resource=result.data;
  if(!['user-videos','user-images','user-files','users'].includes(resource.bucket)||!safePath(resource.object_path))return json({error:'Object unavailable'},404);
  const forward:Record<string,string>={Authorization:'Bearer '+serviceKey,apikey:serviceKey};
  for(const name of ['Range','If-None-Match'])if(req.headers.has(name))forward[name]=req.headers.get(name)!;
  const upstream=await fetch(base+'/storage/v1/object/authenticated/'+resource.bucket+'/'+resource.object_path.split('/').map(encodeURIComponent).join('/'),
   {method:req.method,headers:forward,redirect:'error',signal:req.signal});
  if(!upstream.ok&&![304,416].includes(upstream.status))return json({error:'Object unavailable'},404);
  const output:Record<string,string>={...headers,'Content-Type':resource.mime||'application/octet-stream',
   'Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(resource.name||'file').replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`};
  if(!access)output['Cache-Control']='public, max-age=0, must-revalidate';
  for(const name of ['Content-Range','Accept-Ranges','Content-Length','ETag']){const value=upstream.headers.get(name);if(value)output[name]=value;}
  return new Response(req.method==='HEAD'||upstream.status===304?null:upstream.body,{status:upstream.status,headers:output});
 }catch{return json({error:'Storage link unavailable'},503);}
});
