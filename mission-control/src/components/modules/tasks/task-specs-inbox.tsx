// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DriveFile, Task } from '@/types';

interface TaskSpecsResponse {
  files: DriveFile[];
  configured: boolean;
  error?: string;
}

interface TaskSpecsInboxProps {
  totpToken: string;
  onImported: (task: Task) => void;
  onRequestTotp: (action: () => void) => void;
}

/**
 * Collapsible panel below the Kanban board that lists unimported Task-Specs/
 * Drive docs and allows one-click import as Inbox tasks.
 * Polls every 5 minutes automatically.
 */
export function TaskSpecsInbox({ totpToken, onImported, onRequestTotp }: TaskSpecsInboxProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [data, setData] = useState<TaskSpecsResponse | undefined>();
  const [importing, setImporting] = useState<string | undefined>();

  const fetchSpecs = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks/task-specs');
      const json = (await res.json()) as { data: TaskSpecsResponse };
      setData(json.data);
    } catch {
      // Silent — panel remains in previous state
    }
  }, []);

  useEffect(() => {
    void fetchSpecs();
    const interval = setInterval(() => { void fetchSpecs(); }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchSpecs]);

  async function doImport(file: DriveFile, token: string): Promise<void> {
    setImporting(file.id);
    try {
      const res = await fetch('/api/tasks/import-spec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': token,
        },
        body: JSON.stringify({
          fileId: file.id,
          title: file.name,
          driveUrl: file.webViewLink,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { data: Task };
        onImported(json.data);
        await fetchSpecs();
      }
    } catch {
      // Error is silent — user can retry
    } finally {
      setImporting(undefined);
    }
  }

  return (
    <div className="border border-[#1e1e2e] rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#0d0d14] hover:bg-[#12121a] transition-colors"
      >
        <span className="text-xs font-semibold text-[#6b7280] uppercase tracking-widest">
          Task-Specs/ Inbox
          {data?.files.length ? (
            <span className="ml-2 text-[#3b82f6]">({data.files.length})</span>
          ) : null}
        </span>
        <span className="text-[#6b7280] text-xs">{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div className="bg-[#0a0a11] border-t border-[#1e1e2e]">
          {!data && (
            <p className="px-4 py-3 text-xs text-[#6b7280]">Loading…</p>
          )}

          {data && !data.configured && (
            <p className="px-4 py-3 text-xs text-[#6b7280]">
              Drive not configured — set GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID to enable.
            </p>
          )}

          {data?.configured && data.error && (
            <p className="px-4 py-3 text-xs text-red-400">Drive error: {data.error}</p>
          )}

          {data?.configured && !data.error && data.files.length === 0 && (
            <p className="px-4 py-3 text-xs text-[#6b7280]">No unimported specs.</p>
          )}

          {data?.configured && !data.error && data.files.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="px-4 py-2 text-left text-[10px] text-[#6b7280] uppercase tracking-widest font-medium">Title</th>
                  <th className="px-4 py-2 text-left text-[10px] text-[#6b7280] uppercase tracking-widest font-medium">Created</th>
                  <th className="px-4 py-2 text-right text-[10px] text-[#6b7280] uppercase tracking-widest font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.files.map((file) => (
                  <tr key={file.id} className="border-b border-[#1e1e2e] last:border-0">
                    <td className="px-4 py-2">
                      <a
                        href={file.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#3b82f6] hover:underline"
                      >
                        {file.name}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-[#4b5563]">
                      {new Date(file.createdTime).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        disabled={importing === file.id}
                        onClick={() => onRequestTotp(() => { void doImport(file, totpToken); })}
                        className="text-[10px] px-2 py-1 border border-[#1e1e2e] rounded text-[#6b7280] hover:text-white disabled:opacity-40 transition-colors"
                      >
                        {importing === file.id ? 'Importing…' : 'Import as Task'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
