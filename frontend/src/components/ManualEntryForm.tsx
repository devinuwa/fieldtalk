"use client";

import { useState } from "react";

import { ENTRY_KINDS, type EntryKind } from "@/lib/types";
import { useApp } from "@/lib/store";
import { isMockMode } from "@/lib/contract";

/**
 * The no-model path (P0 item 6): type an entry by hand. It is marked confirmed,
 * because a human typed it; there is no transcript to trace fields back to.
 */
export function ManualEntryForm() {
  const { addEntry, today } = useApp();
  const [open, setOpen] = useState(false);
  const [plot, setPlot] = useState("");
  const [crop, setCrop] = useState("");
  const [kind, setKind] = useState<EntryKind>("observation");
  const [text, setText] = useState("");
  const [date, setDate] = useState(today);
  const [plantingDate, setPlantingDate] = useState("");
  const [quantityValue, setQuantityValue] = useState("");
  const [quantityUnit, setQuantityUnit] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const mock = isMockMode();

  async function submit() {
    if (text.trim() === "") {
      setNote("A note needs some text.");
      return;
    }
    const value = quantityValue.trim() === "" ? null : Number(quantityValue);
    if (value !== null && !Number.isFinite(value)) {
      setNote("Quantity has to be a number.");
      return;
    }
    await addEntry({
      plot: plot.trim() === "" ? null : plot.trim(),
      crop: crop.trim() === "" ? null : crop.trim(),
      kind,
      text: text.trim(),
      date,
      date_expr: null,
      planting_date: plantingDate === "" ? null : plantingDate,
      planting_date_expr: null,
      quantity: value === null ? null : { value, unit: quantityUnit.trim() || "units" },
      recorded_at: date,
      grounded: {
        plot: true,
        crop: true,
        kind: true,
        text: true,
        quantity: true,
        date: true,
        planting_date: true,
      },
      source_span: null,
      confirmed: true,
    });
    setNote("Entry added.");
    setText("");
    setQuantityValue("");
    setQuantityUnit("");
  }

  return (
    <section className="card mt-4 p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Add an entry by hand</h2>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg border border-leaf px-3 py-1 text-sm font-semibold text-leaf"
          aria-expanded={open}
        >
          {open ? "Hide" : "Open"}
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        This path needs no model and no transcription: it always works.
        {mock ? " Mock mode stores it for this session only." : ""}
      </p>

      {open ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">Plot</span>
            <input className="input" value={plot} onChange={(e) => setPlot(e.target.value)} />
          </label>
          <label className="block">
            <span className="field-label">Crop</span>
            <input className="input" value={crop} onChange={(e) => setCrop(e.target.value)} />
          </label>
          <label className="block">
            <span className="field-label">Kind</span>
            <select
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value as EntryKind)}
            >
              {ENTRY_KINDS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Date</span>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="col-span-2 block">
            <span className="field-label">Note text</span>
            <textarea
              className="input min-h-20"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What did you see or do?"
            />
          </label>
          <label className="block">
            <span className="field-label">Quantity</span>
            <input
              inputMode="decimal"
              className="input"
              value={quantityValue}
              onChange={(e) => setQuantityValue(e.target.value)}
              placeholder="none"
            />
          </label>
          <label className="block">
            <span className="field-label">Unit</span>
            <input
              className="input"
              value={quantityUnit}
              onChange={(e) => setQuantityUnit(e.target.value)}
              placeholder="e.g. baskets"
            />
          </label>
          <label className="col-span-2 block">
            <span className="field-label">Planting date</span>
            <input
              type="date"
              className="input"
              value={plantingDate}
              onChange={(e) => setPlantingDate(e.target.value)}
            />
          </label>
          <div className="col-span-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void submit()}
              className="rounded-lg bg-leaf px-4 py-2 font-semibold text-white"
            >
              Add entry
            </button>
            {note !== null ? <span className="text-sm text-ink-soft">{note}</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
