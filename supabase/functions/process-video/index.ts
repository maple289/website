import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization, Apikey, X-Client-Info","Content-Type":"application/json"};
Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("{}",{headers});
  if(req.method!=="POST") return new Response("{}",{headers,status:405});
  const client=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:req.headers.get("Authorization")??""}},auth:{persistSession:false}});
  const {data:{user}}=await client.auth.getUser();
  if(!user) return new Response(JSON.stringify({error:"Authentication required"}),{headers,status:401});
  // Processing is now automatic after queue-media-upload. Never trust caller
  // metadata or the former header-only parser as proof that media is ready.
  return new Response(JSON.stringify({error:"Upload through the validated media queue. Processing starts automatically."}),{headers,status:409});
});
