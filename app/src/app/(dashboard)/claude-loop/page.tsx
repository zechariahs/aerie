// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Requires state for all four interactive sections

import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import type { BriefHistory, DriveFile } from '@/types';
import { basePath } from '@/lib/client-url';
import { isTotpFresh, clearTotpFreshCookieClient } from '@/lib/totp-fresh';

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  background: 'var(--ae-surface)',
  border: '1px solid var(--ae-border)',
  padding: '1rem',
  position: 'relative',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--ae-raised)',
  border: '1px solid var(--ae-border)',
  color: 'var(--ae-text)',
  fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  fontSize: 11,
  padding: '4px 8px',
  outline: 'none',
  width: '100%',
};

const totpStyle: React.CSSProperties = {
  ...inputStyle,
  width: 100,
  textAlign: 'center',
};

const btnPrimary: React.CSSProperties = {
  padding: '5px 16px',
  background: 'var(--ae-amber)',
  border: 'none',
  color: 'var(--ae-void)',
  fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '5px 12px',
  background: 'transparent',
  border: '1px solid var(--ae-border-hi)',
  color: 'var(--ae-text2)',
  fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  cursor: 'pointer',
};

// Corner brackets component
function CornerBrackets(): React.JSX.Element {
  return (
    <>
      <div className="absolute top-[-1px] left-[-1px] w-2 h-2" style={{ borderTop: '1px solid var(--ae-amber)', borderLeft: '1px solid var(--ae-amber)' }} />
      <div className="absolute top-[-1px] right-[-1px] w-2 h-2" style={{ borderTop: '1px solid var(--ae-amber)', borderRight: '1px solid var(--ae-amber)' }} />
      <div className="absolute bottom-[-1px] left-[-1px] w-2 h-2" style={{ borderBottom: '1px solid var(--ae-amber)', borderLeft: '1px solid var(--ae-amber)' }} />
      <div className="absolute bottom-[-1px] right-[-1px] w-2 h-2" style={{ borderBottom: '1px solid var(--ae-amber)', borderRight: '1px solid var(--ae-amber)' }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function SectionHeader({ title, description }: { title: string; description: string }): React.JSX.Element {
  return (
    <div className="mb-4">
      <p className="ae-section-label mb-1">── {title} ─────────────────</p>
      <p className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>{description}</p>
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
      style={totpStyle}
      onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
      onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
    />
  );
}

function ErrorBanner({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="px-3 py-2 text-[11px]" style={{ background: 'var(--ae-red-dim)', border: '1px solid var(--ae-red)', color: 'var(--ae-red)' }}>
      {message}
    </div>
  );
}

function SuccessBanner({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="px-3 py-2 text-[11px]" style={{ background: 'var(--ae-green-dim)', border: '1px solid var(--ae-green)', color: 'var(--ae-green)' }}>
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
        const res = await fetch(basePath + '/api/drive/briefs');
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
    const fresh = isTotpFresh();
    if (!fresh && !totp.trim()) {
      setErrorMsg('TOTP token is required');
      return;
    }
    setStatus('generating');
    setErrorMsg('');
    try {
      const res = await fetch(basePath + '/api/drive/briefs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': fresh ? '' : totp.trim(),
        },
        body: JSON.stringify({ notes }),
      });
      const json = (await res.json()) as {
        data?: { brief: BriefHistory; driveUrl: string };
        error?: string;
      };
      if (res.status === 403) {
        clearTotpFreshCookieClient();
        setErrorMsg('Session expired — enter your TOTP code and try again.');
        setStatus('error');
        return;
      }
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
    <div style={panelStyle} className="space-y-4">
      <CornerBrackets />
      <SectionHeader
        title="Brief Generator"
        description="Assemble a Claude context brief from live dashboard data and write it to Google Drive."
      />

      {/* Notes textarea */}
      <div>
        <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Operator notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Add context for this Claude session…"
          style={{ ...inputStyle, resize: 'none' }}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
        />
      </div>

      {/* Progress steps while generating */}
      {isGenerating && (
        <div className="px-3 py-2 text-[11px] space-y-1" style={{ background: 'var(--ae-raised)', color: 'var(--ae-text2)' }}>
          <div>Fetching cost summary…</div>
          <div>Reading cron run history…</div>
          <div>Loading task board…</div>
          <div>Reading SESSION-STATE.md…</div>
          <div style={{ color: 'var(--ae-amber)' }}>Writing to Google Drive…</div>
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
            className="text-[11px] no-underline hover:underline whitespace-nowrap"
            style={{ color: 'var(--ae-cyan)' }}
          >
            Open in Drive
          </a>
          <button
            onClick={() => { void copyUrl(); }}
            className="text-[11px] whitespace-nowrap"
            style={{ color: 'var(--ae-text2)', background: 'none', border: 'none', cursor: 'pointer' }}
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
          style={{ ...btnPrimary, opacity: isGenerating ? 0.5 : 1 }}
        >
          {isGenerating ? 'Generating…' : 'Generate Brief'}
        </button>
      </div>

      {/* Brief history table */}
      <div>
        <p className="ae-section-label mb-2">── Brief History ─────────────</p>
        {historyLoading ? (
          <div className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>Loading…</div>
        ) : history.length === 0 ? (
          <div className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>No briefs generated yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ae-border)' }}>
                  {['Date', 'Title', 'Link'].map((h) => (
                    <th key={h} className="text-left py-1.5 pr-4 font-normal text-[10px] uppercase tracking-[0.10em]" style={{ color: 'var(--ae-text3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr
                    key={b.id}
                    style={{ borderBottom: '1px solid var(--ae-border)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--ae-raised)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <td className="py-2 pr-4 text-[11px] whitespace-nowrap" style={{ color: 'var(--ae-text2)' }}>
                      {new Date(b.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-4 text-[11px] truncate max-w-xs" style={{ color: 'var(--ae-text)' }}>{b.title}</td>
                    <td className="py-2">
                      <a
                        href={b.drive_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] no-underline hover:underline"
                        style={{ color: 'var(--ae-cyan)' }}
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
        const res = await fetch(basePath + '/api/workspace/file?path=SESSION-STATE.md');
        if (res.status === 404) {
          // File doesn't exist yet — open editor blank so user can create it
          setLoaded(true);
          return;
        }
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
    const fresh = isTotpFresh();
    if (!fresh && !totpValue.trim()) {
      setErrorMsg('TOTP token is required to save');
      setSaveStatus('error');
      return;
    }
    setSaveStatus('saving');
    setErrorMsg('');
    try {
      const res = await fetch(basePath + '/api/workspace/session-state', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': fresh ? '' : totpValue.trim(),
        },
        body: JSON.stringify({ content: contentToSave }),
      });
      if (res.status === 403) {
        clearTotpFreshCookieClient();
        setErrorMsg('Session expired — enter your TOTP code and save again.');
        setSaveStatus('error');
        return;
      }
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
      if (totpRef.current.trim() || isTotpFresh()) {
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
    <div style={panelStyle} className="space-y-4">
      <CornerBrackets />
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
              style={{ ...btnPrimary, opacity: (saveStatus === 'saving' || !loaded) ? 0.5 : 1 }}
            >
              {saveLabel}
            </button>
            <button
              onClick={() => setShowPreview((p) => !p)}
              style={btnSecondary}
            >
              {showPreview ? 'Edit' : 'Preview'}
            </button>
            <button
              onClick={() => { void handleExportForClaude(); }}
              disabled={!loaded}
              style={{ ...btnSecondary, opacity: !loaded ? 0.5 : 1 }}
            >
              Export for Claude
            </button>
            {saveStatus === 'saving' && (
              <span className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>Saving…</span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-[11px]" style={{ color: 'var(--ae-green)' }}>Saved ✓</span>
            )}
          </div>

          {saveStatus === 'error' && errorMsg && <ErrorBanner message={errorMsg} />}

          {/* Char count */}
          {loaded && (
            <div className="text-[10px] text-right" style={{ color: 'var(--ae-text3)' }}>
              {content.length > 0
                ? `${content.length.toLocaleString()} chars`
                : 'File is empty — type to populate'}
            </div>
          )}

          {/* Editor / Preview */}
          {showPreview ? (
            <div
              className="markdown-preview min-h-48 p-3 text-[11px] overflow-auto max-h-96"
              style={{ border: '1px solid var(--ae-border)' }}
              dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
            />
          ) : (
            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              rows={16}
              disabled={!loaded}
              placeholder={loaded ? '' : 'Loading SESSION-STATE.md…'}
              style={{ ...inputStyle, resize: 'none' }}
              onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
              onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
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
    return <div className="text-[11px] py-1" style={{ color: 'var(--ae-text2)' }}>No files in {label}.</div>;
  }

  return (
    <div>
      <p className="ae-section-label mb-2">── {label} ──────────────</p>
      <div className="space-y-1">
        {files.map((f) => {
          const queued = queuedPaths.has(f.id);
          return (
            <div
              key={f.id}
              className="flex items-center gap-2 px-2 py-1.5"
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--ae-raised)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <a
                href={f.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-[11px] no-underline hover:underline truncate"
                style={{ color: 'var(--ae-text2)' }}
              >
                {f.name}
              </a>
              <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--ae-text3)' }}>
                {new Date(f.createdTime).toLocaleDateString()}
              </span>
              <button
                onClick={() => onToggleQueue(f)}
                className={queued ? 'ae-badge ae-badge-active' : 'ae-badge ae-badge-off'}
                style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
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
        const res = await fetch(basePath + '/api/drive/deliverables');
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
    <div style={panelStyle} className="space-y-4">
      <CornerBrackets />
      <SectionHeader
        title="Deliverables Browser"
        description="Browse STG-Intelligence/ and Personal/ Drive folders. Queue files to include links in the next brief."
      />

      {loading && <div className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>Loading…</div>}
      {error && <ErrorBanner message={error} />}

      {data && !data.configured && (
        <div className="text-[11px] px-3 py-2" style={{ background: 'var(--ae-raised)', color: 'var(--ae-text2)' }}>
          Drive not configured — set GOOGLE_DRIVE_STG_FOLDER_ID and GOOGLE_DRIVE_PERSONAL_FOLDER_ID.
        </div>
      )}

      {data?.warnings?.map((w) => (
        <div key={w} className="text-[11px] px-3 py-1" style={{ background: 'var(--ae-warn-dim)', border: '1px solid var(--ae-warn)', color: 'var(--ae-warn)' }}>
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
            <div className="flex items-center gap-3 pt-2" style={{ borderTop: '1px solid var(--ae-border)' }}>
              <span className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>
                {queuedFiles.size} file{queuedFiles.size !== 1 ? 's' : ''} queued for brief
              </span>
              <button
                onClick={() => { void copyQueuedLinks(); }}
                className="text-[11px]"
                style={{ color: 'var(--ae-cyan)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Copy links
              </button>
              <button
                onClick={() => setQueuedFiles(new Map())}
                className="text-[11px]"
                style={{ color: 'var(--ae-text2)', background: 'none', border: 'none', cursor: 'pointer' }}
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
    const fresh = isTotpFresh();
    if (!fresh && !totp.trim()) {
      setErrorMsg('TOTP token is required');
      return;
    }
    setStatus('writing');
    setErrorMsg('');
    setDriveUrl('');

    try {
      const res = await fetch(basePath + '/api/drive/task-specs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': fresh ? '' : totp.trim(),
        },
        body: JSON.stringify({ title: title.trim(), content }),
      });
      const json = (await res.json()) as { data?: { url: string }; error?: string };
      if (res.status === 403) {
        clearTotpFreshCookieClient();
        setErrorMsg('Session expired — enter your TOTP code and try again.');
        setStatus('error');
        return;
      }
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
    <div style={panelStyle} className="space-y-4">
      <CornerBrackets />
      <SectionHeader
        title="Task-Specs Writer"
        description="Write a task specification document directly to the Task-Specs/ Drive folder. The configured agent will pick it up on the next cycle."
      />

      <div>
        <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task spec title…"
          style={inputStyle}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
        />
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--ae-text3)' }}>Content (Markdown)</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={10}
          placeholder={'## Objective\n\n## Background\n\n## Success Criteria\n'}
          style={{ ...inputStyle, resize: 'none' }}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
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
              className="text-[11px] no-underline hover:underline whitespace-nowrap"
              style={{ color: 'var(--ae-cyan)' }}
            >
              Open in Drive
            </a>
          )}
          <button
            onClick={handleReset}
            className="text-[11px]"
            style={{ color: 'var(--ae-text2)', background: 'none', border: 'none', cursor: 'pointer' }}
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
            style={{ ...btnPrimary, opacity: isWriting ? 0.5 : 1 }}
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
        <h1 className="text-[14px] font-medium" style={{ color: 'var(--ae-text)' }}>Claude Integration Loop</h1>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--ae-text2)', letterSpacing: '0.04em' }}>
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
