"use client";

import { useEffect, useState } from "react";

import { SyntheticBadge } from "@/components/SyntheticBadge";
import { WeekPicker } from "@/components/WeekPicker";
import { formatLongDate, formatWeekLabel, weekOf } from "@/lib/engine";
import { ENTRY_KINDS } from "@/lib/types";
import { useApp } from "@/lib/store";
import type { WeeklySummary } from "@/lib/types";

export default function ReportPage() {
  const { weeklyReport, today, mock, entries } = useApp();
  const [weekOfISO, setWeekOfISO] = useState(today);
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    weeklyReport(weekOfISO)
      .then((next) => {
        if (!cancelled) {
          setSummary(next);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weekOfISO, weeklyReport]);

  const week = weekOf(weekOfISO);

  return (
    <div>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold">Weekly report</h2>
        <button
          type="button"
          onClick={() => window.print()}
          className="no-print rounded-lg border border-leaf px-4 py-2 font-semibold text-leaf"
        >
          Print this page
        </button>
      </header>

      <div className="print-only">
        <h1 className="text-lg font-bold">FieldTalk weekly report</h1>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {formatWeekLabel(week.week_start, week.week_end)} · computed by code on{" "}
        {formatLongDate(today)} from {entries.length} stored entries
        {summary?.synthetic ? " · synthetic demo data" : ""}
      </p>
      {mock ? (
        <p className="mt-1 text-sm">
          <SyntheticBadge />
        </p>
      ) : null}

      <div className="mt-3">
        <WeekPicker weekOfISO={weekOfISO} onChange={setWeekOfISO} today={today} />
      </div>

      {loading ? <p className="mt-4 text-ink-soft">Computing…</p> : null}
      {error !== null ? (
        <p className="mt-4 rounded-lg border border-alert bg-alert-soft px-3 py-2 text-sm text-alert">
          {error}
        </p>
      ) : null}

      {summary !== null && !loading ? (
        <div className="mt-4 space-y-4">
          <section className="card p-3 print-avoid-break">
            <h3 className="text-lg font-bold">Entries this week</h3>
            <p className="text-sm text-ink-soft">
              {summary.total_entries} entries across {summary.plots_touched.length} plots.
            </p>
            <table className="mt-2 w-full text-left text-sm">
              <caption className="sr-only">Counts of entries by kind for this week</caption>
              <thead>
                <tr className="border-b border-slate-line">
                  <th scope="col" className="py-1 pr-2 font-semibold">
                    Kind
                  </th>
                  <th scope="col" className="py-1 font-semibold">
                    Count
                  </th>
                </tr>
              </thead>
              <tbody>
                {ENTRY_KINDS.map((kind) => (
                  <tr key={kind} className="border-b border-slate-line/60">
                    <td className="py-1 pr-2">{kind}</td>
                    <td className="py-1 tabular-nums">{summary.counts_by_kind[kind]}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-1 pr-2 font-semibold">total</td>
                  <td className="py-1 font-semibold tabular-nums">{summary.total_entries}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="card p-3 print-avoid-break">
            <h3 className="text-lg font-bold">Plots touched</h3>
            {summary.plots_touched.length === 0 ? (
              <p className="text-sm text-ink-soft">No plots were noted this week.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {summary.plots_touched.map((touch) => (
                  <li key={touch.plot} className="flex flex-wrap gap-2">
                    <span className="font-semibold">{touch.plot}</span>
                    <span className="tabular-nums">{touch.entries} entries</span>
                    <span className="text-ink-soft">({touch.kinds.join(", ")})</span>
                    <span className="text-ink-soft">last on {formatLongDate(touch.latest_date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-3 print-avoid-break">
            <h3 className="text-lg font-bold">Issues</h3>
            <h4 className="mt-1 text-sm font-semibold">Opened this week</h4>
            <IssueList issues={summary.issues_opened} empty="No issues opened this week." />
            <h4 className="mt-2 text-sm font-semibold">Closed this week</h4>
            <IssueList
              issues={summary.issues_closed}
              empty="No issues closed this week (closed = an action entry after the issue on the same plot)."
            />
            <h4 className="mt-2 text-sm font-semibold">Still open (all time)</h4>
            <IssueList issues={summary.open_issues} empty="No open issues." />
          </section>

          <section className="card p-3 print-avoid-break">
            <h3 className="text-lg font-bold">When each plot was last noted</h3>
            {summary.last_note_by_plot.length === 0 ? (
              <p className="text-sm text-ink-soft">No plots yet.</p>
            ) : (
              <table className="mt-1 w-full text-left text-sm">
                <caption className="sr-only">Days since the last note for each plot</caption>
                <thead>
                  <tr className="border-b border-slate-line">
                    <th scope="col" className="py-1 pr-2 font-semibold">
                      Plot
                    </th>
                    <th scope="col" className="py-1 pr-2 font-semibold">
                      Last note
                    </th>
                    <th scope="col" className="py-1 font-semibold">
                      Days since
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.last_note_by_plot.map((row) => (
                    <tr key={row.plot} className="border-b border-slate-line/60">
                      <td className="py-1 pr-2">{row.plot}</td>
                      <td className="py-1 pr-2">{formatLongDate(row.date)}</td>
                      <td className="py-1 tabular-nums">{row.days_since}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card p-3 print-avoid-break">
            <h3 className="text-lg font-bold">Planting dates in your notes</h3>
            {summary.planting_by_plot.length === 0 ? (
              <p className="text-sm text-ink-soft">No planting dates are stored yet.</p>
            ) : (
              <table className="mt-1 w-full text-left text-sm">
                <caption className="sr-only">Days since planting for each plot</caption>
                <thead>
                  <tr className="border-b border-slate-line">
                    <th scope="col" className="py-1 pr-2 font-semibold">
                      Plot
                    </th>
                    <th scope="col" className="py-1 pr-2 font-semibold">
                      Planted
                    </th>
                    <th scope="col" className="py-1 font-semibold">
                      Days since planting
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.planting_by_plot.map((row) => (
                    <tr key={row.plot} className="border-b border-slate-line/60">
                      <td className="py-1 pr-2">{row.plot}</td>
                      <td className="py-1 pr-2">{formatLongDate(row.planting_date)}</td>
                      <td className="py-1 tabular-nums">{row.days_since_planting}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <p className="text-xs text-ink-soft">
            Every count and date on this page is computed by code from the stored entries for the
            week {formatLongDate(summary.week_start)} to {formatLongDate(summary.week_end)}. No number
            comes from a model. The report is a record of what you noted; it gives no advice.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function IssueList({
  issues,
  empty,
}: {
  issues: { id: string; plot: string; text: string; date: string }[];
  empty: string;
}) {
  if (issues.length === 0) return <p className="text-sm text-ink-soft">{empty}</p>;
  return (
    <ul className="mt-1 space-y-1 text-sm">
      {issues.map((issue) => (
        <li key={issue.id}>
          <span className="font-semibold">{issue.plot}</span> · {formatLongDate(issue.date)} ·{" "}
          {issue.text}
        </li>
      ))}
    </ul>
  );
}
