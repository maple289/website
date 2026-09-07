import { useState } from 'react';
import { ArrowLeft, KeyRound, Loader as Loader2, ShieldCheck, Eye, EyeOff, Lock, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export function SettingsPage() {
  const { user, signOut } = useAuth();
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
    setError(null);
    setSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
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

    // Verify the current password by re-authenticating
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });

    if (signInError) {
      setError('Your current password is incorrect.');
      setSaving(false);
      return;
    }

    // Update the password
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    if (updateError) {
      setError(updateError.message || 'Failed to update password. Please try again.');
      setSaving(false);
      return;
    }

    setSaving(false);
    setSuccess(true);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');

    // Sign out after a short delay so the user sees the success message
    setTimeout(() => {
      signOut();
    }, 2500);
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
          <p className="mt-1 text-sm text-[#888]">Manage your account security and password.</p>
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

        {/* Change Password */}
        <div className="rounded-2xl border border-[#272727] bg-[#161616] p-6">
          <div className="mb-5 flex items-center gap-2">
            <KeyRound size={18} className="text-[#ff737b]" />
            <h3 className="text-sm font-semibold tracking-[-0.01em]">Change Password</h3>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Current password */}
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Current Password</label>
              <div className="flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
                <Lock className="ml-3.5 text-[#888]" size={17} />
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => { setCurrentPassword(e.target.value); setError(null); setSuccess(false); }}
                  placeholder="Enter your current password"
                  autoComplete="current-password"
                  className="h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-[#6a6a6a]"
                />
                <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="px-3 text-[#888] transition hover:text-white" aria-label="Toggle visibility">
                  {showCurrent ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">New Password</label>
              <div className="flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
                <Lock className="ml-3.5 text-[#888]" size={17} />
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setError(null); setSuccess(false); }}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  className="h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-[#6a6a6a]"
                />
                <button type="button" onClick={() => setShowNew(!showNew)} className="px-3 text-[#888] transition hover:text-white" aria-label="Toggle visibility">
                  {showNew ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {/* Confirm new password */}
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Confirm New Password</label>
              <div className="flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
                <Lock className="ml-3.5 text-[#888]" size={17} />
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(null); setSuccess(false); }}
                  placeholder="Re-enter your new password"
                  autoComplete="new-password"
                  className="h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-[#6a6a6a]"
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="px-3 text-[#888] transition hover:text-white" aria-label="Toggle visibility">
                  {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">
                {error}
              </div>
            )}

            {/* Success message */}
            {success && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-400">
                <Check size={16} />
                Password changed successfully. You will be signed out shortly — please sign in with your new password.
              </div>
            )}

            {/* Security note */}
            <div className="flex items-start gap-2 rounded-lg border border-[#1a2a4a] bg-[#001338]/50 px-4 py-3">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#4b86ff]" />
              <p className="text-xs leading-5 text-[#9ab3d4]">
                For your security, you will be automatically signed out after changing your password. You'll need to sign in again with your new password.
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-1">
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
                  onClick={() => { setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setError(null); setSuccess(false); }}
                  className="h-11 rounded-xl border border-[#3a3a3a] px-4 text-sm font-medium text-[#ccc] transition hover:bg-[#272727]"
                >
                  Clear
                </button>
              )}
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
