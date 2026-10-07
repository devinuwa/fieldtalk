"use client";

import { useMemo } from "react";

import { EntryCard } from "@/components/EntryCard";
import { KindBadge } from "@/components/KindBadge";
import { ManualEntryForm } from "@/components/ManualEntryForm";
import { SyntheticBadge } from "@/components/SyntheticBadge";
import { formatLongDate, openIssues } from "@/lib/engine";
import { useApp } from "@/lib/store";
import type { StoredEntry } from "@/lib/types";

export default function EntriesPage() {
  const { entries, loading, mock, modelUnavailable } = useApp();

  const groups = useMemo(() => buildGroups(entries), [entries]);
  const needsReview = entries.filter((entry) => !entry.confirmed).length;
  const ungrounded = entries.filter((entry) =>
    Object.values(entry.grounded).some((ok) => !ok),
  ).length;

  return (
    <div>
      <h2 className="text-xl font-bold">Entries</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Grouped by plot. Every field is editable, and anything that could not be traced back to the
        transcript is highlighted.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full border border-slate-line px-2 py-0.5 font-semibold">
          {entries.length} stored
        </span>
        <span className="rounded-full border border-soil bg-soil-soft px-2 py-0.5 font-semibold text-soil">
          {needsReview} need review
        </span>
        <span className="rounded-full border border-alert bg-alert-soft px-2 py-0.5 font-semibold text-alert">
          {ungrounded} with an ungrounded field
        </span>
        {mock ? <SyntheticBadge /> : null}
      </div>

      {modelUnavailable ? (
        <p className="mt-3 rounded-lg border border-soil bg-soil-soft px-3 py-2 text-sm">
          The local model is unavailable: nothing new can be extracted from audio right now, but you
          can still add, edit, confirm and delete entries here.
        </p>
      ) : null}

      <ManualEntryForm />

      {loading ? <p className="mt-4 text-ink-soft">Loading entries…</p> : null}

      {!loading && entries.length === 0 ? (
        <p className="card mt-4 p-3 text-ink-soft">
          No entries yet. Add one by hand above, or record a note on the Record screen.
        </p>
      ) : null}

      {groups.map((group) => (
        <section key={group.plot} className="mt-5 print-avoid-break">
          <header className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">{group.plot}</h3>
            <span className="text-sm text-ink-soft">
              {group.entries.length} {group.entries.length === 1 ? "entry" : "entries"}
            </span>
            <span className="text-sm text-ink-soft">
              newest: {formatLongDate(group.newest)}
            </span>
          </header>
          <div className="mt-1 flex flex-wrap gap-1">
            {group.kinds.map((kind) => (
              <KindBadge key={kind} kind={kind} />
            ))}
            {group.openIssues > 0 ? (
              <span className="rounded-full border border-alert bg-alert-soft px-2 py-0.5 text-xs font-bold uppercase text-alert">
                {group.openIssues} open {group.openIssues === 1 ? "issue" : "issues"}
              </span>
            ) : null}
          </div>
          <div className="mt-2 space-y-3">
            {group.entries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      ))}

      <p className="mt-6 text-xs text-ink-soft">
        “Open issue” means an issue entry with no later action entry on the same plot. That is
        computed from your entries, not judged by the model.
      </p>
    </div>
  );
}

function buildGroups(entries: StoredEntry[]) {
  const byPlot = new Map<string, StoredEntry[]>();
  for (const entry of entries) {
    const key = entry.plot ?? "No plot";
    byPlot.set(key, [...(byPlot.get(key) ?? []), entry]);
  }
  return [...byPlot.entries()]
    .map(([plot, list]) => {
      const sorted = [...list].sort((a, b) =>
        a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date),
      );
      const kinds = [...new Set(sorted.map((entry) => entry.kind))];
      return {
        plot,
        entries: sorted,
        kinds,
        newest: sorted[sorted.length - 1].date,
        openIssues: plot === "No plot" ? openIssues(entries).filter((e) => e.plot === null).length : openIssues(entries, plot).length,
      };
    })
    .sort((a, b) => (a.plot === "No plot" ? 1 : b.plot === "No plot" ? -1 : a.plot.localeCompare(b.plot)));
}
