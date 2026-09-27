import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const headers = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type, Authorization, Apikey, X-Client-Info", "Content-Type":"application/json" };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers});
Deno.serve(async req => {
  if (req.method==="OPTIONS") return json({});
  if (req.method!=="POST") return json({error:"Method not allowed"},405);
  try {
    const client=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
    const token=(req.headers.get("Authorization")??"").replace(/^Bearer /i,"");
    const {data:{user},error:authError}=await client.auth.getUser(token);
    if(authError||!user) return json({error:"Please sign in to upload."},401);
    const text=await req.text();
    if(text.length>4096) return json({error:"Request too large"},413);
    const body=JSON.parse(text);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id??"")
      || !["video","photo","preview"].includes(body.kind)
      || typeof body.file_name!=="string" || !body.file_name.trim() || body.file_name.length>255
      || !["private","public"].includes(body.visibility)) return json({error:"Invalid upload request."},400);
    if ((body.kind === "preview" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.target_video_id ?? ""))
      || (body.kind !== "preview" && body.target_video_id != null)) return json({error:"Invalid preview target."},400);
    const {data,error}=await client.rpc("queue_media_upload",{p_id:body.id,p_owner:user.id,p_kind:body.kind,
      p_name:body.file_name,p_visibility:body.visibility,p_preview:body.has_preview===true,p_video:body.target_video_id??null});
    if(error) {
      console.error(JSON.stringify({operation:"queue_media_upload",code:error.code}));
      const useful=["Too many pending uploads.","Upload is incomplete","Video not found"].find(v=>error.message.startsWith(v));
      return json({error:useful ? error.message : "Could not queue the upload. Please try again."},409);
    }
    return json({id:data,status:"queued"},202);
  } catch { return json({error:"Could not queue the upload."},400); }
});
