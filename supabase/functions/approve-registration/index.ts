import { deliverEmail, safeEmailLog } from "../_shared/email.ts";
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
  return { authorized: true as const, userId: callerData.user.id, adminClient };
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
    const { userId, adminClient } = auth;

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

    const desiredStatus = action === "approve" ? "approved" : "rejected";
    if (registration.status !== "pending" && registration.status !== desiredStatus) {
      return json({ error: `Registration has already been ${registration.status}` }, 400);
    }
    let existingAccount = false;
    if (registration.status === "pending") {
      if (action === "approve") {
        const { error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(registration.email, {
          redirectTo: `${Deno.env.get("SITE_URL") ?? ""}/`,
          data: { first_name: registration.first_name, last_name: registration.last_name },
        });
        if (inviteErr) {
          existingAccount = inviteErr.message.includes("already been registered") || inviteErr.message.includes("already exists");
          console.error(JSON.stringify({ operation: "auth_invitation", status: inviteErr.status, type: inviteErr.name, message: safeEmailLog(inviteErr.message) }));
          if (!existingAccount) return json({ error: "Could not send the account invitation. Check the authentication SMTP configuration and server logs." }, 400);
        } else {
          console.info(JSON.stringify({ operation: "auth_invitation", result: "accepted" }));
        }
      }
      const { data: reviewed, error: reviewError } = await adminClient.from("pending_registrations")
        .update({ status: desiredStatus, reviewed_at: new Date().toISOString(), reviewed_by: userId })
        .eq("id", registrationId).eq("status", "pending").select("id").maybeSingle();
      if (reviewError || !reviewed) {
        console.error(JSON.stringify({ operation: "registration_review", type: "review_update_failed", code: reviewError?.code }));
        return json({ error: "Could not confirm the review status. Reload the registration list before retrying." }, 409);
      }
    }
    // Repeating the same completed review retries only its unsent notification;
    // it never invites/creates another account or repeats a successful email.
    const approved = action === "approve";
    const accepted = await deliverEmail(adminClient, registrationId,
      approved ? "registration_approved" : "registration_rejected", registration.email,
      approved ? "Your Account Has Been Approved" : "Registration Update",
      approved
        ? `<h2>Your Account Has Been Approved</h2><p>Good news! Your registration has been approved by an administrator.</p><p>${existingAccount ? "You can sign in using your existing account." : "Use your account invitation email to set your password and activate your account."}</p>`
        : "<h2>Registration Update</h2><p>Your registration request has not been approved at this time. If you believe this was an error, please contact an administrator.</p>",
    );
    return json({ success: true, email_accepted: accepted,
      ...(accepted ? {} : { warning: "The registration review was saved, but its notification email was not confirmed. Check server email logs before retrying the notification." }),
    });
  } catch {
    console.error(JSON.stringify({ operation: "registration_review", type: "unexpected_error" }));
    return json({ error: "Internal server error" }, 500);
  }
});
