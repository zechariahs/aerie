// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { Sidebar } from '@/components/layout/sidebar';
import { StatusStrip } from '@/components/layout/status-strip';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps): React.JSX.Element {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <StatusStrip />
        <main className="flex-1 overflow-auto p-6 pt-10 md:pt-6">{children}</main>
      </div>
    </div>
  );
}
