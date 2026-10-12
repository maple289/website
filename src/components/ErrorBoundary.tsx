import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode; compact?: boolean };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('App render error', { name: error.name });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" style={{ minHeight: this.props.compact ? '180px' : '100dvh', background: 'linear-gradient(90deg, #033C8D 0%, #001338 48%, #0062C7 100%)', color: '#f1f1f1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', fontFamily: 'system-ui, sans-serif', padding: '20px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Something went wrong</h2>
          <p style={{ color: '#aaa', fontSize: '14px' }}>This page could not load. Check your connection. Reloading may interrupt your current call or unsaved work.</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: '8px', padding: '10px 20px', background: '#ff3d46', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
