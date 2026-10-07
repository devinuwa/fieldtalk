"use client";

import Link from "next/link";
import { useState } from "react";

import { ExtractionReview } from "@/components/ExtractionReview";
import { Recorder, type RecordedClip } from "@/components/Recorder";
import { SyntheticBadge } from "@/components/SyntheticBadge";
import { UploadBox } from "@/components/UploadBox";
import { formatSeconds } from "@/lib/audio";
import { EXTRACT_TRANSCRIPTS } from "@/lib/mock/fixtures";
import { isMockMode } from "@/lib/contract";
import { ModelUnavailableError } from "@/lib/errors";
import { REFUSAL_STRING, SYNTHETIC_LABEL } from "@/lib/strings";
import { useApp } from "@/lib/store";
import type { ExtractionResult, SttResult } from "@/lib/types";

export default function RecordPage() {
  const { transcribe, extract, health, mock, today } = useApp();
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [mockClip, setMockClip] = useState("auto");
  const [stt, setStt] = useState<SttResult | null>(null);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState<"none" | "transcribing" | "extracting">("none");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);

  const sttAvailable = health === null || health.stt === "ok";

  function accept(next: RecordedClip) {
    setClip(next);
    setStt(null);
    setResult(null);
    setTranscript("");
    setMessage(null);
  }

  async function runTranscribe() {
    if (clip === null) return;
    setBusy("transcribing");
    setMessage(null);
    setResult(null);
    try {
      const sttResult = await transcribe({
        file: clip.blob,
        name: clip.name,
        audioSeconds: clip.audioSeconds,
        mockTranscriptId: mock && mockClip !== "auto" ? mockClip : undefined,
      });
      setStt(sttResult);
      setTranscript(sttResult.transcript);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("none");
    }
  }

  async function runExtract() {
    setBusy("extracting");
    setMessage(null);
    try {
      setResult(
        await extract({
          transcript,
          recorded_at: today,
          source: clip === null ? "typed" : clip.name.startsWith("field-note") ? "recording" : "upload",
        }),
      );
    } catch (cause) {
      if (cause instanceof ModelUnavailableError) {
        setMessage(
          "The local model is unavailable, so automatic extraction is off. Transcribe only, or type the note by hand in Entries.",
        );
      } else {
        setMessage(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setBusy("none");
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold">Record or upload a note</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Speak your note, check the transcript, then let the model propose entries. Nothing is stored
        until you confirm it.
      </p>
      {mock ? (
        <p className="mt-2 text-sm">
          <SyntheticBadge /> — mock mode returns a synthetic transcript from
          eval/transcripts.jsonl. No audio is decoded and no model runs.
        </p>
      ) : null}

      {sttAvailable ? (
        <section className="card mt-4 p-3">
          <Recorder onClip={accept} />
          <hr className="my-4 border-slate-line" />
          <UploadBox onClip={accept} />

          {mock ? (
            <div className="mt-3">
              <label className="field-label" htmlFor="mock-clip">
                Mock mode: which synthetic transcript stands in for the audio?
              </label>
              <select
                id="mock-clip"
                className="input"
                value={mockClip}
                onChange={(event) => setMockClip(event.target.value)}
              >
                <option value="auto">auto (chosen from the file name)</option>
                {EXTRACT_TRANSCRIPTS.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.id}: {row.transcript.slice(0, 44)}…
                  </option>
                ))}
                <option value="X01">X01: refusal case</option>
                <option value="X02">X02: vague case</option>
              </select>
            </div>
          ) : null}

          {clip !== null ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-sm">
                <span className="font-semibold">{clip.name}</span> ·{" "}
                {formatSeconds(clip.audioSeconds)}
              </p>
              <button
                type="button"
                onClick={() => void runTranscribe()}
                disabled={busy !== "none"}
                className="rounded-lg bg-leaf px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {busy === "transcribing" ? "Transcribing…" : "Transcribe"}
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-soft">No clip yet.</p>
          )}
        </section>
      ) : (
        <p className="card mt-4 border-alert bg-alert-soft p-3 text-sm text-alert">
          Recording and transcription are off on this machine. Type your notes by hand on the{" "}
          <Link className="font-semibold underline" href="/entries/">
            Entries
          </Link>{" "}
          screen.
        </p>
      )}

      {message !== null ? (
        <p className="mt-3 rounded-lg border border-alert bg-alert-soft px-3 py-2 text-sm text-alert">
          {message}
        </p>
      ) : null}

      {stt !== null ? (
        <section className="card mt-4 p-3" data-testid="transcript">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-lg font-bold">Transcript</h3>
            {stt.synthetic ? <SyntheticBadge compact /> : null}
            <span className="ml-auto font-mono text-xs text-ink-soft">{stt.model}</span>
          </div>
          <label className="mt-2 block">
            <span className="field-label">Edit before extracting (fix spelling if you like)</span>
            <textarea
              className="input min-h-28 text-lg"
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
            />
          </label>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-sm" data-testid="stt-numbers">
            <div>
              <dt className="text-ink-soft">Audio</dt>
              <dd className="font-semibold">{formatSeconds(stt.audio_seconds)}</dd>
            </div>
            <div>
              <dt className="text-ink-soft">Transcribing</dt>
              <dd className="font-semibold">{formatSeconds(stt.wall_seconds)}</dd>
            </div>
            <div>
              <dt className="text-ink-soft">Real-time factor</dt>
              <dd className="font-semibold">
                {stt.rtf === null ? "not measurable in mock mode" : stt.rtf.toFixed(2)}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => void runExtract()}
            disabled={busy !== "none" || transcript.trim() === ""}
            className="mt-3 rounded-lg bg-leaf px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            {busy === "extracting" ? "Extracting…" : "Extract entries"}
          </button>
        </section>
      ) : null}

      {result !== null ? (
        result.action === "refuse" ? (
          <section className="mt-4 rounded-xl border border-alert bg-alert-soft p-3" data-testid="refusal">
            <h3 className="font-bold text-alert">Refused by design</h3>
            <p className="mt-1">{REFUSAL_STRING}</p>
          </section>
        ) : result.action === "clarify" ? (
          <section className="mt-4 rounded-xl border border-soil bg-soil-soft p-3" data-testid="clarify">
            <h3 className="font-bold text-soil">The note needs one more detail</h3>
            <p className="mt-1">{result.clarify_question}</p>
            <p className="mt-2 text-sm text-ink-soft">
              Nothing was stored. Edit the transcript above and extract again, or add the entry by
              hand on the Entries screen.
            </p>
          </section>
        ) : (
          <ExtractionReview
            result={result}
            transcript={transcript}
            recordedAt={today}
            onSaved={() => undefined}
          />
        )
      ) : null}

      <p className="mt-6 text-xs text-ink-soft">
        {SYNTHETIC_LABEL} is always labelled. The model proposes entries; code resolves dates and
        computes every count.
      </p>
    </div>
  );
}
