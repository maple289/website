import { ReactionProvider } from '@/components/ReactionProvider';
import { TemporarySharePage } from '@/components/TemporarySharePage';
import { FileClipboardProvider } from '@/context/FileClipboardContext';
import { DeleteConfirmationProvider } from '@/components/DeleteConfirmationProvider';
import '@/components/MediaGallery.css';
import '@/components/FluentTheme.css';
import { FileDropArea } from '@/components/FileDropArea';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BarChart3, Clapperboard, FolderOpen, Home, Images, Menu, Search, Settings, Upload, Video, X, ShieldCheck } from 'lucide-react';
import { AuthProvider } from '@/context/AuthContext';
import { AuthModal } from '@/components/AuthModal';
import { AccountMenu } from '@/components/AccountMenu';
import { AdminPage } from '@/components/AdminPage';
import { HomePage, MediaTabs } from '@/components/HomePage';
import { VideoLibrary } from '@/components/VideoLibrary';
import { UploadModal } from '@/components/UploadModal';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';
import { PhotoLibrary } from '@/components/PhotoLibrary';
import { PhotoUploadModal } from '@/components/PhotoUploadModal';
import { SettingsPage } from '@/components/SettingsPage';
import { InitialPasswordPage } from '@/components/InitialPasswordPage';
import { FileManager } from '@/components/FileManager';

const UserStatistics = lazy(() => import('@/components/UserStatistics').then(module => ({ default: module.UserStatistics })));

function App() {
  const shared = window.location.pathname.match(/^\/share\/([a-f0-9]{64})\/?$/);
  if (window.location.pathname.startsWith('/share/')) return <TemporarySharePage token={shared?.[1] ?? ''} />;
  return (
    <div className="fluent-app"><AuthProvider>
      <DeleteConfirmationProvider><FileClipboardProvider><ReactionProvider><AppContent /></ReactionProvider></FileClipboardProvider></DeleteConfirmationProvider>
    </AuthProvider></div>
  );
}

type Route = 'home' | 'public-videos' | 'public-photos' | 'library' | 'photos' | 'files' | 'public-files' | 'admin' | 'settings' | 'statistics';

function getRoute(): Route {
  const hash = window.location.hash;
  if (hash === '#/public-videos') return 'public-videos';
  if (hash === '#/public-photos') return 'public-photos';
  if (hash === '#/admin') return 'admin';
  if (hash === '#/library') return 'library';
  if (hash === '#/photos') return 'photos';
  if (hash.split('?')[0] === '#/public-files') return 'public-files';
  if (hash.split('?')[0] === '#/files') return 'files';
  if (hash === '#/settings') return 'settings';
  if (hash === '#/statistics') return 'statistics';
  return 'home';
}

