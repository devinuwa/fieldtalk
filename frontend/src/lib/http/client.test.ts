/**
 * The real backend client. `fetch` is stubbed, so these tests pin down the wire contract:
 * the recorded audio goes out as the request body with its own content type, the measured
 * numbers come back as measured numbers, and the backend's failure messages reach the UI
 * (they are the setup instructions).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, SttUnavailableError } from "@/lib/errors";
import { HttpFieldTalkClient } from "@/lib/http/client";

const BASE = "http://127.0.0.1:8000";

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  });
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpFieldTalkClient.transcribe", () => {
  it("posts the audio bytes as the body and reports the measured numbers", async () => {
    const calls = stubFetch(() =>
      json({
        transcript: "plot 1 maize knee high",
        model: "faster-whisper base (cpu, int8)",
        duration_seconds: 8.34,
        wall_seconds: 3.29,
        rtf: 0.394,
        language: "en",
        synthetic: false,
      }),
    );
    const clip = new Blob(["recorded-bytes"], { type: "audio/webm;codecs=opus" });

    const result = await new HttpFieldTalkClient(BASE).transcribe({
      file: clip,
      name: "field-note.webm",
      audioSeconds: 8.4,
    });

    expect(calls[0].url).toBe(`${BASE}/api/transcribe`);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBe(clip); // the recording itself, not a description of it
    expect((calls[0].init?.headers as Record<string, string>)["content-type"]).toBe("audio/webm;codecs=opus");
    expect(result.transcript).toBe("plot 1 maize knee high");
    expect(result.audio_seconds).toBe(8.34);
    expect(result.wall_seconds).toBe(3.29);
    expect(result.rtf).toBe(0.394);
    expect(result.language).toBe("en");
    expect(result.synthetic).toBe(false);
  });

  it("computes the real-time factor only when the backend did not report one", async () => {
    stubFetch(() =>
      json({ transcript: "hello", model: "m", duration_seconds: 4, wall_seconds: 2, language: "en" }),
    );
    const result = await new HttpFieldTalkClient(BASE).transcribe({
      file: new Blob(["x"], { type: "audio/webm" }),
      name: "clip.webm",
      audioSeconds: null,
    });
    expect(result.rtf).toBe(0.5);
  });

  it("keeps an unknown audio length unknown", async () => {
    stubFetch(() => json({ transcript: "hi", model: "m", duration_seconds: 0, wall_seconds: 1 }));
    const result = await new HttpFieldTalkClient(BASE).transcribe({
      file: new Blob(["x"], { type: "audio/webm" }),
      name: "clip.webm",
      audioSeconds: null,
    });
    expect(result.audio_seconds).toBeNull();
    expect(result.rtf).toBeNull();
  });

  it("surfaces the setup instructions when the model is missing (503)", async () => {
    stubFetch(() =>
      json(
        {
          detail:
            "Speech-to-text model 'base' is not in the local model cache. Download it once at setup: backend/.venv/Scripts/python.exe backend/scripts/stt_download.py base",
        },
        503,
      ),
    );
    const error = await new HttpFieldTalkClient(BASE)
      .transcribe({ file: new Blob(["x"], { type: "audio/webm" }), name: "clip.webm", audioSeconds: 1 })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(SttUnavailableError);
    expect((error as Error).message).toContain("stt_download.py base"); // actionable, not just "failed"
  });

  it("never sends an empty recording to the backend", async () => {
    const calls = stubFetch(() => json({ transcript: "should not be used", model: "m", duration_seconds: 0 }));
    const error = await new HttpFieldTalkClient(BASE)
      .transcribe({ file: new Blob([]), name: "field-note.webm", audioSeconds: 0 })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(0);
  });

  it("reports a rejected body as an ApiError with the backend's reason", async () => {
    stubFetch(() => json({ detail: "content type 'text/plain' is not supported" }, 415));
    const error = await new HttpFieldTalkClient(BASE)
      .transcribe({ file: new Blob(["x"], { type: "text/plain" }), name: "clip.txt", audioSeconds: 1 })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(415);
    expect((error as Error).message).toContain("not supported");
  });
});

describe("HttpFieldTalkClient.health", () => {
  it("maps each dependency and keeps the reason", async () => {
    const calls = stubFetch(() =>
      json({
        backend: "ok",
        stt: "ok",
        stt_name: "faster-whisper base (cpu, int8)",
        stt_detail: "present in the local cache",
        model: "unavailable",
        model_name: "gemma3:4b",
        model_detail: "Ollama is not reachable at http://127.0.0.1:11434",
        detail: "mixed",
      }),
    );
    const health = await new HttpFieldTalkClient(BASE).health();
    expect(calls[0].url).toBe(`${BASE}/api/health`);
    expect(health.stt).toBe("ok");
    expect(health.model).toBe("unavailable");
    expect(health.stt_name).toContain("faster-whisper");
    expect(health.model_detail).toContain("not reachable");
  });

  it("accepts an API-prefixed base URL without duplicating the prefix", async () => {
    const calls = stubFetch(() =>
      json({
        backend: "ok",
        stt: "ok",
        stt_name: "local stt",
        stt_detail: "ready",
        model: "ok",
        model_name: "local model",
        model_detail: "ready",
        detail: "ready",
      }),
    );

    await new HttpFieldTalkClient(`${BASE}/api/`).health();

    expect(calls[0].url).toBe(`${BASE}/api/health`);
  });

  it("maps entry edits to the backend entry payload", async () => {
    const calls = stubFetch(() =>
      json({
        entry: {
          id: "entry-1",
          plot: "plot 2",
          crop: "beans",
          kind: "observation",
          text: "beans are flowering",
          date: "2026-10-11",
          planting_date: "2026-10-01",
          quantity: { value: 3, unit: "rows" },
        },
      }),
    );

    await new HttpFieldTalkClient(BASE).updateEntry("entry-1", {
      plot: "plot 2",
      crop: "beans",
      kind: "observation",
      text: "beans are flowering",
      date: "2026-10-11",
      planting_date: "2026-10-01",
      quantity: { value: 3, unit: "rows" },
    });

    expect(calls[0].url).toBe(`${BASE}/api/entries/entry-1`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      plot: "plot 2",
      crop: "beans",
      kind: "observation",
      text: "beans are flowering",
      recording_date: "2026-10-11",
      planting_date: "2026-10-01",
      quantity_value: 3,
      quantity_unit: "rows",
    });
  });

  describe("HttpFieldTalkClient.extract", () => {
    it("returns resolved dates as an unpersisted review proposal", async () => {
      const calls = stubFetch(() =>
        json({
          id: null,
          action: "run",
          clarify_question: null,
          entries: [
            {
              id: null,
              plot: "plot 2",
              crop: "beans",
              kind: "observation",
              text: "beans are flowering",
              date: "2026-10-11",
              planting_date: "2026-10-01",
              quantity: null,
            },
          ],
          parsed: {
            entries: [{ date_expr: null, planting_date_expr: null }],
          },
        }),
      );

      const result = await new HttpFieldTalkClient(BASE).extract({
        transcript: "Plot 2, beans are flowering.",
        recorded_at: "2026-10-11",
        source: "recording",
      });

      expect(calls[0].url).toBe(`${BASE}/api/extract`);
      expect(result.persisted_by_extraction).toBe(false);
      expect(result.entries[0]).toMatchObject({
        id: null,
        date: "2026-10-11",
        planting_date: "2026-10-01",
      });
    });
  });

  it("gives up on a hung backend instead of spinning forever", async () => {
    vi.useFakeTimers();
    try {
      // A fetch that never settles: only the abort signal can end it.
      vi.stubGlobal("fetch", (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
      );
      const pending = new HttpFieldTalkClient(BASE)
        .transcribe({ file: new Blob(["x"], { type: "audio/webm" }), name: "clip.webm", audioSeconds: 2 })
        .catch((cause: unknown) => cause);
      // Transcription is allowed to take minutes, but not forever.
      await vi.advanceTimersByTimeAsync(15 * 60_000 + 1);
      const error = await pending;
      expect(error).toBeInstanceOf(ApiError);
      expect((error as Error).message).toContain("timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an unreachable backend instead of pretending everything is fine", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const error = await new HttpFieldTalkClient(BASE)
      .health()
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as Error).message).toContain("cannot reach");
  });
});
