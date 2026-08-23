/**
 * Render-error containment.
 *
 * Without this, one thrown error in any panel unmounts the whole React tree and
 * the operator is left staring at a blank console — mid-service, with the
 * congregation watching. The audience and stage windows are separate processes
 * and keep showing whatever was last taken, so the priority here is telling the
 * operator that output is *still live* and giving them a way back.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown in the message so the operator knows which panel failed. */
  area?: string;
  /** Rendered instead of the default card. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
  info: string;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the component trail; it is the only clue once the tree is gone.
    this.setState({ info: info.componentStack?.split('\n').slice(0, 6).join('\n') ?? '' });
    console.error('[BiblePortal] render error', error, info);
  }

  private reset = () => this.setState({ error: null, info: '' });

  override render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="panel">
        <div className="panel-scroll panel-pad">
          <div className="notice warn">
            <strong>{this.props.area ?? 'This panel'} stopped responding.</strong>
            <br /><br />
            Whatever was last taken is <strong>still on the audience screen</strong> — the output
            windows run separately and were not affected.
            <br /><br />
            <span className="mono selectable" style={{ fontSize: 'var(--fs-xs)' }}>{error.message}</span>
          </div>

          {info && (
            <details style={{ marginTop: 'var(--sp-4)' }}>
              <summary className="faint" style={{ cursor: 'pointer', fontSize: 'var(--fs-sm)' }}>
                Technical detail
              </summary>
              <pre
                className="mono selectable faint"
                style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'pre-wrap', marginTop: 'var(--sp-2)' }}
              >
                {info}
              </pre>
            </details>
          )}

          <div className="row" style={{ marginTop: 'var(--sp-5)' }}>
            <button className="btn primary" onClick={this.reset}>Reload this panel</button>
            <button className="btn" onClick={() => window.location.reload()}>Restart the console</button>
          </div>
        </div>
      </div>
    );
  }
}
