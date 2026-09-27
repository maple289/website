import { TaskModal } from '@/components/TaskModal';
import { useGuardedClose } from '@/hooks/useGuardedClose';
import { ProfileNameFields } from './ProfileNameFields';
import { useEffect, useState } from 'react';
import { Loader2, Mail, Lock, Eye, EyeOff, X, Youtube } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

type AuthModalProps = {
  open: boolean;
  initialMode: 'signin' | 'signup';
  onClose: () => void;
};

export function AuthModal({ open, initialMode, onClose }: AuthModalProps) {
  const { signIn, requestRegistration } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const close = useGuardedClose(onClose, !!email || !!username || !!firstName || !!lastName || !!password, submitting);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setError(null);
      setInfo(null);
    }
  }, [open, initialMode]);

  useEffect(() => {
    if (!open) {
      setEmail('');
      setUsername('');
      setFirstName('');
      setLastName('');
      setPassword('');
      setShowPassword(false);
      setError(null);
      setInfo(null);
      setSubmitting(false);
    }
  }, [open]);


  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!email.trim()) {
      setError(mode === 'signin' ? 'Please enter your username or email.' : 'Please enter your email.');
      return;
    }
    if (mode === 'signup' && !/^[A-Za-z0-9_][A-Za-z0-9_-]{2,31}$/.test(username.trim())) { setError('Username must be 3–32 letters, numbers, underscores or hyphens.'); return; }

    setSubmitting(true);
    if (mode === 'signup') {
      const { error } = await requestRegistration(email.trim(), firstName, lastName, username);
      setSubmitting(false);
      if (error) {
        setError(error);
      } else {
        setInfo('Your registration request has been submitted for administrator approval. After approval, sign in with your username or email and leave the password blank to create your password.');
        setEmail(''); setUsername(''); setFirstName(''); setLastName(''); setPassword('');
      }
    } else {
      const { error } = await signIn(email.trim(), password);
      setSubmitting(false);
      if (error) {
        setError(error);
      } else {
        onClose();
      }
    }
  };

  return (
    <TaskModal aria-label="Sign in or register" className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl border border-[#2e2e2e] bg-[#181818] shadow-2xl">
        <div className="relative px-7 pt-8">
          <button aria-label="Close" onClick={close} className="absolute right-4 top-4 rounded-full p-2 text-[#a7a7a7] transition hover:bg-[#2a2a2a] hover:text-white">
            <X size={20} />
          </button>
          <div className="flex h-11 w-14 items-center justify-center rounded-xl bg-[#ff3d46] shadow-[0_0_28px_rgba(255,61,70,0.28)]">
            <Youtube size={24} fill="white" strokeWidth={1.5} />
          </div>
          <h2 className="mt-5 text-[22px] font-semibold tracking-[-0.03em]">
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </h2>
          <p className="mt-1.5 text-sm text-[#a5a5a5]">
            {mode === 'signup'
              ? 'Request an account for administrator approval. You will create your password on the website after approval.'
              : 'Sign in to continue where you left off.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-7 pb-8 pt-6">
          {mode === 'signup' && <div className="mb-4"><label htmlFor="registration-username" className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#9a9a9a]">Username</label>
            <input id="registration-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" maxLength={32} disabled={submitting} placeholder="Choose a username" className="h-12 w-full rounded-xl border border-[#3a3a3a] bg-[#121212] px-3 text-[15px]" /></div>}
          {mode === 'signup' && <ProfileNameFields firstName={firstName} lastName={lastName} onFirstNameChange={setFirstName} onLastNameChange={setLastName} disabled={submitting} />}
          <label htmlFor="login-identifier" className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#9a9a9a]">{mode === 'signin' ? 'Username or Email' : 'Email'}</label>
          <div className="mb-4 flex h-12 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
            <Mail className="ml-3.5 text-[#888]" size={18} />
            <input
              id="login-identifier"
              type={mode === 'signup' ? 'email' : 'text'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete={mode === 'signup' ? 'email' : 'username'}
              className="h-full w-full bg-transparent px-3 text-[15px] outline-none placeholder:text-[#6a6a6a]"
            />
          </div>

          {mode === 'signin' && (
            <>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#9a9a9a]">Password</label>
              <div className="flex h-12 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
                <Lock className="ml-3.5 text-[#888]" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  className="h-full w-full bg-transparent px-3 text-[15px] outline-none placeholder:text-[#6a6a6a]"
                />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)} className="mr-2 rounded-full p-2 text-[#888] transition hover:text-white">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#999]">First login after approval? Leave the password blank to set it up. Existing accounts require their password.</p>
            </>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">
              {error}
            </div>
          )}
          {info && (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ff3d46] text-[15px] font-semibold text-white transition hover:bg-[#ff5962] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 size={18} className="animate-spin" />}
            {mode === 'signup' ? 'Request account' : 'Sign in'}
          </button>

          <p className="mt-5 text-center text-sm text-[#a5a5a5]">
            {mode === 'signup' ? 'Already have an account?' : 'New to Streamly?'}{' '}
            <button
              type="button"
              onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(null); setInfo(null); }}
              className="font-semibold text-[#ff6971] transition hover:text-[#ff9ba0]"
            >
              {mode === 'signup' ? 'Sign in' : 'Create one'}
            </button>
          </p>
        </form>
      </div>
    </TaskModal>
  );
}
