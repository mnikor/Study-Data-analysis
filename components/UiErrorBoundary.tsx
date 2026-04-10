import React from 'react';

interface UiErrorBoundaryProps {
  title?: string;
  children: React.ReactNode;
}

interface UiErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class UiErrorBoundary extends React.Component<UiErrorBoundaryProps, UiErrorBoundaryState> {
  state: UiErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): UiErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unknown UI error.',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('UiErrorBoundary caught an error', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700">
            {this.props.title || 'Panel Error'}
          </div>
          <div className="mt-2 text-sm text-red-800">
            This section failed to render, but the rest of the page is still available.
          </div>
          <div className="mt-2 text-xs text-red-700">
            Error: {this.state.message}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
