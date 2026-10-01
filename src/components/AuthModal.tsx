import { TaskModal } from '@/components/TaskModal';
import { useGuardedClose } from '@/hooks/useGuardedClose';
import { ProfileNameFields } from './ProfileNameFields';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Mail, Lock, Eye, EyeOff, X, Youtube } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

// Keep the response private and accurate for both new and previously reviewed
// requests. A generic API success does not mean a new pending row was created.
const approvalMessage = 'Your request has been received. New registration requests await administrator approval and receive a confirmation email. Existing accounts and previously reviewed requests do not create another request or email. Contact an administrator if you need help with a previous request. After approval, sign in with your email and leave the password blank to create your password.';

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
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registrationSubmitted, setRegistrationSubmitted] = useState(false);
  const submission = useRef<'idle' | 'pending' | 'submitted'>('idle');

  const close = useGuardedClose(onClose, !!email || !!firstName || !!lastName || !!password, submitting);

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
      setFirstName('');
      setLastName('');
      setPassword('');
      setShowPassword(false);
      setError(null);
      setInfo(null);
      setSubmitting(false);
      setRegistrationSubmitted(false);
      submission.current = 'idle';
    }
  }, [open]);


  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submission.current === 'pending' || (mode === 'signup' && submission.current === 'submitted')) return;
    setError(null);
    setInfo(null);

    if (!email.trim()) {
      setError('Please enter your email.');
      return;
    }

    submission.current = 'pending';
    setSubmitting(true);
    try {
      if (mode === 'signup') {
        const { error } = await requestRegistration(email.trim(), firstName, lastName);
        if (error) {
          setError(error);
        } else {
          submission.current = 'submitted';
          setRegistrationSubmitted(true);
          setInfo(approvalMessage);
          setEmail(''); setFirstName(''); setLastName(''); setPassword('');
        }
      } else {
        const { error } = await signIn(email.trim(), password);
        if (error) {
          setError(error);
        } else {
          onClose();
        }
      }
    } catch {
      setError('Could not complete your request. Please try again.');
    } finally {
      if (submission.current === 'pending') submission.current = registrationSubmitted ? 'submitted' : 'idle';
      setSubmitting(false);
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
              : 'Sign in to go to Home.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-7 pb-8 pt-6">
          {mode === 'signup' && <ProfileNameFields firstName={firstName} lastName={lastName} onFirstNameChange={setFirstName} onLastNameChange={setLastName} disabled={submitting || (mode === 'signup' && registrationSubmitted)} />}
          <label htmlFor="login-identifier" className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#9a9a9a]">Email</label>
          <div className="mb-4 flex h-12 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
            <Mail className="ml-3.5 text-[#888]" size={18} />
            <input
              id="login-identifier"
              type="email"
              required
              disabled={submitting || (mode === 'signup' && registrationSubmitted)}
              maxLength={254}
              autoCapitalize="none"
              spellCheck={false}
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
            disabled={submitting || (mode === 'signup' && registrationSubmitted)}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ff3d46] text-[15px] font-semibold text-white transition hover:bg-[#ff5962] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 size={18} className="animate-spin" />}
            {mode === 'signup' ? (registrationSubmitted ? 'Request received' : 'Request account') : 'Sign in'}
          </button>

          <p className="mt-5 text-center text-sm text-[#a5a5a5]">
            {mode === 'signup' ? 'Already have an account?' : 'New to Streamly?'}{' '}
            <button
              type="button"
              disabled={submitting}
              onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(null); setInfo(mode === 'signin' && registrationSubmitted ? approvalMessage : null); }}
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
