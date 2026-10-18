import { supabase } from './supabase';
import { authenticatedRequest } from './authSession';

export type NotificationPreferences = { notify_messages: boolean; notify_voice_calls: boolean; notify_video_calls: boolean; show_message_preview: boolean; sound_enabled: boolean };
export type MessengerNotification = { id: string; kind: 'message' | 'voice' | 'video' | 'call-closed'; conversation_id: string; message_id?: string; call_id?: string; sender_name: string; body: string; sound?: boolean; expires_at: string; device_id?: string };
export type NotificationSettings = { preferences: NotificationPreferences; available: boolean; public_key: string | null; muted_conversations?: string[] };
export const defaultNotificationPreferences: NotificationPreferences = { notify_messages: true, notify_voice_calls: true, notify_video_calls: true, show_message_preview: true, sound_enabled: true };
export type NotificationBinding = { user_id: string; device_id?: string };
type NotificationCore = {
  uuid: (value: unknown) => boolean; valid: (value: unknown) => boolean;
  get: <T>(key: string) => Promise<T | undefined>; put: (key: string, value: unknown) => Promise<void>;
  clearBinding: (owner?: string) => Promise<NotificationBinding | undefined>;
  claim: (id: string, owner: string) => Promise<boolean>; prune: () => Promise<void>;
  tag: (payload: MessengerNotification) => string; route: (payload: MessengerNotification) => string;
};
declare global { interface Window { MyhostageNotifications?: NotificationCore; } }
let corePromise: Promise<NotificationCore> | undefined;
export function notificationCore(): Promise<NotificationCore> {
  if (window.MyhostageNotifications) return Promise.resolve(window.MyhostageNotifications);
  if (!corePromise) corePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = `${import.meta.env.BASE_URL}notification-core.js`;
    const failed = () => { window.clearTimeout(timer); corePromise = undefined; script.remove(); reject(new Error('Could not load notifications')); };
    const timer = window.setTimeout(failed, 8000);
    script.onload = () => { window.clearTimeout(timer); if (window.MyhostageNotifications) resolve(window.MyhostageNotifications); else failed(); };
    script.onerror = failed;
    document.head.appendChild(script);
  });
  return corePromise;
}
export async function notificationRequest<T>(action: string, data: object = {}): Promise<T> {
  const result = await authenticatedRequest(() => supabase.rpc('messenger_notifications_rpc', { p_action: action, p_data: data }));
  if (result.error) throw new Error(result.error.message || 'Could not update notifications');
  if (action === 'settings' || action === 'preferences') {
    const value = result.data as NotificationSettings | null;
    if (!value || !value.preferences || typeof value.available !== 'boolean'
      || (value.public_key !== null && typeof value.public_key !== 'string')
      || Object.keys(defaultNotificationPreferences).some(key => typeof value.preferences[key as keyof NotificationPreferences] !== 'boolean')
      || (value.muted_conversations !== undefined && (!Array.isArray(value.muted_conversations) || value.muted_conversations.some(id => typeof id !== 'string')))) {
      throw new Error('Notification settings are unavailable. Please try again.');
    }
  }
  return result.data as T;
}
let registrationPromise: Promise<ServiceWorkerRegistration | null> | undefined;
export function notificationWorker() {
  if (!registrationPromise) registrationPromise = (async () => {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}notifications-sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' });
    if (!registration.active) await new Promise<void>((resolve, reject) => {
      const worker = registration.installing || registration.waiting;
      if (!worker) { reject(new Error('Notification service worker unavailable')); return; }
      const timer = window.setTimeout(() => reject(new Error('Notification service worker did not start')), 15000);
      const changed = () => {
        if (worker.state === 'activated') { window.clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve(); }
        if (worker.state === 'redundant') { window.clearTimeout(timer); worker.removeEventListener('statechange', changed); reject(new Error('Notification service worker failed')); }
      };
      worker.addEventListener('statechange', changed); changed();
    });
    return registration;
  })().catch(cause => { registrationPromise = undefined; throw cause; });
  return registrationPromise;
}
export function workerMessage(worker: ServiceWorker, message: object, timeout = 3500) {
  return new Promise<boolean>(resolve => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => { channel.port1.close(); resolve(false); }, timeout);
    channel.port1.onmessage = event => { window.clearTimeout(timer); channel.port1.close(); resolve(event.data === 'handled'); };
    worker.postMessage(message, [channel.port2]);
  });
}
export function pushCapability() {
  return window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}
export function applicationServerKey(key: string): Uint8Array {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}
export function openNotification(payload: MessengerNotification) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(payload.conversation_id) || (payload.call_id && !uuid.test(payload.call_id))) return;
  const route = `#/messages?conversation=${encodeURIComponent(payload.conversation_id)}${payload.call_id ? `&call=${encodeURIComponent(payload.call_id)}` : ''}`;
  window.location.hash = route;
  if (payload.call_id) window.dispatchEvent(new CustomEvent('messenger-open-call', { detail: payload.call_id }));
}
export function retainNotificationDestination() {
  const [path, query] = window.location.hash.split('?');
  const params = new URLSearchParams(query);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const conversation = params.get('conversation'), call = params.get('call');
  if (path !== '#/messages' || params.get('notification') !== '1' || !conversation || !uuid.test(conversation) || (call && !uuid.test(call))) return false;
  sessionStorage.setItem('messenger-notification-route', `#/messages?conversation=${conversation}${call ? `&call=${call}` : ''}&notification=1`);
  return true;
}
export function restoreNotificationDestination() {
  const route = sessionStorage.getItem('messenger-notification-route');
  sessionStorage.removeItem('messenger-notification-route');
  if (route && /^#\/messages\?conversation=[0-9a-f-]{36}(&call=[0-9a-f-]{36})?&notification=1$/i.test(route)) window.location.hash = route;
}
export function consumeNotificationDestination() {
  const [path, query] = window.location.hash.split('?');
  const params = new URLSearchParams(query);
  if (path === '#/messages' && params.get('notification') === '1') {
    params.delete('notification');
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${path}?${params}`);
  }
}

// Invoked before local auth storage is cleared. The captured credential is used
// only for this request; it never enters the SW, IndexedDB or a push payload.
export async function detachNotificationDevice(token?: string, owner?: string) {
  try {
    const core = await notificationCore();
    const binding = await core.clearBinding(owner);
    const registration = await navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL);
    if (registration?.active && binding?.user_id) void workerMessage(registration.active, { type: 'clear-notifications', owner: binding.user_id });
    if (binding?.device_id && token) {
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/messenger_notifications_rpc`, {
        method: 'POST', headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_action: 'disable', p_data: { id: binding.device_id } }), signal: AbortSignal.timeout(8000), keepalive: true,
      });
    }
  } catch { /* Local sign-out and its global revocation must always complete. */ }
}
