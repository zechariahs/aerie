// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { getCronJobs } from '@/lib/openclaw';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import CronManager from '@/components/modules/crons/cron-manager';

/**
 * Server Component — fetches the initial cron list from openclaw.json at
 * render time, then passes it to the client-side CronManager for interactive
 * use (week navigation, trigger, enable/disable, history drawer).
 */
export default function CronsPage(): React.JSX.Element {
  const jobs = getCronJobs();

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[14px] font-[500]" style={{ color: 'var(--ae-text)' }}>
            Cron Manager
          </h1>
          <p className="text-[11px] tracking-[0.04em]" style={{ color: 'var(--ae-text2)', marginTop: '3px' }}>
            {jobs.length} job{jobs.length !== 1 ? 's' : ''} · America/Chicago
          </p>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div
          className="p-8 text-center space-y-2"
          style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-border)' }}
        >
          <p className="text-[13px]" style={{ color: 'var(--ae-text)' }}>No cron jobs found</p>
          <p className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>
            {process.env['USE_FIXTURES'] === 'true'
              ? 'Fixture file not found. Create fixtures/crons.json.'
              : 'Could not read openclaw.json — check that the /openclaw volume is mounted correctly.'}
          </p>
        </div>
      ) : (
        <ErrorBoundary label="Cron Manager">
          <CronManager initialJobs={jobs} />
        </ErrorBoundary>
      )}
    </div>
  );
}
