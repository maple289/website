import { useEffect, useState } from 'react';
import { ArrowLeft, HardDrive, Loader as Loader2, Mail, Lock, Pencil, ShieldCheck, Trash2, Users, UserPlus, X, FolderTree, CircleCheck as CheckCircle2, TriangleAlert as AlertTriangle, ChevronDown, Clock, Check, XCircle, Save, AlertCircle } from 'lucide-react';
import { supabase, supabaseAnonKey } from '@/lib/supabase';
import { useAdmin } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { fetchStorageSettings, saveStorageSettings } from '@/lib/storageSettings';
import { Server } from 'lucide-react';

const adminFnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`;
const approveFnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approve-registration`;

type Tab = 'users' | 'storage';

type Profile = {
  id: string;
  email: string | null;
  role: string;
  created_at: string;
};

type PendingRegistration = {
  id: string;
  email: string;
  status: string;
  created_at: string;
};

export function AdminPage() {
  const { isAdmin, checking, refreshAdmin } = useAdmin();
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState<Tab>('users');

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(90deg,#033C8D_0%,#001338_48%,#0062C7_100%)] text-[#f1f1f1]">
        <Loader2 size={28} className="animate-spin text-[#ff3d46]" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[linear-gradient(90deg,#033C8D_0%,#001338_48%,#0062C7_100%)] px-6 text-center text-[#f1f1f1]">
        <ShieldCheck size={48} className="text-[#ff3d46]" />
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Admin access required</h1>
        <p className="max-w-sm text-sm text-[#999]">
          You need an admin account to view this page. Sign in with an admin account to manage users and storage configuration.
        </p>
        <a href="/" className="mt-2 rounded-lg bg-[#ff3d46] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#ff5962]">
          Back to home
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(90deg,#033C8D_0%,#001338_48%,#0062C7_100%)] text-[#f1f1f1]">
      <header className="sticky top-0 z-30 border-b border-[#1a2a4a] bg-[#001338]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1100px] items-center gap-4 px-5 lg:px-8">
          <a href="/" className="rounded-full p-2.5 transition hover:bg-[#272727]" aria-label="Back to home">
            <ArrowLeft size={20} />
          </a>
          <div className="flex h-8 w-10 items-center justify-center rounded-[10px] bg-[#ff3d46]">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <span className="text-[19px] font-semibold tracking-[-0.04em]">Admin Console</span>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-5 pb-20 pt-8 lg:px-8">
        <div className="mb-8 flex gap-1 rounded-xl border border-[#272727] bg-[#161616] p-1.5">
          <TabButton active={tab === 'users'} onClick={() => setTab('users')} icon={<Users size={17} />}>User Accounts</TabButton>
          <TabButton active={tab === 'storage'} onClick={() => setTab('storage')} icon={<FolderTree size={17} />}>File Locations</TabButton>
        </div>
        {tab === 'users' ? <UsersTab currentUserId={currentUser?.id ?? null} onRoleChanged={refreshAdmin} /> : <StorageTab />}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${active ? 'bg-[#ff3d46] text-white' : 'text-[#a5a5a5] hover:text-white'}`}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------- Users Tab ----------

function UsersTab({ currentUserId, onRoleChanged }: { currentUserId: string | null; onRoleChanged: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [deletingUser, setDeletingUser] = useState<Profile | null>(null);
  const [roleChangeUser, setRoleChangeUser] = useState<Profile | null>(null);
  const [openRoleMenu, setOpenRoleMenu] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.from('profiles').select('id, email, role, created_at').order('created_at', { ascending: false });
    if (error) {
      setError('Could not load users. Please try again.');
    } else {
      setProfiles(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const confirmRoleChange = async () => {
    if (!roleChangeUser) return;
    const newRole = roleChangeUser.role === 'admin' ? 'user' : 'admin';
    setActionId(roleChangeUser.id);
    const { error } = await supabase.rpc('set_user_role', { target: roleChangeUser.id, new_role: newRole });
    if (error) {
      setError('Failed to update role.');
      setActionId(null);
      setRoleChangeUser(null);
      return;
    }
    setProfiles((prev) => prev.map((p) => (p.id === roleChangeUser.id ? { ...p, role: newRole } : p)));
    setActionId(null);
    setRoleChangeUser(null);
    onRoleChanged();
  };

  const getAuthHeaders = async () => {
    const { data } = await supabase.auth.getSession();
    return {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${data.session?.access_token ?? ''}`,
    };
  };

  const filtered = profiles.filter((p) => {
    const term = search.trim().toLowerCase();
    return !term || (p.email ?? '').toLowerCase().includes(term);
  });

  return (
    <div onClick={() => setOpenRoleMenu(null)}>
      <PendingRegistrations onResolved={load} getAuthHeaders={getAuthHeaders} />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.03em]">User Accounts</h2>
          <p className="mt-1 text-sm text-[#888]">{profiles.length} registered {profiles.length === 1 ? 'user' : 'users'}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] px-3 sm:w-60">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email..."
              className="h-full w-full bg-transparent text-sm outline-none placeholder:text-[#6a6a6a]"
            />
            {search && <button onClick={() => setSearch('')} className="rounded-full p-1 hover:bg-[#272727]"><X size={16} /></button>}
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#ff3d46] px-4 text-sm font-semibold text-white transition hover:bg-[#ff5962]"
          >
            <UserPlus size={18} /> <span className="hidden sm:inline">Add user</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={26} className="animate-spin text-[#ff3d46]" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#3b3b3b] py-20 text-center">
          <Users className="mx-auto mb-3 text-[#555]" size={32} />
          <p className="text-sm text-[#888]">No users found.</p>
          <button onClick={() => setShowAdd(true)} className="mt-4 text-sm font-semibold text-[#ff6971] hover:text-[#ff9ba0]">Add the first user</button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#272727]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#181818] text-[#888]">
              <tr>
                <th className="px-5 py-3.5 font-medium">Email</th>
                <th className="px-5 py-3.5 font-medium">Role</th>
                <th className="hidden px-5 py-3.5 font-medium sm:table-cell">Joined</th>
                <th className="px-5 py-3.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#222]">
              {filtered.map((p) => (
                <tr key={p.id} className="transition hover:bg-[#181818]">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#3a3a3a] to-[#222] text-sm font-semibold text-[#ccc]">
                        {(p.email ?? '?').charAt(0).toUpperCase()}
                      </div>
                      <span className="text-[#e8e8e8]">{p.email ?? 'Unknown'}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          if (p.id === currentUserId) return;
                          setOpenRoleMenu(openRoleMenu === p.id ? null : p.id);
                        }}
                        disabled={actionId === p.id || p.id === currentUserId}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${p.role === 'admin' ? 'bg-[#ff3d46]/15 text-[#ff737b]' : 'bg-[#272727] text-[#a5a5a5]'} ${p.id !== currentUserId ? 'hover:opacity-80' : ''}`}
                        title={p.id === currentUserId ? 'You cannot change your own role' : 'Change role'}
                      >
                        {actionId === p.id ? <Loader2 size={13} className="animate-spin" /> : p.role === 'admin' ? <ShieldCheck size={13} /> : null}
                        {p.role === 'admin' ? 'Admin' : 'User'}
                        {p.id !== currentUserId && <ChevronDown size={12} className="opacity-60" />}
                      </button>
                      {openRoleMenu === p.id && (
                        <div className="absolute left-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#181818] py-1 shadow-2xl">
                          <button
                            onClick={() => {
                              setOpenRoleMenu(null);
                              if (p.role !== 'admin') setRoleChangeUser(p);
                            }}
                            className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium transition hover:bg-[#272727] ${p.role === 'admin' ? 'text-[#ff737b]' : 'text-[#ccc]'}`}
                          >
                            <ShieldCheck size={14} /> Admin
                            {p.role === 'admin' && <span className="ml-auto text-[#555]">✓</span>}
                          </button>
                          <button
                            onClick={() => {
                              setOpenRoleMenu(null);
                              if (p.role !== 'user') setRoleChangeUser(p);
                            }}
                            className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium transition hover:bg-[#272727] ${p.role === 'user' ? 'text-white' : 'text-[#ccc]'}`}
                          >
                            <Users size={14} /> User
                            {p.role === 'user' && <span className="ml-auto text-[#555]">✓</span>}
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="hidden px-5 py-4 text-[#888] sm:table-cell">
                    {new Date(p.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setEditingUser(p)}
                        className="rounded-lg p-2 text-[#888] transition hover:bg-[#272727] hover:text-white"
                        aria-label="Edit user"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => setDeletingUser(p)}
                        disabled={p.id === currentUserId}
                        className="rounded-lg p-2 text-[#888] transition hover:bg-[#ff3d46]/15 hover:text-[#ff737b] disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Delete user"
                        title={p.id === currentUserId ? 'You cannot delete your own account' : 'Delete user'}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddUserModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); load(); }}
          getAuthHeaders={getAuthHeaders}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={() => { setEditingUser(null); load(); }}
          getAuthHeaders={getAuthHeaders}
        />
      )}

      {deletingUser && (
        <DeleteUserModal
          user={deletingUser}
          onClose={() => setDeletingUser(null)}
          onDeleted={() => { setDeletingUser(null); load(); }}
          getAuthHeaders={getAuthHeaders}
        />
      )}

      {roleChangeUser && (
        <ChangeRoleModal
          user={roleChangeUser}
          onClose={() => setRoleChangeUser(null)}
          onConfirm={confirmRoleChange}
          saving={actionId === roleChangeUser.id}
        />
      )}
    </div>
  );
}

