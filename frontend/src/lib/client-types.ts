import type {
  AskStage,
  DateExprOrNull,
  EntryKind,
  ExtractionRequest,
  ExtractionResult,
  Grounding,
  Health,
  Quantity,
  SttResult,
  StoredEntry,
  StoredEntryPatch,
  WeeklySummary,
} from "@/lib/types";

export type {
  ExtractionRequest,
  ExtractionResult,
  Health,
  SttResult,
  StoredEntry,
  StoredEntryPatch,
  WeeklySummary,
};

export interface SttInput {
  file: Blob;
  /** File name when the input came from the file picker. */
  name: string;
  /** Measured audio length, when the browser could report it. */
  audioSeconds: number | null;
  /** Mock mode only: which bundled synthetic transcript to stand in with. */
  mockTranscriptId?: string;
}

/**
 * What the UI hands to the store. Either `date` is already known (typed by hand)
 * or the client resolves `date_expr` against `recorded_at` in code.
 */
export interface EntryInput {
  plot: string | null;
  crop: string | null;
  kind: EntryKind;
  text: string;
  date: string | null;
  date_expr: DateExprOrNull;
  planting_date: string | null;
  planting_date_expr: DateExprOrNull;
  quantity: Quantity | null;
  recorded_at: string;
  grounded: Grounding;
  source_span: string | null;
  confirmed?: boolean;
}

export interface FieldTalkClient {
  /** Whether speech-to-text and the local model answer right now. */
  health(): Promise<Health>;
  transcribe(input: SttInput): Promise<SttResult>;
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
  listEntries(): Promise<StoredEntry[]>;
  addEntry(input: EntryInput): Promise<StoredEntry>;
  updateEntry(id: string, patch: StoredEntryPatch): Promise<StoredEntry>;
  confirmEntry(id: string): Promise<StoredEntry>;
  deleteEntry(id: string): Promise<void>;
  /** Staged ask-your-notes run: interpret, tool call, validate, engine, answer. */
  askStream(question: string): AsyncIterable<AskStage>;
  weeklyReport(weekOfISO: string): Promise<WeeklySummary>;
}
