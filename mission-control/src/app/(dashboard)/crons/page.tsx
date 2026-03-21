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
          <h1 className="text-xl font-semibold text-white">Cron Manager</h1>
          <p className="text-sm text-[#6b7280] mt-0.5">
            {jobs.length} job{jobs.length !== 1 ? 's' : ''} · America/Chicago
          </p>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-lg p-8 text-center space-y-2">
          <p className="text-white font-medium">No cron jobs found</p>
          <p className="text-[#6b7280] text-sm">
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
