import { useEffect, useState } from 'react';
import { Bell, Compass, Chrome as Home, Images, Library, Menu, Search, Settings, Upload, X, Youtube, ShieldCheck } from 'lucide-react';
import { AuthProvider } from '@/context/AuthContext';
import { AuthModal } from '@/components/AuthModal';
import { AccountMenu } from '@/components/AccountMenu';
import { AdminPage } from '@/components/AdminPage';
import { HomePage } from '@/components/HomePage';
import { VideoLibrary } from '@/components/VideoLibrary';
import { UploadModal } from '@/components/UploadModal';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';
import { PhotoLibrary } from '@/components/PhotoLibrary';

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

type Route = 'home' | 'library' | 'photos' | 'admin';

function getRoute(): Route {
  const hash = window.location.hash;
  if (hash === '#/admin') return 'admin';
  if (hash === '#/library') return 'library';
  if (hash === '#/photos') return 'photos';
  return 'home';
}

function AppContent() {
  const { user, loading } = useAuth();
  const { isAdmin } = useAdmin();
  const [route, setRoute] = useState<Route>(getRoute());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Redirect: if not signed in and trying to access library, go home
  useEffect(() => {
    if (!loading && !user && (route === 'library' || route === 'photos')) {
      window.location.hash = '';
      setRoute('home');
    }
    if (!loading && !user && route === 'admin') {
      window.location.hash = '';
      setRoute('home');
    }
  }, [user, loading, route]);

  const navigate = (r: Route) => {
    if (r === 'home') window.location.hash = '';
    else if (r === 'library') window.location.hash = '#/library';
    else if (r === 'photos') window.location.hash = '#/photos';
    else if (r === 'admin') window.location.hash = '#/admin';
    setRoute(r);
    setSidebarOpen(false);
  };

  const openSignIn = () => { setAuthMode('signin'); setAuthOpen(true); };

  // Admin route — always allow AdminPage to handle its own access control
  if (route === 'admin') {
    return (
      <>
        <AdminPage />
        <AuthModal open={authOpen} initialMode={authMode} onClose={() => setAuthOpen(false)} />
      </>
    );
  }

  const isAuthed = !!user;

  return (
    <div className="min-h-screen bg-[#150b1e] text-[#f1f1f1]">
      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-40 h-[72px] border-b border-[#272727] bg-[#150b1e]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-[1560px] items-center gap-4 px-5 lg:px-8">
          {isAuthed && (
            <button aria-label="Open menu" onClick={() => setSidebarOpen(!sidebarOpen)} className="rounded-full p-3 transition hover:bg-[#272727] lg:hidden">
              {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          )}
          <div className="flex items-center gap-2.5 pr-5">
            <div className="flex h-8 w-11 items-center justify-center rounded-[10px] bg-[#ff3d46] shadow-[0_0_24px_rgba(255,61,70,0.22)]">
              <Youtube size={23} fill="white" strokeWidth={1.5} />
            </div>
            <span className="hidden text-[21px] font-semibold tracking-[-0.06em] sm:inline">streamly</span>
          </div>
          {/* Search bar */}
          <div className="mx-auto hidden max-w-[690px] flex-1 items-center md:flex">
            <div className="flex h-11 flex-1 items-center overflow-hidden rounded-l-full border border-[#3f3f3f] bg-[#121212] transition focus-within:border-[#4b86ff]">
              <Search className="ml-4 text-[#a7a7a7]" size={20} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search videos" aria-label="Search videos" className="h-full w-full bg-transparent px-3 text-[15px] outline-none placeholder:text-[#888]" />
              {search && <button aria-label="Clear search" onClick={() => setSearch('')} className="mr-2 rounded-full p-1 hover:bg-[#303030]"><X size={17} /></button>}
            </div>
            <button aria-label="Search" className="flex h-11 w-16 items-center justify-center rounded-r-full border border-l-0 border-[#3f3f3f] bg-[#222] transition hover:bg-[#303030]"><Search size={21} /></button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button aria-label="Search" className="rounded-full p-3 hover:bg-[#272727] md:hidden"><Search size={21} /></button>
            {isAuthed && (
              <>
                <button
                  onClick={() => setShowUpload(true)}
                  aria-label="Upload"
                  className="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition hover:bg-[#272727]"
                >
                  <Upload size={20} /> <span className="hidden sm:inline">Upload video</span>
                </button>
                <button aria-label="Notifications" className="relative rounded-full p-3 transition hover:bg-[#272727]"><Bell size={21} /><span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#ff3d46]" /></button>
              </>
            )}
            <AccountMenu onSignIn={openSignIn} />
          </div>
        </div>
      </header>

      {/* Sidebar — only for authenticated users */}
      {isAuthed && (
        <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed left-0 top-[72px] z-30 h-[calc(100vh-72px)] w-64 border-r border-[#272727] bg-[#150b1e] p-3 transition-transform duration-300 lg:translate-x-0`}>
          <nav className="space-y-1 text-sm">
            <NavItem icon={<Home size={20} />} label="Home" active={route === 'home'} onClick={() => navigate('home')} />
            <NavItem icon={<Library size={20} />} label="My Library" active={route === 'library'} onClick={() => navigate('library')} />
            <NavItem icon={<Images size={20} />} label="My Photos" active={route === 'photos'} onClick={() => navigate('photos')} />
            <NavItem icon={<Compass size={20} />} label="Explore" />
            <div className="my-4 h-px bg-[#272727]" />
            {isAdmin && (
              <NavItem icon={<ShieldCheck size={20} />} label="Admin Console" onClick={() => navigate('admin')} />
            )}
            <NavItem icon={<Settings size={20} />} label="Settings" />
          </nav>
          <div className="absolute bottom-6 left-6 right-6 rounded-2xl border border-[#2e2e2e] bg-[#191919] p-4">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#ff3d46]/15 text-[#ff6670]"><Upload size={18} /></div>
            <p className="text-sm font-medium">Share your story</p>
            <p className="mt-1 text-xs leading-5 text-[#888]">Upload a video and inspire the world.</p>
            <button onClick={() => setShowUpload(true)} className="mt-3 text-xs font-semibold text-[#ff6971] hover:text-[#ff9ba0]">Upload now</button>
          </div>
        </aside>
      )}

      {/* Main content */}
      <main className={`pt-[72px] ${isAuthed ? 'lg:pl-64' : ''}`}>
        {route === 'library' && isAuthed ? <VideoLibrary /> : route === 'photos' && isAuthed ? <PhotoLibrary /> : <HomePage />}
      </main>

      {/* Auth modal */}
      <AuthModal open={authOpen} initialMode={authMode} onClose={() => setAuthOpen(false)} />

      {/* Upload modal */}
      {showUpload && isAuthed && (
        <UploadModal onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); if (route !== 'library') navigate('library'); }} />
      )}

    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left transition ${active ? 'bg-[#2a2a2a] font-medium' : 'text-[#c4c4c4] hover:bg-[#202020] hover:text-white'}`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

export default App;
