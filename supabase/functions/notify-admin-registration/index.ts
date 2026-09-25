import { deliverEmail, escapeHtml } from "../_shared/email.ts";
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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (email.length > 254 || !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) return json({ error: "Valid email is required" }, 400);
    for (const key of ["first_name", "last_name"]) {
      if (body[key] != null && (typeof body[key] !== "string" || [...body[key].trim()].length > 100)) return json({ error: "Names must be text, up to 100 characters" }, 400);
    }
    const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    // Insert and trigger delivery in the same backend request. Duplicate submissions
    // never create another account/request or overwrite the original applicant's data.
    const { error: insertError } = await client.from("pending_registrations").insert({
      email, first_name: body.first_name?.trim() || null, last_name: body.last_name?.trim() || null,
    });
    if (insertError && insertError.code !== "23505") {
      console.error(JSON.stringify({ operation: "registration", type: "database_error", code: insertError.code }));
      return json({ error: "Could not submit your request. Please try again." }, 500);
    }
    const { data: registration, error: lookupError } = await client.from("pending_registrations")
      .select("id,email,first_name,last_name,created_at,status").eq("email", email).maybeSingle();
    if (lookupError) console.error(JSON.stringify({ operation: "registration", type: "lookup_error", code: lookupError.code }));
    if (!registration || registration.status !== "pending") return json({ success: true });
    try {
      await deliverEmail(client, registration.id, "registration_receipt", registration.email,
        "Registration request received", "<h2>Thank you for registering</h2><p>Your request has been received and is awaiting administrator approval. You will receive an invitation to set your password after approval.</p>");
      const { data: admins, error: adminError } = await client.from("profiles").select("email").eq("role", "admin");
      const recipients = [...new Set((admins ?? []).map((admin) => admin.email?.trim()).filter(Boolean))] as string[];
      if (adminError || recipients.length === 0) console.error(JSON.stringify({ operation: "admin_registration_notification", type: "admin_recipient_missing" }));
      const html = `<h2>New User Registration</h2><p>A registration request is awaiting approval.</p>
        <p>Email: ${escapeHtml(registration.email)}</p><p>First Name: ${escapeHtml(registration.first_name ?? "")}</p>
        <p>Last Name: ${escapeHtml(registration.last_name ?? "")}</p><p>Registered: ${escapeHtml(registration.created_at)}</p>
        <p>Open the Admin Console to review this request.</p>`;
      for (const to of recipients) await deliverEmail(client, registration.id, "admin_registration_notification", to, "New User Registration", html);
    } catch {
      console.error(JSON.stringify({ operation: "registration_emails", type: "unexpected_delivery_failure" }));
    }
    // Mail failure does not undo registration or disclose account existence.
    return json({ success: true });
  } catch {
    console.error(JSON.stringify({ operation: "registration", type: "request_error" }));
    return json({ error: "Could not submit your request. Please try again." }, 500);
  }
});
