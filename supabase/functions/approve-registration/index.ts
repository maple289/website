import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const callerClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("role, email")
      .eq("id", callerData.user.id)
      .single();
    if (profileErr || !profile || profile.role !== "admin") {
      return json({ error: "Admin access required" }, 403);
    }

    const body = await req.json();
    const { action, registrationId } = body;

    if (!action || !registrationId) {
      return json({ error: "Action and registrationId are required" }, 400);
    }

    if (action !== "approve" && action !== "reject") {
      return json({ error: "Invalid action. Use 'approve' or 'reject'." }, 400);
    }

    const { data: registration, error: regErr } = await adminClient
      .from("pending_registrations")
      .select("id, email, password, status")
      .eq("id", registrationId)
      .single();

    if (regErr || !registration) {
      return json({ error: "Registration not found" }, 404);
    }

    if (registration.status !== "pending") {
      return json({ error: `Registration has already been ${registration.status}` }, 400);
    }

    if (action === "approve") {
      const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
        email: registration.email,
        password: registration.password,
        email_confirm: true,
      });

      if (createErr) {
        if (createErr.message.includes("already been registered") || createErr.message.includes("already exists")) {
          await adminClient
            .from("pending_registrations")
            .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: callerData.user.id })
            .eq("id", registrationId);
          return json({ success: true, message: "User already existed, registration marked as approved" });
        }
        return json({ error: createErr.message }, 400);
      }

      await adminClient
        .from("pending_registrations")
        .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: callerData.user.id, password: "" })
        .eq("id", registrationId);

      return json({ success: true, userId: newUser.user?.id });
    } else {
      await adminClient
        .from("pending_registrations")
        .update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: callerData.user.id, password: "" })
        .eq("id", registrationId);

      return json({ success: true });
    }
  } catch (err) {
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
