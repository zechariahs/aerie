// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// TODO(session-7): wire to real Gateway SSE and OpenRouter balance once WebSocket bridge is built
export function StatusStrip(): React.JSX.Element {
  return (
    <div className="h-8 border-b border-[#1e1e2e] bg-[#12121a] flex items-center px-4 gap-4 text-xs text-[#6b7280]">
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-600 inline-block" />
        Gateway: offline
      </span>
      <span className="ml-auto font-mono">
        {new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour12: false })} CT
      </span>
    </div>
  );
}
