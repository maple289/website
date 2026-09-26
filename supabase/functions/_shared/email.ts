import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
export function safeEmailLog(value: unknown): string {
  let text = String(value ?? "Unknown error");
  const secret = Deno.env.get("RESEND_API_KEY");
  if (secret) text = text.split(secret).join("[REDACTED]");
  return text.replace(/re_[A-Za-z0-9_-]+/g, "[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 600);
}
export type EmailResult = { accepted: boolean; status: number; type?: string; message?: string; id?: string };
export async function sendEmail(message: { to: string; subject: string; html: string; operation: string; key: string }): Promise<EmailResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  // Sender identity is separate from the registered admin recipient list.
  const from = Deno.env.get("RESEND_FROM_EMAIL")?.trim();
  const fail = (status: number, type: string, error: unknown): EmailResult => {
    const result = { accepted: false, status, type: safeEmailLog(type), message: safeEmailLog(error) };
    console.error(JSON.stringify({ operation: message.operation, ...result }));
    return result;
  };
  if (!apiKey) return fail(0, "configuration_error", "RESEND_API_KEY missing");
  if (!from || /[\r\n]/.test(from)) return fail(0, "configuration_error", "RESEND_FROM_EMAIL missing or invalid");
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": message.key },
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const result = fail(response.status, body.name ?? "resend_error", body.message ?? "Resend returned an error without a message");
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          const delay = Math.min(5, Math.max(1, Number(response.headers.get("Retry-After")) || 1));
          await new Promise((resolve) => setTimeout(resolve, delay * 1000));
          continue;
        }
        return result;
      }
      if (typeof body.id !== "string") return fail(response.status, "invalid_response", "Resend did not return a message ID");
      console.info(JSON.stringify({ operation: message.operation, status: response.status, message_id: body.id, result: "accepted" }));
      return { accepted: true, status: response.status, id: body.id };
    }
    return fail(0, "retry_exhausted", "Email retries exhausted");
  } catch (error) {
    return fail(0, "transport_error", error instanceof Error ? error.message : "Email transport failed");
  }
}

// A persistent ledger and provider idempotency protect retries/concurrent requests.
async function deliverEmailImpl(client: SupabaseClient, registrationId: string, operation: string, to: string, subject: string, html: string): Promise<boolean> {
  const { error: queueError } = await client.from("registration_email_deliveries").upsert({
    registration_id: registrationId, operation, recipient: to, subject, html,
  }, { onConflict: "registration_id,operation,recipient", ignoreDuplicates: true });
  if (queueError) { console.error(JSON.stringify({ operation, type: "queue_error", message: safeEmailLog(queueError.message) })); return false; }
  const { data: delivery, error: readError } = await client.from("registration_email_deliveries").select("*")
    .eq("registration_id", registrationId).eq("operation", operation).eq("recipient", to).single();
  if (readError || !delivery) { console.error(JSON.stringify({ operation, type: "queue_read_error" })); return false; }
  if (delivery.status === "sent") return true;
  const { data: claimed, error: claimError } = await client.rpc("claim_registration_email", { delivery_id: delivery.id });
  if (claimError || !claimed) { console.warn(JSON.stringify({ operation, delivery_id: delivery.id, result: "deferred", type: claimError ? "claim_error" : "retry_guard" })); return false; }
  const result = await sendEmail({ to: delivery.recipient, subject: delivery.subject, html: delivery.html, operation, key: `registration/${delivery.id}` });
  const { error: saveError } = await client.from("registration_email_deliveries").update({
    status: result.accepted ? "sent" : "failed", message_id: result.id ?? null,
    ...(result.type === "configuration_error" && !delivery.first_attempt_at ? { attempts: 0, first_attempt_at: null } : {}),
    http_status: result.status, error_type: result.type ?? null, error_message: result.message ?? null,
  }).eq("id", delivery.id);
  if (saveError) console.error(JSON.stringify({ operation, delivery_id: delivery.id, type: "delivery_record_error" }));
  return result.accepted;
}

export async function deliverEmail(client: SupabaseClient, registrationId: string, operation: string, to: string, subject: string, html: string): Promise<boolean> {
  try { return await deliverEmailImpl(client, registrationId, operation, to, subject, html); }
  catch { console.error(JSON.stringify({ operation, type: "unexpected_delivery_failure" })); return false; }
}
