"use client";

import { addDays, formatWeekLabel, weekOf } from "@/lib/engine";

export function WeekPicker({
  weekOfISO,
  onChange,
  today,
}: {
  weekOfISO: string;
  onChange: (next: string) => void;
  today: string;
}) {
  const week = weekOf(weekOfISO);
  const thisWeek = weekOf(today);

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(addDays(week.week_start, -7))}
        className="rounded-lg border border-slate-line px-3 py-2 text-sm font-semibold"
      >
        ← Previous week
      </button>
      <button
        type="button"
        onClick={() => onChange(thisWeek.week_start)}
        className="rounded-lg border border-slate-line px-3 py-2 text-sm font-semibold"
      >
        This week
      </button>
      <button
        type="button"
        onClick={() => onChange(addDays(week.week_start, 7))}
        className="rounded-lg border border-slate-line px-3 py-2 text-sm font-semibold"
      >
        Next week →
      </button>
      <label className="ml-auto flex items-center gap-2 text-sm">
        <span className="field-label mb-0">Jump to</span>
        <input
          type="date"
          className="input w-auto"
          value={weekOfISO}
          onChange={(event) => {
            if (event.target.value !== "") onChange(event.target.value);
          }}
        />
      </label>
      <p className="w-full text-sm text-ink-soft" data-testid="week-label">
        {formatWeekLabel(week.week_start, week.week_end)}
      </p>
    </div>
  );
}
