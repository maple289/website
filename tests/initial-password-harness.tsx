/* eslint-disable react-refresh/only-export-components -- Isolated browser fixture. */
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '../src/context/AuthContext';
import { useAuth } from '../src/hooks/useAuth';
import { AuthModal } from '../src/components/AuthModal';
import { InitialPasswordPage } from '../src/components/InitialPasswordPage';
import { DeleteConfirmationProvider } from '../src/components/DeleteConfirmationProvider';
import '../src/index.css';
import '../src/components/FluentTheme.css';
function Screen() {
  const { user, passwordSetup } = useAuth();
  if (user) return <p>Signed in successfully</p>;
  if (passwordSetup) return <InitialPasswordPage />;
  return <AuthModal open initialMode="signin" onClose={() => {}} />;
}
createRoot(document.getElementById('root')!).render(<AuthProvider><DeleteConfirmationProvider><Screen /></DeleteConfirmationProvider></AuthProvider>);
