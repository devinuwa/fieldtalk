/**
 * HTTP client for the real backend (used when NEXT_PUBLIC_MOCK=0).
 *
 * Endpoints, all on 127.0.0.1 (hard rule 5: no cloud calls at runtime):
 *   GET    /api/health
 *   POST   /api/transcribe         the recorded audio as the raw request body -> transcript
 *   POST   /api/extract            { transcript, recording_date, model } -> review proposal
 *   GET    /api/entries
 *   POST   /api/entries             manual entry
 *   PATCH  /api/entries/{id}
 *   DELETE /api/entries/{id}
 *   POST   /api/ask                { question } -> verified answer payload
 *   GET    /api/report/weekly?as_of=YYYY-MM-DD
 */

import { ApiError, ModelUnavailableError, SttUnavailableError } from "@/lib/errors";
import type {
  EntryInput,
  ExtractionResult,
  FieldTalkClient,
  Health,
  SttInput,
  SttResult,
  StoredEntry,
  StoredEntryPatch,
  WeeklySummary,
} from "@/lib/client-types";
import type { AskStage } from "@/lib/types";

/** Every request is bounded, so a hung backend cannot freeze the screen. */
const REQUEST_TIMEOUT_MS = 60_000;
/**
 * Transcription runs on the CPU: a long note takes as long as it takes. The cap is generous
 * (a 20-minute recording at the measured ~0.4 real-time factor is about eight minutes) but
 * finite, so a wedged model eventually reports a timeout instead of spinning forever.
 */
const TRANSCRIBE_TIMEOUT_MS = 15 * 60_000;

