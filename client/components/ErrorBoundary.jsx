import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, background: '#2d2d30', color: '#f14c4c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <h2>页面出错</h2>
          <pre>{this.state.error?.toString?.()}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
