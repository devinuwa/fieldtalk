/**
 * Mock implementation of FieldTalkClient (NEXT_PUBLIC_MOCK=1).
 *
 * Everything the UI shows before the backend exists comes from here: the synthetic
 * transcripts copied from eval/transcripts.jsonl, the seed entries in seedEntries.ts
 * and the mock ask pipeline. It is labelled as mock/synthetic in the UI and it never
 * fabricates measurements - the real-time factor is null because no audio is decoded,
 * and extraction only answers for the bundled synthetic transcripts.
 */

import { weekOf, summarizeWindow } from "@/lib/engine";
import { ApiError, ModelUnavailableError, SttUnavailableError } from "@/lib/errors";
import { EVAL_TRANSCRIPTS, transcriptById, transcriptForFileName, type EvalTranscript } from "@/lib/mock/fixtures";
import { resolveDateExpr } from "@/lib/mock/resolve";
import { SEED_ENTRIES } from "@/lib/mock/seedEntries";
import { streamAsk, type AskContext } from "@/lib/mock/ask";
import { CLARIFY_FALLBACK } from "@/lib/strings";
import type { EntryInput, ExtractionResult, FieldTalkClient, Health, SttInput, SttResult, StoredEntry, StoredEntryPatch, WeeklySummary } from "@/lib/client-types";
import type { AskStage, EntryKind, Extraction } from "@/lib/types";

const MOCK_STT_MODEL = "mock-stt (no audio decoded)";
const MOCK_MODEL_NAME = "mock-router";

export interface MockOptions {
  /** ISO date used as "now". */
  today: string;
  /** Start with the model offline to exercise the manual path. */
  modelOffline?: boolean;
  /** Start with speech-to-text unavailable to exercise the readiness indicator. */
  sttOffline?: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Gold fields -> closed-schema extractions, the way the real pipeline would. */
export function extractionFromGold(row: EvalTranscript): ExtractionResult {
  if (row.gold.action === "refuse") {
    return { entries: [], action: "refuse", clarify_question: null, persisted_by_extraction: false };
  }
  const kinds = row.gold.kinds ?? [];
  if (row.gold.action === "clarify" || kinds.length === 0) {
    return {
      entries: [],
      action: "clarify",
      clarify_question: row.note ?? CLARIFY_FALLBACK,
      persisted_by_extraction: false,
    };
  }
  const entries: Extraction[] = kinds.map((kind) => ({
    plot: row.gold.plot ?? null,
    crop: row.gold.crop ?? null,
    kind: kind as EntryKind,
    // Copied verbatim from the transcript: a short phrase the human can trace.
    text: row.transcript,
    date_expr: row.gold.date_expr ?? null,
    planting_date_expr: row.gold.planting_date_expr ?? null,
    quantity: row.gold.quantity ?? null,
  }));
  // No backend store in mock mode: the review writes the confirmed entries through the
  // same addEntry path the real client uses, so nothing pretends to be persisted.
  return { entries, action: "run", clarify_question: null, persisted_by_extraction: false };
}

export class MockFieldTalkClient implements FieldTalkClient {
  private entries: StoredEntry[];
  private readonly today: string;
  private modelAvailable: boolean;
  private sttAvailable = true;
  private sequence = 2000;

  constructor(options: MockOptions) {
    this.today = options.today;
    this.entries = SEED_ENTRIES.map((entry) => ({ ...entry }));
    // Both on by default; either the option or the env flag switches them off.
    this.modelAvailable = !(options.modelOffline === true || process.env.NEXT_PUBLIC_MODEL_OFFLINE === "1");
    this.sttAvailable = !(options.sttOffline === true || process.env.NEXT_PUBLIC_STT_OFFLINE === "1");
  }

  /** The UI banner toggle: swap the model in and out without a reload. */
  setModelAvailable(available: boolean): void {
    this.modelAvailable = available;
  }

  /** Same for speech-to-text: the readiness indicator can be exercised in mock mode. */
  setSttAvailable(available: boolean): void {
    this.sttAvailable = available;
  }

  isModelAvailable(): boolean {
    return this.modelAvailable;
  }

  isSttAvailable(): boolean {
    return this.sttAvailable;
  }

  async health(): Promise<Health> {
    return {
      stt: this.sttAvailable ? "ok" : "unavailable",
      model: this.modelAvailable ? "ok" : "unavailable",
      model_name: MOCK_MODEL_NAME,
      stt_name: MOCK_STT_MODEL,
      stt_detail: this.sttAvailable
        ? "Mock mode: no audio is decoded and no speech model runs."
        : "Mock mode with speech-to-text switched off: upload still shows a synthetic transcript.",
      model_detail: this.modelAvailable
        ? "Mock mode: a keyword router stands in for the local model."
        : "Mock mode with the model switched off: manual entry path.",
      detail: this.modelAvailable
        ? "Mock mode: the UI is driven by the bundled fixtures, not by a model."
        : "Mock mode with the model switched off: manual entry path.",
    };
  }

