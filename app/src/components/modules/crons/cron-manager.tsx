// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' — manages interactive state for the entire Cron Manager module
'use client';

import { useState, useCallback } from 'react';
import type { CronJob } from '@/types';
import CronTimeline from './cron-timeline';
import CronJobPanel from './cron-job-panel';
import CronHistoryDrawer from './cron-history-drawer';
import { basePath } from '@/lib/client-url';

interface CronManagerProps {
  initialJobs: CronJob[];
}

export default function CronManager({ initialJobs }: CronManagerProps): React.JSX.Element {
  const [jobs, setJobs] = useState<CronJob[]>(initialJobs);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialJobs[0]?.id);
  const [showHistory, setShowHistory] = useState(false);
  const [loadError, setLoadError] = useState('');

  const selectedJob = jobs.find((j) => j.id === selectedId);

  /**
   * Re-fetches the cron list from the API.
   * Called after any mutation (trigger, enable/disable, schedule update)
   * so the panel reflects updated status.
   */
  const refreshJobs = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(basePath + '/api/crons');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: CronJob[] };
      setJobs(json.data);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to refresh');
    }
  }, []);

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
          Refresh error: {loadError}
        </div>
      )}

      {/* Weekly timeline — overflow-x-auto enables horizontal scroll on mobile */}
      <div className="overflow-x-auto">
        <CronTimeline
          jobs={jobs}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      {/* Per-job panel */}
      {selectedJob ? (
        <CronJobPanel
          key={selectedJob.id}
          job={selectedJob}
          onShowHistory={() => setShowHistory(true)}
          onJobUpdated={() => void refreshJobs()}
        />
      ) : (
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-lg p-8 text-center text-[#6b7280] text-sm">
          Click a cron pill in the timeline to view details
        </div>
      )}

      {/* Run history drawer */}
      {showHistory && selectedJob && (
        <CronHistoryDrawer
          cronId={selectedJob.id}
          cronName={selectedJob.name}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
