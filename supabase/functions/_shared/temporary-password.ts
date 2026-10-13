// A 64-character alphabet provides 72 bits of entropy in twelve symbols.
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const encode = (bytes: Uint8Array) => Array.from(bytes.slice(0, 12), byte => alphabet[byte & 63]).join('');
export const temporaryPassword = () => encode(crypto.getRandomValues(new Uint8Array(12)));
export async function approvalPassword(deliveryId: string, secret: string): Promise<string> {
  if (!secret) throw new Error('Credential delivery configuration unavailable');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`initial-password/v1/${deliveryId}`))));
}
export const passwordHash = async (password: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))), byte => byte.toString(16).padStart(2, '0')).join('');
export function appendTemporaryPassword(html: string, text: string | undefined, password: string, expires: string) {
  // Older queued approval notices may still contain the retired blank-password
  // instructions. Normalize only the outgoing copy, keeping the ledger intact.
  const legacy = [
    ['For your first login, enter the email address you registered with and leave the password field blank. The website will immediately ask you to create and confirm your password before you can continue.', 'Enter your registered email and the temporary password below in the normal sign-in form. Then choose your permanent password.'],
    ['After setting your password, use your email and new password for future logins. Blank-password login will no longer work.', 'After setting your permanent password, use it for future logins.'],
  ];
  for (const [old, replacement] of legacy) {
    html = html.replaceAll(old, replacement);
    text = (text || '').replaceAll(old, replacement);
  }
  const block = `<p>Temporary password: <strong>${password}</strong></p><p>Valid until: ${expires} (UTC). Enter it in the normal Password field, then choose your permanent password. If it expires, request a replacement from Sign in.</p>`;
  return { html: html.includes('</body>') ? html.replace('</body>', block + '</body>') : html + block,
    text: (text || '') + `\n\nTemporary password: ${password}\nValid until: ${expires} (UTC). Enter it in the normal Password field, then choose your permanent password. If it expires, request a replacement from Sign in.` };
}
