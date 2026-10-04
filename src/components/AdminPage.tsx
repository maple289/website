import { TaskModal } from './TaskModal';
import { useGuardedClose } from '@/hooks/useGuardedClose';
import { useDeleteConfirmation } from '@/lib/deleteConfirmation';
import { ProfileNameFields } from './ProfileNameFields';
import { AccountMenu } from './AccountMenu';
import './AdminConsole.css';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clapperboard, Menu, Search, HardDrive, Loader as Loader2, Mail, Lock, Pencil, ShieldCheck, Trash2, Users, UserPlus, X, FolderTree, CircleCheck as CheckCircle2, TriangleAlert as AlertTriangle, ChevronDown, Clock, Check, XCircle, Save, AlertCircle } from 'lucide-react';
import { supabase, supabaseAnonKey } from '@/lib/supabase';
import { useAdmin } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { fetchStorageSettings, saveStorageSettings } from '@/lib/storageSettings';
import { Server } from 'lucide-react';
import { BarChart3 } from 'lucide-react';
import { Settings2 } from 'lucide-react';
import { VideoProcessingSettings } from './VideoProcessingSettings';
import { useSystemLoad } from '@/hooks/useSystemLoad';
import { SystemLoadWidget } from './SystemLoadWidget';
import { Activity } from 'lucide-react';
const AdminStatistics = lazy(() => import('./AdminStatistics').then(module => ({ default: module.AdminStatistics })));

const adminFnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`;
const approveFnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approve-registration`;

type Tab = 'users' | 'storage' | 'statistics' | 'settings' | 'system';

type Profile = {
  first_name: string | null;
  last_name: string | null;
  id: string;
  email: string | null;
  role: string;
  created_at: string;
};

type PendingRegistration = {
  first_name: string | null;
  last_name: string | null;
  id: string;
  email: string;
  status: string;
  created_at: string;
};

