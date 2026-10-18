import { Bell } from 'lucide-react';
import { useNotifications } from '@/context/NotificationContext';
import type { NotificationPreferences } from '@/lib/notifications';

export function NotificationSettings() {
  const { settings, loading, pending, permission, deviceEnabled, enable, disable, update, error } = useNotifications();
  const labels: [keyof NotificationPreferences, string][] = [['notify_messages', 'New messages'], ['notify_voice_calls', 'Incoming voice calls'], ['notify_video_calls', 'Incoming video calls'], ['show_message_preview', 'Show message previews'], ['sound_enabled', 'In-site notification sounds']];
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  const status = permission === 'unsupported' ? 'Browser/device unsupported for background notifications'
    : permission === 'denied' ? 'Notifications blocked' : deviceEnabled ? 'Notifications enabled'
    : permission === 'default' ? 'Permission not requested' : 'Notifications not enabled on this device';
  return <section className="notification-settings" aria-labelledby="notification-settings-heading">
    <h3 id="notification-settings-heading"><Bell size={20} className="inline mr-2" />Notifications</h3>
    <p role="status">{loading ? 'Loading notification settings…' : status}</p>
    {settings && labels.map(([name, label]) => <label key={name}>{label}<input type="checkbox" checked={settings.preferences[name]} disabled={pending} onChange={event => void update({ [name]: event.target.checked })} /></label>)}
    {ios && !installed && <p>For background notifications on iPhone or iPad, add myhostage to your Home Screen, open the installed app, then enable notifications there. iOS 16.4 or later is required.</p>}
    {permission === 'denied' && <p>Allow notifications for myhostage in your browser or device settings, then return here. We will not request permission again while it is blocked.</p>}
    {settings && !settings.available && <p>Background delivery is temporarily unavailable. Your notification preferences are saved; try enabling this device again shortly.</p>}
    {permission !== 'unsupported' && <button disabled={loading || pending || (!deviceEnabled && (permission === 'denied' || !settings?.available))} onClick={() => void (deviceEnabled ? disable() : enable())}>{pending ? 'Saving…' : deviceEnabled ? 'Disable on This Device' : 'Enable Notifications'}</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