function AppContent() {
  const { user, loading, passwordSetup } = useAuth();
  const { isAdmin } = useAdmin();
  const [route, setRoute] = useState<Route>(getRoute());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const [authOpen, setAuthOpen] = useState(window.location.hash === '#/login');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [droppedMedia, setDroppedMedia] = useState<File[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const homeTab = route === 'public-photos' ? 'photos' : 'videos';

  useEffect(() => {
    const onHash = () => {
      setRoute(getRoute());
      if (window.location.hash === '#/login') { setAuthMode('signin'); setAuthOpen(true); }
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('popstate', onHash); };
  }, []);

  // Redirect: if not signed in and trying to access library, go home
  useEffect(() => {
    if (!loading && !user && (route === 'library' || route === 'photos' || route === 'files')) {
      window.location.hash = '';
      setRoute('home');
    }
    if (!loading && !user && (route === 'admin' || route === 'settings' || route === 'statistics')) {
      window.location.hash = '';
      setRoute('home');
    }
  }, [user, loading, route]);

  const navigate = (r: Route) => {
    if (r === 'home') window.location.hash = '';
    else if (r === 'public-videos') window.location.hash = '#/public-videos';
    else if (r === 'public-photos') window.location.hash = '#/public-photos';
    else if (r === 'library') window.location.hash = '#/library';
    else if (r === 'photos') window.location.hash = '#/photos';
    else if (r === 'public-files') window.location.hash = '#/public-files';
    else if (r === 'files') window.location.hash = '#/files';
    else if (r === 'admin') window.location.hash = '#/admin';
    else if (r === 'settings') window.location.hash = '#/settings';
    else if (r === 'statistics') window.location.hash = '#/statistics';
    setRoute(r);
    setSidebarOpen(false);
    setSearch('');
    setMobileSearchOpen(false);
  };

  const openPublicSection = (tab: 'videos' | 'photos' | 'files') => {
    navigate(tab === 'files' ? 'public-files' : tab === 'photos' ? 'public-photos' : 'public-videos');
  };

  const openSignIn = () => { setAuthMode('signin'); setAuthOpen(true); };

  const isAuthed = !!user;
  const isFilesRoute = route === 'files' || route === 'public-files';
  const isStatisticsRoute = route === 'statistics';
  const hasMediaControls = !isFilesRoute && !isStatisticsRoute;
  const uploadsPhoto = route === 'photos' || route === 'public-photos';
  const searchLabel = uploadsPhoto ? 'Search photos' : 'Search videos';
  const publicTab = route === 'public-files' ? 'files' : route === 'public-photos' ? 'photos' : route === 'home' || route === 'public-videos' ? 'videos' : undefined;

  // A setup capability is not an authenticated account session. No application
  // route is rendered until the server confirms that a password is established.
  if (passwordSetup) return <InitialPasswordPage />;

  // Admin route — always allow AdminPage to handle its own access control
  if (route === 'admin') {
    return (
      <>
        <AdminPage />
        <AuthModal open={authOpen} initialMode={authMode} onClose={() => setAuthOpen(false)} />
      </>
    );
  }

  // Settings route — requires authentication
  if (route === 'settings' && isAuthed) {
    return (
      <>
        <SettingsPage />
        <AuthModal open={authOpen} initialMode={authMode} onClose={() => setAuthOpen(false)} />
      </>
    );
  }

  return (
    <div className="fluent-shell">
      {/* Header */}
      <header className="fluent-header fixed inset-x-0 top-0 z-40 h-[72px] backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-[1560px] items-center gap-4 px-5 lg:px-8">
          {isAuthed && (
            <button aria-label="Open menu" onClick={() => setSidebarOpen(!sidebarOpen)} className="rounded-full p-3 transition hover:bg-[#272727] lg:hidden">
              {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          )}
          <button onClick={() => navigate('home')} aria-label="MyHostage Home" className="fluent-brand">
            <span className="fluent-brand-icon"><Clapperboard size={23} strokeWidth={1.8} /></span>
            <span className="hidden sm:inline">MyHostage</span>
          </button>
          {/* Search bar */}
          {hasMediaControls && <form onSubmit={(event) => event.preventDefault()} role="search" className="fluent-search mx-auto hidden max-w-[590px] flex-1 items-center md:flex">
            <div className="flex h-11 flex-1 items-center overflow-hidden rounded-l-full border border-[#3f3f3f] bg-[#121212] transition focus-within:border-[#4b86ff]">
              <Search className="ml-4 text-[#a7a7a7]" size={20} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchLabel} aria-label={searchLabel} className="h-full w-full bg-transparent px-3 text-[15px] outline-none placeholder:text-[#888]" />
              {search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="mr-2 rounded-full p-1 hover:bg-[#303030]"><X size={17} /></button>}
            </div>
            <button type="submit" aria-label="Search" className="flex h-11 w-16 items-center justify-center rounded-r-full border border-l-0 border-[#3f3f3f] bg-[#222] transition hover:bg-[#303030]"><Search size={21} /></button>
          </form>}
          <div className="ml-auto flex items-center gap-2">
            {hasMediaControls && <button aria-label={mobileSearchOpen ? 'Close search' : 'Search'} aria-expanded={mobileSearchOpen} onClick={() => setMobileSearchOpen((open) => !open)} className="rounded-full p-3 hover:bg-[#272727] md:hidden">{mobileSearchOpen ? <X size={21} /> : <Search size={21} />}</button>}
            {isAuthed && hasMediaControls && (
                <button
                  onClick={() => { setDroppedMedia([]); if (uploadsPhoto) setShowPhotoUpload(true); else setShowUpload(true); }}
                  aria-label={uploadsPhoto ? 'Upload photo' : 'Upload video'}
                  className="fluent-header-upload flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition"
                >
                  <Upload size={20} /> <span className="hidden sm:inline">{uploadsPhoto ? 'Upload photo' : 'Upload video'}</span>
                </button>
            )}
            <AccountMenu onSignIn={openSignIn} />
          </div>
        </div>
      </header>

      {mobileSearchOpen && hasMediaControls && <form onSubmit={(event) => { event.preventDefault(); mobileSearchRef.current?.blur(); }} role="search" className="fluent-mobile-search fluent-search fixed inset-x-0 top-[72px] z-40 p-3 md:hidden"><div className="flex h-11 items-center overflow-hidden rounded-xl"><Search className="ml-4 shrink-0" size={19} /><input ref={mobileSearchRef} autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchLabel} aria-label={searchLabel} className="h-full min-w-0 flex-1 bg-transparent px-3 text-base outline-none" />{search && <button type="button" aria-label="Clear search" onClick={() => { setSearch(''); mobileSearchRef.current?.focus(); }} className="mr-1 p-3"><X size={17} /></button>}</div></form>}

      {/* Sidebar — only for authenticated users */}
      {isAuthed && (
        <aside className={`fluent-sidebar ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed left-0 top-[72px] z-30 h-[calc(100dvh-72px)] w-64 p-3 transition-transform duration-200 lg:translate-x-0`}>
          <p className="fluent-nav-label">Your workspace</p>
          <nav className="space-y-1 text-sm">
            <NavItem icon={<Home size={20} />} label="Home" active={route === 'home' || route === 'public-videos' || route === 'public-photos'} onClick={() => navigate('home')} />
            <NavItem icon={<Video size={20} />} label="My Videos" active={route === 'library'} onClick={() => navigate('library')} />
            <NavItem icon={<Images size={20} />} label="My Photos" active={route === 'photos'} onClick={() => navigate('photos')} />
            <NavItem icon={<FolderOpen size={20} />} label="File Storage" active={route === 'files'} onClick={() => navigate('files')} />
            <div className="my-4 h-px bg-slate-200" />
            {isAdmin && (
              <NavItem icon={<ShieldCheck size={20} />} label="Admin Console" onClick={() => navigate('admin')} />
            )}
            <NavItem icon={<Settings size={20} />} label="Settings" active={route === 'settings'} onClick={() => navigate('settings')} />
            <NavItem icon={<BarChart3 size={20} />} label="Statistics" active={isStatisticsRoute} onClick={() => navigate('statistics')} />
          </nav>
          <div className="fluent-sidebar-tip mt-8 rounded-2xl p-4">
            <div className="mb-3 text-blue-600"><Upload size={20} /></div>
            <p className="text-sm font-medium">Share your story</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">Keep your memories private or share them with everyone.</p>
            <button onClick={() => { setDroppedMedia([]); if (uploadsPhoto) setShowPhotoUpload(true); else setShowUpload(true); }} className="mt-3 min-h-11 text-sm font-semibold text-blue-700">Upload {uploadsPhoto ? 'photos' : 'videos'}</button>
          </div>
        </aside>
      )}

      {/* Main content */}
      <main className={`fluent-main ${mobileSearchOpen && hasMediaControls ? 'fluent-search-open' : ''} ${hasMediaControls ? 'media-page' : ''} pt-[72px] ${isAuthed ? 'lg:pl-64' : ''}`}>
        <div className="fluent-section-nav"><MediaTabs active={publicTab} onSelect={openPublicSection} /></div>
        {isStatisticsRoute ? isAuthed ? <Suspense fallback={<p role="status" className="p-8 text-center text-slate-600">Loading your statistics…</p>}><UserStatistics key={user.id} /></Suspense> : <p role="status" className="p-8 text-center text-slate-600">Please sign in to view your statistics.</p>
          : isFilesRoute ? !loading && (route === 'public-files' || isAuthed) && <FileManager key={`${route}:${user?.id ?? 'guest'}`} publicOnly={route === 'public-files'} searchTerm={search} onSearchTermChange={setSearch} /> : route === 'library' && isAuthed ? <VideoLibrary searchTerm={search} /> : route === 'photos' && isAuthed ? <PhotoLibrary searchTerm={search} /> : <FileDropArea mediaKind={homeTab === 'photos' ? 'photo' : 'video'} appearance="media" message={homeTab === 'photos' ? 'Drop photos here to upload' : 'Drop videos here to upload'} enabled={isAuthed && !showUpload && !showPhotoUpload} onFiles={(files) => { setDroppedMedia(files); if (homeTab === 'photos') setShowPhotoUpload(true); else setShowUpload(true); }}><HomePage tab={homeTab} searchTerm={search} /></FileDropArea>}
      </main>

      {/* Auth modal */}
      <AuthModal open={authOpen} initialMode={authMode} onClose={() => setAuthOpen(false)} />

      {/* Upload modal */}
      {showUpload && isAuthed && (
        <div className={hasMediaControls ? 'media-page mg-overlay-root' : ''}><div className="mg-dialog"><UploadModal initialFiles={droppedMedia} onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); if (route !== 'library') navigate('library'); }} /></div></div>
      )}

      {/* Photo upload modal */}
      {showPhotoUpload && isAuthed && (
        <div className={hasMediaControls ? 'media-page mg-overlay-root' : ''}><div className="mg-dialog"><PhotoUploadModal initialFiles={droppedMedia} onClose={() => setShowPhotoUpload(false)} onUploaded={() => { setShowPhotoUpload(false); if (route !== 'photos') navigate('photos'); }} /></div></div>
      )}

    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`group flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left transition ${active ? 'bg-[#2a2a2a] font-medium' : 'text-[#c4c4c4] hover:bg-[#202020] hover:text-white'}`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

export default App;
