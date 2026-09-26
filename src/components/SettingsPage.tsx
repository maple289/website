import { ProfileNameSettings } from './ProfileNameSettings';
import { useState } from 'react';
import { ArrowLeft, KeyRound, Loader as Loader2, ShieldCheck, Eye, EyeOff, Lock, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export function SettingsPage() {
  const { user } = useAuth();
  const [passwordFormOpen, setPasswordFormOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const email = user?.email ?? '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSuccess(false);

    if (!user) {
      setError('Please sign in to change your password.');
      return;
    }

    if (!currentPassword || !newPassword.trim() || !confirmPassword) {
      setError('Please fill in all password fields.');
      return;
    }

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    if (newPassword === currentPassword) {
      setError('New password must be different from your current password.');
      return;
    }

    setSaving(true);

    try {
      // Never submit credentials to a remote HTTP endpoint.
      const endpoint = new URL(import.meta.env.VITE_SUPABASE_URL);
      const local = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if ((endpoint.protocol !== 'https:' && !local(endpoint)) ||
          (window.location.protocol !== 'https:' && !local(new URL(window.location.href)))) {
        setError('Use a secure HTTPS connection to change your password.');
        return;
      }
      // Supabase Auth derives the account from the session, verifies its current
      // hash, applies its password policy, and revokes other sessions atomically.
      // Keep this as a variable for compatibility with older SDK type definitions;
      // the Auth API accepts current_password in the JSON request body.
      const attributes = { password: newPassword, current_password: currentPassword };
      const { error: updateError } = await supabase.auth.updateUser(attributes);
      if (updateError) {
        const messages: Record<string, string> = {
          current_password_mismatch: 'Current password is incorrect.',
          current_password_required: 'Please enter your current password.',
          same_password: 'New password must be different from your current password.',
          weak_password: 'New password does not meet the password-security requirements. Choose a stronger password.',
          over_request_rate_limit: 'Too many attempts. Please wait before trying again.',
          session_not_found: 'Your session has expired. Please sign in again.',
          reauthentication_needed: 'Please sign in again before changing your password.',
        };
        setError(messages[updateError.code ?? ''] ?? 'Could not change your password. Please try again.');
        return;
      }
      setSuccess(true);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setShowCurrent(false); setShowNew(false); setShowConfirm(false);
    } catch {
      setError('Could not confirm the password change. Check your connection before trying again.');
    } finally {
      setSaving(false);
    }
  };

  const hasInput = currentPassword || newPassword || confirmPassword;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#033C8D_0%,#0062C7_50%,#001338_100%)] text-[#f1f1f1]">
      <header className="sticky top-0 z-30 border-b border-[#1a2a4a] bg-[#001338]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[700px] items-center gap-4 px-5 lg:px-8">
          <a href="#/library" className="rounded-full p-2.5 transition hover:bg-[#272727]" aria-label="Back">
            <ArrowLeft size={20} />
          </a>
          <div className="flex h-8 w-10 items-center justify-center rounded-[10px] bg-[#ff3d46]">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <span className="text-[19px] font-semibold tracking-[-0.04em]">Settings</span>
        </div>
      </header>

      <main className="mx-auto max-w-[700px] px-5 pb-20 pt-8 lg:px-8">
        <div className="mb-6">
          <h2 className="text-xl font-semibold tracking-[-0.03em]">Account Settings</h2>
          <p className="mt-1 text-sm text-[#888]">Manage your profile, account security, and password.</p>
        </div>

        {/* Account info */}
        <div className="mb-6 rounded-2xl border border-[#272727] bg-[#161616] p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#ff5962] to-[#ff3d46] text-[15px] font-semibold text-white">
              {(email || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{email}</p>
              <p className="text-xs text-[#888]">Signed in</p>
            </div>
          </div>
        </div>

        {user && <ProfileNameSettings key={user.id} userId={user.id} />}

        {/* Change Password */}
        <div className="rounded-2xl border border-[#272727] bg-[#161616] p-6">
          <button type="button" aria-expanded={passwordFormOpen} aria-controls="change-password-form" disabled={saving}
            onClick={() => {
              setPasswordFormOpen(!passwordFormOpen);
              setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
              setShowCurrent(false); setShowNew(false); setShowConfirm(false);
              setError(null); setSuccess(false);
            }} className="flex min-h-11 w-full items-center gap-2 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4b86ff]">
            <KeyRound size={18} className="text-[#ff737b]" />
            <span className="text-sm font-semibold tracking-[-0.01em]">Change Password</span>
            <span className="ml-auto text-sm text-[#999]" aria-hidden="true">{passwordFormOpen ? '−' : '+'}</span>
          </button>

          {passwordFormOpen && <form id="change-password-form" onSubmit={handleSubmit} className="mt-5">
            <fieldset disabled={saving} className="min-w-0 space-y-4">
            {/* Current password */}
            <div>
              <label htmlFor="current-password" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Current Password</label>
              <div className="flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
                <Lock className="ml-3.5 text-[#888]" size={17} />
                <input
                  id="current-password"
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => { setCurrentPassword(e.target.value); setError(null); setSuccess(false); }}
                  placeholder="Enter your current password"
                  autoComplete="current-password"
                  className="h-full min-w-0 w-full bg-transparent px-3 text-sm outline-none placeholder:text-[#6a6a6a]"
                />
                <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="min-h-11 shrink-0 px-3 text-[#888] transition hover:text-white" aria-label={showCurrent ? 'Hide current password' : 'Show current password'} aria-pressed={showCurrent}>
                  {showCurrent ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div>
              <label htmlFor="new-password" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">New Password</label>
              <div className="flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
                <Lock className="ml-3.5 text-[#888]" size={17} />
                <input
                  id="new-password"
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setError(null); setSuccess(false); }}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  className="h-full min-w-0 w-full bg-transparent px-3 text-sm outline-none placeholder:text-[#6a6a6a]"
                />
                <button type="button" onClick={() => setShowNew(!showNew)} className="min-h-11 shrink-0 px-3 text-[#888] transition hover:text-white" aria-label={showNew ? 'Hide new password' : 'Show new password'} aria-pressed={showNew}>
                  {showNew ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {/* Confirm new password */}
            <div>
              <label htmlFor="confirm-password" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Confirm New Password</label>
              <div className="flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
                <Lock className="ml-3.5 text-[#888]" size={17} />
                <input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(null); setSuccess(false); }}
                  placeholder="Re-enter your new password"
                  autoComplete="new-password"
                  className="h-full min-w-0 w-full bg-transparent px-3 text-sm outline-none placeholder:text-[#6a6a6a]"
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="min-h-11 shrink-0 px-3 text-[#888] transition hover:text-white" aria-label={showConfirm ? 'Hide password confirmation' : 'Show password confirmation'} aria-pressed={showConfirm}>
                  {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div role="alert" className="rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">
                {error}
              </div>
            )}

            {/* Success message */}
            {success && (
              <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-400">
                <Check size={16} />
                Your password has been changed successfully.
              </div>
            )}

            {/* Security note */}
            <div className="flex items-start gap-2 rounded-lg border border-[#1a2a4a] bg-[#001338]/50 px-4 py-3">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#4b86ff]" />
              <p className="text-xs leading-5 text-[#9ab3d4]">
                You stay signed in on this device. Other devices will need to sign in again.
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={saving || !hasInput}
                className="flex h-11 items-center gap-2 rounded-xl bg-[#ff3d46] px-5 text-sm font-semibold text-white transition hover:bg-[#ff5962] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                Change Password
              </button>
              {hasInput && !saving && (
                <button
                  type="button"
                  onClick={() => { setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setShowCurrent(false); setShowNew(false); setShowConfirm(false); setError(null); setSuccess(false); }}
                  className="h-11 rounded-xl border border-[#3a3a3a] px-4 text-sm font-medium text-[#ccc] transition hover:bg-[#272727]"
                >
                  Clear
                </button>
              )}
            </div>
            </fieldset>
          </form>}
        </div>
      </main>
    </div>
  );
}
