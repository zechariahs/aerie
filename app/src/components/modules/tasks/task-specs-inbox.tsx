// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DriveFile, Task } from '@/types';
import { basePath } from '@/lib/client-url';
import { clearTotpFreshCookieClient } from '@/lib/totp-fresh';

interface TaskSpecsResponse {
  files: DriveFile[];
  configured: boolean;
  error?: string;
}

interface TaskSpecsInboxProps {
  onImported: (task: Task) => void;
  onRequestTotp: (action: (token: string) => void) => void;
}

/**
 * Collapsible panel below the Kanban board that lists unimported Task-Specs/
 * Drive docs and allows one-click import as Inbox tasks.
 * Polls every 5 minutes automatically.
 */
export function TaskSpecsInbox({ onImported, onRequestTotp }: TaskSpecsInboxProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [data, setData] = useState<TaskSpecsResponse | undefined>();
  const [importing, setImporting] = useState<string | undefined>();

  const fetchSpecs = useCallback(async () => {
    try {
      const res = await fetch(basePath + '/api/tasks/task-specs');
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
      const res = await fetch(basePath + '/api/tasks/import-spec', {
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
      if (res.status === 403) {
        if (token === '') {
          clearTotpFreshCookieClient();
          onRequestTotp((t) => { void doImport(file, t); });
        }
        // Silent on invalid-token 403 — user can retry with a new code
        return;
      }
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
    <div style={{ border: '1px solid var(--ae-border)' }}>
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-3"
        style={{ background: 'var(--ae-void)' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--ae-surface)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--ae-void)'; }}
      >
        <span className="ae-section-label">
          ── Task-Specs/ Inbox
          {data?.files.length ? (
            <span className="ml-2" style={{ color: 'var(--ae-amber)' }}>({data.files.length})</span>
          ) : null}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--ae-text3)' }}>{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div style={{ background: 'var(--ae-void)', borderTop: '1px solid var(--ae-border)' }}>
          {!data && (
            <p className="px-4 py-3 text-[11px]" style={{ color: 'var(--ae-text2)' }}>Loading…</p>
          )}

          {data && !data.configured && (
            <p className="px-4 py-3 text-[11px]" style={{ color: 'var(--ae-text2)' }}>
              Drive not configured — set GOOGLE_DRIVE_TASK_SPECS_FOLDER_ID to enable.
            </p>
          )}

          {data?.configured && data.error && (
            <p className="px-4 py-3 text-[11px]" style={{ color: 'var(--ae-red)' }}>Drive error: {data.error}</p>
          )}

          {data?.configured && !data.error && data.files.length === 0 && (
            <p className="px-4 py-3 text-[11px]" style={{ color: 'var(--ae-text2)' }}>No unimported specs.</p>
          )}

          {data?.configured && !data.error && data.files.length > 0 && (
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ae-border)' }}>
                  {['Title', 'Created', 'Action'].map((h, i) => (
                    <th
                      key={h}
                      className={`px-4 py-2 font-normal text-[10px] uppercase tracking-[0.10em]${i === 2 ? ' text-right' : ' text-left'}`}
                      style={{ color: 'var(--ae-text3)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.files.map((file) => (
                  <tr key={file.id} style={{ borderBottom: '1px solid var(--ae-border)' }}>
                    <td className="px-4 py-2">
                      <a
                        href={file.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] no-underline hover:underline"
                        style={{ color: 'var(--ae-cyan)' }}
                      >
                        {file.name}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-[10px]" style={{ color: 'var(--ae-text3)' }}>
                      {new Date(file.createdTime).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        disabled={importing === file.id}
                        onClick={() => onRequestTotp((token) => { void doImport(file, token); })}
                        className="text-[10px] uppercase tracking-[0.08em] disabled:opacity-40"
                        style={{
                          padding: '3px 8px',
                          background: 'transparent',
                          border: '1px solid var(--ae-border-hi)',
                          color: 'var(--ae-text2)',
                        }}
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
