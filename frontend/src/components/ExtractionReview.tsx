"use client";

import { useState } from "react";

import { KindBadge } from "@/components/KindBadge";
import { SyntheticBadge } from "@/components/SyntheticBadge";
import { describeDateExpr, describeQuantity } from "@/lib/format";
import type { Extraction, ExtractionResult } from "@/lib/types";

interface Props {
  result: ExtractionResult;
  transcript: string;
  /** Recording date used by the backend to resolve date expressions. */
  recordedAt: string;
  /** Confirm a row when a client has already persisted it during extraction. */
  onConfirm: (id: string) => Promise<void>;
  /** Store an extraction preview after the user approves it. */
  onStore: (entry: Extraction, transcript: string, recordedAt: string) => Promise<void>;
  /** Drop a stored entry the user chose not to keep. */
  onRemove: (id: string) => Promise<void>;
  onSaved: (count: number) => void;
}

/**
 * Everything the extraction produced, shown for review. Each row is stored or confirmed
 * through the entries API when you press the button: nothing here is a pretend save.
 *
 * Extraction rows are previews. They are written through the entries API only after the
 * user approves them. The removal path remains for clients that pre-persist rows.
 */
export function ExtractionReview({ result, transcript, recordedAt, onConfirm, onStore, onRemove, onSaved }: Props) {
  const [included, setIncluded] = useState<boolean[]>(() => result.entries.map(() => true));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function save() {
    setSaving(true);
    setNote(null);
    setFailed(false);
    let stored = 0;
    let removed = 0;
    try {
      for (const [index, entry] of result.entries.entries()) {
        if (included[index]) {
          if (entry.id) await onConfirm(entry.id);
          else await onStore(entry, transcript, recordedAt);
          stored += 1;
        } else if (entry.id) {
          await onRemove(entry.id);
          removed += 1;
        }
      }
      setNote(
        stored === 0
          ? `Nothing was kept${removed > 0 ? `; ${removed} extraction${removed === 1 ? "" : "s"} removed` : ""}, so nothing was stored.`
          : `${stored} ${stored === 1 ? "entry" : "entries"} stored as “needs review”${removed > 0 ? `, ${removed} removed` : ""}. Open Entries to edit and confirm.`,
      );
      onSaved(stored);
    } catch (cause) {
      setFailed(true);
      setNote(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  if (result.entries.length === 0) {
    return (
      <p className="rounded-lg border border-slate-line bg-surface-2 px-3 py-2 text-sm text-ink-soft">
        The extraction returned no entries.
      </p>
    );
  }

  return (
    <section className="mt-4" data-testid="extraction-review">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold">
          {result.entries.length} {result.entries.length === 1 ? "entry" : "entries"} extracted
        </h3>
        <SyntheticBadge compact />
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        Dates are shown as the words in the note. Code-resolved dates are preserved when you
        store an approved row. Unticking a row keeps it out of the notebook.
      </p>

      <ul className="mt-3 space-y-3">
        {result.entries.map((entry, index) => (
          <li key={`${entry.kind}-${index}`} className="card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={`include-${index}`}
                type="checkbox"
                className="h-5 w-5 accent-[var(--color-leaf)]"
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
                keep this
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
          className="rounded-lg bg-leaf px-4 py-2 font-semibold text-on-accent disabled:opacity-50"
        >
          {saving ? "Storing…" : "Store selected entries"}
        </button>
        <span className="text-sm text-ink-soft">
          Entries land in the list as “needs review” so you can edit any field.
        </span>
      </div>
      {note !== null ? (
        <p className={`mt-2 text-sm font-semibold ${failed ? "text-alert" : "text-leaf"}`} data-testid="extraction-note">
          {note}
        </p>
      ) : null}
    </section>
  );
}
