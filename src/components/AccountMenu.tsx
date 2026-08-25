import { useEffect, useRef, useState } from 'react';
import { LogOut, UserRound, Settings, ShieldCheck } from 'lucide-react';
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
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) {
    return (
      <button
        onClick={onSignIn}
        className="flex items-center gap-2 rounded-full border border-[#3a3a3a] px-3 py-2 text-sm font-medium transition hover:bg-[#272727] sm:px-4"
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
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#ff5962] to-[#ff3d46] text-[15px] font-semibold text-white transition hover:ring-2 hover:ring-[#ff3d46]/60"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 top-12 w-64 overflow-hidden rounded-xl border border-[#2e2e2e] bg-[#1c1c1c] py-2 shadow-2xl">
          <div className="border-b border-[#2e2e2e] px-4 pb-3 pt-1">
            <p className="truncate text-sm font-medium text-white">{email}</p>
            <p className="mt-0.5 text-xs text-[#888]">Signed in</p>
          </div>
          <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[#d4d4d4] transition hover:bg-[#262626]">
            <UserRound size={18} /> Your channel
          </button>
          {isAdmin && (
            <a href="#/admin" onClick={() => setOpen(false)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[#ff737b] transition hover:bg-[#262626]">
              <ShieldCheck size={18} /> Admin Console
            </a>
          )}
          <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[#d4d4d4] transition hover:bg-[#262626]">
            <Settings size={18} /> Settings
          </button>
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
