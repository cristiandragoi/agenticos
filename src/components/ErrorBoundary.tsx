import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}] Uncaught render error:`, error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div data-testid="error-boundary-fallback" className="p-4 bg-rose-950/40 border border-rose-500/40 rounded-lg text-rose-200 m-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm">
            <AlertTriangle size={16} />
            <span>{this.props.name ? `Error in ${this.props.name}` : 'A component error occurred'}</span>
          </div>
          <pre className="text-[11px] font-mono bg-black/40 p-2 rounded border border-rose-900/50 overflow-x-auto text-rose-300">
            {this.state.error?.message || 'Unknown render error'}
          </pre>
          <div className="mt-1">
            <button
              onClick={this.handleReset}
              className="px-3 py-1 bg-rose-800/40 hover:bg-rose-700/50 border border-rose-600/50 rounded text-xs text-rose-100 flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw size={12} />
              <span>Retry Component</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
