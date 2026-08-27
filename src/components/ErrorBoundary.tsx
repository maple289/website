import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error) {
    console.error('App render error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', background: '#150b1e', color: '#f1f1f1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', fontFamily: 'system-ui, sans-serif' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Something went wrong</h2>
          <p style={{ color: '#aaa', fontSize: '14px' }}>{this.state.message}</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: '8px', padding: '10px 20px', background: '#ff3d46', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
