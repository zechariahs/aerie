// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

import { ErrorBoundary } from '@/components/ui/error-boundary';
import { KanbanBoard } from '@/components/modules/tasks/kanban-board';

export default function TasksPage(): React.JSX.Element {
  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-white">Task Board</h1>
          <p className="text-xs text-[#6b7280] mt-0.5">
            Kanban board for dispatching work to agents
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ErrorBoundary label="Task Board">
          <KanbanBoard />
        </ErrorBoundary>
      </div>
    </div>
  );
}
