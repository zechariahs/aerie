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
    <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--ae-border)' }}>
      <span className="text-[11px]" style={{ color: 'var(--ae-text)' }}>{label}</span>
      <span className={active ? 'ae-badge ae-badge-ok' : 'ae-badge ae-badge-error'}>
        {active ? 'active' : 'inactive'}
      </span>
    </div>
  );
}

export function ServicesUnavailable({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <p className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>
        Host agent unavailable — is host-agent running on the VPS host?
      </p>
      <button
        onClick={onRetry}
        className="text-[10px] uppercase tracking-[0.08em]"
        style={{
          padding: '4px 10px',
          background: 'transparent',
          border: '1px solid var(--ae-border-hi)',
          color: 'var(--ae-text2)',
        }}
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
    return <div className="py-8 text-center text-[11px] animate-pulse" style={{ color: 'var(--ae-text2)' }}>Loading services…</div>;
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
