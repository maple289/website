import { deliverEmail, escapeHtml } from "../_shared/email.ts";
import { registrationTemplate } from "../_shared/registration-templates.ts";
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
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) return json({ error: "Valid email is required" }, 400);
    for (const key of ["first_name", "last_name"]) {
      if (body[key] != null && (typeof body[key] !== "string" || [...body[key].trim()].length > 100)) return json({ error: "Names must be text, up to 100 characters" }, 400);
    }
    const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const { data: existingAccount, error: accountError } = await client.rpc("registration_email_exists", { p_email: email });
    if (accountError) return json({ error: "Could not submit your request. Please try again." }, 500);
    if (existingAccount) {
      console.info(JSON.stringify({ operation: "registration", result: "existing_account" }));
      return json({ error: "This email address already exists. Please enter another email address, or sign in to your existing account.", code: "EMAIL_ALREADY_REGISTERED" }, 409);
    }
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
    if (lookupError || !registration) {
      console.error(JSON.stringify({ operation: "registration", type: "lookup_error", code: lookupError?.code }));
      return json({ error: "Could not confirm your request. Please try again." }, 500);
    }
    if (registration.status !== "pending") {
      console.info(JSON.stringify({ operation: "registration", result: "already_reviewed", registration_id: registration.id, status: registration.status }));
      return json({ error: "A registration request for this email has already been reviewed. Please enter another email address, or contact an administrator about your previous request.", code: "REGISTRATION_ALREADY_REVIEWED" }, 409);
    }
    console.info(JSON.stringify({ operation: "registration", result: insertError ? "existing_pending" : "pending_saved", registration_id: registration.id }));
    const sendNotifications = async () => { try {
      // Template/configuration failures must not prevent administrator delivery.
      try {
        const mail = registrationTemplate("receipt", registration.first_name);
        await deliverEmail(client, registration.id, "registration_receipt", registration.email, mail.subject, mail.html, mail.text);
      } catch { console.error(JSON.stringify({ operation: "registration_receipt", type: "template_configuration_error" })); }
      const { data: admins, error: adminError } = await client.from("profiles").select("email").eq("role", "admin");
      const registeredAdmins = new Set((admins ?? []).map((admin) => admin.email?.trim().toLowerCase()).filter(Boolean));
      // An optional server-side list limits notifications without changing roles.
      // Listed addresses must still belong to registered administrators.
      const configuredRecipients = Deno.env.get("ADMIN_NOTIFICATION_RECIPIENTS")?.trim();
      const recipients = configuredRecipients
        ? [...new Set(configuredRecipients.split(",").map((email) => email.trim().toLowerCase()).filter((email) => registeredAdmins.has(email)))]
        : [...registeredAdmins] as string[];
      if (adminError || recipients.length === 0) console.error(JSON.stringify({ operation: "admin_registration_notification", type: "admin_recipient_missing" }));
      else console.info(JSON.stringify({ operation: "admin_registration_notification", result: "recipients_loaded", count: recipients.length, registration_id: registration.id }));
      const html = `<h2>New User Registration</h2><p>A registration request is awaiting approval.</p>
        <p>Email: ${escapeHtml(registration.email)}</p><p>First Name: ${escapeHtml(registration.first_name ?? "")}</p>
        <p>Last Name: ${escapeHtml(registration.last_name ?? "")}</p><p>Registered: ${escapeHtml(registration.created_at)}</p>
        <p>Open the Admin Console to review this request.</p>`;
      const text = `New User Registration\n\nEmail: ${registration.email}\nFirst Name: ${registration.first_name ?? ""}\nLast Name: ${registration.last_name ?? ""}\nRegistered: ${registration.created_at}\n\nOpen the Admin Console to review this request.`;
      for (const to of recipients) await deliverEmail(client, registration.id, "admin_registration_notification", to, "New User Registration", html, text);
    } catch {
      console.error(JSON.stringify({ operation: "registration_emails", type: "unexpected_delivery_failure" }));
    } };
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(sendNotifications());
    else await sendNotifications();
    // Preserve safe retries of failed notifications for an existing pending
    // request, while clearly explaining that another request was not created.
    if (insertError) return json({ error: "A registration request for this email is already awaiting administrator approval. Please wait for approval, or enter another email address.", code: "REGISTRATION_ALREADY_PENDING" }, 409);
    // Mail failure does not undo a successfully saved registration.
    return json({ success: true });
  } catch {
    console.error(JSON.stringify({ operation: "registration", type: "request_error" }));
    return json({ error: "Could not submit your request. Please try again." }, 500);
  }
});