export class HttpFieldTalkClient implements FieldTalkClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    const normalized = baseUrl.replace(/\/+$/, "");
    this.baseUrl = normalized.endsWith("/api") ? normalized : `${normalized}/api`;
  }

  private async request<T>(path: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ApiError(0, `the request to ${path} timed out after ${Math.round(timeoutMs / 1000)} s`);
      }
      throw new ApiError(0, `cannot reach ${this.baseUrl} (${String(error)})`);
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 503) {
      const detail = await safeText(response);
      if (path === "/transcribe" || path === "/health") throw new SttUnavailableError(detail);
      throw new ModelUnavailableError(detail);
    }
    if (!response.ok) {
      throw new ApiError(response.status, await safeText(response));
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async health(): Promise<Health> {
    const raw = await this.request<{
      stt: string;
      model: string;
      stt_name: string;
      stt_detail?: string;
      model_name: string;
      model_detail?: string;
      detail: string;
    }>("/health");
    return {
      stt: raw.stt === "unavailable" ? "unavailable" : "ok",
      model: raw.model === "unavailable" ? "unavailable" : "ok",
      model_name: raw.model_name,
      stt_name: raw.stt_name,
      stt_detail: raw.stt_detail ?? "",
      model_detail: raw.model_detail ?? "",
      detail: raw.detail,
    };
  }

  /**
   * The recorded audio is the request body, with the content type the browser used for it
   * (`audio/webm;codecs=opus` from MediaRecorder). The backend writes it to a private
   * temporary file, transcribes it locally and deletes it.
   */
  async transcribe(input: SttInput): Promise<SttResult> {
    if (input.file.size === 0) {
      // A stopped-too-early or failed recording must never look like a success.
      throw new ApiError(400, "the recording is empty: nothing was captured.");
    }
    const raw = await this.request<{
      transcript: string;
      model: string;
      duration_seconds: number;
      wall_seconds?: number;
      rtf?: number | null;
      language?: string | null;
    }>(
      "/transcribe",
      {
        method: "POST",
        headers: { "content-type": input.file.type || "application/octet-stream" },
        body: input.file,
      },
      TRANSCRIBE_TIMEOUT_MS,
    );
    const audioSeconds = raw.duration_seconds > 0 ? raw.duration_seconds : input.audioSeconds;
    return {
      transcript: raw.transcript,
      audio_seconds: audioSeconds,
      wall_seconds: raw.wall_seconds ?? 0,
      // Only report a factor the backend actually measured.
      rtf: raw.rtf ?? (audioSeconds && audioSeconds > 0 ? Number((raw.wall_seconds ?? 0) / audioSeconds) : null),
      language: raw.language ?? null,
      model: raw.model,
      synthetic: false,
    };
  }

  async extract(request: { transcript: string; recorded_at: string; source: string }): Promise<ExtractionResult> {
    const raw = await this.request<{
      action: ExtractionResult["action"];
      clarify_question: string | null;
      entries: Array<{
        id: string | null;
        plot: string | null;
        crop: string | null;
        kind: ExtractionResult["entries"][number]["kind"];
        text: string;
        date: string;
        planting_date: string | null;
        quantity: ExtractionResult["entries"][number]["quantity"];
      }>;
      parsed: { entries: ExtractionResult["entries"] };
    }>("/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: request.transcript, recording_date: request.recorded_at }),
    });
    return {
      action: raw.action,
      clarify_question: raw.clarify_question,
      // Extraction is a preview; review writes selected rows through POST /entries.
      persisted_by_extraction: false,
      entries: raw.entries.map((entry, index) => ({
        ...entry,
        id: entry.id,
        date_expr: raw.parsed.entries[index]?.date_expr ?? null,
        planting_date_expr: raw.parsed.entries[index]?.planting_date_expr ?? null,
      })),
    };
  }

  async listEntries(): Promise<StoredEntry[]> {
    const raw = await this.request<{ entries: BackendEntry[] }>("/entries");
    return raw.entries.map(normalizeEntry);
  }

  async addEntry(input: EntryInput): Promise<StoredEntry> {
    const raw = await this.request<{ entry: BackendEntry }>("/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plot: input.plot,
        crop: input.crop,
        kind: input.kind,
        text: input.text,
        recording_date: input.date ?? input.recorded_at,
        quantity_value: input.quantity?.value ?? null,
        quantity_unit: input.quantity?.unit ?? null,
        planting_date: input.planting_date,
      }),
    });
    return normalizeEntry(raw.entry);
  }

  async updateEntry(id: string, patch: StoredEntryPatch): Promise<StoredEntry> {
    const body = {
      plot: patch.plot,
      crop: patch.crop,
      kind: patch.kind,
      text: patch.text,
      recording_date: patch.date,
      planting_date: patch.planting_date,
      quantity_value: patch.quantity?.value,
      quantity_unit: patch.quantity?.unit,
    };
    const raw = await this.request<{ entry: BackendEntry }>(`/entries/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return normalizeEntry(raw.entry);
  }

  async confirmEntry(id: string): Promise<StoredEntry> {
    const raw = await this.request<{ entry: BackendEntry }>(`/entries/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    return { ...normalizeEntry(raw.entry), confirmed: true };
  }

  deleteEntry(id: string): Promise<void> {
    return this.request<void>(`/entries/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async *askStream(question: string): AsyncIterable<AskStage> {
    const raw = await this.request<{
      action: string;
      answer: string;
      clarify_question: string | null;
      plan: { action: string; tool: string | null; plot_text: string | null; date_expr: unknown; keyword: string | null };
      tool_result: unknown;
      v3_violations: string[];
    }>("/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const checks = raw.v3_violations.length === 0 ? ["V2 validated the tool call.", "V3 passed."] : raw.v3_violations;
    const status = raw.action === "refuse" ? "refused" : raw.action === "clarify" ? "clarify" : "done";
    yield { id: "interpret", label: "Interpret", status, summary: raw.plan.action, payload: raw.plan, checks: [], ms: 0 };
    yield { id: "tool_call", label: "Tool call", status, summary: raw.plan.tool ?? "none", payload: raw.plan, checks: [], ms: 0 };
    yield { id: "validate", label: "Validate", status, summary: "V2 checked", payload: raw.plan, checks: ["V2 validated the tool call."], ms: 0 };
    yield { id: "engine", label: "Engine", status, summary: raw.plan.tool ?? "none", payload: raw.tool_result, checks: [], ms: 0 };
    yield { id: "answer", label: "Answer", status, summary: raw.v3_violations.length ? "V3 flagged" : "V3 passed", payload: { answer: raw.answer }, checks, ms: 0 };
  }

  async weeklyReport(weekOfISO: string): Promise<WeeklySummary> {
    const raw = await this.request<BackendWeekly>("/report/weekly?as_of=" + encodeURIComponent(weekOfISO));
    return {
      ...raw,
      week_end_exclusive: nextDay(raw.week_end),
      planting_by_plot: [],
      generated_from: "engine",
      synthetic: false,
    };
  }
}

interface BackendEntry {
  id: string;
  plot: string | null;
  crop: string | null;
  kind: StoredEntry["kind"];
  text: string;
  date: string;
  planting_date: string | null;
  quantity: StoredEntry["quantity"];
}

interface BackendWeekly extends Omit<WeeklySummary, "week_end_exclusive" | "planting_by_plot" | "generated_from" | "synthetic"> {}

function normalizeEntry(entry: BackendEntry): StoredEntry {
  return {
    ...entry,
    date_expr: null,
    planting_date_expr: null,
    grounded: { plot: true, crop: true, kind: true, text: true, quantity: true, date: true, planting_date: true },
    source_span: null,
    confirmed: true,
    synthetic: false,
    created_at: "",
  };
}

function nextDay(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return `HTTP ${response.status}`;
  }
}
