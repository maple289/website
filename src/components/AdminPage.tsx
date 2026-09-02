import { useEffect, useState } from 'react';
import { ArrowLeft, HardDrive, Loader as Loader2, Mail, Lock, Pencil, ShieldCheck, Trash2, Users, UserPlus, X, FolderTree, CircleCheck as CheckCircle2, TriangleAlert as AlertTriangle } from 'lucide-react';
import { supabase, supabaseAnonKey } from '@/lib/supabase';
import { useAdmin } from '@/hooks/useAdmin';

const adminFnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`;

type Tab = 'users' | 'storage';

type Profile = {
  id: string;
  email: string | null;
  role: string;
  created_at: string;
};

export function AdminPage() {
  const { isAdmin, checking } = useAdmin();
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
        {tab === 'users' ? <UsersTab /> : <StorageTab />}
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

function UsersTab() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [deletingUser, setDeletingUser] = useState<Profile | null>(null);

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

  const toggleRole = async (profile: Profile) => {
    setActionId(profile.id);
    const newRole = profile.role === 'admin' ? 'user' : 'admin';
    const { error } = await supabase.rpc('set_user_role', { target: profile.id, new_role: newRole });
    if (error) {
      setError('Failed to update role.');
      setActionId(null);
      return;
    }
    setProfiles((prev) => prev.map((p) => (p.id === profile.id ? { ...p, role: newRole } : p)));
    setActionId(null);
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
    <div>
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
                    {p.role === 'admin' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ff3d46]/15 px-3 py-1 text-xs font-semibold text-[#ff737b]">
                        <ShieldCheck size={13} /> Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#272727] px-3 py-1 text-xs font-medium text-[#a5a5a5]">User</span>
                    )}
                  </td>
                  <td className="hidden px-5 py-4 text-[#888] sm:table-cell">
                    {new Date(p.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => toggleRole(p)}
                        disabled={actionId === p.id}
                        className={`rounded-lg px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${p.role === 'admin' ? 'bg-[#272727] text-[#ccc] hover:bg-[#333]' : 'bg-[#ff3d46]/15 text-[#ff737b] hover:bg-[#ff3d46]/25'}`}
                      >
                        {actionId === p.id ? <Loader2 size={13} className="animate-spin" /> : p.role === 'admin' ? 'Demote' : 'Promote'}
                      </button>
                      <button
                        onClick={() => setEditingUser(p)}
                        className="rounded-lg p-2 text-[#888] transition hover:bg-[#272727] hover:text-white"
                        aria-label="Edit user"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => setDeletingUser(p)}
                        className="rounded-lg p-2 text-[#888] transition hover:bg-[#ff3d46]/15 hover:text-[#ff737b]"
                        aria-label="Delete user"
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
    </div>
  );
}

// ---------- Storage Tab ----------

function StorageTab() {
  const [loading, setLoading] = useState(true);
  const [userCount, setUserCount] = useState(0);
  const [videoCount, setVideoCount] = useState(0);
  const [photoCount, setPhotoCount] = useState(0);

  const load = async () => {
    setLoading(true);
    const { count: uCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
    setUserCount(uCount ?? 0);
    const { count: vCount } = await supabase.from('videos').select('*', { count: 'exact', head: true });
    setVideoCount(vCount ?? 0);
    const { count: pCount } = await supabase.from('photos').select('*', { count: 'exact', head: true });
    setPhotoCount(pCount ?? 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={26} className="animate-spin text-[#ff3d46]" /></div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-[-0.03em]">Video Storage Configuration</h2>
        <p className="mt-1 text-sm text-[#888]">Video files are stored in a private Supabase bucket. The physical disk location is configured on the server through Docker, so it cannot be changed from the website.</p>
      </div>

      <div className="rounded-2xl border border-[#272727] bg-[#161616] p-6">
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
