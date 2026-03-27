// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Requires state for file selection, search, editor, and terminal

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { marked } from 'marked';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import type {
  WorkspaceTreeData,
  WorkspaceTreeNode,
  WorkspaceSearchResult,
  WorkspaceFile,
} from '@/types';
import { basePath } from '@/lib/client-url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PINNED_NAMES = new Set([
  'SOUL.md',
  'MEMORY.md',
  'IDENTITY.md',
  'TOOLS.md',
  'AGENTS.md',
  'SESSION-STATE.md',
  'heartbeat-state.json',
]);

/** Commands shown in the terminal dropdown. */
const TERMINAL_CMDS: { key: string; label: string }[] = [
  { key: 'df-h', label: 'df -h — disk usage' },
  { key: 'free-m', label: 'free -m — memory' },
  { key: 'uptime', label: 'uptime' },
  { key: 'openclaw-cron-list', label: 'openclaw cron list' },
];

/** Known cron IDs for the openclaw-cron-runs dropdown. */
const CRON_IDS = [
  { id: '51d8a322', name: 'heartbeat' },
  { id: '76114cf6', name: 'reddit-signal-scan' },
  { id: 'bb9599ba', name: 'reddit-engagement-brief' },
  { id: 'aec5f855', name: 'weekly-research-digest' },
  { id: '63530884', name: 'competitor-changelog-monitor' },
  { id: '19f6e1bd', name: 'competitor-review-scrape' },
];

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function formatRelTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ${m}m ago`;
  return `${m}m ago`;
}

// ---------------------------------------------------------------------------
// File icon — ae- amber badge style
// ---------------------------------------------------------------------------

function FileIcon({ name }: { name: string }): React.JSX.Element {
  const ext = fileExt(name);
  return (
    <span
      className="font-mono text-[10px] select-none px-1"
      style={{
        color: 'var(--ae-amber)',
        border: '1px solid var(--ae-amber-dim)',
        flexShrink: 0,
      }}
    >
      {ext || 'f'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// File tree node (recursive)
// ---------------------------------------------------------------------------

interface TreeNodeProps {
  node: WorkspaceTreeNode;
  depth: number;
  selectedPath: string | null;
  expandedDirs: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  isLast?: boolean;
}

function TreeNode({
  node,
  depth,
  selectedPath,
  expandedDirs,
  onSelect,
  onToggle,
  isLast = false,
}: TreeNodeProps): React.JSX.Element {
  const indent = depth * 12;
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = selectedPath === node.path;
  const connector = depth > 0 ? (isLast ? '└── ' : '├── ') : '';

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => onToggle(node.path)}
          style={{ paddingLeft: indent + 8 }}
          className="w-full text-left py-1 pr-2 text-[11px] flex items-center gap-1.5"
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text2)'; }}
        >
          <span style={{ color: 'var(--ae-text3)', whiteSpace: 'pre' }}>{connector}</span>
          <span
            className="font-mono text-[10px] select-none px-1"
            style={{ color: 'var(--ae-amber)', border: '1px solid var(--ae-amber-dim)', flexShrink: 0 }}
          >
            dir
          </span>
          <span style={{ color: 'var(--ae-text2)' }}>
            {isExpanded ? '▼ ' : '▶ '}{node.name}
          </span>
        </button>
        {isExpanded && node.children?.map((child, i) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            expandedDirs={expandedDirs}
            onSelect={onSelect}
            onToggle={onToggle}
            isLast={i === (node.children!.length - 1)}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      style={{
        paddingLeft: indent + 8,
        background: isSelected ? 'var(--ae-raised)' : 'transparent',
        borderLeft: isSelected ? '2px solid var(--ae-amber)' : '2px solid transparent',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        textAlign: 'left',
        paddingTop: 4,
        paddingBottom: 4,
        paddingRight: 8,
      }}
      onMouseEnter={(e) => {
        if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--ae-surface)';
      }}
      onMouseLeave={(e) => {
        if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      <span style={{ color: 'var(--ae-text3)', whiteSpace: 'pre', fontSize: 11 }}>{connector}</span>
      <FileIcon name={node.name} />
      <span className="text-[11px]" style={{ color: isSelected ? 'var(--ae-text)' : 'var(--ae-text2)' }}>{node.name}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Heartbeat state panel
// ---------------------------------------------------------------------------

function HeartbeatView({ content }: { content: string }): React.JSX.Element {
  let parsed: Record<string, unknown> = {};
  let parseError = false;

  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    parseError = true;
  }

  if (parseError) {
    return (
      <div className="text-[11px] p-4" style={{ color: 'var(--ae-red)' }}>
        Failed to parse heartbeat-state.json as JSON.
      </div>
    );
  }

  const lastHeartbeat = typeof parsed['last_heartbeat'] === 'string' ? parsed['last_heartbeat'] : null;
  const isStale = lastHeartbeat
    ? Date.now() - new Date(lastHeartbeat).getTime() > 6 * 3_600_000
    : false;

  return (
    <div className="p-4">
      {isStale && (
        <div className="mb-4 px-3 py-2 text-[11px]" style={{ background: 'var(--ae-warn-dim)', border: '1px solid var(--ae-warn)', color: 'var(--ae-warn)' }}>
          STALE — last heartbeat was {lastHeartbeat ? formatRelTime(lastHeartbeat) : 'unknown'}
        </div>
      )}
      <table className="w-full border-collapse">
        <tbody>
          {Object.entries(parsed).map(([key, value]) => (
            <tr key={key} style={{ borderBottom: '1px solid var(--ae-border)' }}>
              <td className="py-1.5 pr-4 text-[11px] w-48 align-top" style={{ color: 'var(--ae-text2)' }}>{key}</td>
              <td className="py-1.5 text-[11px] break-all align-top" style={{ color: 'var(--ae-text)' }}>
                {key === 'last_heartbeat' && typeof value === 'string' ? (
                  <span>
                    {value}
                    <span className="ml-2 text-[10px]" style={{ color: 'var(--ae-text3)' }}>({formatRelTime(value)})</span>
                  </span>
                ) : (
                  String(value)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON preview with basic token coloring
// ---------------------------------------------------------------------------

function JsonPreview({ content }: { content: string }): React.JSX.Element {
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    formatted = content;
  }

  // Simple token colorizer: strings, numbers, booleans, null, keys
  const colorized = formatted
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        if (/^"/.test(match)) {
          if (/:$/.test(match)) return `<span style="color:#C8890A">${match}</span>`; // key — amber
          return `<span style="color:#1E9050">${match}</span>`; // string value — green
        }
        if (/true|false/.test(match)) return `<span style="color:#A86020">${match}</span>`; // warn
        if (/null/.test(match)) return `<span style="color:#A83030">${match}</span>`; // red
        return `<span style="color:#3A8080">${match}</span>`; // number — cyan
      },
    );

  return (
    <pre
      className="text-[11px] leading-relaxed overflow-auto p-4 h-full"
      style={{ color: 'var(--ae-text)' }}
      dangerouslySetInnerHTML={{ __html: colorized }}
    />
  );
}

// ---------------------------------------------------------------------------
// SESSION-STATE.md editor
// ---------------------------------------------------------------------------

interface SessionStateEditorProps {
  content: string;
  onClose: () => void;
  onSaved: (newContent: string) => void;
}

function SessionStateEditor({ content, onClose, onSaved }: SessionStateEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState(content);
  const [totp, setTotp] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const inputStyle: React.CSSProperties = {
    background: 'var(--ae-raised)',
    border: '1px solid var(--ae-border)',
    color: 'var(--ae-text)',
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: 11,
    padding: '3px 6px',
    outline: 'none',
  };

  async function handleSave(): Promise<void> {
    if (!totp.trim()) {
      setErrorMsg('TOTP token is required');
      return;
    }
    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await fetch(basePath + '/api/workspace/session-state', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-TOTP-Token': totp.trim(),
        },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setErrorMsg(json.error ?? 'Save failed');
        setStatus('error');
        return;
      }
      setStatus('saved');
      onSaved(draft);
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setErrorMsg('Network error');
      setStatus('error');
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--ae-border)' }}>
        <span className="text-[11px] flex-1" style={{ color: 'var(--ae-text2)' }}>Editing SESSION-STATE.md</span>
        <input
          type="text"
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
          placeholder="TOTP"
          maxLength={6}
          style={{ ...inputStyle, width: 80, textAlign: 'center' }}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
        />
        <button
          onClick={() => { void handleSave(); }}
          disabled={status === 'saving'}
          className="text-[10px] uppercase tracking-[0.08em] disabled:opacity-50"
          style={{
            padding: '4px 10px',
            background: 'var(--ae-amber)',
            border: 'none',
            color: 'var(--ae-void)',
          }}
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : 'Save'}
        </button>
        <button
          onClick={onClose}
          className="text-[11px]"
          style={{ color: 'var(--ae-text2)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
      {errorMsg && (
        <div className="px-3 py-1.5 text-[11px]" style={{ background: 'var(--ae-red-dim)', borderBottom: '1px solid var(--ae-red)', color: 'var(--ae-red)' }}>
          {errorMsg}
        </div>
      )}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="flex-1 resize-none p-4 focus:outline-none text-[11px]"
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

// ---------------------------------------------------------------------------
// Preview pane
// ---------------------------------------------------------------------------

interface PreviewPaneProps {
  file: WorkspaceFile | null;
  loading: boolean;
  error: string | null;
  onEditSessionState: () => void;
  isEditing: boolean;
  editContent: string;
  onCloseEdit: () => void;
  onSaved: (content: string) => void;
}

function PreviewPane({
  file,
  loading,
  error,
  onEditSessionState,
  isEditing,
  editContent,
  onCloseEdit,
  onSaved,
}: PreviewPaneProps): React.JSX.Element {
  if (isEditing) {
    return (
      <SessionStateEditor content={editContent} onClose={onCloseEdit} onSaved={onSaved} />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[11px]" style={{ color: 'var(--ae-text2)' }}>
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-[11px]" style={{ color: 'var(--ae-red)' }}>Error: {error}</div>
    );
  }

  if (!file) {
    return (
      <div className="flex items-center justify-center h-full text-[11px]" style={{ color: 'var(--ae-text2)' }}>
        Select a file to preview
      </div>
    );
  }

  const isSessionState = file.path === 'SESSION-STATE.md';
  const isHeartbeat = file.path === 'heartbeat-state.json';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--ae-border)' }}>
        <span className="text-[11px] flex-1 truncate" style={{ color: 'var(--ae-text2)' }}>{file.path}</span>
        {isSessionState && (
          <button
            onClick={onEditSessionState}
            className="text-[10px] uppercase tracking-[0.08em]"
            style={{
              padding: '3px 8px',
              background: 'transparent',
              border: '1px solid var(--ae-amber-dim)',
              color: 'var(--ae-amber)',
            }}
          >
            Edit
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {isHeartbeat ? (
          <HeartbeatView content={file.content} />
        ) : file.ext === 'md' ? (
          <div
            className="markdown-preview p-4"
            dangerouslySetInnerHTML={{ __html: marked.parse(file.content) as string }}
          />
        ) : file.ext === 'json' ? (
          <JsonPreview content={file.content} />
        ) : file.ext === 'txt' || file.ext === '' ? (
          <pre className="text-[11px] leading-relaxed overflow-auto p-4 whitespace-pre-wrap" style={{ color: 'var(--ae-text)' }}>
            {file.content}
          </pre>
        ) : (
          <div className="p-4 text-[11px]" style={{ color: 'var(--ae-text2)' }}>Binary file — cannot preview</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminal panel
// ---------------------------------------------------------------------------

function TerminalPanel(): React.JSX.Element {
  const [cmd, setCmd] = useState('df-h');
  const [cronId, setCronId] = useState(CRON_IDS[0]?.id ?? '');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  const selectStyle: React.CSSProperties = {
    background: 'var(--ae-raised)',
    border: '1px solid var(--ae-border)',
    color: 'var(--ae-text)',
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: 11,
    padding: '3px 6px',
    outline: 'none',
  };

  async function run(): Promise<void> {
    setLoading(true);
    setOutput('');
    try {
      const params = new URLSearchParams({ cmd });
      if (cmd === 'openclaw-cron-runs') params.set('cronId', cronId);
      const res = await fetch(`${basePath}/api/workspace/terminal?${params.toString()}`);
      const json = (await res.json()) as { data?: { output: string }; error?: string };
      if (!res.ok) {
        setOutput(`Error: ${json.error ?? 'unknown'}`);
      } else {
        setOutput(json.data?.output ?? '(no output)');
      }
    } catch {
      setOutput('Network error — could not reach terminal endpoint');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col" style={{ borderTop: '1px solid var(--ae-border)' }}>
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
        <span className="ae-section-label">── Terminal ──────────────────</span>
        <select
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          style={{ ...selectStyle, marginLeft: 'auto' }}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
        >
          {TERMINAL_CMDS.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
          <option value="openclaw-cron-runs">openclaw cron runs --id …</option>
        </select>
        {cmd === 'openclaw-cron-runs' && (
          <select
            value={cronId}
            onChange={(e) => setCronId(e.target.value)}
            style={selectStyle}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
          >
            {CRON_IDS.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
            ))}
          </select>
        )}
        <button
          onClick={() => { void run(); }}
          disabled={loading}
          className="text-[10px] uppercase tracking-[0.08em] disabled:opacity-50"
          style={{
            padding: '4px 10px',
            background: 'transparent',
            border: '1px solid var(--ae-border-hi)',
            color: 'var(--ae-text2)',
          }}
        >
          {loading ? 'Running…' : 'Run'}
        </button>
      </div>
      {output && (
        <pre className="text-[11px] p-3 overflow-auto max-h-40 whitespace-pre-wrap" style={{ color: 'var(--ae-text)', background: 'var(--ae-void)', borderTop: '1px solid var(--ae-border)' }}>
          {output}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function WorkspacePage(): React.JSX.Element {
  const [treeData, setTreeData] = useState<WorkspaceTreeData | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<WorkspaceFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Mobile file tree drawer state
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);

  // Fetch file tree on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(basePath + '/api/workspace/tree');
        if (!res.ok) throw new Error('Failed to load file tree');
        const json = (await res.json()) as { data: WorkspaceTreeData; error?: string };
        setTreeData(json.data);
      } catch (err) {
        setTreeError(String(err));
      } finally {
        setTreeLoading(false);
      }
    })();
  }, []);

  // Fetch file when selectedPath changes
  const fetchFile = useCallback(async (filePath: string) => {
    setFileLoading(true);
    setFileError(null);
    setIsEditing(false);
    try {
      const res = await fetch(`${basePath}/api/workspace/file?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? 'Failed to load file');
      }
      const json = (await res.json()) as { data: WorkspaceFile };
      setCurrentFile(json.data);
    } catch (err) {
      setFileError(String(err));
      setCurrentFile(null);
    } finally {
      setFileLoading(false);
    }
  }, []);

  function handleSelectFile(filePath: string): void {
    setSelectedPath(filePath);
    void fetchFile(filePath);
    setSearchResults(null);
    setSearchQuery('');
  }

  function handleToggleDir(dirPath: string): void {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }

  // Debounced search
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);

    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults(null);
      return;
    }

    searchDebounce.current = setTimeout(() => {
      void (async () => {
        setSearchLoading(true);
        try {
          const res = await fetch(
            `${basePath}/api/workspace/search?q=${encodeURIComponent(searchQuery.trim())}`,
          );
          if (!res.ok) throw new Error('Search failed');
          const json = (await res.json()) as { data: WorkspaceSearchResult[] };
          setSearchResults(json.data);
        } catch {
          setSearchResults([]);
        } finally {
          setSearchLoading(false);
        }
      })();
    }, 300);

    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [searchQuery]);

  function handleSearchResultClick(result: WorkspaceSearchResult): void {
    setSearchQuery('');
    setSearchResults(null);
    handleSelectFile(result.path);
  }

  function handleEditSessionState(): void {
    if (currentFile) {
      setEditContent(currentFile.content);
      setIsEditing(true);
    }
  }

  function handleEditClose(): void {
    setIsEditing(false);
  }

  function handleEditSaved(newContent: string): void {
    if (currentFile) {
      setCurrentFile({ ...currentFile, content: newContent });
    }
    setIsEditing(false);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 mb-3">
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-[14px] font-medium flex-1" style={{ color: 'var(--ae-text)' }}>Workspace &amp; Memory</h1>
          {/* Files button — only visible on mobile */}
          <button
            onClick={() => setMobileTreeOpen(true)}
            className="md:hidden text-[10px] uppercase tracking-[0.08em]"
            style={{
              padding: '4px 10px',
              background: 'transparent',
              border: '1px solid var(--ae-border-hi)',
              color: 'var(--ae-text2)',
            }}
          >
            Files
          </button>
        </div>

        {/* Search bar */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workspace files (.md, .json)…"
            className="w-full px-3 py-2 text-[11px] focus:outline-none"
            style={{
              background: 'var(--ae-raised)',
              border: '1px solid var(--ae-border)',
              color: 'var(--ae-text)',
              fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
            }}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-amber)'; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ae-border)'; }}
          />
          {/* Placeholder color via CSS injection for this specific input */}
          <style>{`input::placeholder { color: var(--ae-text3) !important; }`}</style>
          {searchLoading && (
            <span className="absolute right-3 top-2.5 text-[10px]" style={{ color: 'var(--ae-text3)' }}>Searching…</span>
          )}

          {/* Search results dropdown */}
          {searchResults !== null && searchQuery.trim().length >= 2 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto" style={{ background: 'var(--ae-surface)', border: '1px solid var(--ae-border)' }}>
              {searchResults.length === 0 ? (
                <div className="p-3 text-[11px]" style={{ color: 'var(--ae-text2)' }}>No results</div>
              ) : (
                searchResults.map((r) => (
                  <button
                    key={r.path}
                    onClick={() => handleSearchResultClick(r)}
                    className="w-full text-left px-3 py-2.5"
                    style={{ borderBottom: '1px solid var(--ae-border)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--ae-raised)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[11px]" style={{ color: 'var(--ae-cyan)' }}>{r.path}</span>
                      <span className="text-[10px]" style={{ color: 'var(--ae-text3)' }}>
                        {r.matchCount} match{r.matchCount !== 1 ? 'es' : ''}
                      </span>
                    </div>
                    <div className="text-[10px] truncate" style={{ color: 'var(--ae-text2)' }}>{r.excerpt}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile file tree overlay */}
      {mobileTreeOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setMobileTreeOpen(false)}
          />
          <div className="md:hidden fixed top-0 left-0 z-50 h-full w-64 overflow-y-auto" style={{ background: 'var(--ae-void)', borderRight: '1px solid var(--ae-border)' }}>
            <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--ae-border)' }}>
              <span className="ae-section-label">── Files ──────────────</span>
              <button onClick={() => setMobileTreeOpen(false)} style={{ color: 'var(--ae-text2)', background: 'none', border: 'none', cursor: 'pointer' }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.293 3.293a1 1 0 011.414 0L8 6.586l3.293-3.293a1 1 0 011.414 1.414L9.414 8l3.293 3.293a1 1 0 01-1.414 1.414L8 9.414l-3.293 3.293a1 1 0 01-1.414-1.414L6.586 8 3.293 4.707a1 1 0 010-1.414z" />
                </svg>
              </button>
            </div>
            {treeLoading ? (
              <div className="p-3 text-[11px]" style={{ color: 'var(--ae-text2)' }}>Loading…</div>
            ) : treeError ? (
              <div className="p-3 text-[11px]" style={{ color: 'var(--ae-red)' }}>{treeError}</div>
            ) : (
              treeData?.pinned.concat(treeData.tree).map((node) => (
                <button
                  key={node.path}
                  onClick={() => { handleSelectFile(node.path); setMobileTreeOpen(false); }}
                  className="w-full text-left px-3 py-2 text-[11px] flex items-center gap-1.5"
                  style={{
                    borderBottom: '1px solid var(--ae-border)',
                    background: selectedPath === node.path ? 'var(--ae-raised)' : 'transparent',
                    borderLeft: selectedPath === node.path ? '2px solid var(--ae-amber)' : '2px solid transparent',
                    color: selectedPath === node.path ? 'var(--ae-text)' : 'var(--ae-text2)',
                  }}
                >
                  <FileIcon name={node.name} />
                  {node.name}
                </button>
              ))
            )}
          </div>
        </>
      )}

      {/* Two-pane layout */}
      <ErrorBoundary label="File Browser">
      <div className="flex-1 flex min-h-0 overflow-hidden" style={{ border: '1px solid var(--ae-border)' }}>
        {/* Left: file tree — hidden on mobile, visible on md+ */}
        <div className="hidden md:block w-56 flex-shrink-0 overflow-y-auto" style={{ borderRight: '1px solid var(--ae-border)', background: 'var(--ae-void)' }}>
          {treeLoading ? (
            <div className="p-3 text-[11px]" style={{ color: 'var(--ae-text2)' }}>Loading…</div>
          ) : treeError ? (
            <div className="p-3 text-[11px]" style={{ color: 'var(--ae-red)' }}>{treeError}</div>
          ) : (
            <>
              {/* Pinned section */}
              {(treeData?.pinned.length ?? 0) > 0 && (
                <div>
                  <div className="px-3 pt-3 pb-1">
                    <span className="ae-section-label">── Pinned ─────</span>
                  </div>
                  {treeData?.pinned.map((node) => (
                    <button
                      key={node.path}
                      onClick={() => handleSelectFile(node.path)}
                      className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-1.5"
                      style={{
                        background: selectedPath === node.path ? 'var(--ae-raised)' : 'transparent',
                        borderLeft: selectedPath === node.path ? '2px solid var(--ae-amber)' : '2px solid transparent',
                        color: selectedPath === node.path
                          ? 'var(--ae-text)'
                          : PINNED_NAMES.has(node.name)
                            ? 'var(--ae-text)'
                            : 'var(--ae-text2)',
                      }}
                      onMouseEnter={(e) => {
                        if (selectedPath !== node.path) (e.currentTarget as HTMLElement).style.background = 'var(--ae-surface)';
                      }}
                      onMouseLeave={(e) => {
                        if (selectedPath !== node.path) (e.currentTarget as HTMLElement).style.background = 'transparent';
                      }}
                    >
                      <FileIcon name={node.name} />
                      {node.name}
                    </button>
                  ))}
                  <div className="my-1" style={{ borderBottom: '1px solid var(--ae-border)' }} />
                </div>
              )}

              {/* Regular tree */}
              {(treeData?.tree.length ?? 0) === 0 && (treeData?.pinned.length ?? 0) === 0 ? (
                <div className="p-3 text-[11px]" style={{ color: 'var(--ae-text2)' }}>
                  Workspace empty or unavailable
                </div>
              ) : (
                treeData?.tree.map((node, i) => (
                  <TreeNode
                    key={node.path}
                    node={node}
                    depth={0}
                    selectedPath={selectedPath}
                    expandedDirs={expandedDirs}
                    onSelect={handleSelectFile}
                    onToggle={handleToggleDir}
                    isLast={i === (treeData!.tree.length - 1)}
                  />
                ))
              )}
            </>
          )}
        </div>

        {/* Right: preview pane */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col" style={{ background: 'var(--ae-surface)' }}>
          <PreviewPane
            file={currentFile}
            loading={fileLoading}
            error={fileError}
            onEditSessionState={handleEditSessionState}
            isEditing={isEditing}
            editContent={editContent}
            onCloseEdit={handleEditClose}
            onSaved={handleEditSaved}
          />
        </div>
      </div>
      </ErrorBoundary>

      {/* Terminal panel */}
      <ErrorBoundary label="Terminal">
        <div className="flex-shrink-0 mt-3 overflow-hidden" style={{ border: '1px solid var(--ae-border)', background: 'var(--ae-void)' }}>
          <TerminalPanel />
        </div>
      </ErrorBoundary>
    </div>
  );
}
