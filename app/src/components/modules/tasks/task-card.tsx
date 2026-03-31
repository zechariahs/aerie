// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client';

import { Draggable } from '@hello-pangea/dnd';
import type { Task } from '@/types';

interface TaskCardProps {
  task: Task;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}

// Priority indicator colors using ae- hex palette
const PRIORITY_COLORS: Record<string, string> = {
  P1: '#A83030', // ae-red
  P2: '#A86020', // ae-warn
  P3: '#3A8080', // ae-cyan
  P4: '#363430', // ae-text3
};

// Tag badges use ae-badge classes but with override colors for distinction
const TAG_BADGE_STYLE: Record<string, React.CSSProperties> = {
  Work:     { color: 'var(--ae-amber)', borderColor: 'var(--ae-amber-dim)' },
  Personal: { color: 'var(--ae-cyan)',  borderColor: 'var(--ae-cyan)' },
  Other:    { color: 'var(--ae-text2)', borderColor: 'var(--ae-border-hi)' },
};

/**
 * Draggable Kanban card representing a single task.
 */
export function TaskCard({ task, index, isSelected, onClick }: TaskCardProps): React.JSX.Element {
  const priorityColor = PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS['P4']!;

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={onClick}
          className="relative p-3 cursor-pointer select-none"
          style={{
            background: snapshot.isDragging
              ? 'var(--ae-raised)'
              : isSelected
                ? 'var(--ae-raised)'
                : 'var(--ae-surface)',
            border: snapshot.isDragging
              ? '1px solid var(--ae-amber)'
              : isSelected
                ? '1px solid var(--ae-amber)'
                : '1px solid var(--ae-border)',
          }}
        >
          {/* Corner brackets */}
          <div className="absolute top-[-1px] left-[-1px] w-2 h-2" style={{ borderTop: '1px solid var(--ae-amber-dim)', borderLeft: '1px solid var(--ae-amber-dim)' }} />
          <div className="absolute top-[-1px] right-[-1px] w-2 h-2" style={{ borderTop: '1px solid var(--ae-amber-dim)', borderRight: '1px solid var(--ae-amber-dim)' }} />
          <div className="absolute bottom-[-1px] left-[-1px] w-2 h-2" style={{ borderBottom: '1px solid var(--ae-amber-dim)', borderLeft: '1px solid var(--ae-amber-dim)' }} />
          <div className="absolute bottom-[-1px] right-[-1px] w-2 h-2" style={{ borderBottom: '1px solid var(--ae-amber-dim)', borderRight: '1px solid var(--ae-amber-dim)' }} />

          <div className="flex items-start gap-2">
            {/* Priority dot */}
            <span
              className="mt-1 flex-shrink-0 w-2 h-2"
              style={{ background: priorityColor }}
              title={task.priority}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] leading-snug line-clamp-2" style={{ color: 'var(--ae-text)' }}>{task.title}</p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {task.tag && (
                  <span
                    className="ae-badge"
                    style={TAG_BADGE_STYLE[task.tag] ?? { color: 'var(--ae-text2)', borderColor: 'var(--ae-border-hi)' }}
                  >
                    {task.tag}
                  </span>
                )}
                {task.assigned_agent && (
                  <span className="ae-badge ae-badge-off">
                    {task.assigned_agent}
                  </span>
                )}
                {task.capability_tier === 'reasoning' && (
                  <span className="ae-badge ae-badge-warn">reasoning</span>
                )}
                {task.capability_tier === 'fast' && (
                  <span className="ae-badge ae-badge-off">fast</span>
                )}
                {task.capability_tier === 'auto' && (
                  <span className="ae-badge ae-badge-off" style={{ fontStyle: 'italic' }}>auto</span>
                )}
                {task.source === 'agent' && (
                  <span className="ae-badge" style={{ color: 'var(--ae-cyan)', borderColor: 'var(--ae-cyan)' }}>[agent]</span>
                )}
                {task.source === 'api' && (
                  <span className="ae-badge ae-badge-off">[api]</span>
                )}
              </div>
            </div>
          </div>
          {task.clarification_state === 'pending_board' && (
            <span
              className="absolute top-1 right-1 text-[9px] animate-pulse"
              style={{ color: 'var(--ae-warn)' }}
              role="img"
              aria-label="Clarification needed"
              title="Clarification needed"
            >?</span>
          )}
        </div>
      )}
    </Draggable>
  );
}
