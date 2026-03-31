// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  Suspense,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { basePath } from '@/lib/client-url';
import { Marked } from 'marked';

/** Escapes special HTML characters for safe injection into attributes and text. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Returns true for URL schemes that are safe to render in an <a href> or
 * <img src>. Relative URLs (no scheme) are always safe. Only an explicit
 * allowlist of absolute schemes is permitted.
 */
function isSafeUrl(href: string | null | undefined): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  // Relative URLs (no scheme present) are safe.
  if (!/^[a-zA-Z][\w+.-]*:/.test(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith('http:') ||
    lower.startsWith('https:') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:')
  );
}

/**
 * Module-level Marked instance — created once and reused across all renders
 * so we don't pay parser-construction overhead on every call.
 *
 * Safety:
 *  - Raw HTML blocks are stripped (html renderer returns '') to block
 *    <script>/<img onerror=...> style injections.
 *  - Link and image URLs are validated at render time against an explicit
 *    scheme allowlist (http, https, mailto, tel, relative). Unsafe schemes
 *    (javascript:, data:, vbscript:, etc.) are rejected: links render as
 *    plain text and images render as their alt text.
 *  - All attribute values and text content are HTML-escaped to prevent
 *    injection via crafted hrefs (e.g. `http://x" onmouseover="...`) or
 *    link labels containing raw HTML tags.
 */
const workspaceMarkdownParser = new Marked({
  renderer: {
    html(): string { return ''; },
    link(token: { href?: string | null; title?: string | null; text?: string }): string {
      if (!isSafeUrl(token.href)) return escapeHtml(token.text ?? '');
      const href = escapeHtml(token.href!);
      const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<a href="${href}"${titleAttr}>${escapeHtml(token.text ?? '')}</a>`;
    },
    image(token: { href?: string | null; title?: string | null; text?: string }): string {
      if (!isSafeUrl(token.href)) return token.text ? `<span>${escapeHtml(token.text)}</span>` : '';
      const src = escapeHtml(token.href!);
      const altAttr = ` alt="${escapeHtml(token.text ?? '')}"`;
      const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<img src="${src}"${altAttr}${titleAttr} />`;
    },
  },
});

function renderWorkspaceMarkdown(content: string): string {
  return workspaceMarkdownParser.parse(content, { async: false }) as string;
}
import type {
  AgentConfig,
  AgentBinding,
  AgentSessionsResult,
  AgentModelsStatus,
  AgentWorkspaceFileInfo,
  GatewayStatusResponse,
  WorkspaceTreeData,
  WorkspaceTreeNode,
  WorkspaceSearchResult,
} from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type TabId = 'overview' | 'workspace' | 'sessions' | 'bindings' | 'models';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'bindings', label: 'Bindings' },
  { id: 'models', label: 'Models' },
];

const DEFAULT_AGENT_ID =
  process.env['NEXT_PUBLIC_WINTERMUTE_AGENT_ID'] ??
  process.env['NEXT_PUBLIC_AGENT_ID'] ??
  'main';

// Standard workspace files grouped by section
interface FileSpec {
  name: string;
  description: string;
  isBootstrap?: boolean;
  isDirectory?: boolean;
}

const WORKSPACE_SECTIONS: { label: string; files: FileSpec[] }[] = [
  {
    label: 'Core (loaded every session)',
    files: [
      { name: 'AGENTS.md', description: 'Operating instructions, memory rules' },
      { name: 'SOUL.md', description: 'Persona, tone, boundaries' },
      { name: 'USER.md', description: 'Who the user is' },
    ],
  },
  {
    label: 'Automation',
    files: [
      { name: 'HEARTBEAT.md', description: 'Heartbeat cron checklist' },
      { name: 'BOOT.md', description: 'Gateway restart checklist' },
    ],
  },
  {
    label: 'Context & Identity',
    files: [
      { name: 'TOOLS.md', description: 'Tool usage notes (guidance only)' },
      { name: 'IDENTITY.md', description: 'Name, vibe, emoji' },
    ],
  },
  {
    label: 'Lifecycle',
    files: [
      { name: 'BOOTSTRAP.md', description: 'First-run ritual', isBootstrap: true },
      { name: 'MEMORY.md', description: 'Long-term memory (private sessions only)' },
      { name: 'memory', description: 'Daily logs directory', isDirectory: true },
    ],
  },
];

