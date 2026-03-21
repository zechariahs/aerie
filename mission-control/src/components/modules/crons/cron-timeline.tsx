// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// 'use client' — uses event handlers and useState
'use client';

import { useState } from 'react';
import { CronExpressionParser } from 'cron-parser';
import type { CronJob } from '@/types';

const TZ = 'America/Chicago';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface CronPill {
  job: CronJob;
  /** Minutes from midnight (Chicago) for this scheduled occurrence */
  minuteOfDay: number;
}

/** Returns the Monday (midnight Chicago-ish, UTC-based) of the week containing date. */
function getMondayOf(date: Date): Date {
  const d = new Date(date);
  // getDay: 0=Sun..6=Sat. We want Mon=0 offset.
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatMinuteOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Determines which columns (Mon–Sun) a cron fires on within the given week,
 * and the scheduled minute-of-day (Chicago time) for each occurrence.
 */
function buildWeekColumns(
  jobs: CronJob[],
  weekStart: Date,
): { dates: string[]; pillsByDay: CronPill[][] } {
  // Build ISO date string for each column
  const dates: string[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return toIsoDate(d);
  });

  const pillsByDay: CronPill[][] = Array.from({ length: 7 }, () => []);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  for (const job of jobs) {
    try {
      // Start the iterator one millisecond before the week so the first .next()
      // lands on or after the Monday start.
      const startPoint = new Date(weekStart.getTime() - 1);
      const expr = CronExpressionParser.parse(job.schedule, {
        tz: TZ,
        currentDate: startPoint,
      });

      // Guard against infinite loops — at most 14 iterations per job per week
      const seenDays = new Set<number>();
      for (let guard = 0; guard < 14; guard++) {
        const cronDate = expr.next();
        const occurrence = cronDate.toDate();
        if (occurrence >= weekEnd) break;

        // Resolve the column index (0=Mon…6=Sun) from the occurrence's local day
        const localDay = occurrence.toLocaleDateString('en-US', {
          timeZone: TZ,
          weekday: 'narrow',
        });
        // Map narrow weekday → column index
        const narrow2idx: Record<string, number> = {
          M: 0, T: 1, W: 2, // Mon, Tue, Wed — Tue/Thu collision handled below
          F: 4, S: 5,       // Fri, Sat — Sun handled below
        };
        // We need to compare full day strings to disambiguate Tue/Thu, Sat/Sun
        const fullDay = occurrence.toLocaleDateString('en-US', {
          timeZone: TZ,
          weekday: 'long',
        });
        const dayMap: Record<string, number> = {
          Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3,
          Friday: 4, Saturday: 5, Sunday: 6,
        };
        const _ = localDay; void _;  // suppress unused var
        const colIndex = dayMap[fullDay] ?? -1;
        if (colIndex === -1 || seenDays.has(colIndex)) continue;
        seenDays.add(colIndex);

        const localHHMM = occurrence.toLocaleTimeString('en-US', {
          timeZone: TZ,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        const parts = localHHMM.split(':');
        const minuteOfDay = parseInt(parts[0] ?? '0', 10) * 60 + parseInt(parts[1] ?? '0', 10);

        pillsByDay[colIndex]?.push({ job, minuteOfDay });
      }
    } catch {
      // Skip jobs with unparseable cron expressions
    }
  }

  // Sort each column by scheduled time ascending
  for (const col of pillsByDay) {
    col.sort((a, b) => a.minuteOfDay - b.minuteOfDay);
  }

  return { dates, pillsByDay };
}

const STATUS_PILL: Record<CronJob['status'], string> = {
  active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  disabled: 'bg-[#1e1e2e] text-[#6b7280] border-[#2e2e3e]',
  running: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
};

interface CronTimelineProps {
  jobs: CronJob[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

export default function CronTimeline({ jobs, selectedId, onSelect }: CronTimelineProps): React.JSX.Element {
  const today = new Date();
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOf(today));

  const { dates, pillsByDay } = buildWeekColumns(jobs, weekStart);

  const weekLabel = (() => {
    const end = new Date(weekStart);
    end.setDate(weekStart.getDate() + 6);
    const fmt = (d: Date): string =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(weekStart)} – ${fmt(end)}`;
  })();

  const todayIso = toIsoDate(today);

  return (
    <div className="bg-[#12121a] border border-[#1e1e2e] rounded-lg overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e]">
        <span className="text-white font-medium text-sm">Weekly Schedule</span>
        <div className="flex items-center gap-2">
          <span className="text-[#6b7280] text-xs">{weekLabel}</span>
          <button
            onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(d.getDate() - 7); return n; })}
            className="px-2 py-1 text-xs text-[#6b7280] hover:text-white border border-[#1e1e2e] rounded hover:border-[#3f3f5a] transition-colors"
          >
            ‹
          </button>
          <button
            onClick={() => setWeekStart(getMondayOf(new Date()))}
            className="px-2 py-1 text-xs text-[#6b7280] hover:text-white border border-[#1e1e2e] rounded hover:border-[#3f3f5a] transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(d.getDate() + 7); return n; })}
            className="px-2 py-1 text-xs text-[#6b7280] hover:text-white border border-[#1e1e2e] rounded hover:border-[#3f3f5a] transition-colors"
          >
            ›
          </button>
        </div>
      </div>

      {/* Day columns */}
      <div className="grid grid-cols-7 divide-x divide-[#1e1e2e]">
        {DAYS.map((day, i) => {
          const isToday = dates[i] === todayIso;
          const dateNum = dates[i]
            ? new Date(dates[i]! + 'T12:00:00').getDate()
            : '';
          return (
            <div key={day} className="min-h-[120px]">
              <div className={`px-2 py-2 text-center border-b border-[#1e1e2e] ${isToday ? 'bg-[#6366f1]/10' : ''}`}>
                <div className={`text-[11px] font-medium ${isToday ? 'text-[#6366f1]' : 'text-[#6b7280]'}`}>{day}</div>
                <div className={`text-[11px] mt-0.5 ${isToday ? 'text-white font-semibold' : 'text-[#4b5563]'}`}>
                  {dateNum}
                </div>
              </div>
              <div className="p-1 space-y-1">
                {(pillsByDay[i] ?? []).map((pill) => (
                  <button
                    key={pill.job.id}
                    onClick={() => onSelect(pill.job.id)}
                    title={`${pill.job.name} — ${formatMinuteOfDay(pill.minuteOfDay)}`}
                    className={`w-full text-left px-1.5 py-1 rounded border text-[10px] truncate transition-all ${STATUS_PILL[pill.job.status]} ${
                      selectedId === pill.job.id
                        ? 'ring-1 ring-[#6366f1] ring-offset-1 ring-offset-[#12121a]'
                        : 'hover:brightness-125'
                    }`}
                  >
                    <div className="font-medium truncate leading-tight">{pill.job.name}</div>
                    <div className="opacity-70 leading-tight">{formatMinuteOfDay(pill.minuteOfDay)}</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
