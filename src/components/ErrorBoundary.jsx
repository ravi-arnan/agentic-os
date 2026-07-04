import { Component } from 'react';

/**
 * Catches render errors in a subtree so one broken panel degrades to a small
 * message instead of unmounting the whole app (which, on a near-black bg,
 * reads as "the screen went black").
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel text-faint flex min-h-24 flex-col items-center justify-center gap-2 p-6 font-mono text-xs">
          <span className="text-danger">this panel hit an error</span>
          <span className="opacity-70">{String(this.state.error.message || this.state.error)}</span>
          <button
            onClick={() => this.setState({ error: null })}
            className="border-edge hover:border-accent/40 mt-1 rounded-md border px-3 py-1"
          >
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