// ---------- Pending Registrations ----------

function PendingRegistrations({ onResolved, getAuthHeaders }: { onResolved: () => void; getAuthHeaders: AuthHeadersFn }) {
  const [pending, setPending] = useState<PendingRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ reg: PendingRegistration; action: 'approve' | 'reject' } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from('pending_registrations')
      .select('id, email, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (!error && data) {
      setPending(data);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAction = async () => {
    if (!confirmAction) return;
    setActionId(confirmAction.reg.id);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(approveFnUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: confirmAction.action, registrationId: confirmAction.reg.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to process request.');
        setActionId(null);
        setConfirmAction(null);
        return;
      }
      setPending((prev) => prev.filter((p) => p.id !== confirmAction.reg.id));
      setActionId(null);
      setConfirmAction(null);
      onResolved();
    } catch {
      setError('Network error. Please try again.');
      setActionId(null);
      setConfirmAction(null);
    }
  };

  if (loading) return null;
  if (pending.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="mb-4 flex items-center gap-2">
        <Clock size={18} className="text-amber-400" />
        <h3 className="text-base font-semibold tracking-[-0.02em]">Pending Approvals</h3>
        <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-400">{pending.length}</span>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">{error}</div>
      )}

      <div className="overflow-hidden rounded-2xl border border-amber-500/20">
        <table className="w-full text-left text-sm">
          <thead className="bg-amber-500/5 text-[#888]">
            <tr>
              <th className="px-5 py-3.5 font-medium">Email</th>
              <th className="hidden px-5 py-3.5 font-medium sm:table-cell">Requested</th>
              <th className="px-5 py-3.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#222]">
            {pending.map((reg) => (
              <tr key={reg.id} className="transition hover:bg-amber-500/5">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15 text-sm font-semibold text-amber-400">
                      {(reg.email ?? '?').charAt(0).toUpperCase()}
                    </div>
                    <span className="text-[#e8e8e8]">{reg.email}</span>
                  </div>
                </td>
                <td className="hidden px-5 py-4 text-[#888] sm:table-cell">
                  {new Date(reg.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setConfirmAction({ reg, action: 'approve' })}
                      disabled={actionId === reg.id}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600/15 px-3 py-2 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-600/25 disabled:opacity-50"
                    >
                      {actionId === reg.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                      Approve
                    </button>
                    <button
                      onClick={() => setConfirmAction({ reg, action: 'reject' })}
                      disabled={actionId === reg.id}
                      className="flex items-center gap-1.5 rounded-lg bg-[#ff3d46]/15 px-3 py-2 text-xs font-semibold text-[#ff737b] transition hover:bg-[#ff3d46]/25 disabled:opacity-50"
                    >
                      {actionId === reg.id ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={14} />}
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmAction && (
        <ConfirmApprovalModal
          email={confirmAction.reg.email}
          action={confirmAction.action}
          saving={actionId === confirmAction.reg.id}
          onClose={() => setConfirmAction(null)}
          onConfirm={handleAction}
        />
      )}
    </div>
  );
}

function ConfirmApprovalModal({ email, action, saving, onClose, onConfirm }: { email: string; action: 'approve' | 'reject'; saving: boolean; onClose: () => void; onConfirm: () => void }) {
  const isApprove = action === 'approve';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[#2e2e2e] bg-[#181818] shadow-2xl">
        <div className="px-6 pt-6">
          <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${isApprove ? 'bg-emerald-600/15 text-emerald-400' : 'bg-[#ff3d46]/15 text-[#ff737b]'}`}>
            {isApprove ? <Check size={24} /> : <XCircle size={24} />}
          </div>
          <h2 className="text-lg font-semibold tracking-[-0.02em]">
            {isApprove ? 'Approve Registration' : 'Reject Registration'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#a5a5a5]">
            {isApprove ? (
              <>Are you sure you want to approve the registration for <span className="font-semibold text-white">{email}</span>? An account will be created and they will be able to sign in immediately.</>
            ) : (
              <>Are you sure you want to reject the registration for <span className="font-semibold text-white">{email}</span>? No account will be created.</>
            )}
          </p>
        </div>
        <div className="px-6 pb-7 pt-5">
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl border border-[#3a3a3a] text-sm font-medium text-[#ccc] transition hover:bg-[#272727]">Cancel</button>
            <button
              onClick={onConfirm}
              disabled={saving}
              className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition disabled:opacity-60 ${isApprove ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-[#ff3d46] hover:bg-[#ff5962]'}`}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : isApprove ? <Check size={16} /> : <XCircle size={16} />}
              {isApprove ? 'Approve' : 'Reject'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChangeRoleModal({ user, onClose, onConfirm, saving }: { user: Profile; onClose: () => void; onConfirm: () => void; saving: boolean }) {
  const newRole = user.role === 'admin' ? 'user' : 'admin';
  const isPromotion = newRole === 'admin';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[#2e2e2e] bg-[#181818] shadow-2xl">
        <div className="px-6 pt-6">
          <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${isPromotion ? 'bg-[#ff3d46]/15 text-[#ff737b]' : 'bg-amber-500/15 text-amber-400'}`}>
            {isPromotion ? <ShieldCheck size={24} /> : <AlertTriangle size={24} />}
          </div>
          <h2 className="text-lg font-semibold tracking-[-0.02em]">
            {isPromotion ? 'Promote to Admin' : 'Demote to User'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#a5a5a5]">
            {isPromotion ? (
              <>Are you sure you want to promote <span className="font-semibold text-white">{user.email}</span> to admin? They will gain full access to the Admin Console, including user management and storage configuration.</>
            ) : (
              <>Are you sure you want to demote <span className="font-semibold text-white">{user.email}</span> to a regular user? They will lose access to the Admin Console immediately.</>
            )}
          </p>
        </div>
        <div className="px-6 pb-7 pt-5">
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-[#272727] bg-[#121212] px-4 py-3">
            <span className="text-xs text-[#888]">Current role:</span>
            <span className={`text-xs font-semibold ${user.role === 'admin' ? 'text-[#ff737b]' : 'text-[#a5a5a5]'}`}>{user.role === 'admin' ? 'Admin' : 'User'}</span>
            <span className="mx-1 text-[#555]">→</span>
            <span className="text-xs text-[#888]">New role:</span>
            <span className={`text-xs font-semibold ${newRole === 'admin' ? 'text-[#ff737b]' : 'text-[#a5a5a5]'}`}>{newRole === 'admin' ? 'Admin' : 'User'}</span>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl border border-[#3a3a3a] text-sm font-medium text-[#ccc] transition hover:bg-[#272727]">Cancel</button>
            <button
              onClick={onConfirm}
              disabled={saving}
              className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition disabled:opacity-60 ${isPromotion ? 'bg-[#ff3d46] hover:bg-[#ff5962]' : 'bg-amber-600 hover:bg-amber-500'}`}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : isPromotion ? <ShieldCheck size={16} /> : <Users size={16} />}
              {isPromotion ? 'Promote' : 'Demote'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Storage Tab ----------

function StorageTab() {
  const [loading, setLoading] = useState(true);
  const [userCount, setUserCount] = useState(0);
  const [videoCount, setVideoCount] = useState(0);
  const [photoCount, setPhotoCount] = useState(0);
  const [videosPath, setVideosPath] = useState('');
  const [imagesPath, setImagesPath] = useState('');
  const [fileServerUrl, setFileServerUrl] = useState('');
  const [savedVideosPath, setSavedVideosPath] = useState('');
  const [savedImagesPath, setSavedImagesPath] = useState('');
  const [savedFileServerUrl, setSavedFileServerUrl] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [settings, uRes, vRes, pRes] = await Promise.all([
      fetchStorageSettings(),
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('videos').select('*', { count: 'exact', head: true }),
      supabase.from('photos').select('*', { count: 'exact', head: true }),
    ]);
    if (settings) {
      setVideosPath(settings.videos_base_path);
      setImagesPath(settings.images_base_path);
      setFileServerUrl(settings.file_server_url);
      setSavedVideosPath(settings.videos_base_path);
      setSavedImagesPath(settings.images_base_path);
      setSavedFileServerUrl(settings.file_server_url);
      setUpdatedAt(settings.updated_at);
    }
    setUserCount(uRes.count ?? 0);
    setVideoCount(vRes.count ?? 0);
    setPhotoCount(pRes.count ?? 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSettingsError(null);
    setSettingsSaved(false);
    const result = await saveStorageSettings(videosPath, imagesPath, fileServerUrl);
    if (!result.ok) {
      setSettingsError(result.error);
      setSavingSettings(false);
      return;
    }
    setSavedVideosPath(result.settings.videos_base_path);
    setSavedImagesPath(result.settings.images_base_path);
    setSavedFileServerUrl(result.settings.file_server_url);
    setUpdatedAt(result.settings.updated_at);
    setSettingsSaved(true);
    setSavingSettings(false);
  };

  const hasUnsavedChanges = videosPath !== savedVideosPath || imagesPath !== savedImagesPath || fileServerUrl !== savedFileServerUrl;

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={26} className="animate-spin text-[#ff3d46]" /></div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-[-0.03em]">Storage Settings</h2>
        <p className="mt-1 text-sm text-[#888]">Configure the physical disk and folder locations where user-uploaded videos and images are stored. These locations are used when saving new uploads and persist across restarts.</p>
      </div>

      {/* Storage Settings Section */}
      <div className="rounded-2xl border border-[#272727] bg-[#161616] p-6">
        <div className="mb-5 flex items-center gap-2">
          <HardDrive size={18} className="text-[#ff737b]" />
          <h3 className="text-sm font-semibold tracking-[-0.01em]">Storage Locations</h3>
        </div>

        {/* Videos location */}
        <div className="mb-5">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">User Videos Storage Location</label>
          <div className="flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
            <FolderTree className="ml-3.5 text-[#888]" size={17} />
            <input
              value={videosPath}
              onChange={(e) => { setVideosPath(e.target.value); setSettingsSaved(false); }}
              placeholder="/mnt/storage/videos"
              className="h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-[#6a6a6a]"
            />
          </div>
          <p className="mt-1.5 text-xs leading-5 text-[#777]">The physical disk or folder path where new user-uploaded videos will be stored. Enter an absolute path (e.g. <code className="rounded bg-[#272727] px-1 py-0.5 font-mono text-[11px] text-[#ccc]">/mnt/storage/videos</code>).</p>
        </div>

        {/* Images location */}
        <div className="mb-5">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">User Images Storage Location</label>
          <div className="flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
            <FolderTree className="ml-3.5 text-[#888]" size={17} />
            <input
              value={imagesPath}
              onChange={(e) => { setImagesPath(e.target.value); setSettingsSaved(false); }}
              placeholder="/mnt/storage/images"
              className="h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-[#6a6a6a]"
            />
          </div>
          <p className="mt-1.5 text-xs leading-5 text-[#777]">The physical disk or folder path where new user-uploaded images will be stored. Enter an absolute path (e.g. <code className="rounded bg-[#272727] px-1 py-0.5 font-mono text-[11px] text-[#ccc]">/mnt/storage/images</code>).</p>
        </div>

        {/* File Storage Server URL */}
        <div className="mb-5">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">File Storage Server URL</label>
          <div className="flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
            <Server className="ml-3.5 text-[#888]" size={17} />
            <input
              value={fileServerUrl}
              onChange={(e) => { setFileServerUrl(e.target.value); setSettingsSaved(false); }}
              placeholder="https://fileserver.example.com or 192.168.1.100"
              className="h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-[#6a6a6a]"
            />
          </div>
          <p className="mt-1.5 text-xs leading-5 text-[#777]">The URL or IP address of the external file server. When users click "File Storage" in the sidebar, this address opens in a new tab. Leave empty to hide the link.</p>
        </div>

        {/* Validation info */}
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-[#1a2a4a] bg-[#001338]/50 px-4 py-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-[#4b86ff]" />
          <p className="text-xs leading-5 text-[#9ab3d4]">
            When you save, the server validates that each folder exists and is writable. If a folder does not exist or cannot be written to, an error message will appear and the setting will not be saved.
          </p>
        </div>

        {settingsError && (
          <div className="mb-4 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">{settingsError}</div>
        )}
        {settingsSaved && !settingsError && (
          <div className="mb-4 rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-400">Storage locations saved successfully. New uploads will use these paths.</div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings || !hasUnsavedChanges}
            className="flex h-11 items-center gap-2 rounded-xl bg-[#ff3d46] px-5 text-sm font-semibold text-white transition hover:bg-[#ff5962] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {savingSettings ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save Storage Locations
          </button>
          {hasUnsavedChanges && (
            <button
              onClick={() => { setVideosPath(savedVideosPath); setImagesPath(savedImagesPath); setFileServerUrl(savedFileServerUrl); setSettingsError(null); setSettingsSaved(false); }}
              className="h-11 rounded-xl border border-[#3a3a3a] px-4 text-sm font-medium text-[#ccc] transition hover:bg-[#272727]"
            >
              Revert
            </button>
          )}
          {updatedAt && !hasUnsavedChanges && (
            <span className="text-xs text-[#6a6a6a]">Last updated {new Date(updatedAt).toLocaleString()}</span>
          )}
        </div>
      </div>

      {/* Bucket info */}
      <div className="mt-4 rounded-2xl border border-[#272727] bg-[#161616] p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#ff3d46]/15 text-[#ff737b]">
            <HardDrive size={20} />
          </div>
          <div>
            <p className="text-sm font-semibold">Private bucket: <code className="rounded bg-[#272727] px-1.5 py-0.5 font-mono text-xs text-[#ccc]">user-videos</code></p>
            <p className="mt-1.5 text-xs leading-5 text-[#777]">Maximum file size: 10 GB. Uploaded files must use a video MIME type. Only the owner can upload, edit, or delete files in their folder.</p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-[#272727] bg-[#161616] p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#ff3d46]/15 text-[#ff737b]">
            <FolderTree size={20} />
          </div>
          <div>
            <p className="text-sm font-semibold">Private bucket: <code className="rounded bg-[#272727] px-1.5 py-0.5 font-mono text-xs text-[#ccc]">user-images</code></p>
            <p className="mt-1.5 text-xs leading-5 text-[#777]">Maximum original size: 25 MB. Stores photo originals, optimized previews, thumbnails, and video preview images.</p>
          </div>
        </div>
      </div>

      {/* Folder structure preview */}
      <div className="mt-6 rounded-2xl border border-[#272727] bg-[#161616] p-6">
        <div className="mb-4 flex items-center gap-2">
          <FolderTree size={18} className="text-[#ff737b]" />
          <h3 className="text-sm font-semibold tracking-[-0.01em]">Folder Structure Preview</h3>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[#1a2a4a] bg-[#001338] p-4">
          <pre className="font-mono text-[13px] leading-[1.7] text-[#bbb]">
user-videos/{'\n'}
    {'<user-id>'}/videos/{'<video-id>'}/{'<file-id>'}.mp4{'\n'}
user-images/{'\n'}
    {'<user-id>'}/photos/{'<photo-id>'}/{'\n'}
        original.jpg{'\n'}
        preview.webp{'\n'}
        thumbnail.webp{'\n'}
    {'<user-id>'}/video-previews/{'<video-id>'}/{'<preview-id>'}.webp{'\n'}
        ...{'\n'}
          </pre>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <StatCard label="Registered Users" value={userCount} icon={<Users size={16} />} />
          <StatCard label="Total Videos" value={videoCount} icon={<FolderTree size={16} />} />
          <StatCard label="Total Photos" value={photoCount} icon={<FolderTree size={16} />} />
          <StatCard label="Access" value="Private" icon={<CheckCircle2 size={16} />} active={true} />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, active }: { label: string; value: string | number; icon: React.ReactNode; active?: boolean }) {
  return (
    <div className="rounded-xl border border-[#222] bg-[#121212] p-4">
      <div className="mb-2 flex items-center gap-2 text-[#888]">
        {icon}
        <span className="text-xs font-medium uppercase tracking-[0.08em]">{label}</span>
      </div>
      <p className={`text-lg font-semibold tracking-[-0.02em] ${active === false ? 'text-[#888]' : 'text-white'}`}>{value}</p>
    </div>
  );
}

// ---------- User management modals ----------

type AuthHeadersFn = () => Promise<Record<string, string>>;

function AddUserModal({ onClose, onCreated, getAuthHeaders }: { onClose: () => void; onCreated: () => void; getAuthHeaders: AuthHeadersFn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Please enter an email and password.');
      return;
    }
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(adminFnUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: email.trim(), password, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create user.');
        setSaving(false);
        return;
      }
      onCreated();
    } catch {
      setError('Network error. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[#2e2e2e] bg-[#181818] shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff3d46]/15 text-[#ff737b]"><UserPlus size={20} /></div>
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Add User</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[#a7a7a7] hover:bg-[#2a2a2a] hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 pb-7 pt-5">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Email</label>
          <div className="mb-4 flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
            <Mail className="ml-3.5 text-[#888]" size={17} />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-[#6a6a6a]"
            />
          </div>

          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Password</label>
          <div className="mb-4 flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
            <Lock className="ml-3.5 text-[#888]" size={17} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              className="h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-[#6a6a6a]"
            />
          </div>

          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Role</label>
          <div className="mb-5 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setRole('user')} className={`rounded-xl border py-3 text-sm font-medium transition ${role === 'user' ? 'border-[#ff3d46] bg-[#ff3d46]/10 text-[#ff737b]' : 'border-[#3a3a3a] text-[#999] hover:border-[#4a4a4a]'}`}>User</button>
            <button type="button" onClick={() => setRole('admin')} className={`flex items-center justify-center gap-1.5 rounded-xl border py-3 text-sm font-medium transition ${role === 'admin' ? 'border-[#ff3d46] bg-[#ff3d46]/10 text-[#ff737b]' : 'border-[#3a3a3a] text-[#999] hover:border-[#4a4a4a]'}`}><ShieldCheck size={15} /> Admin</button>
          </div>

          {error && <div className="mb-4 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">{error}</div>}

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl border border-[#3a3a3a] text-sm font-medium text-[#ccc] transition hover:bg-[#272727]">Cancel</button>
            <button type="submit" disabled={saving} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#ff3d46] text-sm font-semibold text-white transition hover:bg-[#ff5962] disabled:opacity-60">
              {saving && <Loader2 size={16} className="animate-spin" />}
              Create user
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditUserModal({ user, onClose, onSaved, getAuthHeaders }: { user: Profile; onClose: () => void; onSaved: () => void; getAuthHeaders: AuthHeadersFn }) {
  const [email, setEmail] = useState(user.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() && !password) {
      setError('Enter a new email or password to update.');
      return;
    }
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const body: Record<string, string> = { id: user.id };
      if (email.trim() && email.trim() !== user.email) body.email = email.trim();
      if (password) body.password = password;
      const res = await fetch(adminFnUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to update user.');
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setError('Network error. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[#2e2e2e] bg-[#181818] shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff3d46]/15 text-[#ff737b]"><Pencil size={20} /></div>
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em]">Edit User</h2>
              <p className="text-xs text-[#888]">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[#a7a7a7] hover:bg-[#2a2a2a] hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 pb-7 pt-5">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">Email</label>
          <div className="mb-4 flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
            <Mail className="ml-3.5 text-[#888]" size={17} />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-[#6a6a6a]"
            />
          </div>

          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9a9a9a]">New Password</label>
          <div className="mb-2 flex h-11 items-center overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#121212] transition focus-within:border-[#4b86ff]">
            <Lock className="ml-3.5 text-[#888]" size={17} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current"
              className="h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-[#6a6a6a]"
            />
          </div>
          <p className="mb-5 text-xs text-[#6a6a6a]">Fill in only the fields you want to change.</p>

          {error && <div className="mb-4 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">{error}</div>}

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl border border-[#3a3a3a] text-sm font-medium text-[#ccc] transition hover:bg-[#272727]">Cancel</button>
            <button type="submit" disabled={saving} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#ff3d46] text-sm font-semibold text-white transition hover:bg-[#ff5962] disabled:opacity-60">
              {saving && <Loader2 size={16} className="animate-spin" />}
              Save changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteUserModal({ user, onClose, onDeleted, getAuthHeaders }: { user: Profile; onClose: () => void; onDeleted: () => void; getAuthHeaders: AuthHeadersFn }) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${adminFnUrl}?id=${encodeURIComponent(user.id)}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to delete user.');
        setDeleting(false);
        return;
      }
      onDeleted();
    } catch {
      setError('Network error. Please try again.');
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[#2e2e2e] bg-[#181818] shadow-2xl">
        <div className="px-6 pt-6">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#ff3d46]/15 text-[#ff737b]">
            <AlertTriangle size={24} />
          </div>
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Delete User</h2>
          <p className="mt-2 text-sm leading-6 text-[#a5a5a5]">
            Are you sure you want to permanently delete <span className="font-semibold text-white">{user.email}</span>? This action cannot be undone and all their data will be removed.
          </p>
        </div>
        <div className="px-6 pb-7 pt-5">
          {error && <div className="mb-4 rounded-lg border border-[#ff3d46]/30 bg-[#ff3d46]/10 px-4 py-3 text-sm text-[#ff8a90]">{error}</div>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl border border-[#3a3a3a] text-sm font-medium text-[#ccc] transition hover:bg-[#272727]">Cancel</button>
            <button onClick={handleDelete} disabled={deleting} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#ff3d46] text-sm font-semibold text-white transition hover:bg-[#ff5962] disabled:opacity-60">
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Delete user
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
