import { escapeHtml } from "./email.ts";

export function registrationTemplate(kind: "receipt" | "approved", firstName?: string | null) {
  const siteName = Deno.env.get("SITE_NAME")?.trim() || "Streamly";
  const configured = Deno.env.get("SITE_URL")?.trim() || "";
  const url = new URL(configured);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("SITE_URL must be a public HTTPS website address");
  url.search = ""; url.hash = "";
  const siteUrl = url.toString();
  url.hash = "/login";
  const loginUrl = url.toString();
  const approved = kind === "approved";
  const subject = approved ? "Your Account Has Been Approved" : "Registration Request Received";
  const greeting = firstName?.trim() ? `Hello ${firstName.trim()},` : "Hello,";
  const paragraphs = approved ? [
    `Your registration request for ${siteName} has been approved. Your account is now active.`,
    "For your first login, enter the email address you registered with and leave the password field blank. The website will immediately ask you to create and confirm your password before you can continue.",
    "After setting your password, use your email and new password for future logins. Blank-password login will no longer work.",
  ] : [
    `We have successfully received your registration request for ${siteName}. Your account is pending administrator approval.`,
    "We will send you another notification once an administrator approves your request. You do not need to submit another registration request.",
  ];
  const target = approved ? loginUrl : siteUrl;
  const label = approved ? "Sign in and set your password" : "Visit website";
  const text = `${subject}\n\n${greeting}\n\n${paragraphs.join("\n\n")}\n\n${label}: ${target}\n\n${siteName}\n${siteUrl}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#f5f7fa;color:#243247;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fa;"><tr><td style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5eaf1;border-radius:12px;"><tr><td style="padding:28px 24px;overflow-wrap:anywhere;word-break:break-word;">
<p style="margin:0 0 24px;color:#3867b0;font-weight:700;font-size:18px;">${escapeHtml(siteName)}</p>
<h1 style="margin:0 0 24px;font-size:24px;line-height:1.3;">${escapeHtml(subject)}</h1>
<p style="font-size:16px;line-height:1.6;">${escapeHtml(greeting)}</p>
${paragraphs.map(p => `<p style="font-size:16px;line-height:1.6;">${escapeHtml(p)}</p>`).join("")}
<p style="margin:28px 0;"><a href="${escapeHtml(target)}" style="display:inline-block;padding:13px 18px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;line-height:1.4;">${escapeHtml(label)}</a></p>
<p style="font-size:13px;line-height:1.6;color:#64748b;overflow-wrap:anywhere;">${escapeHtml(siteName)}<br><a href="${escapeHtml(siteUrl)}" style="color:#3867b0;word-break:break-all;">${escapeHtml(siteUrl)}</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}
