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
    <div style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-border)' }} className="p-4">
      <p className="ae-section-label mb-4">── {title} ────────────────</p>
      {children}
    </div>
  );
}

export default function VpsHealthPage(): React.JSX.Element {
  return (
    <div>
      <h1 className="text-[14px] font-medium mb-6" style={{ color: 'var(--ae-text)' }}>VPS Health</h1>

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
