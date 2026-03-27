// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Requires state for pagination

import React, { useEffect, useState, useCallback } from 'react';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { basePath } from '@/lib/client-url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditEntry {
  id: number;
  timestamp: string;
  action: string;
  resource: string;
  result: string;
  ip: string;
  user_agent: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface AuditResponse {
  data: {
    entries: AuditEntry[];
    pagination: Pagination;
  };
}

// ---------------------------------------------------------------------------
// Result badge
// ---------------------------------------------------------------------------

function ResultBadge({ result }: { result: string }): React.JSX.Element {
  const cls =
    result === 'success'
      ? 'ae-badge ae-badge-ok'
      : result === 'denied'
        ? 'ae-badge ae-badge-warn'
        : 'ae-badge ae-badge-error';

  return <span className={cls}>{result}</span>;
}

// ---------------------------------------------------------------------------
// Audit table
// ---------------------------------------------------------------------------

function AuditTable(): React.JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/security/audit?page=${p}&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AuditResponse;
      setEntries(json.data.entries);
      setPagination(json.data.pagination);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPage(page);
  }, [fetchPage, page]);

  if (loading) {
    return <div className="p-6 text-[11px]" style={{ color: 'var(--ae-text2)' }}>Loading audit log…</div>;
  }

  if (error) {
    return <div className="p-6 text-[11px]" style={{ color: 'var(--ae-red)' }}>Failed to load: {error}</div>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ae-border)' }}>
              {['Timestamp (UTC)', 'Action', 'Resource', 'Result', 'IP'].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left font-normal text-[10px] uppercase tracking-[0.10em]"
                  style={{ color: 'var(--ae-text3)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[11px]" style={{ color: 'var(--ae-text2)' }}>
                  No audit log entries yet.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr
                  key={entry.id}
                  style={{ borderBottom: '1px solid var(--ae-border)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--ae-surface)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <td className="px-3 py-2 text-[11px] whitespace-nowrap" style={{ color: 'var(--ae-text2)' }}>
                    {entry.timestamp}
                  </td>
                  <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--ae-text)' }}>{entry.action}</td>
                  <td className="px-3 py-2 truncate max-w-[200px]">
                    <a
                      href={entry.resource}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] no-underline hover:underline"
                      style={{ color: 'var(--ae-cyan)' }}
                    >
                      {entry.resource}
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    <ResultBadge result={entry.result} />
                  </td>
                  <td className="px-3 py-2 text-[10px]" style={{ color: 'var(--ae-text3)' }}>{entry.ip}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center gap-3 px-3 py-3 text-[11px]" style={{ borderTop: '1px solid var(--ae-border)', color: 'var(--ae-text2)' }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="text-[10px] uppercase tracking-[0.08em] disabled:opacity-40"
            style={{ padding: '4px 10px', background: 'transparent', border: '1px solid var(--ae-border-hi)', color: 'var(--ae-text2)' }}
          >
            ← Prev
          </button>
          <span>
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} entries)
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={page >= pagination.totalPages}
            className="text-[10px] uppercase tracking-[0.08em] disabled:opacity-40"
            style={{ padding: '4px 10px', background: 'transparent', border: '1px solid var(--ae-border-hi)', color: 'var(--ae-text2)' }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

export default function SecurityPage(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[14px] font-medium" style={{ color: 'var(--ae-text)' }}>Security</h1>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--ae-text2)', letterSpacing: '0.04em' }}>Audit log — read-only record of all write operations</p>
      </div>

      <ErrorBoundary label="Audit Log">
        <section style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-border)' }}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--ae-border)' }}>
            <p className="ae-section-label">── Audit Log ─────────────────────</p>
          </div>
          <AuditTable />
        </section>
      </ErrorBoundary>
    </div>
  );
}
