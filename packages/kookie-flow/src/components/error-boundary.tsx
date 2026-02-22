import { Component, type ReactNode, type ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional callback when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary that wraps the R3F Canvas to catch WebGL/Three.js crashes
 * (context loss, shader compilation failures, GPU driver bugs) and prevent
 * them from taking down the entire consumer application.
 */
export class CanvasErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[KookieFlow] Canvas crashed:', error, errorInfo.componentStack);
    this.props.onError?.(error, errorInfo);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: 'var(--gray-11, #999)',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14,
          }}
        >
          <p style={{ margin: 0 }}>Something went wrong rendering the canvas.</p>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              padding: '6px 16px',
              border: '1px solid var(--gray-7, #444)',
              borderRadius: 6,
              background: 'var(--gray-3, #222)',
              color: 'var(--gray-11, #999)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
