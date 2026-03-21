// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Class components with componentDidCatch require client context

import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Label shown in the error card header (e.g. "System Metrics"). */
  label: string;
}

interface ErrorBoundaryState {
  error: Error | undefined;
}

/**
 * Per-section error boundary that catches render errors in a panel and
 * shows a contained error card instead of crashing the whole page.
 * Each dashboard module wraps its top-level panel with this component.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: undefined };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[ErrorBoundary] ${this.props.label} panel crashed`, error, info.componentStack);
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="rounded border border-red-900/50 bg-red-950/20 p-4">
          <p className="text-sm font-semibold text-red-400">{this.props.label} — render error</p>
          <p className="mt-1 text-xs text-[#6b7280]">{this.state.error.message}</p>
          <button
            className="mt-3 text-xs text-[#6b7280] underline hover:text-white"
            onClick={() => this.setState({ error: undefined })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
