/**
 * HTTP client for the real backend (used when NEXT_PUBLIC_MOCK=0).
 *
 * Endpoints, all on 127.0.0.1 (hard rule 5: no cloud calls at runtime):
 *   GET    /health
 *   POST   /stt                    multipart audio -> transcript + timing
 *   POST   /extract                { transcript, recorded_at, source } -> closed-schema result
 *   GET    /entries
 *   POST   /entries                manual entry
 *   PATCH  /entries/{id}
 *   POST   /entries/{id}/confirm
 *   DELETE /entries/{id}
 *   POST   /ask                    { question } -> newline-delimited AskStage stream
 *   GET    /report/weekly?week_of=YYYY-MM-DD
 *
 * The backend is being built in parallel; if a shape differs, adjust here only.
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

export class HttpFieldTalkClient implements FieldTalkClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, init);
    } catch (error) {
      throw new ApiError(0, `cannot reach ${this.baseUrl} (${String(error)})`);
    }
    if (response.status === 503) {
      const detail = await safeText(response);
      if (path === "/stt" || path === "/health") throw new SttUnavailableError(detail);
      throw new ModelUnavailableError(detail);
    }
    if (!response.ok) {
      throw new ApiError(response.status, await safeText(response));
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  health(): Promise<Health> {
    return this.request<Health>("/health");
  }

  async transcribe(input: SttInput): Promise<SttResult> {
    const form = new FormData();
    form.append("audio", input.file, input.name);
    if (input.audioSeconds !== null) form.append("audio_seconds", String(input.audioSeconds));
    return this.request<SttResult>("/stt", { method: "POST", body: form });
  }

  extract(request: { transcript: string; recorded_at: string; source: string }): Promise<ExtractionResult> {
    return this.request<ExtractionResult>("/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  listEntries(): Promise<StoredEntry[]> {
    return this.request<StoredEntry[]>("/entries");
  }

  addEntry(input: EntryInput): Promise<StoredEntry> {
    return this.request<StoredEntry>("/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  updateEntry(id: string, patch: StoredEntryPatch): Promise<StoredEntry> {
    return this.request<StoredEntry>(`/entries/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  confirmEntry(id: string): Promise<StoredEntry> {
    return this.request<StoredEntry>(`/entries/${encodeURIComponent(id)}/confirm`, { method: "POST" });
  }

  deleteEntry(id: string): Promise<void> {
    return this.request<void>(`/entries/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async *askStream(question: string): AsyncIterable<AskStage> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify({ question }),
      });
    } catch (error) {
      throw new ApiError(0, `cannot reach ${this.baseUrl} (${String(error)})`);
    }
    if (response.status === 503) throw new ModelUnavailableError(await safeText(response));
    if (!response.ok || response.body === null) {
      throw new ApiError(response.status, await safeText(response));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() === "") continue;
        yield JSON.parse(line) as AskStage;
      }
    }
    if (buffer.trim() !== "") yield JSON.parse(buffer) as AskStage;
  }

  weeklyReport(weekOfISO: string): Promise<WeeklySummary> {
    return this.request<WeeklySummary>(`/report/weekly?week_of=${encodeURIComponent(weekOfISO)}`);
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return `HTTP ${response.status}`;
  }
}
