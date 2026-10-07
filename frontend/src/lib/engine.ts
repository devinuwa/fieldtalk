/**
 * Deterministic date and count helpers used by the UI and the mock layer.
 *
 * These mirror the pure-Python engine in backend/fieldtalk/engine (PLAN.md:
 * resolve_date, days_since, days_since_last_note, plot_timeline, open_issues,
 * weekly_summary). The Python engine is authoritative; everything here is
 * stdlib-only logic with no DOM and no network so it can be unit tested against
 * fixtures/golden_engine.json.
 *
 * Window convention: `summarizeWindow` takes a half-open window
 * [week_start, week_end_exclusive), which is what fixtures/golden_engine.json
 * expects (see the weekly_cases entry: 09-28..10-04 with 10-04 excluded).
 */

import {
  ENTRY_KINDS,
  type EntryKind,
  type IssueRef,
  type PlotPlanting,
  type PlotRecency,
  type PlotTouch,
  type StoredEntry,
  type WeeklySummary,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse `YYYY-MM-DD` as midnight UTC. Throws on anything else. */
export function parseISODate(iso: string): Date {
  if (!ISO_DATE.test(iso)) throw new Error(`not an ISO date: ${iso}`);
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`invalid calendar date: ${iso}`);
  }
  return date;
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isISODate(value: string): boolean {
  try {
    parseISODate(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(iso: string, days: number): string {
  return toISODate(new Date(parseISODate(iso).getTime() + days * DAY_MS));
}

/** Whole days from `fromISO` to `toISO`; negative when `toISO` is earlier. */
export function diffDays(fromISO: string, toISO: string): number {
  return Math.round((parseISODate(toISO).getTime() - parseISODate(fromISO).getTime()) / DAY_MS);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(iso: string): number {
  return (parseISODate(iso).getUTCDay() + 6) % 7;
}

export interface WeekWindow {
  week_start: string;
  /** Last day of the week, inclusive (Sunday). */
  week_end: string;
  /** Start of the following week: the exclusive end of the window. */
  week_end_exclusive: string;
}

/** The Monday-to-Sunday week containing `iso`. */
export function weekOf(iso: string): WeekWindow {
  const weekStart = addDays(iso, -weekdayIndex(iso));
  const weekEndExclusive = addDays(weekStart, 7);
  return {
    week_start: weekStart,
    week_end: addDays(weekEndExclusive, -1),
    week_end_exclusive: weekEndExclusive,
  };
}

/** Days from planting to `on`; 0 on the planting day. */
export function daysSincePlanting(plantingISO: string, onISO: string): number {
  return diffDays(plantingISO, onISO);
}

function byDateThenId(a: StoredEntry, b: StoredEntry): number {
  return a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date);
}

/** Entries for one plot, oldest first. */
export function plotTimeline(entries: StoredEntry[], plot: string): StoredEntry[] {
  const key = normalizePlot(plot);
  return entries.filter((e) => e.plot !== null && normalizePlot(e.plot) === key).sort(byDateThenId);
}

/** All distinct plots, sorted by name. */
export function knownPlots(entries: StoredEntry[]): string[] {
  const names = new Set<string>();
  for (const entry of entries) if (entry.plot) names.add(entry.plot);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Loose plot matching used by the ask tools: case and whitespace only. */
export function normalizePlot(plot: string): string {
  return plot.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Days since the newest entry on `plot`, or null when the plot has no entries. */
export function daysSinceLastNote(
  entries: StoredEntry[],
  plot: string,
  asOfISO: string,
): number | null {
  const timeline = plotTimeline(entries, plot);
  if (timeline.length === 0) return null;
  const last = timeline[timeline.length - 1];
  return diffDays(last.date, asOfISO);
}

/**
 * Issue entries with no later action entry on the same plot.
 * `plot` null/omitted means every plot.
 */
export function openIssues(entries: StoredEntry[], plot?: string | null): StoredEntry[] {
  const scope =
    plot === undefined || plot === null ? entries : plotTimeline(entries, plot);
  const actions = scope.filter((e) => e.kind === "action");
  return scope
    .filter((e) => e.kind === "issue" && !closedBy(actions, e))
    .sort(byDateThenId);
}

function closedBy(actions: StoredEntry[], issue: StoredEntry): boolean {
  return actions.some(
    (action) =>
      action.plot !== null &&
      issue.plot !== null &&
      normalizePlot(action.plot) === normalizePlot(issue.plot) &&
      action.date > issue.date,
  );
}

/** Plain substring search over stored entries. No embeddings, no ranking. */
export function searchNotes(entries: StoredEntry[], keyword: string): StoredEntry[] {
  const needle = keyword.trim().toLowerCase();
  if (needle === "") return [];
  return entries
    .filter((e) => {
      const haystack = [e.text, e.plot ?? "", e.crop ?? "", e.kind].join(" ").toLowerCase();
      return haystack.includes(needle);
    })
    .sort(byDateThenId);
}

function emptyCounts(): Record<EntryKind, number> {
  return ENTRY_KINDS.reduce(
    (acc, kind) => {
      acc[kind] = 0;
      return acc;
    },
    {} as Record<EntryKind, number>,
  );
}

function toIssueRef(entry: StoredEntry): IssueRef {
  return {
    id: entry.id,
    plot: entry.plot ?? "(no plot)",
    text: entry.text,
    date: entry.date,
  };
}

/** Most recent known planting date per plot, oldest planting first. */
export function plantingsByPlot(entries: StoredEntry[], onISO: string): PlotPlanting[] {
  const latest = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.plot || !entry.planting_date) continue;
    const key = normalizePlot(entry.plot);
    const current = latest.get(key);
    if (!current || entry.planting_date > current) latest.set(key, entry.planting_date);
  }
  const byPlot = new Map(entries.filter((e) => e.plot).map((e) => [normalizePlot(e.plot as string), e.plot as string]));
  return [...latest.entries()]
    .map(([key, planting_date]) => ({
      plot: byPlot.get(key) ?? key,
      planting_date,
      days_since_planting: daysSincePlanting(planting_date, onISO),
    }))
    .sort((a, b) => a.plot.localeCompare(b.plot));
}

/**
 * Weekly aggregates over the half-open window [weekStartISO, weekEndExclusiveISO).
 * Every count is computed here; no number comes from a model.
 */
export function summarizeWindow(
  entries: StoredEntry[],
  weekStartISO: string,
  weekEndExclusiveISO: string,
  /** "Today" for the days-since columns; never the end of a future week. */
  asOfISO: string,
): WeeklySummary {
  const asOf = asOfISO;
  const inWindow = entries
    .filter((e) => e.date >= weekStartISO && e.date < weekEndExclusiveISO)
    .sort(byDateThenId);

  const counts = emptyCounts();
  for (const entry of inWindow) counts[entry.kind] += 1;

  const touches = new Map<string, PlotTouch>();
  for (const entry of inWindow) {
    const name = entry.plot ?? "(no plot)";
    const touch = touches.get(name) ?? { plot: name, entries: 0, kinds: [], latest_date: entry.date };
    touch.entries += 1;
    if (!touch.kinds.includes(entry.kind)) touch.kinds.push(entry.kind);
    if (entry.date > touch.latest_date) touch.latest_date = entry.date;
    touches.set(name, touch);
  }

  const opened = inWindow.filter((e) => e.kind === "issue");
  const actions = entries.filter((e) => e.kind === "action");
  const allIssues = entries.filter((e) => e.kind === "issue");

  const lastNote: PlotRecency[] = knownPlots(entries)
    .map((plot) => {
      const days = daysSinceLastNote(entries, plot, asOf);
      const timeline = plotTimeline(entries, plot);
      return {
        plot,
        date: timeline[timeline.length - 1].date,
        days_since: days ?? 0,
      };
    })
    .sort((a, b) => b.days_since - a.days_since);

  return {
    week_start: weekStartISO,
    week_end: addDays(weekEndExclusiveISO, -1),
    week_end_exclusive: weekEndExclusiveISO,
    counts_by_kind: counts,
    total_entries: inWindow.length,
    plots_touched: [...touches.values()].sort((a, b) => a.plot.localeCompare(b.plot)),
    issues_opened: opened.map(toIssueRef),
    issues_closed: allIssues
      .filter((issue) => {
        const closer = actions.find(
          (action) =>
            action.plot !== null &&
            issue.plot !== null &&
            normalizePlot(action.plot) === normalizePlot(issue.plot) &&
            action.date > issue.date,
        );
        return (
          closer !== undefined &&
          closer.date >= weekStartISO &&
          closer.date < weekEndExclusiveISO
        );
      })
      .map(toIssueRef),
    open_issues: openIssues(entries).map(toIssueRef),
    last_note_by_plot: lastNote,
    planting_by_plot: plantingsByPlot(entries, asOf),
    generated_from: "engine",
    synthetic: entries.every((e) => e.synthetic),
  };
}

/** For the report page: "Mon 5 Oct 2026 - Sun 11 Oct 2026". */
export function formatWeekLabel(weekStartISO: string, weekEndISO: string): string {
  return `${formatLongDate(weekStartISO)} – ${formatLongDate(weekEndISO)}`;
}

const LONG_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const LONG_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Mon 5 Oct 2026" - formatted without ICU so it is stable in tests and in print. */
export function formatLongDate(iso: string): string {
  const date = parseISODate(iso);
  return `${LONG_WEEKDAYS[weekdayIndex(iso)]} ${date.getUTCDate()} ${
    LONG_MONTHS[date.getUTCMonth()]
  } ${date.getUTCFullYear()}`;
}

export function formatShortDate(iso: string): string {
  const date = parseISODate(iso);
  return `${date.getUTCDate()} ${LONG_MONTHS[date.getUTCMonth()]}`;
}
