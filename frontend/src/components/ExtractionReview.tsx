"use client";

import { useState } from "react";

import { KindBadge } from "@/components/KindBadge";
import { SyntheticBadge } from "@/components/SyntheticBadge";
import { describeDateExpr, describeQuantity } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { ExtractionResult } from "@/lib/types";

interface Props {
  result: ExtractionResult;
  transcript: string;
  /** Recording date used by the backend to resolve date expressions. */
  recordedAt: string;
  onSaved: (count: number) => void;
}

/**
 * Everything the extraction produced, shown for review. Nothing is stored until the
 * human says so; the grounding flags come from the backend's V1 gate.
 */
export function ExtractionReview({ result, transcript, recordedAt, onSaved }: Props) {
  const { addEntry } = useApp();
  const [included, setIncluded] = useState<boolean[]>(() => result.entries.map(() => true));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setNote(null);
    let count = 0;
    for (const [index, entry] of result.entries.entries()) {
      if (!included[index]) continue;
      await addEntry({
        plot: entry.plot,
        crop: entry.crop,
        kind: entry.kind,
        text: entry.text,
        date: null,
        date_expr: entry.date_expr,
        planting_date: null,
        planting_date_expr: entry.planting_date_expr,
        quantity: entry.quantity,
        recorded_at: recordedAt,
        // The backend's V1 gate decides these; mock mode reports copied fields as traceable.
        grounded: {
          plot: true,
          crop: true,
          kind: true,
          text: true,
          quantity: true,
          date: true,
          planting_date: true,
        },
        source_span: transcript,
        confirmed: false,
      });
      count += 1;
    }
    setSaving(false);
    setNote(
      count === 0
        ? "Nothing selected, so nothing was stored."
        : `${count} ${count === 1 ? "entry" : "entries"} stored as “needs review”.`,
    );
    onSaved(count);
  }

  if (result.entries.length === 0) {
    return (
      <p className="rounded-lg border border-slate-line bg-white px-3 py-2 text-sm text-ink-soft">
        The extraction returned no entries.
      </p>
    );
  }

  return (
    <section className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold">
          {result.entries.length} {result.entries.length === 1 ? "entry" : "entries"} extracted
        </h3>
        <SyntheticBadge compact />
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        Dates are shown as the words in the note. Code resolves them to a calendar date when the
        entry is stored.
      </p>

      <ul className="mt-3 space-y-3">
        {result.entries.map((entry, index) => (
          <li key={`${entry.kind}-${index}`} className="card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={`include-${index}`}
                type="checkbox"
                className="h-5 w-5"
                checked={included[index]}
                onChange={(event) =>
                  setIncluded((current) =>
                    current.map((value, position) =>
                      position === index ? event.target.checked : value,
                    ),
                  )
                }
              />
              <label htmlFor={`include-${index}`} className="text-sm font-semibold">
                store this
              </label>
              <KindBadge kind={entry.kind} />
              <span className="text-sm font-semibold">{entry.plot ?? "no plot"}</span>
              <span className="text-sm text-ink-soft">{entry.crop ?? "no crop"}</span>
            </div>
            <p className="mt-2">{entry.text}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-ink-soft">Date in the note</dt>
              <dd>{describeDateExpr(entry.date_expr)}</dd>
              <dt className="text-ink-soft">Planting date in the note</dt>
              <dd>{describeDateExpr(entry.planting_date_expr)}</dd>
              <dt className="text-ink-soft">Quantity</dt>
              <dd>{describeQuantity(entry.quantity)}</dd>
            </dl>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-leaf px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Storing…" : "Store selected entries"}
        </button>
        <span className="text-sm text-ink-soft">
          Entries land in the list as “needs review” so you can edit any field.
        </span>
      </div>
      {note !== null ? <p className="mt-2 text-sm font-semibold text-leaf">{note}</p> : null}
    </section>
  );
}
