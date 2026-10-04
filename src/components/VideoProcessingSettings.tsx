import { useEffect, useRef, useState } from 'react';
import { Film, LoaderCircle, Save } from 'lucide-react';
import { fetchStorageSettings, saveVideoProcessingSettings } from '@/lib/storageSettings';
import { useGuardedClose } from '@/hooks/useGuardedClose';

const formatMbps = (value: number) => value.toFixed(2).replace(/0$/, '');

export function VideoProcessingSettings() {
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState('3.0');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const value = draft.trim() ? Number(draft) : NaN;
  const valid = Number.isFinite(value) && value >= 1 && value <= 15 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
  const dirty = saved !== null && value !== saved;

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const settings = await fetchStorageSettings();
      if (!settings) throw new Error('Could not load video processing settings.');
      setSaved(settings.target_video_bitrate_mbps);
      setDraft(formatMbps(settings.target_video_bitrate_mbps));
    } catch {
      setError('Could not load video processing settings. Please try again.');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const reset = useGuardedClose(() => {
    if (saved !== null) setDraft(formatMbps(saved));
    setError(null); setSuccess(false);
  }, dirty, busy);

  const save = async () => {
    if (pending.current || !valid || saved === null) return;
    pending.current = true; setBusy(true); setError(null); setSuccess(false);
    try {
      const result = await saveVideoProcessingSettings(value);
      if (!result.ok) { setError(result.error); return; }
      setSaved(result.settings.target_video_bitrate_mbps);
      setDraft(formatMbps(result.settings.target_video_bitrate_mbps));
      setSuccess(true);
    } finally { pending.current = false; setBusy(false); }
  };

  if (loading) return <p className="admin-loading" role="status"><LoaderCircle size={24} className="animate-spin" />Loading video processing settings…</p>;
  return <section className="admin-panel" aria-labelledby="video-processing-title">
    <div className="mb-5 flex items-center gap-2"><Film size={20} className="text-blue-600" /><h2 id="video-processing-title">Video Processing</h2></div>
    {saved === null ? <><p role="alert" className="admin-notice admin-notice-error">{error}</p><button className="fluent-button" onClick={() => void load()}>Try again</button></> :
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label htmlFor="target-video-bitrate" className="admin-form-label">Target Video Bitrate</label>
        <div className="mt-2 flex max-w-xs items-center gap-3">
          <div className="fluent-field min-w-0 flex-1">
          <input id="target-video-bitrate" type="number" inputMode="decimal" min="1" max="15" step="0.01" required
            value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); setSuccess(false); setError(null); }}
            aria-describedby="video-bitrate-help video-bitrate-validation" aria-invalid={!valid}
            className="min-w-0" />
          </div>
          <span className="text-sm text-slate-500">Mbps</span>
        </div>
        <p id="video-bitrate-help" className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
          Videos requiring transcoding will be encoded using this bitrate. Compatible MP4 videos with a video bitrate
          of 4.5 Mbps or lower will normally be kept without re-encoding. Changes apply to future conversions;
          existing Ready videos stay unchanged.
        </p>
        <p className="mt-2 text-sm text-slate-600">Current target: <strong>{formatMbps(saved)} Mbps</strong> · Default: 3.0 Mbps</p>
        <p id="video-bitrate-validation" className={`mt-2 text-sm ${valid ? 'text-slate-400' : 'text-rose-600'}`}>
          {valid ? 'Allowed range: 1–15 Mbps, up to two decimal places.' : 'Enter a number between 1 and 15 Mbps, with at most two decimal places.'}
        </p>
        {error && <p role="alert" className="admin-notice admin-notice-error mt-4">{error}</p>}
        {success && <p role="status" className="admin-notice admin-notice-success mt-4">Video processing settings saved.</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="submit" disabled={busy || !valid || !dirty} className="fluent-button fluent-primary">
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}{busy ? 'Saving…' : 'Save Video Processing'}
          </button>
          {dirty && <button type="button" disabled={busy} onClick={reset} className="fluent-button">Cancel</button>}
        </div>
      </form>}
  </section>;
}
