import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMessenger } from './MessengerContext';
import { authSessionEvent, sessionIsSignedOut } from '@/lib/authSessionStorage';
import { applicationServerKey, consumeNotificationDestination, notificationCore, notificationRequest, notificationWorker, openNotification, pushCapability, restoreNotificationDestination, workerMessage, type MessengerNotification, type NotificationBinding, type NotificationPreferences, type NotificationSettings } from '@/lib/notifications';
import '@/components/MessengerNotifications.css';

type Value = { managed: boolean; mutedConversations: string[]; settings: NotificationSettings | null; loading: boolean; pending: boolean; error: string; permission: NotificationPermission | 'unsupported'; deviceEnabled: boolean; enable: () => Promise<void>; disable: () => Promise<void>; update: (changes: Partial<NotificationPreferences>) => Promise<void> };
const empty: Value = { managed: false, mutedConversations: [], settings: null, loading: true, pending: false, error: '', permission: 'unsupported', deviceEnabled: false, enable: async () => {}, disable: async () => {}, update: async () => {} };
const NotificationContext = createContext<Value>(empty);
// eslint-disable-next-line react-refresh/only-export-components
export const useNotifications = () => useContext(NotificationContext);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, session, configured, passwordSetup, loading: authLoading } = useAuth();
  const [snapshot, setSnapshot] = useState<{ owner: string; value: Value } | null>(null);
  const publish = useCallback((owner: string, value: Value) => setSnapshot({ owner, value }), []);
  const active = !!user && !!session && configured && !passwordSetup;
  useEffect(() => {
    let cancelled = false;
    if (!authLoading && !user) {
      void notificationCore().then(core => { if (!cancelled) return core.clearBinding(); }).catch(() => undefined);
      void navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL).then(registration => {
        if (registration?.active) void workerMessage(registration.active, { type: 'clear-notifications' });
      }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [authLoading, user]);
  return <NotificationContext.Provider value={active && snapshot?.owner === user.id ? snapshot.value : { ...empty, managed: active }}>
    <NotificationSession key={active ? user.id : 'guest'} userId={active ? user.id : ''} publish={publish} />
    {children}
  </NotificationContext.Provider>;
}

function MessageCard({ item, close }: { item: MessengerNotification; close: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const dismiss = useCallback(() => { setLeaving(true); }, []);
  useEffect(() => { const timer = window.setTimeout(dismiss, 6500); return () => window.clearTimeout(timer); }, [dismiss]);
  useEffect(() => { if (leaving) { const timer = window.setTimeout(close, 210); return () => window.clearTimeout(timer); } }, [leaving, close]);
  return <article className={`messenger-notification-card${leaving ? ' is-leaving' : ''}`} aria-label={`New message from ${item.sender_name}`}>
    <span className="messenger-notification-avatar" aria-hidden="true">{item.sender_name.trim().slice(0, 1).toUpperCase() || <MessageCircle size={20} />}</span>
    <button className="messenger-notification-content messenger-notification-open" onClick={() => { openNotification(item); dismiss(); }}>
      <strong>{item.sender_name}</strong><small>New message</small><p>{item.body}</p>
    </button>
    <button className="messenger-notification-dismiss" aria-label="Dismiss notification" onClick={dismiss}><X size={16} /></button>
  </article>;
}
function NotificationSession({ userId, publish }: { userId: string; publish: (owner: string, value: Value) => void }) {
  const { revision, conversations } = useMessenger();
  const [settings, setSettings] = useState<NotificationSettings | null>(null), [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [deviceEnabled, setDeviceEnabled] = useState(false), [permission, setPermission] = useState<Value['permission']>(pushCapability() ? Notification.permission : 'unsupported');
  const [cards, setCards] = useState<MessengerNotification[]>([]);
  const alive = useRef(false), guard = useRef(false), cursor = useRef<number | null>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const pollRef = useRef<() => void>(() => {});
  const settingsRefreshRef = useRef<() => void>(() => {}), settingsVersion = useRef(0);
  const audio = useRef<AudioContext | null>(null);
  const lastSound = useRef(0);
  const sound = useCallback(() => {
    const context = audio.current;
    if (!context || context.state !== 'running' || Date.now() - lastSound.current < 1200) return;
    lastSound.current = Date.now();
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .12);
    oscillator.start(); oscillator.stop(context.currentTime + .12);
  }, []);
  useEffect(() => {
    alive.current = true;
    if (!userId) { setLoading(false); return () => { alive.current = false; }; }
    restoreNotificationDestination();
    consumeNotificationDestination();
    let timer = 0, cancelled = false, polling = false, again = false, settingsFetching = false;
    const startedAt = new Date(Date.now() - 5000).toISOString();
    const getWorker = () => notificationWorker().catch(() => null);
    let bindingReady: Promise<void> | undefined;
    const ensureBinding = () => bindingReady ??= notificationCore().then(async core => {
      const binding = await core.get<NotificationBinding>('binding');
      if (cancelled || sessionIsSignedOut()) return;
      if (binding?.user_id !== userId) {
        // A PushSubscription belongs to the previous signed-in account. Do not
        // silently transfer it; a new account must explicitly enable its device.
        const registration = await getWorker();
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription && !await subscription.unsubscribe()) throw new Error('Could not reset the previous account notification subscription');
        if (!cancelled) { await core.put('binding', { user_id: userId }); setDeviceEnabled(false); }
      } else if (binding.device_id) {
        const device = await notificationRequest<{ enabled: boolean }>('device', { id: binding.device_id });
        const registration = await getWorker();
        const subscription = await registration?.pushManager?.getSubscription();
        if (!cancelled) setDeviceEnabled(device.enabled && !!subscription && 'Notification' in window && Notification.permission === 'granted');
      } else if (!cancelled) setDeviceEnabled(false);
      await core.prune();
    }).catch(cause => { bindingReady = undefined; throw cause; });
    const refreshSettings = async () => {
      if (settingsFetching || guard.current) return;
      settingsFetching = true;
      const version = settingsVersion.current;
      try {
        const value = await notificationRequest<NotificationSettings>('settings');
        if (!cancelled && version === settingsVersion.current) { setSettings(value); setError(''); setLoading(false); void notificationCore().then(core => core.put(`preferences:${userId}`, value.preferences)).catch(() => undefined); }
      } catch { if (!cancelled && version === settingsVersion.current) { setLoading(false); setError('Could not load notification settings. Check your connection.'); } }
      finally { settingsFetching = false; }
    };
    settingsRefreshRef.current = () => void refreshSettings();
    void refreshSettings();
    const handle = async (payload: MessengerNotification) => {
      if (cancelled || document.hidden || !document.hasFocus() || sessionIsSignedOut()) return false;
      const core = await notificationCore();
      if (!core.valid(payload)) return true;
      const binding = await core.get<NotificationBinding>('binding');
      if (cancelled || binding?.user_id !== userId || (payload.device_id && binding.device_id !== payload.device_id)) return false;
      if (!await core.claim(payload.id, userId)) return true;
      if (cancelled || sessionIsSignedOut()) return true;
      if (payload.kind !== 'message') { window.dispatchEvent(new CustomEvent('messenger-call', { detail: 'call-state' })); return true; }
      const pref = settingsRef.current?.preferences;
      if (pref?.notify_messages === false) return true;
      // Never increment unread or mark read here. Messenger retains those rules.
      const url = new URL(window.location.href);
      const [path, query] = url.hash.slice(1).split('?');
      if (path === '/messages' && new URLSearchParams(query).get('conversation') === payload.conversation_id) return true;
      const item = { ...payload, body: pref?.show_message_preview === false ? 'New message' : payload.body };
      setCards(current => [item, ...current.filter(card => card.conversation_id !== item.conversation_id)].slice(0, 3));
      if (payload.sound && pref?.sound_enabled !== false) sound();
      return true;
    };
    const onWorker = (event: MessageEvent) => {
      if (event.data?.type === 'messenger-notification') void handle(event.data.payload).then(handled => event.ports[0]?.postMessage(handled ? 'handled' : 'unavailable')).catch(() => event.ports[0]?.postMessage('unavailable'));
      if (event.data?.type === 'open-messenger-notification') {
        const payload = event.data.payload as MessengerNotification;
        void notificationCore().then(async core => {
          const binding = await core.get<NotificationBinding>('binding');
          if (!cancelled && binding?.user_id === userId) {
            if (event.data.payload?.kind === 'update') window.location.hash = '#/messages';
            else if (core.uuid(payload?.conversation_id)) openNotification(payload);
          }
          event.ports[0]?.postMessage('handled');
        }).catch(() => event.ports[0]?.postMessage('unavailable'));
      }
    };
    navigator.serviceWorker?.addEventListener('message', onWorker);
    const poll = async () => {
      if (cancelled || !navigator.onLine || sessionIsSignedOut()) return;
      if (polling) { again = true; return; }
      polling = true;
      try {
        await ensureBinding();
        if (cancelled) return;
        const result = await notificationRequest<{ cursor: number; events: MessengerNotification[] }>('events', cursor.current === null ? { since: startedAt } : { after: cursor.current });
        if (cancelled) return;
        const registration = await getWorker();
        for (let payload of result.events) {
          if (cancelled) return;
          const core = await notificationCore(), binding = await core.get<NotificationBinding>('binding');
          let lease: string | undefined;
          if (binding?.user_id === userId && binding.device_id) {
            const delivery = await notificationRequest<{ action: 'page' | 'push' | 'ignore' | 'local'; lease?: string; payload?: MessengerNotification }>('delivery-claim', { id: payload.id, device_id: binding.device_id });
            if (delivery.action === 'local') {
              // Provider expiry/device disabling must not silence in-site cards.
              // Clear only the stale device we checked, never a newer enrollment.
              const current = await core.get<NotificationBinding>('binding');
              if (current?.user_id === userId && current.device_id === binding.device_id) {
                await core.put('binding', { user_id: userId }); setDeviceEnabled(false);
              }
            } else if (delivery.action !== 'page') continue;
            payload = delivery.payload ?? payload; lease = delivery.lease;
          }
          if (registration?.active) {
            const handled = await workerMessage(registration.active, { type: 'deliver-notification', payload });
            if (!handled && !await handle(payload)) throw new Error('Notification delivery will retry');
          }
          else await handle(payload);
          if (lease && binding?.device_id) await notificationRequest('delivery-ack', { id: payload.id, device_id: binding.device_id, lease });
        }
        cursor.current = result.cursor;
      } catch { /* Realtime/poll reconnects later; push is independent of this tab. */ }
      finally { polling = false; if (again && !cancelled) { again = false; window.setTimeout(() => void poll(), 100); } }
    };
    pollRef.current = () => void poll();
    void poll(); timer = window.setInterval(() => void poll(), 10000);
    const visible = () => { if (!document.hidden) { bindingReady = undefined; setPermission(pushCapability() ? Notification.permission : 'unsupported'); void poll(); void refreshSettings(); } };
    const unlock = () => {
      if (!window.AudioContext || settingsRef.current?.preferences.sound_enabled === false) return;
      audio.current ??= new AudioContext(); void audio.current.resume().catch(() => undefined);
    };
    const signedOut = () => { if (sessionIsSignedOut()) { setCards([]); void notificationCore().then(core => core.clearBinding(userId)).catch(() => undefined); } };
    document.addEventListener('visibilitychange', visible); window.addEventListener('online', visible); window.addEventListener('focus', visible);
    window.addEventListener('hashchange', consumeNotificationDestination);
    window.addEventListener('pointerdown', unlock, { passive: true }); window.addEventListener('keydown', unlock);
    window.addEventListener(authSessionEvent, signedOut);
    return () => {
      cancelled = true; alive.current = false; window.clearInterval(timer); pollRef.current = () => {}; settingsRefreshRef.current = () => {};
      navigator.serviceWorker?.removeEventListener('message', onWorker);
      document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', visible); window.removeEventListener('focus', visible);
      window.removeEventListener('hashchange', consumeNotificationDestination);
      window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock);
      window.removeEventListener(authSessionEvent, signedOut);
      void audio.current?.close().catch(() => undefined); audio.current = null;
    };
  }, [userId, sound]);
  useEffect(() => { pollRef.current(); settingsRefreshRef.current(); }, [revision]);

  const update = useCallback(async (changes: Partial<NotificationPreferences>) => {
    if (guard.current) return; guard.current = true; settingsVersion.current++; setPending(true); setError('');
    try { const result = await notificationRequest<NotificationSettings>('preferences', changes); if (alive.current) { setSettings(result); await (await notificationCore()).put(`preferences:${userId}`, result.preferences); } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Could not save notification preferences'); }
    finally { guard.current = false; if (alive.current) setPending(false); }
  }, [userId]);
  const enable = useCallback(async () => {
    if (guard.current || !pushCapability() || !settings?.available || !settings.public_key) return;
    guard.current = true; setPending(true); setError('');
    // Permission is requested immediately in this explicit click handler, before
    // any await. Never request on mount, reconnect, a socket event, or a timer.
    const request = Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    try {
      const permission = await request;
      if (!alive.current) return;
      setPermission(permission);
      if (permission !== 'granted') return;
      const core = await notificationCore(), registration = await notificationWorker();
      if (!registration) throw new Error('Background notifications are unavailable in this browser');
      const binding = await core.get<NotificationBinding>('binding');
      if (!alive.current || binding?.user_id !== userId) return;
      let subscription = await registration.pushManager.getSubscription();
      const expectedKey = applicationServerKey(settings.public_key);
      const existingKey = subscription?.options.applicationServerKey;
      if (subscription && binding.device_id && !deviceEnabled) { if (!await subscription.unsubscribe()) throw new Error('Could not renew this browser subscription. Try again when connected.'); subscription = null; }
      if (subscription && existingKey && String(new Uint8Array(existingKey)) !== String(expectedKey)) { if (!await subscription.unsubscribe()) throw new Error('Could not update this browser subscription. Try again when connected.'); subscription = null; }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: expectedKey });
      const device = await notificationRequest<{ id: string }>('subscribe', { subscription: subscription.toJSON(), device_label: navigator.userAgent.slice(0, 100) });
      if (!alive.current || sessionIsSignedOut()) { await notificationRequest('disable', { id: device.id }).catch(() => undefined); return; }
      await core.put('binding', { user_id: userId, device_id: device.id }); setDeviceEnabled(true);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Could not enable notifications'); }
    finally { guard.current = false; if (alive.current) setPending(false); }
  }, [settings, userId, deviceEnabled]);
  const disable = useCallback(async () => {
    if (guard.current) return; guard.current = true; setPending(true); setError('');
    try {
      const core = await notificationCore(), binding = await core.get<NotificationBinding>('binding');
      if (binding?.user_id === userId && binding.device_id) await notificationRequest('disable', { id: binding.device_id });
      await core.put('binding', { user_id: userId });
      const registration = await notificationWorker();
      if (registration?.active) await workerMessage(registration.active, { type: 'clear-notifications' });
      if (alive.current) setDeviceEnabled(false);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Could not disable notifications'); }
    finally { guard.current = false; if (alive.current) setPending(false); }
  }, [userId]);
  useEffect(() => { publish(userId, { managed: true, mutedConversations: [...new Set([...(settings?.muted_conversations ?? []), ...conversations.filter(item => item.muted).map(item => item.id)])], settings, loading, pending, error, permission, deviceEnabled, update, enable, disable }); }, [publish, userId, conversations, settings, loading, pending, error, permission, deviceEnabled, update, enable, disable]);
  return userId && cards.length ? createPortal(<div className="messenger-notification-stack" aria-live="polite" aria-relevant="additions">
    {cards.map(item => <MessageCard key={item.id} item={item} close={() => setCards(current => current.filter(card => card.id !== item.id))} />)}
  </div>, document.body) : null;
}
