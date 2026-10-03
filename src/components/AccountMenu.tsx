import { useEffect, useRef, useState } from 'react';
import { BarChart3, LogOut, UserRound, Settings, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';

type AccountMenuProps = {
  onSignIn: () => void;
};

export function AccountMenu({ onSignIn }: AccountMenuProps) {
  const { user, signOut } = useAuth();
  const { isAdmin } = useAdmin();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onClick); document.removeEventListener('keydown', onKey); };
  }, []);

  if (!user) {
    return (
      <button
        onClick={onSignIn}
        aria-label="Sign in"
        className="fluent-account-button flex items-center gap-2 px-3 py-2 text-sm font-medium sm:px-4"
      >
        <UserRound size={18} />
        <span className="hidden sm:inline">Sign in</span>
      </button>
    );
  }

  const email = user.email ?? '';
  const initial = email.charAt(0).toUpperCase() || 'U';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Account menu"
        aria-expanded={open}
        className="fluent-avatar"
      >
        {initial}
      </button>
      {open && (
        <div className="fluent-account-menu">
          <div className="border-b border-[#2e2e2e] px-4 pb-3 pt-1">
            <p className="truncate text-sm font-medium text-white">{email}</p>
            <p className="mt-0.5 text-xs text-[#888]">Signed in</p>
          </div>
          <a href="#/library" onClick={() => setOpen(false)}><UserRound size={18} />My Videos</a>
          {isAdmin && (
            <a href="#/admin" onClick={() => setOpen(false)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[#ff737b] transition hover:bg-[#262626]">
              <ShieldCheck size={18} /> Admin Console
            </a>
          )}
          <a href="#/settings" onClick={() => setOpen(false)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[#d4d4d4] transition hover:bg-[#262626]">
            <Settings size={18} /> Settings
          </a>
          <a href="#/statistics" onClick={() => setOpen(false)}><BarChart3 size={18} />Statistics</a>
          <div className="my-1 h-px bg-[#2e2e2e]" />
          <button
            onClick={async () => { await signOut(); setOpen(false); }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[#d4d4d4] transition hover:bg-[#262626]"
          >
            <LogOut size={18} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
