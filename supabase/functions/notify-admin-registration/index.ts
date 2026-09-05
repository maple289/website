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

    const body = await req.json();
    const { email } = body;

    if (!email || typeof email !== "string") {
      return json({ error: "Email is required" }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: admins, error: adminErr } = await adminClient
      .from("profiles")
      .select("email")
      .eq("role", "admin");

    if (adminErr || !admins || admins.length === 0) {
      console.warn("No admins found to notify");
      return json({ success: true, notified: 0 });
    }

    const subject = "New Registration Pending Approval";
    const html = `
      <h2>New Registration Awaiting Approval</h2>
      <p>A new user has submitted a registration request:</p>
      <p><strong>Email:</strong> ${email}</p>
      <p>Please log in to the Admin Console to review and approve or reject this request.</p>
    `;

    let notified = 0;
    for (const admin of admins) {
      if (admin.email) {
        const sent = await sendEmail(admin.email, subject, html);
        if (sent) notified++;
      }
    }

    return json({ success: true, notified });
  } catch (err) {
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
