// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Requires state for all four interactive sections

import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import type { BriefHistory, DriveFile } from '@/types';

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function SectionHeader({ title, description }: { title: string; description: string }): React.JSX.Element {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <p className="text-xs text-[#6b7280] mt-0.5">{description}</p>
    </div>
  );
}

function TotpInput({
  value,
  onChange,
  label = 'TOTP',
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}): React.JSX.Element {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={label}
      maxLength={6}
      className="w-24 px-2 py-1.5 text-xs font-mono bg-[#1e1e2e] border border-[#2d2d3e] rounded text-white placeholder-[#6b7280] focus:outline-none focus:border-[#6366f1]"
    />
  );
}

function ErrorBanner({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="px-3 py-2 bg-red-900/30 border border-red-800 rounded text-xs text-red-400">
      {message}
    </div>
  );
}

function SuccessBanner({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="px-3 py-2 bg-green-900/30 border border-green-800 rounded text-xs text-green-400">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 1 — Brief Generator
// ---------------------------------------------------------------------------

function BriefGenerator(): React.JSX.Element {
  const [notes, setNotes] = useState('');
  const [totp, setTotp] = useState('');
  const [status, setStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [lastBrief, setLastBrief] = useState<{ url: string; title: string } | null>(null);
  const [history, setHistory] = useState<BriefHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Load brief history on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/drive/briefs');
        if (!res.ok) throw new Error('Failed to load brief history');
        const json = (await res.json()) as { data: BriefHistory[] };
        setHistory(json.data);
      } catch {
        // Non-fatal — history just stays empty
      } finally {
        setHistoryLoading(false);
      }
    })();
  }, []);

  async function handleGenerate(): Promise<void> {
    if (!totp.trim()) {
      setErrorMsg('TOTP token is required');
      return;
    }
    setStatus('generating');
    setErrorMsg('');
    try {
      const res = await fetch('/api/drive/briefs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': totp.trim(),
        },
        body: JSON.stringify({ notes }),
      });
      const json = (await res.json()) as {
        data?: { brief: BriefHistory; driveUrl: string };
        error?: string;
      };
      if (!res.ok) {
        setErrorMsg(json.error ?? 'Generation failed');
        setStatus('error');
        return;
      }
      const brief = json.data?.brief;
      if (brief) {
        setLastBrief({ url: brief.drive_url, title: brief.title });
        setHistory((prev) => [brief, ...prev.slice(0, 29)]);
      }
      setStatus('done');
      setTotp('');
    } catch {
      setErrorMsg('Network error');
      setStatus('error');
    }
  }

  async function copyUrl(): Promise<void> {
    if (!lastBrief?.url) return;
    try {
      await navigator.clipboard.writeText(lastBrief.url);
    } catch {
      // clipboard API may be blocked in some contexts
    }
  }

  const isGenerating = status === 'generating';

  return (
    <div className="bg-[#0f0f17] border border-[#1e1e2e] rounded p-4 space-y-4">
      <SectionHeader
        title="Brief Generator"
        description="Assemble a Claude context brief from live dashboard data and write it to Google Drive."
      />

      {/* Notes textarea */}
      <div>
        <label className="block text-xs text-[#9ca3af] mb-1">Operator notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Add context for this Claude session — what you're working on, decisions pending, anything to highlight…"
          className="w-full px-3 py-2 text-xs bg-[#12121a] border border-[#1e1e2e] rounded text-white placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1] resize-none font-mono"
        />
      </div>

      {/* Progress steps while generating */}
      {isGenerating && (
        <div className="px-3 py-2 bg-[#1e1e2e] rounded text-xs text-[#9ca3af] space-y-1">
          <div>Fetching cost summary…</div>
          <div>Reading cron run history…</div>
          <div>Loading task board…</div>
          <div>Reading SESSION-STATE.md…</div>
          <div className="text-[#6366f1]">Writing to Google Drive…</div>
        </div>
      )}

      {/* Error/success banners */}
      {status === 'error' && errorMsg && <ErrorBanner message={errorMsg} />}
      {status === 'done' && lastBrief && (
        <div className="flex items-center gap-2 flex-wrap">
          <SuccessBanner message={`Brief written: ${lastBrief.title}`} />
          <a
            href={lastBrief.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#6366f1] hover:text-[#818cf8] underline whitespace-nowrap"
          >
            Open in Drive
          </a>
          <button
            onClick={() => { void copyUrl(); }}
            className="text-xs text-[#6b7280] hover:text-white transition-colors whitespace-nowrap"
          >
            Copy URL
          </button>
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center gap-2">
        <TotpInput value={totp} onChange={setTotp} label="TOTP" />
        <button
          onClick={() => { void handleGenerate(); }}
          disabled={isGenerating}
          className="px-4 py-1.5 text-xs bg-[#6366f1] hover:bg-[#5254cc] disabled:opacity-50 text-white rounded transition-colors"
        >
          {isGenerating ? 'Generating…' : 'Generate Brief'}
        </button>
      </div>

      {/* Brief history table */}
      <div>
        <div className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-2">
          Brief History
        </div>
        {historyLoading ? (
          <div className="text-xs text-[#6b7280]">Loading…</div>
        ) : history.length === 0 ? (
          <div className="text-xs text-[#6b7280]">No briefs generated yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="text-left py-1.5 pr-4 text-[#6b7280] font-normal">Date</th>
                  <th className="text-left py-1.5 pr-4 text-[#6b7280] font-normal">Title</th>
                  <th className="text-left py-1.5 text-[#6b7280] font-normal">Link</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id} className="border-b border-[#12121a] hover:bg-[#1a1a27]">
                    <td className="py-1.5 pr-4 text-[#9ca3af] font-mono whitespace-nowrap">
                      {new Date(b.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-1.5 pr-4 text-white truncate max-w-xs">{b.title}</td>
                    <td className="py-1.5">
                      <a
                        href={b.drive_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#6366f1] hover:text-[#818cf8] underline"
                      >
                        Open
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — SESSION-STATE.md Editor
// ---------------------------------------------------------------------------

function SessionStateEditor(): React.JSX.Element {
  const [content, setContent] = useState('');
  const [totp, setTotp] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const totpRef = useRef(totp);

  // Keep totpRef in sync so the debounced save closure can read it
  useEffect(() => {
    totpRef.current = totp;
  }, [totp]);

  // Auto-save debounce ref
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Load SESSION-STATE.md on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/workspace/file?path=SESSION-STATE.md');
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          setLoadError(json.error ?? 'Failed to load SESSION-STATE.md');
          return;
        }
        const json = (await res.json()) as { data: { content: string } };
        setContent(json.data.content);
        setLoaded(true);
      } catch {
        setLoadError('Network error loading SESSION-STATE.md');
      }
    })();
  }, []);

  async function doSave(contentToSave: string, totpValue: string): Promise<void> {
    if (!totpValue.trim()) {
      setErrorMsg('TOTP token is required to save');
      setSaveStatus('error');
      return;
    }
    setSaveStatus('saving');
    setErrorMsg('');
    try {
      const res = await fetch('/api/workspace/session-state', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': totpValue.trim(),
        },
        body: JSON.stringify({ content: contentToSave }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setErrorMsg(json.error ?? 'Save failed');
        setSaveStatus('error');
        return;
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setErrorMsg('Network error');
      setSaveStatus('error');
    }
  }

  // Debounced auto-save (5s after last keystroke, only if TOTP present)
  function handleContentChange(newContent: string): void {
    setContent(newContent);
    setSaveStatus('idle');

    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(() => {
      if (totpRef.current.trim()) {
        void doSave(newContent, totpRef.current);
      }
    }, 5000);
  }

  async function handleExportForClaude(): Promise<void> {
    const instruction =
      '<!-- Paste the content below into your Claude session as the session state context -->\n\n';
    try {
      await navigator.clipboard.writeText(instruction + content);
    } catch {
      // clipboard may be unavailable in some environments
    }
  }

  const saveLabel =
    saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : 'Save';

  return (
    <div className="bg-[#0f0f17] border border-[#1e1e2e] rounded p-4 space-y-4">
      <SectionHeader
        title="SESSION-STATE.md Editor"
        description="Edit the session state file included in Claude context briefs. Auto-saves 5 seconds after you stop typing (TOTP required)."
      />

      {loadError && <ErrorBanner message={loadError} />}

      {!loadError && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <TotpInput value={totp} onChange={setTotp} />
            <button
              onClick={() => { void doSave(content, totp); }}
              disabled={saveStatus === 'saving' || !loaded}
              className="px-3 py-1.5 text-xs bg-[#6366f1] hover:bg-[#5254cc] disabled:opacity-50 text-white rounded transition-colors"
            >
              {saveLabel}
            </button>
            <button
              onClick={() => setShowPreview((p) => !p)}
              className="px-3 py-1.5 text-xs border border-[#2d2d3e] text-[#9ca3af] hover:text-white rounded transition-colors"
            >
              {showPreview ? 'Edit' : 'Preview'}
            </button>
            <button
              onClick={() => { void handleExportForClaude(); }}
              disabled={!loaded}
              className="px-3 py-1.5 text-xs border border-[#2d2d3e] text-[#9ca3af] hover:text-white disabled:opacity-50 rounded transition-colors"
            >
              Export for Claude
            </button>
            {saveStatus === 'saving' && (
              <span className="text-xs text-[#6b7280]">Saving…</span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-green-400">Saved ✓</span>
            )}
          </div>

          {saveStatus === 'error' && errorMsg && <ErrorBanner message={errorMsg} />}

          {/* Editor / Preview */}
          {showPreview ? (
            <div
              className="markdown-preview min-h-48 border border-[#1e1e2e] rounded p-3 text-sm overflow-auto max-h-96"
              dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
            />
          ) : (
            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              rows={16}
              disabled={!loaded}
              placeholder={loaded ? '' : 'Loading SESSION-STATE.md…'}
              className="w-full px-3 py-2 text-xs bg-[#0a0a0f] border border-[#1e1e2e] rounded text-white placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1] resize-none font-mono"
              spellCheck={false}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Deliverables Browser
// ---------------------------------------------------------------------------

interface DeliverablesData {
  stg: DriveFile[];
  personal: DriveFile[];
  configured: boolean;
  warnings?: string[];
}

interface DeliverableListProps {
  files: DriveFile[];
  label: string;
  queuedPaths: Set<string>;
  onToggleQueue: (file: DriveFile) => void;
}

function DeliverablesList({
  files,
  label,
  queuedPaths,
  onToggleQueue,
}: DeliverableListProps): React.JSX.Element {
  if (files.length === 0) {
    return <div className="text-xs text-[#6b7280] py-1">No files in {label}.</div>;
  }

  return (
    <div>
      <div className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-2">{label}</div>
      <div className="space-y-1">
        {files.map((f) => {
          const queued = queuedPaths.has(f.id);
          return (
            <div
              key={f.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#1a1a27]"
            >
              <a
                href={f.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-xs text-[#9ca3af] hover:text-white transition-colors truncate"
              >
                {f.name}
              </a>
              <span className="text-[10px] text-[#4b5563] whitespace-nowrap">
                {new Date(f.createdTime).toLocaleDateString()}
              </span>
              <button
                onClick={() => onToggleQueue(f)}
                className={[
                  'text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap',
                  queued
                    ? 'border-[#6366f1] text-[#6366f1] bg-[#6366f1]/10'
                    : 'border-[#2d2d3e] text-[#6b7280] hover:border-[#6366f1] hover:text-[#6366f1]',
                ].join(' ')}
              >
                {queued ? 'Queued ✓' : 'Add to Brief'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeliverablesBrowser(): React.JSX.Element {
  const [data, setData] = useState<DeliverablesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [queuedFiles, setQueuedFiles] = useState<Map<string, DriveFile>>(new Map());

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/drive/deliverables');
        if (!res.ok) throw new Error('Failed to load deliverables');
        const json = (await res.json()) as { data: DeliverablesData };
        setData(json.data);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function toggleQueue(file: DriveFile): void {
    setQueuedFiles((prev) => {
      const next = new Map(prev);
      if (next.has(file.id)) {
        next.delete(file.id);
      } else {
        next.set(file.id, file);
      }
      return next;
    });
  }

  async function copyQueuedLinks(): Promise<void> {
    const lines = Array.from(queuedFiles.values()).map(
      (f) => `- [${f.name}](${f.webViewLink})`,
    );
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
    } catch {
      // clipboard may be unavailable
    }
  }

  const queuedIds = new Set(queuedFiles.keys());

  return (
    <div className="bg-[#0f0f17] border border-[#1e1e2e] rounded p-4 space-y-4">
      <SectionHeader
        title="Deliverables Browser"
        description="Browse STG-Intelligence/ and Personal/ Drive folders. Queue files to include links in the next brief."
      />

      {loading && <div className="text-xs text-[#6b7280]">Loading…</div>}
      {error && <ErrorBanner message={error} />}

      {data && !data.configured && (
        <div className="text-xs text-[#6b7280] px-3 py-2 bg-[#1e1e2e] rounded">
          Drive not configured — set GOOGLE_DRIVE_STG_FOLDER_ID and GOOGLE_DRIVE_PERSONAL_FOLDER_ID.
        </div>
      )}

      {data?.warnings?.map((w) => (
        <div key={w} className="text-xs text-yellow-400 px-3 py-1 bg-yellow-900/20 border border-yellow-800 rounded">
          {w}
        </div>
      ))}

      {data?.configured && (
        <>
          <DeliverablesList
            files={data.stg}
            label="STG-Intelligence"
            queuedPaths={queuedIds}
            onToggleQueue={toggleQueue}
          />
          <DeliverablesList
            files={data.personal}
            label="Personal"
            queuedPaths={queuedIds}
            onToggleQueue={toggleQueue}
          />

          {queuedFiles.size > 0 && (
            <div className="flex items-center gap-3 pt-2 border-t border-[#1e1e2e]">
              <span className="text-xs text-[#9ca3af]">
                {queuedFiles.size} file{queuedFiles.size !== 1 ? 's' : ''} queued for brief
              </span>
              <button
                onClick={() => { void copyQueuedLinks(); }}
                className="text-xs text-[#6366f1] hover:text-[#818cf8] transition-colors"
              >
                Copy links
              </button>
              <button
                onClick={() => setQueuedFiles(new Map())}
                className="text-xs text-[#6b7280] hover:text-white transition-colors"
              >
                Clear queue
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 4 — Task-Specs Writer
// ---------------------------------------------------------------------------

function TaskSpecsWriter(): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [totp, setTotp] = useState('');
  const [status, setStatus] = useState<'idle' | 'writing' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [driveUrl, setDriveUrl] = useState('');

  async function handleWrite(): Promise<void> {
    if (!title.trim()) {
      setErrorMsg('Title is required');
      return;
    }
    if (!content.trim()) {
      setErrorMsg('Content is required');
      return;
    }
    if (!totp.trim()) {
      setErrorMsg('TOTP token is required');
      return;
    }
    setStatus('writing');
    setErrorMsg('');
    setDriveUrl('');

    try {
      const res = await fetch('/api/drive/task-specs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': totp.trim(),
        },
        body: JSON.stringify({ title: title.trim(), content }),
      });
      const json = (await res.json()) as { data?: { url: string }; error?: string };
      if (!res.ok) {
        setErrorMsg(json.error ?? 'Write failed');
        setStatus('error');
        return;
      }
      setDriveUrl(json.data?.url ?? '');
      setStatus('done');
      setTotp('');
    } catch {
      setErrorMsg('Network error');
      setStatus('error');
    }
  }

  function handleReset(): void {
    setTitle('');
    setContent('');
    setTotp('');
    setStatus('idle');
    setErrorMsg('');
    setDriveUrl('');
  }

  const isWriting = status === 'writing';

  return (
    <div className="bg-[#0f0f17] border border-[#1e1e2e] rounded p-4 space-y-4">
      <SectionHeader
        title="Task-Specs Writer"
        description="Write a task specification document directly to the Task-Specs/ Drive folder. The configured agent will pick it up on the next cycle."
      />

      <div>
        <label className="block text-xs text-[#9ca3af] mb-1">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task spec title…"
          className="w-full px-3 py-1.5 text-xs bg-[#12121a] border border-[#1e1e2e] rounded text-white placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1]"
        />
      </div>

      <div>
        <label className="block text-xs text-[#9ca3af] mb-1">Content (Markdown)</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={10}
          placeholder={'## Objective\n\n## Background\n\n## Success Criteria\n'}
          className="w-full px-3 py-2 text-xs bg-[#0a0a0f] border border-[#1e1e2e] rounded text-white placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1] resize-none font-mono"
          spellCheck={false}
        />
      </div>

      {status === 'error' && errorMsg && <ErrorBanner message={errorMsg} />}

      {status === 'done' && (
        <div className="flex items-center gap-2 flex-wrap">
          <SuccessBanner message="Task spec written to Drive." />
          {driveUrl && (
            <a
              href={driveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#6366f1] hover:text-[#818cf8] underline whitespace-nowrap"
            >
              Open in Drive
            </a>
          )}
          <button
            onClick={handleReset}
            className="text-xs text-[#6b7280] hover:text-white transition-colors"
          >
            Write another
          </button>
        </div>
      )}

      {status !== 'done' && (
        <div className="flex items-center gap-2">
          <TotpInput value={totp} onChange={setTotp} />
          <button
            onClick={() => { void handleWrite(); }}
            disabled={isWriting}
            className="px-4 py-1.5 text-xs bg-[#6366f1] hover:bg-[#5254cc] disabled:opacity-50 text-white rounded transition-colors"
          >
            {isWriting ? 'Writing…' : 'Write to Drive'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

export default function ClaudeLoopPage(): React.JSX.Element {
  return (
    <div className="space-y-6 pb-8">
      <div className="flex-shrink-0">
        <h1 className="text-xl font-semibold text-white">Claude Integration Loop</h1>
        <p className="text-xs text-[#6b7280] mt-0.5">
          Generate context briefs, manage session state, browse deliverables, and write task specs.
        </p>
      </div>

      <ErrorBoundary label="Brief Generator">
        <BriefGenerator />
      </ErrorBoundary>
      <ErrorBoundary label="Session State Editor">
        <SessionStateEditor />
      </ErrorBoundary>
      <ErrorBoundary label="Deliverables Browser">
        <DeliverablesBrowser />
      </ErrorBoundary>
      <ErrorBoundary label="Task Specs Writer">
        <TaskSpecsWriter />
      </ErrorBoundary>
    </div>
  );
}
