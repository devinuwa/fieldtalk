/**
 * Types shared by the UI, the typed API client and the mock layer.
 *
 * They mirror the closed entry schema in PLAN.md ("Entry schema (closed; the LLM
 * fills it, code validates)"). The real values come from the backend engine; this
 * file must not compute anything itself.
 */

/** The closed set of entry kinds. The model may only emit one of these. */
export const ENTRY_KINDS = ["observation", "issue", "action", "plan", "measurement"] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

export type DateExprKind = "today" | "days_ago" | "month_day";

/** What the model is allowed to emit for a date: never a resolved date. */
export interface DateExpr {
  kind: DateExprKind;
  /** days_ago: how many days before the recording date. */
  n?: number | null;
  /** month_day: 1-12. */
  month?: number | null;
  /** month_day: 1-31. */
  day?: number | null;
}

export type DateExprOrNull = DateExpr | null;

export interface Quantity {
  value: number;
  unit: string;
}

/** One extracted entry exactly as it comes out of the extraction pipeline. */
export interface Extraction {
  plot: string | null;
  crop: string | null;
  kind: EntryKind;
  /** Short phrase copied or lightly trimmed from the transcript. */
  text: string;
  date_expr: DateExprOrNull;
  planting_date_expr: DateExprOrNull;
  quantity: Quantity | null;
}

export type ExtractionAction = "run" | "clarify" | "refuse";

export interface ExtractionResult {
  entries: Extraction[];
  action: ExtractionAction;
  clarify_question: string | null;
}

/** Fields that must be traceable to the transcript (V1). */
export type GroundedField =
  | "plot"
  | "crop"
  | "kind"
  | "text"
  | "quantity"
  | "date"
  | "planting_date";

export type Grounding = Record<GroundedField, boolean>;

/** An entry after the store and the V1 gate have run. */
export interface StoredEntry {
  id: string;
  plot: string | null;
  crop: string | null;
  kind: EntryKind;
  /** Short phrase, copied or lightly trimmed from the transcript. */
  text: string;
  /** Resolved in code from `date_expr` against the recording date. */
  date: string;
  date_expr: DateExprOrNull;
  /** Resolved in code from `planting_date_expr`, or typed by hand. */
  planting_date: string | null;
  planting_date_expr: DateExprOrNull;
  quantity: Quantity | null;
  /** Per-field V1 result. Any false value is shown highlighted, never accepted silently. */
  grounded: Grounding;
  /** The transcript snippet this entry was traced to (V1 evidence). */
  source_span: string | null;
  /** True once the human reviewed and confirmed the entry. */
  confirmed: boolean;
  /** Synthetic demo data is always labelled. */
  synthetic: boolean;
  created_at: string;
}

export type StoredEntryPatch = Partial<
  Pick<
    StoredEntry,
    "plot" | "crop" | "kind" | "text" | "date" | "planting_date" | "quantity" | "confirmed"
  >
>;

/** Manual entry: the path that works with no model at all. */
export interface ManualEntryDraft {
  plot: string | null;
  crop: string | null;
  kind: EntryKind;
  text: string;
  date: string;
  planting_date: string | null;
  quantity: Quantity | null;
}

export interface SttResult {
  transcript: string;
  /** Measured audio length in seconds; null when the browser could not report it. */
  audio_seconds: number | null;
  /** Measured transcription time in seconds. */
  wall_seconds: number;
  /** Real-time factor = wall_seconds / audio_seconds. null in mock mode: no audio was decoded. */
  rtf: number | null;
  model: string;
  synthetic: boolean;
}

export interface ExtractionRequest {
  transcript: string;
  /** ISO date used to resolve date expressions. */
  recorded_at: string;
  source: "recording" | "upload" | "typed";
}

export interface Health {
  /** "ok" when speech-to-text is usable on this machine. */
  stt: "ok" | "unavailable";
  /** "ok" when the local model answers; "unavailable" switches the UI to the manual path. */
  model: "ok" | "unavailable";
  model_name: string;
  stt_name: string;
  detail: string;
}

/** The five stages of one ask-your-notes run, in order. */
export const ASK_STAGES = ["interpret", "tool_call", "validate", "engine", "answer"] as const;

export type AskStageId = (typeof ASK_STAGES)[number];

export type AskStageStatus = "running" | "done" | "refused" | "clarify" | "error";

export interface AskStage {
  id: AskStageId;
  /** Human label shown in the ribbon. */
  label: string;
  status: AskStageStatus;
  /** One-line summary for the ribbon. */
  summary: string;
  /** Raw payload for the collapsible trace panel. */
  payload: unknown;
  /** V2 / V3 notes, shown in the trace panel. */
  checks: string[];
  /** Simulated or measured milliseconds spent in this stage. */
  ms: number;
}

export interface AskRun {
  question: string;
  stages: AskStage[];
  outcome: "answered" | "refused" | "clarify" | "error";
  answer: string;
  refused: boolean;
  /** Which tool produced the answer, when one ran. */
  tool: string | null;
}

export type ToolName =
  | "plot_timeline"
  | "days_since_planting"
  | "days_since_last_note"
  | "open_issues"
  | "weekly_summary"
  | "search_notes";

export interface PlotTouch {
  plot: string;
  entries: number;
  kinds: EntryKind[];
  latest_date: string;
}

export interface PlotRecency {
  plot: string;
  date: string;
  days_since: number;
}

export interface PlotPlanting {
  plot: string;
  planting_date: string;
  days_since_planting: number;
}

export interface IssueRef {
  id: string;
  plot: string;
  text: string;
  date: string;
}

export interface WeeklySummary {
  week_start: string;
  /** Last day inside the window (inclusive). */
  week_end: string;
  /** End of the half-open window, i.e. week_end + 1 day. */
  week_end_exclusive: string;
  counts_by_kind: Record<EntryKind, number>;
  total_entries: number;
  plots_touched: PlotTouch[];
  issues_opened: IssueRef[];
  issues_closed: IssueRef[];
  open_issues: IssueRef[];
  last_note_by_plot: PlotRecency[];
  planting_by_plot: PlotPlanting[];
  /** Always "engine": every number on the report is computed from stored entries. */
  generated_from: "engine";
  synthetic: boolean;
}
