// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' required — error boundaries need React class component lifecycle
'use client';

import React from 'react';

interface Props {
  title: string;
  children: React.ReactNode;
}

interface State {
  error: Error | undefined;
}

/**
 * Per-panel error boundary. One broken cost panel must not crash the others.
 */
export class ModuleErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: undefined };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          className="p-4"
          style={{ border: '1px solid var(--ae-red-dim)', background: 'var(--ae-surface)' }}
        >
          <p className="text-[11px] uppercase tracking-[0.08em]" style={{ color: 'var(--ae-red)' }}>
            {this.props.title} — error
          </p>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--ae-text2)' }}>
            {this.state.error.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
