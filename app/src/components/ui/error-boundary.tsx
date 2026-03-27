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
        <div
          style={{
            border: '1px solid var(--ae-red-dim)',
            background: 'var(--ae-surface)',
            padding: '14px',
          }}
        >
          <p className="text-[11px] uppercase tracking-[0.08em]" style={{ color: 'var(--ae-red)' }}>
            {this.props.label} — render error
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--ae-text2)' }}>
            {this.state.error.message}
          </p>
          <button
            className="text-[10px] uppercase tracking-[0.08em] mt-3 px-[12px] py-[5px] transition-opacity hover:opacity-80"
            style={{
              border: '1px solid var(--ae-red-dim)',
              color: 'var(--ae-red)',
              fontFamily: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
            }}
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
