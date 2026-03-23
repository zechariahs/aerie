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
  const classes =
    result === 'success'
      ? 'bg-green-900/40 text-green-400 border-green-800'
      : result === 'denied'
        ? 'bg-amber-900/40 text-amber-400 border-amber-800'
        : 'bg-red-900/40 text-red-400 border-red-800';

  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded border ${classes}`}>
      {result}
    </span>
  );
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
    return <div className="p-6 text-sm text-[#6b7280]">Loading audit log…</div>;
  }

  if (error) {
    return <div className="p-6 text-sm text-red-400">Failed to load: {error}</div>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#1e1e2e] text-[#6b7280] text-left">
              <th className="px-3 py-2 font-medium whitespace-nowrap">Timestamp (UTC)</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Resource</th>
              <th className="px-3 py-2 font-medium">Result</th>
              <th className="px-3 py-2 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[#6b7280]">
                  No audit log entries yet.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id} className="border-b border-[#1a1a27] hover:bg-[#1a1a27]/40">
                  <td className="px-3 py-2 font-mono text-[#6b7280] whitespace-nowrap">
                    {entry.timestamp}
                  </td>
                  <td className="px-3 py-2 text-[#c9d1d9]">{entry.action}</td>
                  <td className="px-3 py-2 font-mono text-[#818cf8] truncate max-w-[200px]">
                    {entry.resource}
                  </td>
                  <td className="px-3 py-2">
                    <ResultBadge result={entry.result} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[#6b7280]">{entry.ip}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center gap-3 px-3 py-3 border-t border-[#1e1e2e] text-xs text-[#6b7280]">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-2 py-1 rounded border border-[#2a2a3e] hover:text-white disabled:opacity-40 transition-colors"
          >
            ← Prev
          </button>
          <span>
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} entries)
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={page >= pagination.totalPages}
            className="px-2 py-1 rounded border border-[#2a2a3e] hover:text-white disabled:opacity-40 transition-colors"
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
        <h1 className="text-xl font-semibold text-white">Security</h1>
        <p className="text-sm text-[#6b7280] mt-0.5">Audit log — read-only record of all write operations</p>
      </div>

      <ErrorBoundary label="Audit Log">
        <section className="rounded border border-[#1e1e2e] bg-[#12121a]">
          <div className="px-4 py-3 border-b border-[#1e1e2e]">
            <h2 className="text-sm font-semibold text-[#c9d1d9]">Audit Log</h2>
          </div>
          <AuditTable />
        </section>
      </ErrorBoundary>
    </div>
  );
}
