// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Polls for live service status

import { useEffect, useRef, useState } from 'react';
import type { VpsServiceStatus } from '@/types/index';
import { basePath } from '@/lib/client-url';

interface ServicesPanelState {
  services: VpsServiceStatus | undefined;
  error: string | undefined;
  loading: boolean;
}

interface BadgeProps {
  label: string;
  active: boolean;
}

function StatusBadge({ label, active }: BadgeProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#1e1e2e]/50 last:border-0">
      <span className="text-sm text-[#e2e8f0]">{label}</span>
      <span className={[
        'px-2 py-0.5 rounded text-xs font-medium',
        active ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400',
      ].join(' ')}>
        {active ? 'active' : 'inactive'}
      </span>
    </div>
  );
}

export function ServicesUnavailable({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <p className="text-sm text-[#6b7280]">
        Host agent unavailable — is host-agent running on the VPS host?
      </p>
      <button
        onClick={onRetry}
        className="text-xs px-3 py-1.5 rounded border border-[#1e1e2e] text-[#6b7280] hover:text-white hover:border-[#6366f1] transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

export function ServicesPanel(): React.JSX.Element {
  const [state, setState] = useState<ServicesPanelState>({ services: undefined, error: undefined, loading: true });
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  async function fetchServices(): Promise<void> {
    try {
      const res = await fetch(basePath + '/api/vps/services');
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch services' })) as { error?: string };
        setState({ services: undefined, error: err.error ?? 'Failed to fetch services', loading: false });
        return;
      }
      const json = await res.json() as { data: VpsServiceStatus };
      setState({ services: json.data, error: undefined, loading: false });
    } catch {
      setState({ services: undefined, error: 'Host agent unavailable', loading: false });
    }
  }

  function startPolling(): void {
    void fetchServices();
    intervalRef.current = setInterval(() => { void fetchServices(); }, 15000);
  }

  function stopPolling(): void {
    if (intervalRef.current !== undefined) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
  }

  useEffect(() => {
    startPolling();
    return stopPolling;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRetry(): void {
    setState({ services: undefined, error: undefined, loading: true });
    stopPolling();
    startPolling();
  }

  if (state.loading) {
    return <div className="py-8 text-center text-xs text-[#6b7280] animate-pulse">Loading services…</div>;
  }

  if (state.error) {
    return <ServicesUnavailable onRetry={handleRetry} />;
  }

  const s = state.services!;

  return (
    <div>
      <StatusBadge label="Nginx" active={s.nginx === 'active'} />
      <StatusBadge label="OpenClaw Gateway" active={s.openclawGateway} />
    </div>
  );
}
