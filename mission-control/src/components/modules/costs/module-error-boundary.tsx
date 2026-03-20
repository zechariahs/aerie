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
        <div className="rounded border border-red-800/40 bg-[#1a0f0f] p-4">
          <p className="text-sm font-medium text-red-400">{this.props.title} — error</p>
          <p className="mt-1 text-xs text-red-600">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
