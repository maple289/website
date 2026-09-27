import { deliverEmail, customerEmailsEnabled } from "../_shared/email.ts";
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

async function verifyAdmin(supabaseUrl: string, serviceRoleKey: string, anonKey: string, token: string) {
  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !callerData.user) {
    return { authorized: false as const, status: 401, message: "Unauthorized" };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: profile, error: profileErr } = await adminClient
    .from("profiles")
    .select("role, email")
    .eq("id", callerData.user.id)
    .maybeSingle();

  if (profileErr || !profile || profile.role !== "admin") {
    return { authorized: false as const, status: 403, message: "Admin access required" };
  }
  return { authorized: true as const, userId: callerData.user.id, adminClient, callerClient };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const auth = await verifyAdmin(supabaseUrl, serviceRoleKey, anonKey, token);
    if (!auth.authorized) {
      return json({ error: auth.message }, auth.status);
    }
    const { userId, adminClient, callerClient } = auth;

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
      .select("id, email, status, first_name, last_name")
      .eq("id", registrationId)
      .maybeSingle();

    if (regErr || !registration) {
      return json({ error: "Registration not found" }, 404);
    }

    if (action === "approve") {
      // Use the caller's authenticated session, not a body-supplied administrator
      // ID. The RPC checks the admin role again and commits everything atomically.
      const { data: account, error: approvalError } = await callerClient.rpc("approve_pending_account", { p_registration_id: registrationId });
      if (approvalError) {
        console.error(JSON.stringify({ operation: "registration_approval", type: "transaction_failed", code: approvalError.code }));
        const useful = approvalError.message.includes("already exists") || approvalError.message.includes("email is invalid") || approvalError.message.includes("already been reviewed")
          ? approvalError.message : "Account creation could not be completed. The pending request was retained; please retry.";
        return json({ error: `Unable to approve user: ${useful}` }, approvalError.code === "42501" ? 403 : 409);
      }
      // Retain the existing user-email service/template behind the feature flag.
      // Delivery is never part of the account creation transaction.
      const notify = async () => {
        if (customerEmailsEnabled()) await deliverEmail(adminClient, registrationId, "registration_approved", registration.email,
          "Your Account Has Been Approved", "<h2>Your Account Has Been Approved</h2><p>Your account is ready for initial login. Sign in with your email and leave the password blank to create your password on the website.</p>");
      };
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(notify()); else await notify();
      return json({ success: true, user_id: account.user_id, must_change_password: true,
        message: "User approved successfully. The account has been created and is ready for initial login." });
    }
    if (registration.status !== "pending") return json({ error: "Registration has already been reviewed" }, 409);
    const { data: reviewed, error: reviewError } = await adminClient.from("pending_registrations")
      .update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: userId })
      .eq("id", registrationId).eq("status", "pending").select("id").maybeSingle();
    if (reviewError || !reviewed) return json({ error: "Unable to reject registration. Reload and try again." }, 409);
    if (customerEmailsEnabled()) await deliverEmail(adminClient, registrationId, "registration_rejected", registration.email,
      "Registration Update", "<h2>Registration Update</h2><p>Your registration request has not been approved at this time. If you believe this was an error, please contact an administrator.</p>");
    return json({ success: true, message: "Registration rejected." });
  } catch {
    console.error(JSON.stringify({ operation: "registration_review", type: "unexpected_error" }));
    return json({ error: "Internal server error" }, 500);
  }
});
