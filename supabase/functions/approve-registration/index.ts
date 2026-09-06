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

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("RESEND_API_KEY not configured, skipping email send");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "noreply@bolt.new",
        to,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Resend API error (${res.status}): ${text}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to send email:", err);
    return false;
  }
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

    const userEmail = registration.email;

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

          await sendEmail(
            userEmail,
            "Your Account Has Been Approved",
            `<h2>Your Account Has Been Approved</h2>
             <p>Good news! Your registration has been approved by an administrator.</p>
             <p>You can now sign in to your account using your email and password.</p>`,
          );

          return json({ success: true, message: "User already existed, registration marked as approved" });
        }
        return json({ error: createErr.message }, 400);
      }

      await adminClient
        .from("pending_registrations")
        .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: callerData.user.id, password: "" })
        .eq("id", registrationId);

      await sendEmail(
        userEmail,
        "Your Account Has Been Approved",
        `<h2>Your Account Has Been Approved</h2>
         <p>Good news! Your registration has been approved by an administrator.</p>
         <p>You can now sign in to your account using your email and password.</p>`,
      );

      return json({ success: true, userId: newUser.user?.id });
    } else {
      await adminClient
        .from("pending_registrations")
        .update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: callerData.user.id, password: "" })
        .eq("id", registrationId);

      await sendEmail(
        userEmail,
        "Registration Update",
        `<h2>Registration Update</h2>
         <p>We're writing to let you know that your registration request has not been approved at this time.</p>
         <p>If you believe this was an error, please contact an administrator.</p>`,
      );

      return json({ success: true });
    }
  } catch (err) {
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
