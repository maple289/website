import { useGuardedClose } from '@/hooks/useGuardedClose';
import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export function InitialPasswordPage() {
  const { completeInitialPassword, cancelPasswordSetup } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = useGuardedClose(() => { setPassword(''); setConfirmation(''); setCode(''); cancelPasswordSetup(); window.location.hash = ''; }, !!password || !!confirmation || !!code, saving);
  return <main className="flex min-h-dvh items-center justify-center bg-[linear-gradient(145deg,#f7f9fc,#eef3f8)] p-5 text-slate-800">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <KeyRound className="mb-4 text-blue-600" size={28} />
      <h1 className="text-xl font-semibold">Create your password</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">Check your approved email address for a verification code. Paste it below and create your password. The code expires in 15 minutes.</p>
      <form className="mt-6" onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        setError(null);
        if (!password.trim() || password.length < 6) { setError('New password must be at least 6 characters.'); return; }
        if (password !== confirmation) { setError('New password and confirmation do not match.'); return; }
        setSaving(true);
        const result = await completeInitialPassword(password, confirmation, code);
        setSaving(false);
        if (result.error) setError(result.error);
        else { setPassword(''); setConfirmation(''); setCode(''); }
      }}>
        <fieldset disabled={saving} className="min-w-0 space-y-4">
          <div><label htmlFor="initial-code" className="mb-2 block text-sm">Email verification code</label>
            <input id="initial-code" type="text" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} maxLength={64} value={code} onChange={e => setCode(e.target.value)} className="min-h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3" /></div>
          <div><label htmlFor="initial-password" className="mb-2 block text-sm">New Password</label>
            <input id="initial-password" type={visible ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="min-h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3" /></div>
          <div><label htmlFor="initial-confirmation" className="mb-2 block text-sm">Confirm New Password</label>
            <input id="initial-confirmation" type={visible ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="min-h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3" /></div>
          <button type="button" aria-pressed={visible} onClick={() => setVisible(!visible)} className="flex min-h-11 items-center gap-2 text-sm text-slate-600">{visible ? <EyeOff size={18} /> : <Eye size={18} />}{visible ? 'Hide passwords' : 'Show passwords'}</button>
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          <button type="submit" className="fluent-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-xl font-semibold disabled:opacity-60">{saving && <Loader2 size={18} className="animate-spin" />}Save password and continue</button>
          <button type="button" onClick={close} className="min-h-11 w-full text-sm text-slate-600">Return to sign in</button>
        </fieldset>
      </form>
    </section>
  </main>;
}
