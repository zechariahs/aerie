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

const PRIORITY_COLORS: Record<string, string> = {
  P1: 'bg-red-500',
  P2: 'bg-orange-400',
  P3: 'bg-blue-500',
  P4: 'bg-[#4b5563]',
};

const TAG_COLORS: Record<string, string> = {
  STG: 'bg-purple-900/60 text-purple-300',
  Personal: 'bg-teal-900/60 text-teal-300',
  CW: 'bg-yellow-900/60 text-yellow-300',
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
          className={[
            'p-3 rounded border cursor-pointer transition-colors select-none',
            snapshot.isDragging
              ? 'border-[#3b82f6] bg-[#1a1f3a] shadow-lg'
              : isSelected
                ? 'border-[#3b82f6] bg-[#161625]'
                : 'border-[#1e1e2e] bg-[#12121a] hover:border-[#374151]',
          ].join(' ')}
        >
          <div className="flex items-start gap-2">
            {/* Priority dot */}
            <span
              className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${priorityColor}`}
              title={task.priority}
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white leading-snug line-clamp-2">{task.title}</p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {task.tag && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TAG_COLORS[task.tag] ?? 'bg-[#1e1e2e] text-[#6b7280]'}`}>
                    {task.tag}
                  </span>
                )}
                {task.assigned_agent && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e1e2e] text-[#6b7280]">
                    {task.assigned_agent}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}
