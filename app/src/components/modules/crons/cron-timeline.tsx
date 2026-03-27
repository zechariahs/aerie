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
        void narrow2idx;
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

function pillStyle(job: CronJob, isSelected: boolean): React.CSSProperties {
  if (job.status === 'disabled') {
    return {
      background: 'transparent',
      border: isSelected ? '1px solid var(--ae-amber)' : '1px solid var(--ae-border)',
      color: isSelected ? 'var(--ae-amber)' : 'var(--ae-text3)',
    };
  }
  // active or running
  return {
    background: isSelected ? 'var(--ae-amber-dim)' : 'var(--ae-amber-faint)',
    border: isSelected ? '1px solid var(--ae-amber)' : '1px solid var(--ae-amber-dim)',
    color: isSelected ? 'var(--ae-amber-bright)' : 'var(--ae-amber)',
  };
}

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

  const navBtnStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono), "IBM Plex Mono", ui-monospace, monospace',
    background: 'transparent',
    border: '1px solid var(--ae-border-hi)',
    color: 'var(--ae-text2)',
    fontSize: '10px',
    letterSpacing: '0.06em',
    padding: '3px 8px',
    cursor: 'pointer',
  };

  return (
    <div style={{ background: 'var(--ae-void)', border: '1px solid var(--ae-border)' }}>
      {/* Header row */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--ae-border)' }}
      >
        <span className="ae-section-label">── Weekly Schedule ──────────────────</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px]" style={{ color: 'var(--ae-text2)' }}>{weekLabel}</span>
          <button
            style={navBtnStyle}
            onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(d.getDate() - 7); return n; })}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text2)'; }}
          >
            ‹
          </button>
          <button
            style={navBtnStyle}
            onClick={() => setWeekStart(getMondayOf(new Date()))}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text2)'; }}
          >
            Today
          </button>
          <button
            style={navBtnStyle}
            onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(d.getDate() + 7); return n; })}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ae-text2)'; }}
          >
            ›
          </button>
        </div>
      </div>

      {/* Day columns */}
      <div className="grid grid-cols-7" style={{ borderBottom: '1px solid var(--ae-border)' }}>
        {DAYS.map((day, i) => {
          const isToday = dates[i] === todayIso;
          const dateNum = dates[i]
            ? new Date(dates[i]! + 'T12:00:00').getDate()
            : '';
          return (
            <div
              key={day}
              className="min-h-[120px]"
              style={{ borderRight: i < 6 ? '1px solid var(--ae-border)' : undefined }}
            >
              <div
                className="px-2 py-2 text-center"
                style={{
                  borderBottom: '1px solid var(--ae-border)',
                  background: isToday ? 'var(--ae-raised)' : 'transparent',
                }}
              >
                <div
                  className="text-[11px] font-medium"
                  style={{ color: isToday ? 'var(--ae-amber)' : 'var(--ae-text2)' }}
                >
                  {day}
                </div>
                <div
                  className="text-[11px] mt-0.5"
                  style={{
                    color: isToday ? 'var(--ae-amber)' : 'var(--ae-text3)',
                    fontWeight: isToday ? '600' : undefined,
                  }}
                >
                  {dateNum}
                </div>
              </div>
              <div className="p-1 space-y-1">
                {(pillsByDay[i] ?? []).map((pill) => (
                  <button
                    key={pill.job.id}
                    onClick={() => onSelect(pill.job.id)}
                    title={`${pill.job.name} — ${formatMinuteOfDay(pill.minuteOfDay)}`}
                    className="w-full text-left px-1.5 py-1 text-[10px] truncate transition-all"
                    style={pillStyle(pill.job, selectedId === pill.job.id)}
                    onMouseEnter={(e) => {
                      if (selectedId !== pill.job.id) {
                        (e.currentTarget as HTMLElement).style.filter = 'brightness(1.2)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.filter = '';
                    }}
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