const CHAR_WARN_THRESHOLD = 18_000;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function formatRelTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ${m}m ago`;
  return `${m}m ago`;
}


function agentDisplayName(agent: AgentConfig): string {
  return agent.identity?.name ?? agent.name ?? agent.id;
}

function agentEmoji(agent: AgentConfig): string {
  return agent.identity?.emoji ?? '🤖';
}

// ---------------------------------------------------------------------------
// Shared input style
// ---------------------------------------------------------------------------

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--ae-raised)',
  border: '1px solid var(--ae-border)',
  color: 'var(--ae-text)',
  fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  fontSize: 11,
  padding: '3px 6px',
  outline: 'none',
};

// ---------------------------------------------------------------------------
// InlineEditor — pencil-icon inline edit for identity fields
// ---------------------------------------------------------------------------

interface InlineEditorProps {
  value: string;
  maxLen: number;
  onSave: (v: string) => Promise<void>;
}

function InlineEditor({ value, maxLen, onSave }: InlineEditorProps): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit(): void {
    setDraft(value);
    setError(null);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancel(): void {
    setEditing(false);
    setError(null);
  }

  async function save(): Promise<void> {
    const trimmed = draft.trim();
    if (!trimmed) { setError('Cannot be empty'); return; }
    if (trimmed.length > maxLen) { setError(`Max ${maxLen} chars`); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5 group">
        <span style={{ color: 'var(--ae-text)' }}>{value || '—'}</span>
        <button
          onClick={startEdit}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
          style={{ color: 'var(--ae-text2)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
          title="Edit"
        >
          ✎
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={maxLen}
          style={{ ...INPUT_STYLE, width: 200 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') cancel();
          }}
          onFocus={(el) => { (el.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
          onBlur={(el) => { (el.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
        />
        <button
          onClick={() => { void save(); }}
          disabled={saving}
          style={{ ...INPUT_STYLE, background: 'var(--ae-amber)', color: 'var(--ae-void)', cursor: saving ? 'wait' : 'pointer', border: 'none', padding: '3px 8px' }}
          title="Save"
        >
          {saving ? '…' : '✓'}
        </button>
        <button
          onClick={cancel}
          style={{ ...INPUT_STYLE, cursor: 'pointer', padding: '3px 8px' }}
          title="Cancel"
        >
          ✗
        </button>
      </span>
      {error && <span className="text-[10px]" style={{ color: 'var(--ae-red)' }}>{error}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// OverviewTab
// ---------------------------------------------------------------------------

interface OverviewTabProps {
  agent: AgentConfig;
  gatewayStatus: GatewayStatusResponse | null;
  gatewayLoading: boolean;
  onIdentitySaved: () => void;
}

function OverviewTab({ agent, gatewayStatus, gatewayLoading, onIdentitySaved }: OverviewTabProps): React.JSX.Element {
  async function saveIdentityField(field: 'name' | 'emoji', value: string): Promise<void> {
    const res = await fetch(basePath + '/api/agents/set-identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: agent.id, [field]: value }),
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      throw new Error(json.error ?? 'Save failed');
    }
    onIdentitySaved();
  }

  const gwStatus = gatewayStatus?.status ?? 'unknown';
  const gwStatusColor =
    gwStatus === 'connected' ? 'var(--ae-green)' :
    gwStatus === 'reconnecting' ? 'var(--ae-warn)' :
    'var(--ae-red)';

  const toolAllow = agent.tools?.allow?.length ?? 0;
  const toolDeny = agent.tools?.deny?.length ?? 0;
  const toolPolicy = toolAllow === 0 && toolDeny === 0
    ? 'unrestricted'
    : `allow: ${toolAllow}, deny: ${toolDeny}`;

  return (
    <div className="p-4 space-y-5">
      {/* Gateway status card */}
      <div style={{ border: '1px solid var(--ae-border)', background: 'var(--ae-surface)' }}>
        <div
          className="px-3 py-2 text-[10px] uppercase tracking-[0.12em]"
          style={{ borderBottom: '1px solid var(--ae-border)', color: 'var(--ae-text2)' }}
        >
          Gateway Status
        </div>
        <div className="px-3 py-3 grid grid-cols-3 gap-4">
          <div>
            <div className="text-[10px] mb-1" style={{ color: 'var(--ae-text2)' }}>Connection</div>
            <div className="text-[11px] flex items-center gap-1.5">
              {gatewayLoading ? (
                <span style={{ color: 'var(--ae-text3)' }}>Loading…</span>
              ) : (
                <>
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: gwStatusColor, flexShrink: 0 }}
                  />
                  <span style={{ color: 'var(--ae-text)' }}>{gwStatus}</span>
                </>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] mb-1" style={{ color: 'var(--ae-text2)' }}>Last Event</div>
            <div className="text-[11px]" style={{ color: 'var(--ae-text)' }}>
              {gatewayStatus?.lastEventAt
                ? formatRelTime(new Date(gatewayStatus.lastEventAt).toISOString())
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] mb-1" style={{ color: 'var(--ae-text2)' }}>Agent State</div>
            <div className="text-[11px]" style={{ color: 'var(--ae-text)' }}>
              {gatewayStatus?.agentStates.find((s) => s.agentId === agent.id)?.status ?? 'UNKNOWN'}
            </div>
          </div>
        </div>
      </div>

      {/* Identity */}
      <div style={{ border: '1px solid var(--ae-border)', background: 'var(--ae-surface)' }}>
        <div
          className="px-3 py-2 text-[10px] uppercase tracking-[0.12em]"
          style={{ borderBottom: '1px solid var(--ae-border)', color: 'var(--ae-text2)' }}
        >
          Identity
        </div>
        <div className="px-3 py-3 space-y-3">
          <div className="grid grid-cols-[140px_1fr] gap-2 items-start">
            <span className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>Name</span>
            <InlineEditor
              value={agent.identity?.name ?? agent.name ?? agent.id}
              maxLen={64}
              onSave={(v) => saveIdentityField('name', v)}
            />
          </div>
          <div className="grid grid-cols-[140px_1fr] gap-2 items-start">
            <span className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>Emoji</span>
            <InlineEditor
              value={agent.identity?.emoji ?? '🤖'}
              maxLen={8}
              onSave={(v) => saveIdentityField('emoji', v)}
            />
          </div>
          {agent.identity?.theme && (
            <div className="grid grid-cols-[140px_1fr] gap-2 items-start">
              <span className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>Theme</span>
              <span className="text-[11px]" style={{ color: 'var(--ae-text)' }}>{agent.identity.theme}</span>
            </div>
          )}
          {agent.identity?.avatar && (
            <div className="grid grid-cols-[140px_1fr] gap-2 items-start">
              <span className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>Avatar</span>
              <span className="text-[11px]" style={{ color: 'var(--ae-text2)' }} title="Avatar is set in IDENTITY.md or via CLI.">
                (set — edit via CLI)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Config */}
      <div style={{ border: '1px solid var(--ae-border)', background: 'var(--ae-surface)' }}>
        <div
          className="px-3 py-2 text-[10px] uppercase tracking-[0.12em]"
          style={{ borderBottom: '1px solid var(--ae-border)', color: 'var(--ae-text2)' }}
        >
          Configuration (read-only)
        </div>
        <div className="px-3 py-3 space-y-2">
          {[
            { label: 'Agent ID', value: agent.id, mono: true },
            { label: 'Workspace', value: agent.workspace ?? '—', mono: true },
            {
              label: 'Agent dir',
              value: agent.agentDir ?? `~/.openclaw/agents/${agent.id}/agent`,
              mono: true,
            },
            {
              label: 'Default model',
              value: agent.model ?? '— (uses system default)',
              title: 'Per-agent model default. Cron jobs override this per-job.',
            },
            { label: 'Sandbox mode', value: agent.sandbox?.mode ?? 'off' },
            { label: 'Tool policy', value: toolPolicy },
          ].map(({ label, value, mono, title }) => (
            <div key={label} className="grid grid-cols-[140px_1fr] gap-2 items-start">
              <span className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>{label}</span>
              <span
                className="text-[11px] break-all"
                style={{
                  color: 'var(--ae-text)',
                  fontFamily: mono ? '"IBM Plex Mono", ui-monospace, monospace' : undefined,
                }}
                title={title}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceTab
// ---------------------------------------------------------------------------

interface WorkspaceTabProps {
  agent: AgentConfig;
}

interface EditorState {
  filename: string;
  content: string;
  original: string;
  saving: boolean;
  error: string | null;
}

function WorkspaceTab({ agent }: WorkspaceTabProps): React.JSX.Element {
  const workspacePath = agent.workspace;
  const [view, setView] = useState<'standard' | 'browse'>('standard');

  const [files, setFiles] = useState<AgentWorkspaceFileInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [memoryModalFiles, setMemoryModalFiles] = useState<string[] | null>(null);

  const fetchFiles = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        basePath + `/api/agents/workspace/files?workspacePath=${encodeURIComponent(workspacePath)}`,
      );
      const json = (await res.json()) as { data?: AgentWorkspaceFileInfo[]; error?: string };
      if (!res.ok) { setError(json.error ?? 'Failed to load files'); return; }
      setFiles(json.data ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => { void fetchFiles(); }, [fetchFiles]);

  async function openEditor(filename: string, existing: boolean): Promise<void> {
    if (!workspacePath) return;
    let content = '';
    if (existing) {
      try {
        const res = await fetch(
          basePath + `/api/agents/workspace/file?workspacePath=${encodeURIComponent(workspacePath)}&filename=${encodeURIComponent(filename)}`,
        );
        const json = (await res.json()) as { data?: { content: string }; error?: string };
        if (!res.ok) { alert(json.error ?? 'Failed to read file'); return; }
        content = json.data?.content ?? '';
      } catch (err) {
        alert(String(err)); return;
      }
    }
    setEditor({ filename, content, original: content, saving: false, error: null });
  }

  async function saveEditor(): Promise<void> {
    if (!editor || !workspacePath) return;
    setEditor((e) => e ? { ...e, saving: true, error: null } : e);
    try {
      const res = await fetch(basePath + '/api/agents/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, filename: editor.filename, content: editor.content }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setEditor((e) => e ? { ...e, saving: false, error: json.error ?? 'Save failed' } : e);
        return;
      }
      setEditor(null);
      void fetchFiles();
    } catch (err) {
      setEditor((e) => e ? { ...e, saving: false, error: String(err) } : e);
    }
  }

  async function deleteBootstrap(): Promise<void> {
    if (!workspacePath) return;
    try {
      const res = await fetch(
        basePath + `/api/agents/workspace/file?workspacePath=${encodeURIComponent(workspacePath)}&filename=BOOTSTRAP.md`,
        { method: 'DELETE' },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) { alert(json.error ?? 'Delete failed'); return; }
      setDeleteConfirm(false);
      void fetchFiles();
    } catch (err) {
      alert(String(err));
    }
  }

  if (!workspacePath) {
    return (
      <div className="p-4 text-[11px]" style={{ color: 'var(--ae-red)' }}>
        Workspace path not configured for this agent.
      </div>
    );
  }

  if (editor) {
    return (
      <div className="flex flex-col h-full">
        {/* Editor toolbar */}
        <div
          className="flex items-center gap-2 px-3 py-2 flex-shrink-0 text-[11px]"
          style={{ borderBottom: '1px solid var(--ae-border)' }}
        >
          <span style={{ color: 'var(--ae-text2)', flex: 1 }}>
            Editing <span style={{ color: 'var(--ae-text)', fontFamily: 'monospace' }}>{editor.filename}</span>
          </span>
          <button
            onClick={() => { void saveEditor(); }}
            disabled={editor.saving}
            className="disabled:opacity-50"
            style={{ ...INPUT_STYLE, background: 'var(--ae-amber)', color: 'var(--ae-void)', border: 'none', padding: '4px 12px', cursor: editor.saving ? 'wait' : 'pointer' }}
          >
            {editor.saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => {
              if (editor.content !== editor.original && !confirm('Discard unsaved changes?')) return;
              setEditor(null);
            }}
            style={{ ...INPUT_STYLE, padding: '4px 10px', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
        {editor.error && (
          <div className="px-3 py-2 text-[11px]" style={{ background: 'var(--ae-raised)', borderBottom: '1px solid var(--ae-border)', color: 'var(--ae-red)' }}>
            {editor.error}
          </div>
        )}
        <textarea
          value={editor.content}
          onChange={(e) => setEditor((prev) => prev ? { ...prev, content: e.target.value } : prev)}
          className="flex-1 resize-none p-4 text-[11px] focus:outline-none"
          style={{
            background: 'var(--ae-raised)',
            color: 'var(--ae-text)',
            fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
          }}
          spellCheck={false}
        />
      </div>
    );
  }

  const subTabBar = (
    <div className="flex gap-1 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--ae-border)' }}>
      {(['standard', 'browse'] as const).map((v) => (
        <button
          key={v}
          onClick={() => setView(v)}
          className="text-[10px] uppercase tracking-[0.08em]"
          style={{
            background: 'none',
            border: 'none',
            borderBottom: view === v ? '2px solid var(--ae-amber)' : '2px solid transparent',
            color: view === v ? 'var(--ae-amber)' : 'var(--ae-text2)',
            cursor: 'pointer',
            padding: '2px 8px 4px',
            fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
            fontSize: 10,
          }}
        >
          {v}
        </button>
      ))}
    </div>
  );

  if (view === 'browse') {
    return (
      <div className="flex flex-col h-full">
        {subTabBar}
        <div className="flex-1 min-h-0 overflow-hidden">
          <WorkspaceBrowsePanel agent={agent} />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        {subTabBar}
        <div className="p-4 space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-7 rounded" style={{ background: 'var(--ae-raised)' }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        {subTabBar}
        <div className="p-4 flex flex-col gap-2">
          <div className="text-[11px]" style={{ color: 'var(--ae-red)' }}>{error}</div>
          <button
            onClick={() => { void fetchFiles(); }}
            className="text-[11px] w-fit"
            style={{ color: 'var(--ae-amber)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const fileMap = new Map((files ?? []).map((f) => [f.name, f]));
  const bootstrapInfo = fileMap.get('BOOTSTRAP.md');

  return (
    <div className="flex flex-col h-full">
      {subTabBar}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {/* BOOTSTRAP.md warning */}
      {bootstrapInfo?.exists && (
        <div className="px-3 py-2 text-[11px] flex items-center justify-between gap-3" style={{ background: 'var(--ae-raised)', border: '1px solid var(--ae-warn)', color: 'var(--ae-warn)' }}>
          <span>BOOTSTRAP.md exists — this file should be deleted after the first-run ritual is complete.</span>
          <button
            onClick={() => setDeleteConfirm(true)}
            className="flex-shrink-0 text-[10px] uppercase tracking-[0.08em]"
            style={{ background: 'var(--ae-red)', color: 'white', border: 'none', cursor: 'pointer', padding: '3px 8px' }}
          >
            Delete
          </button>
        </div>
      )}

      {WORKSPACE_SECTIONS.map((section) => (
        <div key={section.label}>
          <div className="text-[10px] uppercase tracking-[0.12em] mb-2" style={{ color: 'var(--ae-text2)' }}>
            {section.label}
          </div>
          <div style={{ border: '1px solid var(--ae-border)' }}>
            {section.files.map((spec, idx) => {
              const info = fileMap.get(spec.name);
              const exists = info?.exists ?? false;
              const isLast = idx === section.files.length - 1;

              if (spec.isDirectory) {
                return (
                  <div
                    key={spec.name}
                    className="flex items-center gap-3 px-3 py-2 text-[11px]"
                    style={{
                      borderBottom: isLast ? undefined : '1px solid var(--ae-border)',
                      background: 'var(--ae-surface)',
                    }}
                  >
                    <span
                      className="font-mono w-32 flex-shrink-0"
                      style={{ color: 'var(--ae-amber)' }}
                    >
                      {spec.name}/
                    </span>
                    <span className="flex-1" style={{ color: 'var(--ae-text2)' }}>{spec.description}</span>
                    {exists ? (
                      <>
                        <span className="text-[10px]" style={{ color: 'var(--ae-text3)' }}>
                          {info?.fileCount ?? 0} files{info?.latestDate ? `, latest ${info.latestDate}` : ''}
                        </span>
                        {info?.files && (
                          <button
                            onClick={() => setMemoryModalFiles(info.files ?? [])}
                            className="text-[10px]"
                            style={{ color: 'var(--ae-amber)', background: 'none', border: 'none', cursor: 'pointer' }}
                          >
                            View list
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="text-[10px]" style={{ color: 'var(--ae-text3)' }}>Missing</span>
                    )}
                  </div>
                );
              }

              return (
                <div
                  key={spec.name}
                  className="flex items-center gap-3 px-3 py-2 text-[11px]"
                  style={{
                    borderBottom: isLast ? undefined : '1px solid var(--ae-border)',
                    background: 'var(--ae-surface)',
                  }}
                >
                  <span
                    className="font-mono w-32 flex-shrink-0"
                    style={{ color: exists ? 'var(--ae-text)' : 'var(--ae-text3)' }}
                  >
                    {spec.name}
                  </span>
                  <span className="flex-1" style={{ color: 'var(--ae-text2)' }}>{spec.description}</span>
                  {exists && info?.sizeChars !== undefined ? (
                    <>
                      <span
                        className="text-[10px] flex-shrink-0"
                        style={{ color: info.sizeChars >= CHAR_WARN_THRESHOLD ? 'var(--ae-warn)' : 'var(--ae-text3)' }}
                        title={info.sizeChars >= CHAR_WARN_THRESHOLD ? 'Large — may be truncated at 20k chars' : undefined}
                      >
                        {info.sizeChars.toLocaleString()} chars
                        {info.sizeChars >= CHAR_WARN_THRESHOLD ? ' ⚠' : ''}
                      </span>
                      <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--ae-text3)' }}>
                        {info.modifiedAt ? formatRelTime(info.modifiedAt) : ''}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--ae-text3)' }}>
                      {exists ? '' : 'Missing'}
                    </span>
                  )}
                  <button
                    onClick={() => { void openEditor(spec.name, exists); }}
                    className="text-[10px] flex-shrink-0"
                    style={{ color: 'var(--ae-amber)', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    {exists ? 'Edit' : 'Create'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Delete BOOTSTRAP.md confirmation modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
        >
          <div
            className="w-80 p-5 space-y-4"
            style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-border)' }}
          >
            <p className="text-[12px]" style={{ color: 'var(--ae-text)' }}>
              Delete BOOTSTRAP.md? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { void deleteBootstrap(); }}
                className="text-[11px]"
                style={{ background: 'var(--ae-red)', color: 'white', border: 'none', cursor: 'pointer', padding: '6px 16px' }}
              >
                Delete
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="text-[11px]"
                style={{ ...INPUT_STYLE, padding: '6px 16px', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Memory files modal */}
      {memoryModalFiles !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
        >
          <div
            className="w-96 max-h-[60vh] flex flex-col"
            style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-border)' }}
          >
            <div
              className="flex items-center justify-between px-4 py-3 text-[11px]"
              style={{ borderBottom: '1px solid var(--ae-border)' }}
            >
              <span style={{ color: 'var(--ae-text2)' }}>memory/ — {memoryModalFiles.length} files</span>
              <button
                onClick={() => setMemoryModalFiles(null)}
                style={{ color: 'var(--ae-text2)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                ✗
              </button>
            </div>
            <div className="overflow-y-auto p-3 space-y-1">
              {memoryModalFiles.length === 0 ? (
                <div className="text-[11px]" style={{ color: 'var(--ae-text3)' }}>No files.</div>
              ) : (
                memoryModalFiles.map((f) => (
                  <div key={f} className="text-[11px] font-mono" style={{ color: 'var(--ae-text2)' }}>{f}</div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceBrowsePanel
// ---------------------------------------------------------------------------

interface BrowseEditorState {
  relPath: string;
  content: string;
  original: string;
  saving: boolean;
  error: string | null;
}

function renderTreeNodes(
  nodes: WorkspaceTreeNode[],
  depth: number,
  expandedDirs: Set<string>,
  onToggle: (path: string) => void,
  onOpen: (path: string) => void,
): React.JSX.Element[] {
  return nodes.flatMap((node) => {
    const indent = depth * 14;
    if (node.type === 'directory') {
      const expanded = expandedDirs.has(node.path);
      return [
        <div
          key={node.path}
          className="flex items-center gap-1 py-[3px] text-[11px] cursor-pointer select-none"
          style={{ paddingLeft: 12 + indent }}
          onClick={() => onToggle(node.path)}
        >
          <span style={{ color: 'var(--ae-text3)', width: 10, flexShrink: 0 }}>{expanded ? '▼' : '▶'}</span>
          <span style={{ color: 'var(--ae-amber)', fontFamily: 'monospace' }}>{node.name}/</span>
        </div>,
        ...(expanded && node.children
          ? renderTreeNodes(node.children, depth + 1, expandedDirs, onToggle, onOpen)
          : []),
      ];
    }
    return [
      <div
        key={node.path}
        className="flex items-center gap-1 py-[3px] text-[11px] cursor-pointer"
        style={{ paddingLeft: 12 + indent }}
        onClick={() => onOpen(node.path)}
      >
        <span style={{ color: 'var(--ae-text3)', width: 10, flexShrink: 0 }}> </span>
        <span style={{ color: 'var(--ae-text)', fontFamily: 'monospace' }}>{node.name}</span>
      </div>,
    ];
  });
}

function WorkspaceBrowsePanel({ agent }: { agent: AgentConfig }): React.JSX.Element {
  const workspacePath = agent.workspace;

  const [treeData, setTreeData] = useState<WorkspaceTreeData | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [viewFile, setViewFile] = useState<{ relPath: string; content: string } | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [browseEditor, setBrowseEditor] = useState<BrowseEditorState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [newFileMode, setNewFileMode] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [previewMode, setPreviewMode] = useState(true);

  const fetchTree = useCallback(async () => {
    if (!workspacePath) return;
    setTreeLoading(true);
    setTreeError(null);
    try {
      const res = await fetch(
        basePath + `/api/agents/workspace/tree?workspacePath=${encodeURIComponent(workspacePath)}`,
      );
      const json = (await res.json()) as { data?: WorkspaceTreeData; error?: string };
      if (!res.ok) { setTreeError(json.error ?? 'Failed to load tree'); return; }
      setTreeData(json.data ?? { pinned: [], tree: [] });
    } catch (err) {
      setTreeError(String(err));
    } finally {
      setTreeLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => { void fetchTree(); }, [fetchTree]);

  // Debounced search
  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults(null); return; }
    const timer = setTimeout(() => {
      if (!workspacePath) return;
      setSearchLoading(true);
      fetch(
        basePath + `/api/agents/workspace/search?workspacePath=${encodeURIComponent(workspacePath)}&q=${encodeURIComponent(searchQuery)}`,
      )
        .then((res) => res.json() as Promise<{ data?: WorkspaceSearchResult[]; error?: string }>)
        .then((json) => { setSearchResults(json.data ?? []); })
        .catch(() => { setSearchResults([]); })
        .finally(() => { setSearchLoading(false); });
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, workspacePath]);

  async function openFile(relPath: string): Promise<void> {
    if (!workspacePath) return;
    setPreviewMode(true);
    setViewLoading(true);
    setViewFile(null);
    try {
      const res = await fetch(
        basePath + `/api/agents/workspace/browse?workspacePath=${encodeURIComponent(workspacePath)}&relPath=${encodeURIComponent(relPath)}`,
      );
      const json = (await res.json()) as { data?: { content: string }; error?: string };
      if (!res.ok) { alert(json.error ?? 'Failed to read file'); return; }
      setViewFile({ relPath, content: json.data?.content ?? '' });
    } catch (err) {
      alert(String(err));
    } finally {
      setViewLoading(false);
    }
  }

  async function saveBrowseFile(): Promise<void> {
    if (!browseEditor || !workspacePath) return;
    setBrowseEditor((e) => e ? { ...e, saving: true, error: null } : e);
    try {
      const res = await fetch(basePath + '/api/agents/workspace/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, relPath: browseEditor.relPath, content: browseEditor.content }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setBrowseEditor((e) => e ? { ...e, saving: false, error: json.error ?? 'Save failed' } : e);
        return;
      }
      const saved = { relPath: browseEditor.relPath, content: browseEditor.content };
      setBrowseEditor(null);
      setViewFile({ relPath: saved.relPath, content: saved.content });
      void fetchTree();
    } catch (err) {
      setBrowseEditor((e) => e ? { ...e, saving: false, error: String(err) } : e);
    }
  }

  async function deleteFile(relPath: string): Promise<void> {
    if (!workspacePath) return;
    try {
      const res = await fetch(
        basePath + `/api/agents/workspace/browse?workspacePath=${encodeURIComponent(workspacePath)}&relPath=${encodeURIComponent(relPath)}`,
        { method: 'DELETE' },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) { alert(json.error ?? 'Delete failed'); return; }
      setDeleteConfirm(null);
      setViewFile(null);
      void fetchTree();
    } catch (err) {
      alert(String(err));
    }
  }

  async function createFile(relPath: string): Promise<void> {
    if (!workspacePath || !relPath.trim()) return;
    const cleanPath = relPath.trim();
    try {
      const res = await fetch(basePath + '/api/agents/workspace/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, relPath: cleanPath, content: '' }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) { alert(json.error ?? 'Create failed'); return; }
      setNewFileMode(false);
      setNewFilePath('');
      void fetchTree();
      setBrowseEditor({ relPath: cleanPath, content: '', original: '', saving: false, error: null });
    } catch (err) {
      alert(String(err));
    }
  }

  function toggleDir(relPath: string): void {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }

  // Editor overlay
  if (browseEditor) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="flex items-center gap-2 px-3 py-2 flex-shrink-0 text-[11px]"
          style={{ borderBottom: '1px solid var(--ae-border)' }}
        >
          <span style={{ color: 'var(--ae-text2)', flex: 1 }}>
            Editing <span style={{ color: 'var(--ae-text)', fontFamily: 'monospace' }}>{browseEditor.relPath}</span>
          </span>
          <button
            onClick={() => { void saveBrowseFile(); }}
            disabled={browseEditor.saving}
            className="disabled:opacity-50"
            style={{ ...INPUT_STYLE, background: 'var(--ae-amber)', color: 'var(--ae-void)', border: 'none', padding: '4px 12px', cursor: browseEditor.saving ? 'wait' : 'pointer' }}
          >
            {browseEditor.saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => {
              if (browseEditor.content !== browseEditor.original && !confirm('Discard unsaved changes?')) return;
              setBrowseEditor(null);
            }}
            style={{ ...INPUT_STYLE, padding: '4px 10px', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
        {browseEditor.error && (
          <div className="px-3 py-2 text-[11px]" style={{ background: 'var(--ae-raised)', borderBottom: '1px solid var(--ae-border)', color: 'var(--ae-red)' }}>
            {browseEditor.error}
          </div>
        )}
        <textarea
          value={browseEditor.content}
          onChange={(e) => setBrowseEditor((prev) => prev ? { ...prev, content: e.target.value } : prev)}
          className="flex-1 resize-none p-4 text-[11px] focus:outline-none"
          style={{ background: 'var(--ae-raised)', color: 'var(--ae-text)', fontFamily: '"IBM Plex Mono", ui-monospace, monospace' }}
          spellCheck={false}
        />
      </div>
    );
  }

  // File viewer
  if (viewFile) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="flex items-center gap-2 px-3 py-2 flex-shrink-0 text-[11px]"
          style={{ borderBottom: '1px solid var(--ae-border)' }}
        >
          <button
            onClick={() => setViewFile(null)}
            style={{ color: 'var(--ae-amber)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'monospace' }}
          >
            ←
          </button>
          <span className="flex-1 font-mono" style={{ color: 'var(--ae-text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {viewFile.relPath}
          </span>
          {viewFile.relPath.endsWith('.md') && (
            <button
              onClick={() => setPreviewMode((p) => !p)}
              className="text-[10px]"
              style={{ color: 'var(--ae-cyan)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              {previewMode ? 'Raw' : 'Preview'}
            </button>
          )}
          <button
            onClick={() => setBrowseEditor({ relPath: viewFile.relPath, content: viewFile.content, original: viewFile.content, saving: false, error: null })}
            className="text-[10px]"
            style={{ color: 'var(--ae-amber)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Edit
          </button>
          <button
            onClick={() => setDeleteConfirm(viewFile.relPath)}
            className="text-[10px]"
            style={{ color: 'var(--ae-red)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Delete
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {viewFile.relPath.endsWith('.md') && previewMode ? (
            <div
              className="markdown-preview"
              dangerouslySetInnerHTML={{ __html: renderWorkspaceMarkdown(viewFile.content) }}
            />
          ) : (
            <pre
              className="text-[11px] whitespace-pre-wrap break-words"
              style={{ color: 'var(--ae-text)', fontFamily: '"IBM Plex Mono", ui-monospace, monospace' }}
            >
              {viewFile.content}
            </pre>
          )}
        </div>
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
            <div className="w-80 p-5 space-y-4" style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-border)' }}>
              <p className="text-[12px]" style={{ color: 'var(--ae-text)' }}>
                Delete <span className="font-mono">{deleteConfirm}</span>? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { void deleteFile(deleteConfirm); }}
                  className="text-[11px]"
                  style={{ background: 'var(--ae-red)', color: 'white', border: 'none', cursor: 'pointer', padding: '6px 16px' }}
                >
                  Delete
                </button>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="text-[11px]"
                  style={{ ...INPUT_STYLE, padding: '6px 16px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Main browse panel
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--ae-border)' }}>
        <input
          type="text"
          placeholder="Search workspace files…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full text-[11px]"
          style={{ ...INPUT_STYLE, width: '100%', padding: '4px 8px' }}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {searchQuery.length >= 2 ? (
          searchLoading ? (
            <div className="p-3 text-[11px]" style={{ color: 'var(--ae-text3)' }}>Searching…</div>
          ) : searchResults && searchResults.length === 0 ? (
            <div className="p-3 text-[11px]" style={{ color: 'var(--ae-text3)' }}>No matches.</div>
          ) : (
            <div>
              {(searchResults ?? []).map((r) => (
                <div
                  key={r.path}
                  className="px-3 py-2 cursor-pointer text-[11px]"
                  style={{ borderBottom: '1px solid var(--ae-border)' }}
                  onClick={() => { void openFile(r.path); }}
                >
                  <div className="font-mono" style={{ color: 'var(--ae-amber)' }}>{r.path}</div>
                  <div className="mt-1 truncate" style={{ color: 'var(--ae-text2)' }}>{r.excerpt}</div>
                  <div className="mt-[2px] text-[10px]" style={{ color: 'var(--ae-text3)' }}>
                    {r.matchCount} match{r.matchCount !== 1 ? 'es' : ''}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : treeLoading ? (
          <div className="p-3 space-y-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-6 rounded" style={{ background: 'var(--ae-raised)' }} />
            ))}
          </div>
        ) : treeError ? (
          <div className="p-3 flex flex-col gap-2">
            <div className="text-[11px]" style={{ color: 'var(--ae-red)' }}>{treeError}</div>
            <button
              onClick={() => { void fetchTree(); }}
              className="text-[11px] w-fit"
              style={{ color: 'var(--ae-amber)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="py-1">
            {(treeData?.pinned.length ?? 0) > 0 && (
              <>
                <div className="px-3 py-1 text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--ae-text3)' }}>
                  pinned
                </div>
                {renderTreeNodes(treeData!.pinned, 0, expandedDirs, toggleDir, (p) => { void openFile(p); })}
                <div className="my-1" style={{ borderTop: '1px solid var(--ae-border)' }} />
              </>
            )}
            {renderTreeNodes(treeData?.tree ?? [], 0, expandedDirs, toggleDir, (p) => { void openFile(p); })}
            {viewLoading && (
              <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--ae-text3)' }}>Loading…</div>
            )}
          </div>
        )}
      </div>

      <div className="px-3 py-2 flex-shrink-0" style={{ borderTop: '1px solid var(--ae-border)' }}>
        {newFileMode ? (
          <div className="flex gap-2 items-center">
            <input
              type="text"
              placeholder="path/to/new-file.md"
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { void createFile(newFilePath); }
                if (e.key === 'Escape') { setNewFileMode(false); setNewFilePath(''); }
              }}
              autoFocus
              className="flex-1 text-[11px]"
              style={{ ...INPUT_STYLE, padding: '3px 6px' }}
            />
            <button
              onClick={() => { void createFile(newFilePath); }}
              className="text-[10px]"
              style={{ ...INPUT_STYLE, background: 'var(--ae-amber)', color: 'var(--ae-void)', border: 'none', cursor: 'pointer', padding: '3px 8px' }}
            >
              Create
            </button>
            <button
              onClick={() => { setNewFileMode(false); setNewFilePath(''); }}
              className="text-[10px]"
              style={{ ...INPUT_STYLE, cursor: 'pointer', padding: '3px 8px' }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setNewFileMode(true)}
            className="text-[10px]"
            style={{ color: 'var(--ae-text2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            + New file
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionsTab
// ---------------------------------------------------------------------------

interface SessionsTabProps {
  agent: AgentConfig;
}

function deriveChannel(key: string): string {
  // key format: agent:<id>:<channel>:<type>:<peer>
  const parts = key.split(':');
  return parts[2] ?? key;
}

function SessionsTab({ agent }: SessionsTabProps): React.JSX.Element {
  const [data, setData] = useState<AgentSessionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [cleanupModal, setCleanupModal] = useState<{ items: unknown[]; raw: string | null } | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const loaded = useRef(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        basePath + `/api/agents/sessions?agentId=${encodeURIComponent(agent.id)}&activeMinutes=120`,
      );
      const json = (await res.json()) as { data?: AgentSessionsResult; error?: string };
      if (!res.ok) { setError(json.error ?? 'Failed to load sessions'); return; }
      setData(json.data ?? null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [agent.id]);

  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      void fetchSessions();
    }
  }, [fetchSessions]);

  async function previewCleanup(): Promise<void> {
    setCleanupLoading(true);
    try {
      const res = await fetch(
        basePath + `/api/agents/sessions/cleanup?agentId=${encodeURIComponent(agent.id)}`,
      );
      const json = (await res.json()) as { data?: { items: unknown[]; raw: string | null }; error?: string };
      if (!res.ok) { alert(json.error ?? 'Failed'); return; }
      setCleanupModal(json.data ?? { items: [], raw: null });
    } catch (err) {
      alert(String(err));
    } finally {
      setCleanupLoading(false);
    }
  }

  if (loading) {
    return <div className="p-4 text-[11px]" style={{ color: 'var(--ae-text3)' }}>Loading sessions…</div>;
  }

  if (error) {
    return (
      <div className="p-4 space-y-2">
        <div className="text-[11px]" style={{ color: 'var(--ae-red)' }}>{error}</div>
        <button onClick={() => { void fetchSessions(); }} className="text-[11px]" style={{ color: 'var(--ae-amber)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Retry</button>
      </div>
    );
  }

  const allSessions = data?.sessions ?? [];
  const shown = showAll ? allSessions : allSessions.slice(0, 20);

  return (
    <div className="p-4 space-y-4">
      {/* Summary */}
      <div className="text-[11px] flex flex-wrap gap-4" style={{ color: 'var(--ae-text2)' }}>
        <span>Total sessions: <span style={{ color: 'var(--ae-text)' }}>{allSessions.length}</span></span>
        <span>Active (last 2h): <span style={{ color: 'var(--ae-text)' }}>{data?.activeSessions.length ?? 0}</span></span>
        <span className="font-mono text-[10px]" style={{ color: 'var(--ae-text3)' }}>{data?.storePath ?? ''}</span>
      </div>

      {allSessions.length === 0 ? (
        <div className="text-[11px]" style={{ color: 'var(--ae-text3)' }}>No sessions found.</div>
      ) : (
        <>
          <div style={{ border: '1px solid var(--ae-border)' }}>
            {/* Header */}
            <div
              className="grid grid-cols-[1fr_200px_100px] px-3 py-1.5 text-[10px] uppercase tracking-[0.08em]"
              style={{ borderBottom: '1px solid var(--ae-border)', color: 'var(--ae-text2)', background: 'var(--ae-raised)' }}
            >
              <span>Key</span>
              <span>Model</span>
              <span>Channel</span>
            </div>
            {shown.map((s, i) => (
              <div
                key={s.key}
                className="grid grid-cols-[1fr_200px_100px] px-3 py-1.5 text-[11px] font-mono"
                style={{
                  borderBottom: i < shown.length - 1 ? '1px solid var(--ae-border)' : undefined,
                  background: s.active ? 'var(--ae-raised)' : 'var(--ae-surface)',
                  color: 'var(--ae-text)',
                }}
              >
                <span className="truncate text-[10px]" style={{ color: 'var(--ae-text2)' }} title={s.key}>{s.key}</span>
                <span className="truncate text-[10px]" style={{ color: 'var(--ae-text3)' }}>{s.model ?? '—'}</span>
                <span className="text-[10px]" style={{ color: 'var(--ae-text2)' }}>{deriveChannel(s.key)}</span>
              </div>
            ))}
          </div>
          {!showAll && allSessions.length > 20 && (
            <button
              onClick={() => setShowAll(true)}
              className="text-[11px]"
              style={{ color: 'var(--ae-amber)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Show all {allSessions.length} sessions
            </button>
          )}
        </>
      )}

      <button
        onClick={() => { void previewCleanup(); }}
        disabled={cleanupLoading}
        className="text-[11px] disabled:opacity-50"
        style={{ ...INPUT_STYLE, padding: '5px 12px', cursor: cleanupLoading ? 'wait' : 'pointer' }}
      >
        {cleanupLoading ? 'Loading…' : 'Preview cleanup'}
      </button>

      {/* Cleanup preview modal */}
      {cleanupModal !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
        >
          <div
            className="w-[640px] max-h-[70vh] flex flex-col"
            style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-border)' }}
          >
            <div
              className="flex items-center justify-between px-4 py-3 text-[11px]"
              style={{ borderBottom: '1px solid var(--ae-border)' }}
            >
              <span style={{ color: 'var(--ae-text)' }}>Cleanup dry run — {cleanupModal.items.length} items</span>
              <button onClick={() => setCleanupModal(null)} style={{ color: 'var(--ae-text2)', background: 'none', border: 'none', cursor: 'pointer' }}>✗</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {cleanupModal.items.length === 0 ? (
                <div className="p-4 text-[11px]" style={{ color: 'var(--ae-text3)' }}>
                  {cleanupModal.raw ?? 'Nothing to clean up.'}
                </div>
              ) : (
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--ae-border)', background: 'var(--ae-raised)' }}>
                      {['Action', 'Key', 'Age', 'Flags'].map((h) => (
                        <th key={h} className="text-left px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] font-normal" style={{ color: 'var(--ae-text2)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cleanupModal.items.map((item, i) => {
                      const r = item as Record<string, unknown>;
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--ae-border)', background: 'var(--ae-surface)' }}>
                          <td className="px-3 py-1.5" style={{ color: r['action'] === 'prune' ? 'var(--ae-red)' : 'var(--ae-green)' }}>{String(r['action'] ?? '')}</td>
                          <td className="px-3 py-1.5 font-mono text-[10px] truncate max-w-[280px]" style={{ color: 'var(--ae-text2)' }}>{String(r['key'] ?? '')}</td>
                          <td className="px-3 py-1.5 text-[10px]" style={{ color: 'var(--ae-text3)' }}>{String(r['age'] ?? '—')}</td>
                          <td className="px-3 py-1.5 text-[10px]" style={{ color: 'var(--ae-text3)' }}>{String(r['flags'] ?? '—')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div
              className="px-4 py-3 text-[10px]"
              style={{ borderTop: '1px solid var(--ae-border)', color: 'var(--ae-text2)', background: 'var(--ae-raised)' }}
            >
              This is a dry run. To enforce cleanup, run:{' '}
              <code className="font-mono" style={{ color: 'var(--ae-amber)' }}>
                openclaw sessions cleanup --agent {agent.id} --enforce
              </code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BindingsTab
// ---------------------------------------------------------------------------

interface BindingsTabProps {
  agent: AgentConfig;
  bindings: AgentBinding[];
}

function bindingSpecificity(b: AgentBinding): string {
  if (b.peer) return 'peer match';
  if (b.accountId && b.accountId !== '*') return 'account match';
  if (b.accountId === '*') return 'channel-wide fallback';
  return 'channel default';
}

function BindingsTab({ agent, bindings }: BindingsTabProps): React.JSX.Element {
  const agentBindings = bindings.filter((b) => !b.agentId || b.agentId === agent.id);

  if (agentBindings.length === 0) {
    return (
      <div className="p-4 space-y-4">
        <div className="px-3 py-2 text-[11px]" style={{ background: 'var(--ae-raised)', border: '1px solid var(--ae-border)', color: 'var(--ae-text2)' }}>
          No bindings configured — this agent receives messages via the default routing fallback.
        </div>
        <ReadonlyBindingCallout agentId={agent.id} />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div style={{ border: '1px solid var(--ae-border)' }}>
        <div
          className="grid grid-cols-4 px-3 py-1.5 text-[10px] uppercase tracking-[0.08em]"
          style={{ borderBottom: '1px solid var(--ae-border)', color: 'var(--ae-text2)', background: 'var(--ae-raised)' }}
        >
          <span>Channel</span>
          <span>Account</span>
          <span>Peer</span>
          <span>Specificity</span>
        </div>
        {agentBindings.map((b, i) => (
          <div
            key={i}
            className="grid grid-cols-4 px-3 py-1.5 text-[11px]"
            style={{ borderBottom: i < agentBindings.length - 1 ? '1px solid var(--ae-border)' : undefined, background: 'var(--ae-surface)' }}
          >
            <span style={{ color: 'var(--ae-text)' }}>{b.channel}</span>
            <span style={{ color: 'var(--ae-text2)' }}>{b.accountId ?? '—'}</span>
            <span className="font-mono text-[10px] truncate" style={{ color: 'var(--ae-text3)' }}>{b.peer ?? '—'}</span>
            <span style={{ color: 'var(--ae-text2)' }}>{bindingSpecificity(b)}</span>
          </div>
        ))}
      </div>
      <ReadonlyBindingCallout agentId={agent.id} />
    </div>
  );
}

function ReadonlyBindingCallout({ agentId }: { agentId: string }): React.JSX.Element {
  return (
    <div className="px-3 py-2 text-[11px] space-y-1" style={{ background: 'var(--ae-raised)', border: '1px solid var(--ae-border)', color: 'var(--ae-text2)' }}>
      <div>Bindings are managed in <code className="font-mono text-[10px]">openclaw.json</code> and require a gateway restart to take effect.</div>
      <div>CLI: <code className="font-mono text-[10px]" style={{ color: 'var(--ae-amber)' }}>openclaw agents bind --agent {agentId} --bind &lt;channel&gt;</code></div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModelsTab
// ---------------------------------------------------------------------------

interface ModelsTabProps {
  agent: AgentConfig;
}

function ModelsTab({ agent }: ModelsTabProps): React.JSX.Element {
  const [data, setData] = useState<AgentModelsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState(false);
  const [modelDraft, setModelDraft] = useState('');
  const [modelSaving, setModelSaving] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [allowlistWarn, setAllowlistWarn] = useState(false);
  const loaded = useRef(false);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        basePath + `/api/agents/models/status?agentId=${encodeURIComponent(agent.id)}`,
      );
      const json = (await res.json()) as { data?: AgentModelsStatus; error?: string };
      if (!res.ok) { setError(json.error ?? 'Failed to load models'); return; }
      setData(json.data ?? null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [agent.id]);

  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      void fetchModels();
    }
  }, [fetchModels]);

  function startEditModel(): void {
    setModelDraft(data?.primary ?? '');
    setModelError(null);
    setAllowlistWarn(false);
    setEditingModel(true);
  }

  function checkAllowlistWarn(value: string): void {
    if (!data?.allowlist || data.allowlist.length === 0) {
      setAllowlistWarn(false);
      return;
    }
    const inList = data.allowlist.some(
      (m) => m.ref === value || m.alias === value,
    );
    setAllowlistWarn(!inList);
  }

  async function applyModel(): Promise<void> {
    const ref = modelDraft.trim();
    if (!ref.includes('/')) {
      setModelError('Model ref must be in provider/model format (e.g. openrouter/kimi-k2)');
      return;
    }
    if (allowlistWarn) {
      const confirmed = confirm(
        'This model is not in the configured allowlist. The agent will reject it at runtime. Proceed anyway?',
      );
      if (!confirmed) return;
    }
    setModelSaving(true);
    setModelError(null);
    try {
      const res = await fetch(basePath + '/api/agents/models/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, modelRef: ref }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setModelError(json.error ?? 'Failed to set model');
        return;
      }
      setEditingModel(false);
      void fetchModels();
    } catch (err) {
      setModelError(String(err));
    } finally {
      setModelSaving(false);
    }
  }

  function authStatusColor(status: string): string {
    if (status === 'ok') return 'var(--ae-green)';
    if (status.includes('expir')) return 'var(--ae-warn)';
    return 'var(--ae-red)';
  }

  function authStatusIcon(status: string): string {
    if (status === 'ok') return '✓';
    if (status.includes('expir')) return '⚠';
    return '✗';
  }

  if (loading) {
    return <div className="p-4 text-[11px]" style={{ color: 'var(--ae-text3)' }}>Loading models…</div>;
  }

  if (error) {
    return (
      <div className="p-4 space-y-2">
        <div className="text-[11px]" style={{ color: 'var(--ae-red)' }}>{error}</div>
        <button onClick={() => { void fetchModels(); }} className="text-[11px]" style={{ color: 'var(--ae-amber)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Retry</button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      {/* Primary model */}
      <div style={{ border: '1px solid var(--ae-border)', background: 'var(--ae-surface)' }}>
        <div className="px-3 py-2 text-[10px] uppercase tracking-[0.12em]" style={{ borderBottom: '1px solid var(--ae-border)', color: 'var(--ae-text2)' }}>
          Primary model
        </div>
        <div className="px-3 py-3 space-y-2">
          {editingModel ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={modelDraft}
                  onChange={(e) => {
                    setModelDraft(e.target.value);
                    checkAllowlistWarn(e.target.value);
                  }}
                  placeholder="openrouter/provider/model"
                  style={{ ...INPUT_STYLE, width: 320 }}
                  onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
                  onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void applyModel();
                    if (e.key === 'Escape') setEditingModel(false);
                  }}
                />
                <button
                  onClick={() => { void applyModel(); }}
                  disabled={modelSaving}
                  className="disabled:opacity-50"
                  style={{ ...INPUT_STYLE, background: 'var(--ae-amber)', color: 'var(--ae-void)', border: 'none', padding: '3px 10px', cursor: modelSaving ? 'wait' : 'pointer' }}
                >
                  {modelSaving ? '…' : 'Apply'}
                </button>
                <button
                  onClick={() => setEditingModel(false)}
                  style={{ ...INPUT_STYLE, padding: '3px 8px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
              {allowlistWarn && (
                <div className="text-[10px]" style={{ color: 'var(--ae-warn)' }}>
                  ⚠ This model is not in the configured allowlist. The agent will reject it at runtime.
                </div>
              )}
              {modelError && (
                <div className="text-[10px]" style={{ color: 'var(--ae-red)' }}>{modelError}</div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px]" style={{ color: 'var(--ae-text)' }}>
                {data?.primary ?? '— (uses system default)'}
              </span>
              <button
                onClick={startEditModel}
                className="text-[10px]"
                style={{ color: 'var(--ae-amber)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Edit
              </button>
            </div>
          )}
          {data?.primary && (
            <div className="text-[10px]" style={{ color: 'var(--ae-text3)' }}>
              Provider: {data.primary.split('/')[0]}
            </div>
          )}
        </div>
        {(data?.fallbacks ?? []).length > 0 && (
          <div className="px-3 pb-3">
            <div className="text-[10px] mb-1" style={{ color: 'var(--ae-text2)' }}>Fallbacks</div>
            {(data?.fallbacks ?? []).map((f, i) => (
              <div key={i} className="text-[11px] font-mono" style={{ color: 'var(--ae-text3)' }}>
                {i + 1}. {f}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Supplemental models */}
      {(data?.imageModel ?? data?.imageGenerationModel) && (
        <div style={{ border: '1px solid var(--ae-border)', background: 'var(--ae-surface)' }}>
          <div className="px-3 py-2 text-[10px] uppercase tracking-[0.12em]" style={{ borderBottom: '1px solid var(--ae-border)', color: 'var(--ae-text2)' }}>
            Supplemental Models
          </div>
          <div className="px-3 py-3 space-y-2">
            <div className="grid grid-cols-[160px_1fr]">
              <span className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>Image model</span>
              <span className="text-[11px] font-mono" style={{ color: 'var(--ae-text)' }}>{data?.imageModel ?? '—'}</span>
            </div>
            <div className="grid grid-cols-[160px_1fr]">
              <span className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>Image generation model</span>
              <span className="text-[11px] font-mono" style={{ color: 'var(--ae-text)' }}>{data?.imageGenerationModel ?? '—'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Allowlist */}
      <div style={{ border: '1px solid var(--ae-border)', background: 'var(--ae-surface)' }}>
        <div className="px-3 py-2 text-[10px] uppercase tracking-[0.12em]" style={{ borderBottom: '1px solid var(--ae-border)', color: 'var(--ae-text2)' }}>
          Model Allowlist
        </div>
        <div className="px-3 py-3 space-y-2">
          {!data?.allowlist || data.allowlist.length === 0 ? (
            <div className="text-[11px]" style={{ color: 'var(--ae-text2)' }}>
              No allowlist configured — all models are available.
            </div>
          ) : (
            <>
              <div className="px-2 py-1.5 text-[10px]" style={{ background: 'var(--ae-raised)', border: '1px solid var(--ae-border)', color: 'var(--ae-text2)' }}>
                Only models in this list can be used by cron job payloads or selected via /model.
                A model absent from this list will silently fail to respond.
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--ae-border)' }}>
                    <th className="text-left py-1 pr-4 text-[10px] font-normal uppercase tracking-[0.08em]" style={{ color: 'var(--ae-text2)' }}>Ref</th>
                    <th className="text-left py-1 text-[10px] font-normal uppercase tracking-[0.08em]" style={{ color: 'var(--ae-text2)' }}>Alias</th>
                  </tr>
                </thead>
                <tbody>
                  {data.allowlist.map((m, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--ae-border)' }}>
                      <td className="py-1 pr-4 font-mono text-[10px]" style={{ color: 'var(--ae-text)' }}>{m.ref}</td>
                      <td className="py-1 text-[10px]" style={{ color: 'var(--ae-text3)' }}>{m.alias ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-[10px]" style={{ color: 'var(--ae-text3)' }}>
                To add a model: edit <code className="font-mono">agents.defaults.models</code> in{' '}
                <code className="font-mono">openclaw.json</code>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Auth status */}
      {data?.auth && data.auth.length > 0 && (
        <div style={{ border: '1px solid var(--ae-border)', background: 'var(--ae-surface)' }}>
          <div className="px-3 py-2 text-[10px] uppercase tracking-[0.12em]" style={{ borderBottom: '1px solid var(--ae-border)', color: 'var(--ae-text2)' }}>
            Provider Auth
          </div>
          <div className="px-3 py-3 space-y-1">
            {data.auth.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span style={{ color: authStatusColor(a.status), fontWeight: 'bold' }}>
                  {authStatusIcon(a.status)}
                </span>
                <span style={{ color: 'var(--ae-text)' }}>{a.provider}</span>
                {a.status !== 'ok' && (
                  <span style={{ color: authStatusColor(a.status) }}>{a.status}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentListSidebar
// ---------------------------------------------------------------------------

interface AgentListSidebarProps {
  agents: AgentConfig[];
  selectedId: string | null;
  agentStates: Map<string, { status: string }>;
  wsConnected: boolean;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

function AgentListSidebar({
  agents, selectedId, agentStates, wsConnected, loading, error, onSelect, onRetry,
}: AgentListSidebarProps): React.JSX.Element {
  const containerStyle: React.CSSProperties = {
    width: 200,
    flexShrink: 0,
    borderRight: '1px solid var(--ae-border)',
    background: 'var(--ae-void)',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  };

  if (loading) {
    return (
      <div style={containerStyle} className="p-3 space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-12 rounded" style={{ background: 'var(--ae-raised)' }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle} className="p-3 space-y-2">
        <div className="text-[10px]" style={{ color: 'var(--ae-red)' }}>{error}</div>
        <button
          onClick={onRetry}
          className="text-[10px]"
          style={{ color: 'var(--ae-amber)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div style={containerStyle} className="p-3">
        <div className="text-[10px]" style={{ color: 'var(--ae-text3)' }}>
          No agents configured. Check openclaw.json.
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {agents.map((agent) => {
        const isSelected = agent.id === selectedId;
        const state = agentStates.get(agent.id);
        const isActive = state?.status === 'ACTIVE';
        const presenceColor = !wsConnected ? 'var(--ae-text3)' : isActive ? 'var(--ae-green)' : 'var(--ae-text3)';
        const presenceTitle = !wsConnected ? 'Gateway disconnected — presence unknown' : isActive ? 'Active session' : 'No active session';

        return (
          <button
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            className="w-full text-left px-3 py-2.5"
            style={{
              background: isSelected ? 'var(--ae-raised)' : 'transparent',
              borderLeft: isSelected ? '2px solid var(--ae-amber)' : '2px solid transparent',
              borderBottom: '1px solid var(--ae-border)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--ae-surface)';
            }}
            onMouseLeave={(e) => {
              if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[14px]">{agentEmoji(agent)}</span>
              <span className="text-[11px] truncate" style={{ color: isSelected ? 'var(--ae-text)' : 'var(--ae-text2)' }}>
                {agentDisplayName(agent)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] flex-1 truncate" style={{ color: 'var(--ae-text3)' }}>
                {agent.id}
              </span>
              <span
                className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: presenceColor }}
                title={presenceTitle}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentDetail
// ---------------------------------------------------------------------------

interface AgentDetailProps {
  agent: AgentConfig;
  bindings: AgentBinding[];
  selectedTab: TabId;
  gatewayStatus: GatewayStatusResponse | null;
  gatewayLoading: boolean;
  onTabChange: (tab: TabId) => void;
  onIdentitySaved: () => void;
}

function AgentDetail({
  agent, bindings, selectedTab, gatewayStatus, gatewayLoading, onTabChange, onIdentitySaved,
}: AgentDetailProps): React.JSX.Element {
  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* Tab bar */}
      <div
        className="flex items-center px-3 pt-2 gap-0 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--ae-border)' }}
      >
        {TABS.map(({ id, label }) => {
          const isActive = id === selectedTab;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className="text-[11px] px-3 py-2"
              style={{
                color: isActive ? 'var(--ae-amber)' : 'var(--ae-text2)',
                borderTop: 'none',
                borderLeft: 'none',
                borderRight: 'none',
                borderBottom: isActive ? '2px solid var(--ae-amber)' : '2px solid transparent',
                background: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.color = 'var(--ae-text)';
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.color = 'var(--ae-text2)';
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {selectedTab === 'overview' && (
          <div className="flex-1 overflow-auto">
            <OverviewTab
              agent={agent}
              gatewayStatus={gatewayStatus}
              gatewayLoading={gatewayLoading}
              onIdentitySaved={onIdentitySaved}
            />
          </div>
        )}
        {selectedTab === 'workspace' && <WorkspaceTab agent={agent} />}
        {selectedTab === 'sessions' && <div className="flex-1 overflow-auto"><SessionsTab agent={agent} /></div>}
        {selectedTab === 'bindings' && <div className="flex-1 overflow-auto"><BindingsTab agent={agent} bindings={bindings} /></div>}
        {selectedTab === 'models' && <div className="flex-1 overflow-auto"><ModelsTab agent={agent} /></div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentsContent — main orchestrator (uses useSearchParams)
// ---------------------------------------------------------------------------

function AgentsContent(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [bindings, setBindings] = useState<AgentBinding[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatusResponse | null>(null);
  const [gatewayLoading, setGatewayLoading] = useState(true);

  const agentIdParam = searchParams.get('agent');
  const tabParam = (searchParams.get('tab') as TabId | null) ?? 'overview';
  const selectedTab: TabId = TABS.some((t) => t.id === tabParam) ? tabParam : 'overview';

  // Derive selected agent ID — URL param → default agent → first agent
  const [selectedId, setSelectedId] = useState<string | null>(agentIdParam ?? null);

  // Build a map of agent states from gateway status
  const agentStates = new Map(
    (gatewayStatus?.agentStates ?? []).map((s) => [s.agentId, s]),
  );
  const wsConnected = gatewayStatus?.status === 'connected';

  const fetchAgents = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const [agentsRes, bindingsRes] = await Promise.all([
        fetch(basePath + '/api/agents/list'),
        fetch(basePath + '/api/agents/bindings'),
      ]);
      const agentsJson = (await agentsRes.json()) as { data?: AgentConfig[]; error?: string };
      const bindingsJson = (await bindingsRes.json()) as { data?: AgentBinding[]; error?: string };

      if (!agentsRes.ok) {
        setAgentsError(agentsJson.error ?? 'Failed to load agents');
        return;
      }

      const loadedAgents = agentsJson.data ?? [];
      setAgents(loadedAgents);
      setBindings(bindingsJson.data ?? []);

      // Set default selection if not already set
      setSelectedId((prev) => {
        if (prev && loadedAgents.some((a) => a.id === prev)) return prev;
        const defaultAgent = loadedAgents.find((a) => a.id === DEFAULT_AGENT_ID)
          ?? loadedAgents.find((a) => a.default)
          ?? loadedAgents[0];
        return defaultAgent?.id ?? null;
      });
    } catch (err) {
      setAgentsError(String(err));
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  const fetchGatewayStatus = useCallback(async () => {
    setGatewayLoading(true);
    try {
      const res = await fetch(basePath + '/api/gateway/status');
      const json = (await res.json()) as { data?: GatewayStatusResponse };
      setGatewayStatus(json.data ?? null);
    } catch { /* silent */ } finally {
      setGatewayLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAgents();
    void fetchGatewayStatus();

    // Poll gateway status every 30s
    const timer = setInterval(() => { void fetchGatewayStatus(); }, 30_000);
    return () => clearInterval(timer);
  }, [fetchAgents, fetchGatewayStatus]);

  // Sync selected agent to URL
  function selectAgent(id: string): void {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set('agent', id);
    router.replace(`?${params.toString()}`);
  }

  // Sync selected tab to URL
  function selectTab(tab: TabId): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`?${params.toString()}`);
  }

  const selectedAgent = agents.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex flex-1 min-h-0" style={{ border: '1px solid var(--ae-border)' }}>
      {/* Mobile: dropdown agent selector (< 768px) */}
      <div className="md:hidden w-full absolute top-0 left-0 z-10 px-3 py-2" style={{ borderBottom: '1px solid var(--ae-border)', background: 'var(--ae-surface)' }}>
        <select
          value={selectedId ?? ''}
          onChange={(e) => selectAgent(e.target.value)}
          style={{ ...INPUT_STYLE, width: '100%' }}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {agentEmoji(a)} {agentDisplayName(a)} ({a.id})
            </option>
          ))}
        </select>
      </div>

      {/* Desktop: sidebar */}
      <div className="hidden md:flex">
        <AgentListSidebar
          agents={agents}
          selectedId={selectedId}
          agentStates={agentStates}
          wsConnected={wsConnected}
          loading={agentsLoading}
          error={agentsError}
          onSelect={selectAgent}
          onRetry={fetchAgents}
        />
      </div>

      {/* Detail panel */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {selectedAgent ? (
          <AgentDetail
            agent={selectedAgent}
            bindings={bindings}
            selectedTab={selectedTab}
            gatewayStatus={gatewayStatus}
            gatewayLoading={gatewayLoading}
            onTabChange={selectTab}
            onIdentitySaved={fetchAgents}
          />
        ) : agentsLoading ? (
          <div className="flex-1 flex items-center justify-center text-[11px]" style={{ color: 'var(--ae-text3)' }}>
            Loading…
          </div>
        ) : agents.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[11px]" style={{ color: 'var(--ae-text3)' }}>
            No agents configured. Check openclaw.json.
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[11px]" style={{ color: 'var(--ae-text3)' }}>
            Select an agent
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page shell — Suspense boundary required for useSearchParams
// ---------------------------------------------------------------------------

export default function AgentsPage(): React.JSX.Element {
  return (
    <ErrorBoundary label="Agents">
      <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
        {/* Page header */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h1
            className="text-[12px] tracking-[0.15em] uppercase"
            style={{ color: 'var(--ae-amber)' }}
          >
            Agents
          </h1>
        </div>

        {/* Main content */}
        <Suspense
          fallback={
            <div
              className="flex-1 flex items-center justify-center text-[11px]"
              style={{ color: 'var(--ae-text3)', border: '1px solid var(--ae-border)' }}
            >
              Loading…
            </div>
          }
        >
          <AgentsContent />
        </Suspense>
      </div>
    </ErrorBoundary>
  );
}
