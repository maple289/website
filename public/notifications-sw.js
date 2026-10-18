/* No fetch handler or media cache: existing playback/network paths stay intact. */
importScripts('./notification-core.js');
const core = self.MyhostageNotifications;
const base = self.registration.scope;
const inScope = client => client.url.startsWith(base);
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(Promise.all([self.clients.claim(), core.prune(), reconcileCalls()])));

async function closeCall(payload, owner) {
  await core.put(`closed:${owner}:${payload.call_id}`, Date.now());
  const notifications = await self.registration.getNotifications({ tag: core.tag(payload) });
  notifications.filter(notification => notification.data?.owner === owner).forEach(notification => notification.close());
}
async function reconcileCalls(owner, activeCalls) {
  if (!self.Notification || self.Notification.permission !== 'granted' || !self.registration.getNotifications) return;
  const binding = await core.get('binding');
  if (!binding?.user_id || (owner && binding.user_id !== owner)) return;
  const notifications = await self.registration.getNotifications();
  for (const notification of notifications) {
    const payload = notification.data;
    if (payload?.owner !== binding.user_id || !core.uuid(payload.call_id)) continue;
    if (Date.parse(payload.expires_at) <= Date.now() || (Array.isArray(activeCalls) && !activeCalls.includes(payload.call_id))
      || await core.get(`closed:${binding.user_id}:${payload.call_id}`)) await closeCall(payload, binding.user_id);
  }
}
function foreground(client, payload) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 1500);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close(); resolve(event.data === 'handled');
    };
    client.postMessage({ type: 'messenger-notification', payload }, [channel.port2]);
  });
}
async function deliver(payload, source, owner) {
  const binding = await core.get('binding');
  if (!binding?.user_id || (payload?.device_id && payload.device_id !== binding.device_id)) return;
  const pushed = source === 'push';
  if (!pushed && binding.user_id !== owner) return;
  if (pushed && !binding.device_id) return;
  let quiet = false;
  if (!core.valid(payload)) {
    if (!pushed) return;
    // A late call invitation must never resume ringing. Apple also requires a
    // user-visible notification for every real push, including malformed/late
    // payloads; a silent page handoff can revoke its push subscription.
    const lateCall = ['voice', 'video', 'call-closed'].includes(payload?.kind)
      && Number.isFinite(Date.parse(payload.expires_at)) && Date.parse(payload.expires_at) <= Date.now()
      && core.valid({ ...payload, expires_at: new Date(Date.now() + 1000).toISOString() });
    payload = lateCall ? { ...payload, kind: 'call-closed', body: 'Missed call' }
      : { kind: 'update', sender_name: 'myhostage', body: 'Open Messenger for updates' };
    quiet = true;
  }
  if (payload.kind === 'call-closed') {
    if (!pushed) { await closeCall(payload, binding.user_id); return; }
    await core.put(`closed:${binding.user_id}:${payload.call_id}`, Date.now());
    // The backend never sends close-only pushes. An obsolete/in-flight real
    // invitation still needs a visible effect under Safari's push policy.
    payload = { ...payload, sender_name: payload.sender_name || 'myhostage', body: 'Missed call' };
    quiet = true;
  }
  const preferences = await core.get(`preferences:${binding.user_id}`);
  if ((payload.kind === 'message' && preferences?.notify_messages === false)
    || (payload.kind === 'voice' && preferences?.notify_voice_calls === false)
    || (payload.kind === 'video' && preferences?.notify_video_calls === false)) {
    if (!pushed) return;
    // Preferences are rechecked server-side before sending. An already accepted
    // provider request cannot be recalled, so keep that rare update private.
    payload = { kind: 'update', sender_name: 'myhostage', body: 'Open Messenger for updates' }; quiet = true;
  }
  if (payload.kind === 'message' && preferences?.show_message_preview === false) payload = { ...payload, body: 'New message' };
  if (payload.call_id && payload.kind !== 'call-closed' && await core.get(`closed:${binding.user_id}:${payload.call_id}`)) {
    if (!pushed) return;
    payload = { ...payload, kind: 'call-closed', body: 'Missed call' }; quiet = true;
  }
  if (!pushed) {
    const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(inScope);
    const visible = windows.filter(client => client.visibilityState === 'visible' && client.focused);
    // Pages acquire a server delivery lease BEFORE asking us to deliver. The
    // dispatcher waits for their ACK instead of sending a silent foreground push.
    if (visible.length && await foreground(visible[0], payload)) return;
  }
  if (!binding.device_id) return;
  const fresh = payload.id ? await core.claim(payload.id, binding.user_id) : true;
  if (!fresh && !pushed) return;
  // An endpoint can be disabled while the delivery is in flight.
  const current = await core.get('binding');
  if (current?.user_id !== binding.user_id || current.device_id !== binding.device_id) return;
  if (self.Notification.permission !== 'granted') return;
  try { await self.registration.showNotification(payload.sender_name, {
    body: payload.body, tag: payload.kind === 'update' ? 'messenger-update' : core.tag(payload), renotify: false,
    silent: quiet || !fresh || payload.sound === false || preferences?.sound_enabled === false,
    icon: new URL('icons/icon-192.png', base).href,
    badge: new URL('myhostage.svg', base).href,
    data: { ...payload, owner: binding.user_id },
    // An open page reconciles call state and closes ended alerts without a new
    // notification. The expiry timer is best effort while the SW remains awake.
    requireInteraction: false,
  }); } catch (cause) {
    // A transient display failure must not permanently consume a realtime ID.
    if (fresh && payload.id) await core.put(`event:${binding.user_id}:${payload.id}`, undefined);
    throw cause;
  }
  if (payload.call_id && payload.kind !== 'call-closed') setTimeout(() => void closeCall(payload, binding.user_id), Math.max(0, Date.parse(payload.expires_at) - Date.now()));
}
self.addEventListener('push', event => {
  let payload;
  try { if (event.data && event.data.text().length <= 6000) payload = event.data.json(); } catch { /* Use a private generic update for an invalid payload. */ }
  event.waitUntil(deliver(payload, 'push').catch(() => undefined));
});
self.addEventListener('message', event => {
  if (!event.source || !inScope(event.source)) return;
  const operation = event.data?.type === 'deliver-notification' ? deliver(event.data.payload, 'page', event.data.owner)
    : event.data?.type === 'reconcile-call-notifications' && core.uuid(event.data.owner) ? reconcileCalls(event.data.owner, event.data.active_calls)
    : event.data?.type === 'clear-notifications' && core.uuid(event.data.owner) ? self.registration.getNotifications().then(items => items.filter(item => item.data?.owner === event.data.owner).forEach(item => item.close()))
    : Promise.resolve();
  event.waitUntil(operation.then(() => event.ports[0]?.postMessage('handled')).catch(() => event.ports[0]?.postMessage('failed')));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const payload = event.notification.data;
  event.waitUntil((async () => {
    const binding = await core.get('binding');
    if (binding?.user_id !== payload?.owner || (payload?.kind !== 'update' && !core.uuid(payload?.conversation_id))) return;
    if (payload.device_id && binding.device_id !== payload.device_id) return;
    // Routing data is validated; never navigate to an arbitrary push-supplied URL.
    if (payload.call_id && !core.uuid(payload.call_id)) return;
    const url = new URL(base); url.hash = payload.kind === 'update' ? '/messages' : core.route(payload).slice(1);
    const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(inScope).sort((a, b) => Number(b.focused) - Number(a.focused));
    if (windows[0]) {
      const client = await windows[0].focus();
      const channel = new MessageChannel();
      const handled = new Promise(resolve => {
        const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 1000);
        channel.port1.onmessage = () => { clearTimeout(timer); channel.port1.close(); resolve(true); };
      });
      client.postMessage({ type: 'open-messenger-notification', payload }, [channel.port2]);
      // The running page uses its router without reloading an active call/media.
      if (!await handled && client.url !== url.href) await client.navigate(url.href);
    } else await self.clients.openWindow(url.href);
  })());
});
