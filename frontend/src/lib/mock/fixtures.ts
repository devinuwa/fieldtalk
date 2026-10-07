/**
 * Access to the fixture data copied by scripts/sync-fixtures.mjs.
 *
 * The source of truth is eval/transcripts.jsonl (owned by the backend agent).
 * These are synthetic transcripts with hand-written gold fields; the mock layer
 * uses them so the UI has something honest to show before the backend exists.
 * Nothing here is real audio or a real model output.
 */

import type { DateExprOrNull, Quantity } from "@/lib/types";
import rawTranscripts from "@mock/from-fixtures/transcripts.generated.json";

export interface GoldFields {
  plot?: string | null;
  crop?: string | null;
  kinds?: string[];
  date_expr?: DateExprOrNull;
  planting_date_expr?: DateExprOrNull;
  quantity?: Quantity | null;
  action?: "run" | "clarify" | "refuse";
}

export interface EvalTranscript {
  id: string;
  type: "extract" | "adversarial";
  synthetic: boolean;
  transcript: string;
  gold: GoldFields;
  note?: string;
}

export const EVAL_TRANSCRIPTS = rawTranscripts as EvalTranscript[];

export const EXTRACT_TRANSCRIPTS = EVAL_TRANSCRIPTS.filter((row) => row.type === "extract");

export function transcriptById(id: string): EvalTranscript | undefined {
  return EVAL_TRANSCRIPTS.find((row) => row.id === id);
}

/**
 * A file named after a bundled case (T01.wav, x02.m4a) picks that case; otherwise the
 * same file always maps to the same synthetic transcript.
 */
export function transcriptForFileName(name: string, size: number): EvalTranscript {
  const match = name.toUpperCase().match(/(T\d{2}|X\d{2})/);
  const named = match ? transcriptById(match[1]) : undefined;
  if (named) return named;
  const seed = [...`${name}:${size}`].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return EXTRACT_TRANSCRIPTS[seed % EXTRACT_TRANSCRIPTS.length];
}