export function AdminPage() {
  const { isAdmin, checking, refreshAdmin } = useAdmin();
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState<Tab>('users');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebar, setDesktopSidebar] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const menuButton = useRef<HTMLButtonElement>(null);
  const systemLoad = useSystemLoad(Boolean(currentUser && isAdmin && !checking && (desktopSidebar || sidebarOpen || tab === 'system')), currentUser?.id);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const changed = () => setDesktopSidebar(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const closeNavigation = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSidebarOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', closeNavigation);
    return () => document.removeEventListener('keydown', closeNavigation);
  }, [sidebarOpen]);

  const selectTab = (next: Tab) => {
    setTab(next);
    setSidebarOpen(false);
    if (sidebarOpen) menuButton.current?.focus();
  };

  if (checking) {
    return (
      <div className="fluent-shell admin-console flex min-h-screen items-center justify-center" role="status" aria-label="Checking administrator access">
        <Loader2 size={28} className="animate-spin text-blue-600" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="fluent-shell admin-console flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <ShieldCheck size={48} className="text-blue-600" />
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Admin access required</h1>
        <p className="max-w-sm text-sm text-[#999]">
          You need an admin account to view this page. Sign in with an admin account to manage users and storage configuration.
        </p>
        <a href="#/" className="mt-2 rounded-lg fluent-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700">
          Back to home
        </a>
      </div>
    );
  }

  return (
    <div className="fluent-shell admin-console">
      <header className="fluent-header fixed inset-x-0 top-0 z-40 h-[72px] backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-[1560px] items-center gap-4 px-5 lg:px-8">
          <button ref={menuButton} type="button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen ? 'Close admin navigation' : 'Open admin navigation'} aria-expanded={sidebarOpen} aria-controls="admin-navigation" className="admin-header-control lg:hidden">
            {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <a href="#/" className="admin-header-control" aria-label="Back to home" title="Back to Home">
            <ArrowLeft size={20} />
          </a>
          <a href="#/" aria-label="MyHostage Home" className="fluent-brand admin-brand">
            <span className="fluent-brand-icon"><Clapperboard size={23} strokeWidth={1.8} /></span>
            <span className="hidden md:inline">MyHostage</span>
          </a>
          <div className="admin-header-title">
            <ShieldCheck size={18} aria-hidden="true" />
            <span>Admin Console</span>
          </div>
          <div className="ml-auto shrink-0"><AccountMenu onSignIn={() => { window.location.hash = '#/login'; }} /></div>
        </div>
      </header>

      {sidebarOpen && <button type="button" className="admin-nav-backdrop lg:hidden" aria-label="Close admin navigation" onClick={() => { setSidebarOpen(false); menuButton.current?.focus(); }} />}
      <aside id="admin-navigation" className={`fluent-sidebar admin-sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <p className="fluent-nav-label">Administration</p>
        <nav aria-label="Admin sections" className="space-y-1 text-sm">
          <TabButton active={tab === 'users'} onClick={() => selectTab('users')} icon={<Users size={20} />}>Users</TabButton>
          <TabButton active={tab === 'storage'} onClick={() => selectTab('storage')} icon={<FolderTree size={20} />}>Storage</TabButton>
          <TabButton active={tab === 'statistics'} onClick={() => selectTab('statistics')} icon={<BarChart3 size={20} />}>Statistics</TabButton>
          <TabButton active={tab === 'system'} onClick={() => selectTab('system')} icon={<Activity size={20} />}>System Load</TabButton>
          <TabButton active={tab === 'settings'} onClick={() => selectTab('settings')} icon={<Settings2 size={20} />}>Settings</TabButton>
        </nav>
        <SystemLoadWidget {...systemLoad} compact />
        <div className="admin-sidebar-footer">
          <ShieldCheck size={18} />
          <div><p className="font-medium">Administrator workspace</p><p className="mt-1 text-xs">Manage accounts, storage and site statistics.</p></div>
        </div>
      </aside>
      <main className="admin-main">
        <div className={`admin-content ${tab === 'statistics' ? 'admin-content-wide' : ''}`}>
          <p className="admin-location"><ShieldCheck size={14} /><span>Admin Console</span><span aria-hidden="true">/</span><span>{tab === 'users' ? 'Users' : tab === 'storage' ? 'Storage' : tab === 'settings' ? 'Settings' : tab === 'system' ? 'System Load' : 'Statistics'}</span></p>
          {tab === 'users' ? <UsersTab currentUserId={currentUser?.id ?? null} onRoleChanged={refreshAdmin} /> : tab === 'statistics' ? <Suspense fallback={<p role="status" className="admin-loading">Loading Statistics…</p>}><AdminStatistics /></Suspense> : tab === 'system' ? <SystemLoadWidget {...systemLoad} /> : tab === 'settings' ? <VideoProcessingSettings /> : <StorageTab />}
        </div>
      </main>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      type="button"
      aria-current={active ? 'page' : undefined}
      className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition"
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
  const { requestDelete } = useDeleteConfirmation();
  const [roleChangeUser, setRoleChangeUser] = useState<Profile | null>(null);
  const [openRoleMenu, setOpenRoleMenu] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.from('profiles').select('id, email, role, created_at, first_name, last_name').order('created_at', { ascending: false });
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
    return !term || [p.email, p.first_name, p.last_name, [p.first_name, p.last_name].filter(Boolean).join(' ')].some((value) => (value ?? '').toLowerCase().includes(term));
  });

  return (
    <div onClick={() => setOpenRoleMenu(null)}>
      <PendingRegistrations onResolved={load} getAuthHeaders={getAuthHeaders} />

      <section className="admin-panel" aria-labelledby="admin-users-heading">
        <div className="admin-toolbar">
          <div>
            <h2 id="admin-users-heading">User Accounts</h2>
            <p>{profiles.length} registered {profiles.length === 1 ? 'user' : 'users'}</p>
          </div>
          <div className="admin-toolbar-actions">
            <div className="fluent-field admin-search">
              <Search size={17} aria-hidden="true" />
              <input
                aria-label="Search users by email or name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search email or name..."
              />
              {search && <button onClick={() => setSearch('')} aria-label="Clear user search"><X size={16} /></button>}
            </div>
            <button
              onClick={() => setShowAdd(true)}
              aria-label="Add user"
              className="fluent-button fluent-primary shrink-0"
            >
              <UserPlus size={18} /> <span className="hidden sm:inline">Add user</span>
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="admin-notice admin-notice-error">{error}</div>
        )}

        {loading ? (
          <div role="status" aria-label="Loading users" className="admin-loading"><Loader2 size={26} className="animate-spin text-blue-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="admin-empty">
            <Users size={32} />
            <p>No users found.</p>
            <button onClick={() => setShowAdd(true)}>Add the first user</button>
          </div>
        ) : (
          <div className="admin-table-scroll" role="region" aria-label="User accounts" tabIndex={0}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="admin-user-avatar">
                          {(p.email ?? '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="admin-identity"><p>{p.email ?? 'Unknown'}</p><p>First Name: {p.first_name || '—'}</p><p>Last Name: {p.last_name || '—'}</p></div>
                      </div>
                    </td>
                    <td>
                      <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            if (p.id === currentUserId) return;
                            setOpenRoleMenu(openRoleMenu === p.id ? null : p.id);
                          }}
                          disabled={actionId === p.id || p.id === currentUserId}
                          className={`admin-role-button ${p.role === 'admin' ? 'is-admin' : ''}`}
                          aria-expanded={openRoleMenu === p.id}
                          title={p.id === currentUserId ? 'You cannot change your own role' : 'Change role'}
                        >
                          {actionId === p.id ? <Loader2 size={13} className="animate-spin" /> : p.role === 'admin' ? <ShieldCheck size={13} /> : null}
                          {p.role === 'admin' ? 'Admin' : 'User'}
                          {p.id !== currentUserId && <ChevronDown size={12} className="opacity-60" />}
                        </button>
                        {openRoleMenu === p.id && (
                          <div className="admin-role-menu" aria-label={`Role for ${p.email}`}>
                            <button
                              onClick={() => {
                                setOpenRoleMenu(null);
                                if (p.role !== 'admin') setRoleChangeUser(p);
                              }}
                              aria-pressed={p.role === 'admin'}
                            >
                              <ShieldCheck size={14} /> Admin
                              {p.role === 'admin' && <span className="ml-auto">✓</span>}
                            </button>
                            <button
                              onClick={() => {
                                setOpenRoleMenu(null);
                                if (p.role !== 'user') setRoleChangeUser(p);
                              }}
                              aria-pressed={p.role === 'user'}
                            >
                              <Users size={14} /> User
                              {p.role === 'user' && <span className="ml-auto">✓</span>}
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="admin-date">
                      {new Date(p.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditingUser(p)}
                          className="fluent-button fluent-secondary admin-icon-button"
                          aria-label="Edit user"
                          title="Edit user"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => void requestDelete({ title: 'Delete user',
                            message: `Are you sure you want to delete user "${[p.first_name, p.last_name].filter(Boolean).join(' ') || p.email}" (${p.email})?`,
                            details: 'The account, profile, video/photo records, file metadata, related shares and reactions will be permanently deleted. Cached document previews will be removed. Original uploaded storage files are not automatically removed; account deletion may be blocked while the user owns stored files. This cannot be undone.',
                            confirmLabel: 'Delete User', onConfirm: async () => {
                              const headers = await getAuthHeaders();
                              const response = await fetch(`${adminFnUrl}?id=${encodeURIComponent(p.id)}`, { method: 'DELETE', headers });
                              const data = await response.json();
                              if (!response.ok) throw new Error(data.error || 'Unable to delete this user. Please try again.');
                              setProfiles((current) => current.filter((profile) => profile.id !== p.id));
                              await load();
                            },
                          })}
                          disabled={p.id === currentUserId}
                          className="fluent-button fluent-danger admin-icon-button"
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

      </section>

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
  const { requestDelete } = useDeleteConfirmation();
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const activeLoad = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (activeLoad.current) return;
    const controller = new AbortController();
    activeLoad.current = controller;
    setRefreshing(true);
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const { data, error } = await supabase
        .from('pending_registrations')
        .select('id, email, status, created_at, first_name, last_name')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .abortSignal(controller.signal);
      if (activeLoad.current !== controller) return;
      if (error) throw error;
      setPending(data ?? []);
      setLoadError(null);
    } catch {
      if (activeLoad.current === controller) setLoadError('Could not load pending approvals. Refresh to try again.');
    } finally {
      window.clearTimeout(timeout);
      if (activeLoad.current === controller) {
        activeLoad.current = null;
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === 'visible') void load(); };
    void load();
    const interval = window.setInterval(refreshVisible, 15000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      const controller = activeLoad.current;
      activeLoad.current = null;
      controller?.abort();
    };
  }, [load]);

  const confirmReview = (reg: PendingRegistration, action: 'approve' | 'reject') => {
    void requestDelete({
      title: action === 'approve' ? 'Approve registration' : 'Reject registration',
      tone: action === 'approve' ? 'primary' : 'destructive',
      message: action === 'approve' ? `Approve the registration for "${reg.email}"?` : `Are you sure you want to reject the registration for "${reg.email}"?`,
      details: action === 'approve'
        ? 'A standard User account will be created and this pending request will be removed only after successful account creation. The user must create a password at first login.'
        : 'No account will be created. The request will leave Waiting for Approval, but the rejected registration record is retained.',
      confirmLabel: action === 'approve' ? 'Approve' : 'Reject', processingLabel: action === 'approve' ? 'Approving…' : 'Rejecting…',
      onConfirm: async () => {
        setActionId(reg.id); setError(null); setNotice(null);
        try {
          const headers = await getAuthHeaders();
          const res = await fetch(approveFnUrl, { method: 'POST', headers, body: JSON.stringify({ action, registrationId: reg.id }) });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? 'Unable to review this registration. Please try again.');
          setError(data.warning ?? null); setNotice(data.message ?? 'Registration updated successfully.');
          const controller = activeLoad.current;
          activeLoad.current = null; controller?.abort(); setRefreshing(false);
          setPending((current) => current.filter((p) => p.id !== reg.id));
          onResolved();
        } finally { setActionId(null); }
      },
    });
  };

  return (
    <div className="admin-panel mb-5" role="region" aria-labelledby="admin-approvals-heading">
      <div className="admin-panel-header">
        <Clock size={18} className="admin-warning-icon" />
        <h3 id="admin-approvals-heading" className="text-base">Pending Approvals</h3>
        <span className="admin-count">{pending.length}</span>
        <button type="button" onClick={() => void load()} disabled={refreshing} className="fluent-button fluent-secondary ml-auto">
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loadError && <p role="alert" className="admin-notice admin-notice-warning">{loadError}</p>}
      {notice && <p role="status" className="admin-notice admin-notice-success">{notice}</p>}
      {error && (
        <div role="alert" className="admin-notice admin-notice-error">{error}</div>
      )}

      {pending.length === 0 && <p role="status" className="mb-4 text-sm text-[#aaa]">{loading ? 'Loading pending approvals…' : loadError ? 'Pending approvals could not be checked.' : 'No pending approval requests.'}</p>}
      {pending.length > 0 && (
      <div className="admin-table-scroll" role="region" aria-label="Pending registrations" tabIndex={0}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Requested</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((reg) => (
              <tr key={reg.id}>
                <td>
                  <div className="flex items-center gap-3">
                    <div className="admin-user-avatar admin-user-avatar-pending">
                      {(reg.email ?? '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="admin-identity"><p>{reg.email}</p><p>First Name: {reg.first_name || '—'}</p><p>Last Name: {reg.last_name || '—'}</p></div>
                  </div>
                </td>
                <td className="admin-date">
                  {new Date(reg.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </td>
                <td>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => confirmReview(reg, 'approve')}
                      disabled={actionId === reg.id}
                      className="fluent-button fluent-success"
                    >
                      {actionId === reg.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                      Approve
                    </button>
                    <button
                      onClick={() => confirmReview(reg, 'reject')}
                      disabled={actionId === reg.id}
                      className="fluent-button fluent-danger"
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

      )}

    </div>
  );
}


function ChangeRoleModal({ user, onClose, onConfirm, saving }: { user: Profile; onClose: () => void; onConfirm: () => void; saving: boolean }) {
  const close = useGuardedClose(onClose, false, saving);
  const newRole = user.role === 'admin' ? 'user' : 'admin';
  const isPromotion = newRole === 'admin';

  return (
    <TaskModal aria-label="Change user role" className="admin-modal fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="admin-dialog-panel relative w-full max-w-md shadow-2xl">
        <div className="px-6 pt-6">
          <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${isPromotion ? 'admin-dialog-icon' : 'bg-amber-50 text-amber-800'}`}>
            {isPromotion ? <ShieldCheck size={24} /> : <AlertTriangle size={24} />}
          </div>
          <h2 className="text-lg font-semibold tracking-[-0.02em]">
            {isPromotion ? 'Promote to Admin' : 'Demote to User'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#a5a5a5]">
            {isPromotion ? (
              <>Are you sure you want to promote <span className="font-semibold text-[var(--fluent-text)]">{user.email}</span> to admin? They will gain full access to the Admin Console, including user management and storage configuration.</>
            ) : (
              <>Are you sure you want to demote <span className="font-semibold text-[var(--fluent-text)]">{user.email}</span> to a regular user? They will lose access to the Admin Console immediately.</>
            )}
          </p>
        </div>
        <div className="px-6 pb-7 pt-5">
          <div className="admin-role-summary">
            <span className="text-xs text-[var(--fluent-muted)]">Current role:</span>
            <span className={`text-xs font-semibold ${user.role === 'admin' ? 'text-blue-700' : 'text-[var(--fluent-muted)]'}`}>{user.role === 'admin' ? 'Admin' : 'User'}</span>
            <span className="mx-1 text-[#555]">→</span>
            <span className="text-xs text-[var(--fluent-muted)]">New role:</span>
            <span className={`text-xs font-semibold ${newRole === 'admin' ? 'text-blue-700' : 'text-[var(--fluent-muted)]'}`}>{newRole === 'admin' ? 'Admin' : 'User'}</span>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={close} disabled={saving} className="fluent-button fluent-secondary flex-1">Cancel</button>
            <button
              onClick={onConfirm}
              disabled={saving}
              className={`fluent-button flex-1 ${isPromotion ? 'fluent-primary' : 'bg-amber-700 text-white hover:bg-amber-800'}`}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : isPromotion ? <ShieldCheck size={16} /> : <Users size={16} />}
              {isPromotion ? 'Promote' : 'Demote'}
            </button>
          </div>
        </div>
      </div>
    </TaskModal>
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
    return <div role="status" aria-label="Loading storage settings" className="admin-loading"><Loader2 size={26} className="animate-spin text-blue-600" /></div>;
  }

  return (
    <div>
      <div className="admin-section-heading">
        <h2>Storage Settings</h2>
        <p>Configure the physical disk and folder locations where user-uploaded videos and images are stored. These locations are used when saving new uploads and persist across restarts.</p>
      </div>

      {/* Storage Settings Section */}
      <div className="admin-panel">
        <div className="mb-5 flex items-center gap-2">
          <HardDrive size={18} className="text-blue-600" />
          <h3 className="text-sm font-semibold tracking-[-0.01em]">Storage Locations</h3>
        </div>

        {/* Videos location */}
        <div className="mb-5">
          <label htmlFor="admin-videos-path" className="admin-form-label">User Videos Storage Location</label>
          <div className="fluent-field">
            <FolderTree className="ml-3.5 text-[#888]" size={17} />
            <input
              id="admin-videos-path"
              value={videosPath}
              onChange={(e) => { setVideosPath(e.target.value); setSettingsSaved(false); }}
              placeholder="/mnt/storage/videos"

            />
          </div>
          <p className="mt-1.5 text-xs leading-5 text-[#777]">The physical disk or folder path where new user-uploaded videos will be stored. Enter an absolute path (e.g. <code className="rounded bg-[#272727] px-1 py-0.5 font-mono text-[11px] text-[#ccc]">/mnt/storage/videos</code>).</p>
        </div>

        {/* Images location */}
        <div className="mb-5">
          <label htmlFor="admin-images-path" className="admin-form-label">User Images Storage Location</label>
          <div className="fluent-field">
            <FolderTree className="ml-3.5 text-[#888]" size={17} />
            <input
              id="admin-images-path"
              value={imagesPath}
              onChange={(e) => { setImagesPath(e.target.value); setSettingsSaved(false); }}
              placeholder="/mnt/storage/images"

            />
          </div>
          <p className="mt-1.5 text-xs leading-5 text-[#777]">The physical disk or folder path where new user-uploaded images will be stored. Enter an absolute path (e.g. <code className="rounded bg-[#272727] px-1 py-0.5 font-mono text-[11px] text-[#ccc]">/mnt/storage/images</code>).</p>
        </div>

        {/* File Storage Server URL */}
        <div className="mb-5">
          <label htmlFor="admin-file-server-url" className="admin-form-label">File Storage Server URL</label>
          <div className="fluent-field">
            <Server className="ml-3.5 text-[#888]" size={17} />
            <input
              id="admin-file-server-url"
              value={fileServerUrl}
              onChange={(e) => { setFileServerUrl(e.target.value); setSettingsSaved(false); }}
              placeholder="https://fileserver.example.com or 192.168.1.100"

            />
          </div>
          <p className="mt-1.5 text-xs leading-5 text-[#777]">The URL or IP address of the external file server. When users click "File Storage" in the sidebar, this address opens in a new tab. Leave empty to hide the link.</p>
        </div>

        {/* Validation info */}
        <div className="admin-notice admin-notice-info">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-[#4b86ff]" />
          <p className="text-xs leading-5 text-[#9ab3d4]">
            When you save, the server validates that each folder exists and is writable. If a folder does not exist or cannot be written to, an error message will appear and the setting will not be saved.
          </p>
        </div>

        {settingsError && (
          <div role="alert" className="admin-notice admin-notice-error">{settingsError}</div>
        )}
        {settingsSaved && !settingsError && (
          <div role="status" className="admin-notice admin-notice-success">Storage locations saved successfully. New uploads will use these paths.</div>
        )}

        <div className="admin-form-actions">
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings || !hasUnsavedChanges}
            className="fluent-button fluent-primary"
          >
            {savingSettings ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save Storage Locations
          </button>
          {hasUnsavedChanges && (
            <button
              onClick={() => { setVideosPath(savedVideosPath); setImagesPath(savedImagesPath); setFileServerUrl(savedFileServerUrl); setSettingsError(null); setSettingsSaved(false); }}
              className="fluent-button fluent-secondary"
            >
              Revert
            </button>
          )}
          {updatedAt && !hasUnsavedChanges && (
            <span className="text-xs text-[var(--fluent-muted)]">Last updated {new Date(updatedAt).toLocaleString()}</span>
          )}
        </div>
      </div>

      {/* Bucket info */}
      <div className="admin-panel mt-5">
        <div className="flex items-start gap-4">
          <div className="admin-dialog-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <HardDrive size={20} />
          </div>
          <div>
            <p className="text-sm font-semibold">Private bucket: <code className="rounded bg-[#272727] px-1.5 py-0.5 font-mono text-xs text-[#ccc]">user-videos</code></p>
            <p className="mt-1.5 text-xs leading-5 text-[#777]">Maximum file size: 10 GB. Uploaded files must use a video MIME type. Only the owner can upload, edit, or delete files in their folder.</p>
          </div>
        </div>
      </div>

      <div className="admin-panel mt-5">
        <div className="flex items-start gap-4">
          <div className="admin-dialog-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <FolderTree size={20} />
          </div>
          <div>
            <p className="text-sm font-semibold">Private bucket: <code className="rounded bg-[#272727] px-1.5 py-0.5 font-mono text-xs text-[#ccc]">user-images</code></p>
            <p className="mt-1.5 text-xs leading-5 text-[#777]">Maximum original size: 25 MB. Stores photo originals, optimized previews, thumbnails, and video preview images.</p>
          </div>
        </div>
      </div>

      {/* Folder structure preview */}
      <div className="admin-panel mt-5">
        <div className="mb-4 flex items-center gap-2">
          <FolderTree size={18} className="text-blue-600" />
          <h3 className="text-sm font-semibold tracking-[-0.01em]">Folder Structure Preview</h3>
        </div>
        <div className="admin-code-preview" tabIndex={0} role="region" aria-label="Storage folder structure">
          <pre className="font-mono text-[13px] leading-[1.7]">
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
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
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
    <div className="admin-stat-card">
      <div>
        {icon}
        <span>{label}</span>
      </div>
      <p className={active === false ? 'text-[var(--fluent-muted)]' : 'text-[var(--fluent-text)]'}>{value}</p>
    </div>
  );
}

// ---------- User management modals ----------

type AuthHeadersFn = () => Promise<Record<string, string>>;

function AddUserModal({ onClose, onCreated, getAuthHeaders }: { onClose: () => void; onCreated: () => void; getAuthHeaders: AuthHeadersFn }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const close = useGuardedClose(onClose, !!firstName || !!lastName || !!email || !!password || role !== 'user', saving);

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
        body: JSON.stringify({ email: email.trim(), password, role, first_name: firstName.trim(), last_name: lastName.trim() }),
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
    <TaskModal aria-label="Add user" className="admin-modal fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="admin-dialog-panel relative w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="admin-dialog-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"><UserPlus size={20} /></div>
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Add User</h2>
          </div>
          <button onClick={close} disabled={saving} className="fluent-button fluent-secondary admin-icon-button" aria-label="Close"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 pb-7 pt-5">
          <ProfileNameFields firstName={firstName} lastName={lastName} onFirstNameChange={setFirstName} onLastNameChange={setLastName} disabled={saving} />
          <label htmlFor="admin-add-email" className="admin-form-label">Email</label>
          <div className="fluent-field mb-4">
            <Mail className="ml-3.5 text-[#888]" size={17} />
            <input
              id="admin-add-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"

            />
          </div>

          <label htmlFor="admin-add-password" className="admin-form-label">Password</label>
          <div className="fluent-field mb-4">
            <Lock className="ml-3.5 text-[#888]" size={17} />
            <input
              id="admin-add-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"

            />
          </div>

          <fieldset className="mb-5">
            <legend className="admin-form-label">Role</legend>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setRole('user')} aria-pressed={role === 'user'} className="admin-role-option">User</button>
              <button type="button" onClick={() => setRole('admin')} aria-pressed={role === 'admin'} className="admin-role-option flex items-center justify-center gap-1.5"><ShieldCheck size={15} /> Admin</button>
            </div>
          </fieldset>

          {error && <div role="alert" className="admin-notice admin-notice-error">{error}</div>}

          <div className="flex gap-3">
            <button type="button" onClick={close} disabled={saving} className="fluent-button fluent-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="fluent-button fluent-primary flex-1">
              {saving && <Loader2 size={16} className="animate-spin" />}
              Create user
            </button>
          </div>
        </form>
      </div>
    </TaskModal>
  );
}

