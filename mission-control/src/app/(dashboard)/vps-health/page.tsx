// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SystemMetricsPanel } from '@/components/modules/vps-health/system-metrics-panel';
import { DockerPanel } from '@/components/modules/vps-health/docker-panel';
import { ServicesPanel } from '@/components/modules/vps-health/services-panel';

interface PanelProps {
  title: string;
  children: React.ReactNode;
}

function Panel({ title, children }: PanelProps): React.JSX.Element {
  return (
    <div className="rounded border border-[#1e1e2e] bg-[#12121a] p-4">
      <h2 className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-4">{title}</h2>
      {children}
    </div>
  );
}

export default function VpsHealthPage(): React.JSX.Element {
  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-6">VPS Health</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ErrorBoundary label="System Metrics">
          <Panel title="System Metrics">
            <SystemMetricsPanel />
          </Panel>
        </ErrorBoundary>

        <ErrorBoundary label="Docker Containers">
          <Panel title="Docker Containers">
            <DockerPanel />
          </Panel>
        </ErrorBoundary>

        <ErrorBoundary label="Services">
          <Panel title="Services">
            <ServicesPanel />
          </Panel>
        </ErrorBoundary>
      </div>
    </div>
  );
}
