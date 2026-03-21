// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Requires state for file selection, search, editor, and terminal

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { marked } from 'marked';
import type {
  WorkspaceTreeData,
  WorkspaceTreeNode,
  WorkspaceSearchResult,
  WorkspaceFile,
} from '@/types';

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
// File icon (text-based, no emoji for consistency)
// ---------------------------------------------------------------------------

function FileIcon({ name }: { name: string }): React.JSX.Element {
  const ext = fileExt(name);
  const cls =
    ext === 'md' ? 'text-blue-400' : ext === 'json' ? 'text-yellow-400' : 'text-gray-400';
  return <span className={`font-mono text-xs select-none ${cls}`}>[{ext || 'f'}]</span>;
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
}

function TreeNode({
  node,
  depth,
  selectedPath,
  expandedDirs,
  onSelect,
  onToggle,
}: TreeNodeProps): React.JSX.Element {
  const indent = depth * 12;
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = selectedPath === node.path;

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => onToggle(node.path)}
          style={{ paddingLeft: indent + 8 }}
          className="w-full text-left py-1 pr-2 text-xs text-[#9ca3af] hover:text-white flex items-center gap-1.5 transition-colors"
        >
          <span className="font-mono text-[10px] select-none">{isExpanded ? '▼' : '▶'}</span>
          <span className="font-mono text-[#6b7280] select-none">[dir]</span>
          {node.name}
        </button>
        {isExpanded && node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            expandedDirs={expandedDirs}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      style={{ paddingLeft: indent + 8 }}
      className={[
        'w-full text-left py-1 pr-2 text-xs flex items-center gap-1.5 transition-colors',
        isSelected
          ? 'text-white bg-[#1e1e2e]'
          : 'text-[#9ca3af] hover:text-white hover:bg-[#1a1a27]',
      ].join(' ')}
    >
      <FileIcon name={node.name} />
      {node.name}
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
      <div className="text-sm text-red-400 p-4">
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
        <div className="mb-4 px-3 py-2 bg-yellow-900/40 border border-yellow-700 rounded text-sm text-yellow-300">
          STALE — last heartbeat was {lastHeartbeat ? formatRelTime(lastHeartbeat) : 'unknown'}
        </div>
      )}
      <table className="w-full text-sm border-collapse">
        <tbody>
          {Object.entries(parsed).map(([key, value]) => (
            <tr key={key} className="border-b border-[#1e1e2e]">
              <td className="py-1.5 pr-4 font-mono text-[#9ca3af] text-xs w-48 align-top">{key}</td>
              <td className="py-1.5 text-white break-all align-top">
                {key === 'last_heartbeat' && typeof value === 'string' ? (
                  <span>
                    {value}
                    <span className="ml-2 text-[#6b7280] text-xs">({formatRelTime(value)})</span>
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
          if (/:$/.test(match)) return `<span style="color:#a5b4fc">${match}</span>`; // key
          return `<span style="color:#86efac">${match}</span>`; // string value
        }
        if (/true|false/.test(match)) return `<span style="color:#fcd34d">${match}</span>`;
        if (/null/.test(match)) return `<span style="color:#f87171">${match}</span>`;
        return `<span style="color:#67e8f9">${match}</span>`; // number
      },
    );

  return (
    <pre
      className="text-xs leading-relaxed overflow-auto p-4 h-full"
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

  async function handleSave(): Promise<void> {
    if (!totp.trim()) {
      setErrorMsg('TOTP token is required');
      return;
    }
    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await fetch('/api/workspace/session-state', {
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
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e1e2e]">
        <span className="text-xs text-[#6b7280] flex-1">Editing SESSION-STATE.md</span>
        <input
          type="text"
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
          placeholder="TOTP token"
          maxLength={6}
          className="w-24 px-2 py-1 text-xs font-mono bg-[#1e1e2e] border border-[#2d2d3e] rounded text-white placeholder-[#6b7280] focus:outline-none focus:border-[#6366f1]"
        />
        <button
          onClick={() => { void handleSave(); }}
          disabled={status === 'saving'}
          className="px-3 py-1 text-xs bg-[#6366f1] hover:bg-[#5254cc] disabled:opacity-50 text-white rounded transition-colors"
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : 'Save'}
        </button>
        <button
          onClick={onClose}
          className="px-2 py-1 text-xs text-[#6b7280] hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
      {errorMsg && (
        <div className="px-3 py-1.5 bg-red-900/30 text-red-400 text-xs border-b border-red-800">
          {errorMsg}
        </div>
      )}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="flex-1 resize-none bg-[#0f0f17] text-white font-mono text-xs p-4 focus:outline-none"
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
      <div className="flex items-center justify-center h-full text-[#6b7280] text-sm">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-400">Error: {error}</div>
    );
  }

  if (!file) {
    return (
      <div className="flex items-center justify-center h-full text-[#6b7280] text-sm">
        Select a file to preview
      </div>
    );
  }

  const isSessionState = file.path === 'SESSION-STATE.md';
  const isHeartbeat = file.path === 'heartbeat-state.json';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e1e2e] flex-shrink-0">
        <span className="text-xs text-[#9ca3af] font-mono flex-1 truncate">{file.path}</span>
        {isSessionState && (
          <button
            onClick={onEditSessionState}
            className="px-2 py-1 text-xs text-[#6366f1] hover:text-[#818cf8] border border-[#6366f1]/40 rounded transition-colors"
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
          <pre className="text-xs leading-relaxed overflow-auto p-4 whitespace-pre-wrap text-[#e2e8f0]">
            {file.content}
          </pre>
        ) : (
          <div className="p-4 text-sm text-[#6b7280]">Binary file — cannot preview</div>
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

  async function run(): Promise<void> {
    setLoading(true);
    setOutput('');
    try {
      const params = new URLSearchParams({ cmd });
      if (cmd === 'openclaw-cron-runs') params.set('cronId', cronId);
      const res = await fetch(`/api/workspace/terminal?${params.toString()}`);
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
    <div className="flex flex-col border-t border-[#1e1e2e]">
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
        <span className="text-xs text-[#6b7280] font-semibold uppercase tracking-wider">
          Terminal
        </span>
        <select
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          className="ml-auto text-xs bg-[#1e1e2e] border border-[#2d2d3e] text-white rounded px-2 py-1 focus:outline-none focus:border-[#6366f1]"
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
            className="text-xs bg-[#1e1e2e] border border-[#2d2d3e] text-white rounded px-2 py-1 focus:outline-none focus:border-[#6366f1]"
          >
            {CRON_IDS.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
            ))}
          </select>
        )}
        <button
          onClick={() => { void run(); }}
          disabled={loading}
          className="px-3 py-1 text-xs bg-[#1e1e2e] hover:bg-[#2d2d3e] disabled:opacity-50 text-white rounded border border-[#2d2d3e] transition-colors"
        >
          {loading ? 'Running…' : 'Run'}
        </button>
      </div>
      {output && (
        <pre className="text-xs font-mono text-[#e2e8f0] bg-[#0a0a0f] border-t border-[#1e1e2e] p-3 overflow-auto max-h-40 whitespace-pre-wrap">
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

  // Fetch file tree on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/workspace/tree');
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
      const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(filePath)}`);
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
            `/api/workspace/search?q=${encodeURIComponent(searchQuery.trim())}`,
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
        <h1 className="text-xl font-semibold text-white mb-3">Workspace &amp; Memory</h1>

        {/* Search bar */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workspace files (.md, .json)…"
            className="w-full px-3 py-2 text-sm bg-[#12121a] border border-[#1e1e2e] rounded text-white placeholder-[#6b7280] focus:outline-none focus:border-[#6366f1]"
          />
          {searchLoading && (
            <span className="absolute right-3 top-2.5 text-xs text-[#6b7280]">Searching…</span>
          )}

          {/* Search results dropdown */}
          {searchResults !== null && searchQuery.trim().length >= 2 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-[#12121a] border border-[#1e1e2e] rounded shadow-xl max-h-64 overflow-y-auto">
              {searchResults.length === 0 ? (
                <div className="p-3 text-sm text-[#6b7280]">No results</div>
              ) : (
                searchResults.map((r) => (
                  <button
                    key={r.path}
                    onClick={() => handleSearchResultClick(r)}
                    className="w-full text-left px-3 py-2.5 hover:bg-[#1e1e2e] border-b border-[#1a1a27] last:border-0"
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-[#818cf8]">{r.path}</span>
                      <span className="text-[10px] text-[#6b7280]">
                        {r.matchCount} match{r.matchCount !== 1 ? 'es' : ''}
                      </span>
                    </div>
                    <div className="text-xs text-[#9ca3af] truncate">{r.excerpt}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Two-pane layout */}
      <div className="flex-1 flex min-h-0 border border-[#1e1e2e] rounded overflow-hidden">
        {/* Left: file tree */}
        <div className="w-56 flex-shrink-0 border-r border-[#1e1e2e] overflow-y-auto bg-[#0f0f17]">
          {treeLoading ? (
            <div className="p-3 text-xs text-[#6b7280]">Loading…</div>
          ) : treeError ? (
            <div className="p-3 text-xs text-red-400">{treeError}</div>
          ) : (
            <>
              {/* Pinned section */}
              {(treeData?.pinned.length ?? 0) > 0 && (
                <div>
                  <div className="px-3 pt-3 pb-1 text-[10px] font-semibold text-[#6b7280] uppercase tracking-widest">
                    Pinned
                  </div>
                  {treeData?.pinned.map((node) => (
                    <button
                      key={node.path}
                      onClick={() => handleSelectFile(node.path)}
                      className={[
                        'w-full text-left px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors',
                        selectedPath === node.path
                          ? 'text-white bg-[#1e1e2e]'
                          : PINNED_NAMES.has(node.name)
                            ? 'text-[#a5b4fc] hover:text-white hover:bg-[#1a1a27]'
                            : 'text-[#9ca3af] hover:text-white hover:bg-[#1a1a27]',
                      ].join(' ')}
                    >
                      <FileIcon name={node.name} />
                      {node.name}
                    </button>
                  ))}
                  <div className="border-b border-[#1e1e2e] my-1" />
                </div>
              )}

              {/* Regular tree */}
              {(treeData?.tree.length ?? 0) === 0 && (treeData?.pinned.length ?? 0) === 0 ? (
                <div className="p-3 text-xs text-[#6b7280]">
                  Workspace empty or unavailable
                </div>
              ) : (
                treeData?.tree.map((node) => (
                  <TreeNode
                    key={node.path}
                    node={node}
                    depth={0}
                    selectedPath={selectedPath}
                    expandedDirs={expandedDirs}
                    onSelect={handleSelectFile}
                    onToggle={handleToggleDir}
                  />
                ))
              )}
            </>
          )}
        </div>

        {/* Right: preview pane */}
        <div className="flex-1 min-w-0 bg-[#0c0c14] overflow-hidden flex flex-col">
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

      {/* Terminal panel */}
      <div className="flex-shrink-0 mt-3 border border-[#1e1e2e] rounded overflow-hidden bg-[#0f0f17]">
        <TerminalPanel />
      </div>
    </div>
  );
}