function EditUserModal({ user, onClose, onSaved, getAuthHeaders }: { user: Profile; onClose: () => void; onSaved: () => void; getAuthHeaders: AuthHeadersFn }) {
  const [firstName, setFirstName] = useState(user.first_name ?? '');
  const [lastName, setLastName] = useState(user.last_name ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const close = useGuardedClose(onClose, firstName !== (user.first_name ?? '') || lastName !== (user.last_name ?? '') || email !== (user.email ?? '') || !!password, saving);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const body: Record<string, string> = { id: user.id };
      if (email.trim() && email.trim() !== user.email) body.email = email.trim();
      if (password) body.password = password;
      if (firstName.trim() !== (user.first_name ?? '')) body.first_name = firstName.trim();
      if (lastName.trim() !== (user.last_name ?? '')) body.last_name = lastName.trim();
      if (Object.keys(body).length === 1) { onClose(); return; }
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
    <TaskModal aria-label="Edit user" className="admin-modal fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="admin-dialog-panel relative w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="admin-dialog-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"><Pencil size={20} /></div>
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em]">Edit User</h2>
              <p className="text-xs text-[var(--fluent-muted)]">{user.email}</p>
            </div>
          </div>
          <button onClick={close} disabled={saving} className="fluent-button fluent-secondary admin-icon-button" aria-label="Close"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 pb-7 pt-5">
          <ProfileNameFields firstName={firstName} lastName={lastName} onFirstNameChange={setFirstName} onLastNameChange={setLastName} disabled={saving} />
          <label htmlFor="admin-edit-email" className="admin-form-label">Email</label>
          <div className="fluent-field mb-4">
            <Mail className="ml-3.5 text-[#888]" size={17} />
            <input
              id="admin-edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"

            />
          </div>

          <label htmlFor="admin-edit-password" className="admin-form-label">New Password</label>
          <div className="fluent-field mb-2">
            <Lock className="ml-3.5 text-[#888]" size={17} />
            <input
              id="admin-edit-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current"

            />
          </div>
          <p className="mb-5 text-xs text-[var(--fluent-muted)]">Leave password blank to keep it. Clear a name to remove it.</p>

          {error && <div role="alert" className="admin-notice admin-notice-error">{error}</div>}

          <div className="flex gap-3">
            <button type="button" onClick={close} disabled={saving} className="fluent-button fluent-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="fluent-button fluent-primary flex-1">
              {saving && <Loader2 size={16} className="animate-spin" />}
              Save changes
            </button>
          </div>
        </form>
      </div>
    </TaskModal>
  );
}
