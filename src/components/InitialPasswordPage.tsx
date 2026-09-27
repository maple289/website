import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export function InitialPasswordPage() {
  const { completeInitialPassword, cancelPasswordSetup } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <main className="flex min-h-dvh items-center justify-center bg-[#001338] p-5 text-white">
    <section className="w-full max-w-md rounded-2xl border border-white/15 bg-[#131e31] p-6 shadow-xl">
      <KeyRound className="mb-4 text-blue-300" size={28} />
      <h1 className="text-xl font-semibold">Create your password</h1>
      <p className="mt-3 text-sm leading-6 text-slate-300">Your account does not have a password yet. Please create a password to continue.</p>
      <form className="mt-6" onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        setError(null);
        if (!password.trim() || password.length < 6) { setError('New password must be at least 6 characters.'); return; }
        if (password !== confirmation) { setError('New password and confirmation do not match.'); return; }
        setSaving(true);
        const result = await completeInitialPassword(password, confirmation);
        setSaving(false);
        if (result.error) setError(result.error);
        else { setPassword(''); setConfirmation(''); }
      }}>
        <fieldset disabled={saving} className="min-w-0 space-y-4">
          <div><label htmlFor="initial-password" className="mb-2 block text-sm">New Password</label>
            <input id="initial-password" type={visible ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="min-h-12 w-full min-w-0 rounded-xl border border-white/20 bg-black/25 px-3" /></div>
          <div><label htmlFor="initial-confirmation" className="mb-2 block text-sm">Confirm New Password</label>
            <input id="initial-confirmation" type={visible ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="min-h-12 w-full min-w-0 rounded-xl border border-white/20 bg-black/25 px-3" /></div>
          <button type="button" aria-pressed={visible} onClick={() => setVisible(!visible)} className="flex min-h-11 items-center gap-2 text-sm text-slate-300">{visible ? <EyeOff size={18} /> : <Eye size={18} />}{visible ? 'Hide passwords' : 'Show passwords'}</button>
          {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
          <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold disabled:opacity-60">{saving && <Loader2 size={18} className="animate-spin" />}Save password and continue</button>
          <button type="button" onClick={() => { setPassword(''); setConfirmation(''); cancelPasswordSetup(); window.location.hash = ''; }} className="min-h-11 w-full text-sm text-slate-300">Return to sign in</button>
        </fieldset>
      </form>
    </section>
  </main>;
}
