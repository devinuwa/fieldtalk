"use client";

import { useState } from "react";

import { GroundingNote, ungroundedClass } from "@/components/GroundingNote";
import { KindBadge } from "@/components/KindBadge";
import { SyntheticBadge } from "@/components/SyntheticBadge";
import { formatLongDate } from "@/lib/engine";
import { ENTRY_KINDS, type EntryKind, type StoredEntry } from "@/lib/types";
import { useApp } from "@/lib/store";

interface Draft {
  plot: string;
  crop: string;
  kind: EntryKind;
  text: string;
  date: string;
  planting_date: string;
  quantityValue: string;
  quantityUnit: string;
}

function toDraft(entry: StoredEntry): Draft {
  return {
    plot: entry.plot ?? "",
    crop: entry.crop ?? "",
    kind: entry.kind,
    text: entry.text,
    date: entry.date,
    planting_date: entry.planting_date ?? "",
    quantityValue: entry.quantity === null ? "" : String(entry.quantity.value),
    quantityUnit: entry.quantity === null ? "" : entry.quantity.unit,
  };
}

export function EntryCard({ entry }: { entry: StoredEntry }) {
  const { updateEntry, confirmEntry, deleteEntry } = useApp();
  const [draft, setDraft] = useState<Draft>(() => toDraft(entry));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const dirty =
    draft.plot !== (entry.plot ?? "") ||
    draft.crop !== (entry.crop ?? "") ||
    draft.kind !== entry.kind ||
    draft.text !== entry.text ||
    draft.date !== entry.date ||
    draft.planting_date !== (entry.planting_date ?? "") ||
    draft.quantityValue !== (entry.quantity === null ? "" : String(entry.quantity.value)) ||
    draft.quantityUnit !== (entry.quantity === null ? "" : entry.quantity.unit);

  const ungroundedFields = Object.entries(entry.grounded)
    .filter(([, ok]) => !ok)
    .map(([field]) => field);

  async function save() {
    setSaving(true);
    setNote(null);
    try {
      const value = draft.quantityValue.trim() === "" ? null : Number(draft.quantityValue);
      if (value !== null && !Number.isFinite(value)) {
        setNote("Quantity has to be a number.");
        return;
      }
      const unit = draft.quantityUnit.trim();
      await updateEntry(entry.id, {
        plot: draft.plot.trim() === "" ? null : draft.plot.trim(),
        crop: draft.crop.trim() === "" ? null : draft.crop.trim(),
        kind: draft.kind,
        text: draft.text,
        date: draft.date,
        planting_date: draft.planting_date === "" ? null : draft.planting_date,
        quantity: value === null ? null : { value, unit: unit === "" ? "units" : unit },
      });
      setNote("Saved.");
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setNote(null);
  }

  return (
    <article className="card print-avoid-break p-3">
      <header className="flex flex-wrap items-center gap-2">
        <KindBadge kind={entry.kind} />
        <span className="text-sm font-semibold">{formatLongDate(entry.date)}</span>
        {entry.confirmed ? (
          <span className="rounded-full border border-leaf bg-leaf-soft px-2 py-0.5 text-xs font-bold uppercase text-leaf">
            confirmed
          </span>
        ) : (
          <span className="rounded-full border border-soil bg-soil-soft px-2 py-0.5 text-xs font-bold uppercase text-soil">
            needs review
          </span>
        )}
        {entry.synthetic ? <SyntheticBadge compact /> : null}
        <span className="ml-auto font-mono text-xs text-ink-soft">{entry.id}</span>
      </header>

      {ungroundedFields.length > 0 ? (
        <p className="mt-2 rounded-lg border border-alert bg-alert-soft px-2 py-1 text-sm font-semibold text-alert">
          Not traceable to the transcript: {ungroundedFields.join(", ")}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Plot</span>
          <input
            className={`input ${ungroundedClass(entry.grounded.plot)}`}
            value={draft.plot}
            onChange={(event) => set("plot", event.target.value)}
            placeholder="no plot"
          />
          {!entry.grounded.plot ? <GroundingNote field="plot" /> : null}
        </label>
        <label className="block">
          <span className="field-label">Crop</span>
          <input
            className={`input ${ungroundedClass(entry.grounded.crop)}`}
            value={draft.crop}
            onChange={(event) => set("crop", event.target.value)}
            placeholder="no crop"
          />
          {!entry.grounded.crop ? <GroundingNote field="crop" /> : null}
        </label>
        <label className="block">
          <span className="field-label">Kind</span>
          <select
            className={`input ${ungroundedClass(entry.grounded.kind)}`}
            value={draft.kind}
            onChange={(event) => set("kind", event.target.value as EntryKind)}
          >
            {ENTRY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Date</span>
          <input
            type="date"
            className={`input ${ungroundedClass(entry.grounded.date)}`}
            value={draft.date}
            onChange={(event) => set("date", event.target.value)}
          />
        </label>
        <label className="col-span-2 block">
          <span className="field-label">Note text</span>
          <textarea
            className={`input min-h-20 ${ungroundedClass(entry.grounded.text)}`}
            value={draft.text}
            onChange={(event) => set("text", event.target.value)}
          />
        </label>
        <label className="block">
          <span className="field-label">Quantity</span>
          <input
            inputMode="decimal"
            className={`input ${ungroundedClass(entry.grounded.quantity)}`}
            value={draft.quantityValue}
            onChange={(event) => set("quantityValue", event.target.value)}
            placeholder="none"
          />
          {!entry.grounded.quantity ? <GroundingNote field="quantity" /> : null}
        </label>
        <label className="block">
          <span className="field-label">Unit</span>
          <input
            className={`input ${ungroundedClass(entry.grounded.quantity)}`}
            value={draft.quantityUnit}
            onChange={(event) => set("quantityUnit", event.target.value)}
            placeholder="e.g. baskets"
          />
        </label>
        <label className="col-span-2 block">
          <span className="field-label">Planting date</span>
          <input
            type="date"
            className={`input ${ungroundedClass(entry.grounded.planting_date)}`}
            value={draft.planting_date}
            onChange={(event) => set("planting_date", event.target.value)}
          />
        </label>
      </div>

      {entry.source_span !== null ? (
        <p className="mt-3 rounded-lg bg-leaf-soft px-2 py-1 text-sm">
          <span className="font-semibold">From the transcript: </span>
          <span className="italic">“{entry.source_span}”</span>
        </p>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">
          No transcript span is stored for this entry.
        </p>
      )}

      <div className="no-print mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="rounded-lg bg-leaf px-3 py-2 text-sm font-semibold text-on-accent disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={() => void confirmEntry(entry.id)}
          disabled={entry.confirmed}
          className="rounded-lg border border-leaf px-3 py-2 text-sm font-semibold text-leaf disabled:opacity-40"
        >
          {entry.confirmed ? "Confirmed" : "Confirm entry"}
        </button>
        {confirmDelete ? (
          <>
            <button
              type="button"
              onClick={() => void deleteEntry(entry.id)}
              className="rounded-lg bg-alert px-3 py-2 text-sm font-semibold text-on-accent"
            >
              Really delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg border border-slate-line px-3 py-2 text-sm font-semibold text-ink-soft"
            >
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg border border-alert px-3 py-2 text-sm font-semibold text-alert"
          >
            Delete
          </button>
        )}
        {note !== null ? <span className="text-sm text-ink-soft">{note}</span> : null}
      </div>
    </article>
  );
}