  async transcribe(input: SttInput): Promise<SttResult> {
    if (!this.sttAvailable) {
      throw new SttUnavailableError(
        "Speech-to-text is switched off in mock mode. Start the local backend for a real transcript.",
      );
    }
    if (input.file.size === 0) {
      // Mirrors the real endpoint: a failed recording is never a successful note.
      throw new ApiError(400, "the recording is empty: nothing was captured.");
    }
    const row =
      (input.mockTranscriptId ? transcriptById(input.mockTranscriptId) : undefined) ??
      transcriptForFileName(input.name, input.file.size);
    const started = Date.now();
    await delay(450);
    const wall = (Date.now() - started) / 1000;
    return {
      transcript: row.transcript,
      audio_seconds: input.audioSeconds,
      wall_seconds: Number(wall.toFixed(2)),
      // Honest: no audio was decoded, so there is no real-time factor to report.
      rtf: null,
      language: null,
      model: MOCK_STT_MODEL,
      synthetic: true,
    };
  }

  async extract(request: { transcript: string; recorded_at: string; source: string }): Promise<ExtractionResult> {
    if (!this.modelAvailable) throw new ModelUnavailableError();
    const row = EVAL_TRANSCRIPTS.find((candidate) => normalize(candidate.transcript) === normalize(request.transcript));
    await delay(300);
    if (row) return extractionFromGold(row);
    return {
      entries: [],
      action: "clarify",
      persisted_by_extraction: false,
      clarify_question:
        "Mock extraction only knows the bundled synthetic transcripts (T01-T10, X01, X02). Start the backend to run the local model on your own words.",
    };
  }

  async listEntries(): Promise<StoredEntry[]> {
    return this.entries.map((entry) => ({ ...entry }));
  }

  async addEntry(input: EntryInput): Promise<StoredEntry> {
    const resolved = input.date ?? resolveDateExpr(input.date_expr, input.recorded_at).date;
    const planting =
      input.planting_date ?? resolveDateExpr(input.planting_date_expr, input.recorded_at).date;
    const entry: StoredEntry = {
      id: `e-${this.sequence++}`,
      plot: input.plot,
      crop: input.crop,
      kind: input.kind,
      text: input.text,
      date: resolved ?? input.recorded_at,
      date_expr: input.date_expr,
      planting_date: planting,
      planting_date_expr: input.planting_date_expr,
      quantity: input.quantity,
      grounded:
        resolved === null ? { ...input.grounded, date: false } : { ...input.grounded },
      source_span: input.source_span,
      confirmed: input.confirmed ?? false,
      // Mock data is always synthetic; the store labels it.
      synthetic: true,
      created_at: new Date().toISOString(),
    };
    this.entries = [...this.entries, entry];
    return { ...entry };
  }

  async updateEntry(id: string, patch: StoredEntryPatch): Promise<StoredEntry> {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) throw new ApiError(404, `no entry ${id}`);
    const current = this.entries[index];
    const next: StoredEntry = { ...current, ...patch };
    // Editing does not clear a V1 highlight; clearing a field does (nothing is claimed).
    next.grounded = { ...current.grounded };
    for (const field of ["plot", "crop", "quantity", "planting_date"] as const) {
      if (next[field] === null) next.grounded[field] = true;
    }
    this.entries = this.entries.map((entry) => (entry.id === id ? next : entry));
    return { ...next };
  }

  async confirmEntry(id: string): Promise<StoredEntry> {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) throw new ApiError(404, `no entry ${id}`);
    const next: StoredEntry = {
      ...this.entries[index],
      confirmed: true,
      // A human checked every field, so the review highlights are cleared.
      grounded: {
        plot: true,
        crop: true,
        kind: true,
        text: true,
        quantity: true,
        date: true,
        planting_date: true,
      },
    };
    this.entries = this.entries.map((entry) => (entry.id === id ? next : entry));
    return { ...next };
  }

  async deleteEntry(id: string): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.id !== id);
  }

  askStream(question: string): AsyncIterable<AskStage> {
    const context: AskContext = { entries: this.entries, today: this.today };
    return streamAsk(question, context);
  }

  async weeklyReport(weekOfISO: string): Promise<WeeklySummary> {
    const week = weekOf(weekOfISO);
    // "as of" is today, never the end of the requested week: days-since counts must
    // not be based on a date in the future.
    return summarizeWindow(this.entries, week.week_start, week.week_end_exclusive, this.today);
  }
}
