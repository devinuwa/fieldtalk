"use client";

import Link from "next/link";
import { useState } from "react";

import { ExtractionReview } from "@/components/ExtractionReview";
import { ReadinessIndicator } from "@/components/ReadinessIndicator";
import { Recorder, type RecordedClip } from "@/components/Recorder";
import { SyntheticBadge } from "@/components/SyntheticBadge";
import { UploadBox } from "@/components/UploadBox";
import { AlertIcon, SpinnerIcon } from "@/components/icons";
import { formatSeconds } from "@/lib/audio";
import { isMockMode } from "@/lib/contract";
import { ModelUnavailableError, SttUnavailableError } from "@/lib/errors";
import { EXTRACT_TRANSCRIPTS } from "@/lib/mock/fixtures";
import { REFUSAL_STRING, SYNTHETIC_LABEL } from "@/lib/strings";
import { useApp } from "@/lib/store";
import type { Extraction, ExtractionResult, SttResult } from "@/lib/types";

/**
 * The recording screen: one continuous workflow.
 *
 *   Record → (Processing) → Transcribed → review → Save note / Ask a question / Discard
 *
 * A transcript is *not* a stored entry: it stays in this page until the extraction is
 * reviewed and stored. An empty or failed transcription is never saved.
 */
export default function RecordPage() {
  const { transcribe, extract, health, mock, today, addEntry, confirmEntry, deleteEntry, setPendingQuestion } = useApp();
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [mockClip, setMockClip] = useState("auto");
  const [stt, setStt] = useState<SttResult | null>(null);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState<"none" | "transcribing" | "extracting">("none");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const sttAvailable = health === null || health.stt === "ok";
  const phase: "empty" | "captured" | "processing" | "transcribed" =
    busy === "transcribing" ? "processing" : stt !== null ? "transcribed" : clip !== null ? "captured" : "empty";
  const transcriptEmpty = transcript.trim() === "";

  function accept(next: RecordedClip) {
    setClip(next);
    setStt(null);
    setResult(null);
    setSaved(null);
    setTranscript("");
    setMessage(null);
    // The workflow is one step, not two: the clip goes straight to the local engine.
    void runTranscribe(next);
  }

  function discard() {
    setClip(null);
    setStt(null);
    setResult(null);
    setSaved(null);
    setTranscript("");
    setMessage("Recording discarded. Nothing was stored.");
  }

  async function runTranscribe(target: RecordedClip | null = clip) {
    if (target === null) return;
    setBusy("transcribing");
    setMessage(null);
    setResult(null);
    setSaved(null);
    try {
      const sttResult = await transcribe({
        file: target.blob,
        name: target.name,
        audioSeconds: target.audioSeconds,
        mockTranscriptId: mock && mockClip !== "auto" ? mockClip : undefined,
      });
      setStt(sttResult);
      setTranscript(sttResult.transcript);
      if (sttResult.transcript.trim() === "") {
        setMessage(
          "The engine returned no words for this audio, so there is nothing to save. Try again closer to the microphone, or type the note on Entries.",
        );
      }
    } catch (cause) {
      setMessage(describeTranscribeFailure(cause));
    } finally {
      setBusy("none");
    }
  }

  async function saveNote() {
    if (transcriptEmpty) {
      setMessage("Nothing to save: the transcript is empty.");
      return;
    }
    setBusy("extracting");
    setMessage(null);
    setSaved(null);
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
          "The local model is unavailable, so automatic extraction is off. The transcript is kept in this page; type the note by hand on Entries, or start Ollama and try again.",
        );
      } else {
        setMessage(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setBusy("none");
    }
  }

  async function storeExtraction(entry: Extraction, sourceTranscript: string, recordedAt: string) {
    // Extraction is only a proposal. Selected rows are written after review through
    // the same entries API in mock and real modes.
    await addEntry({
      plot: entry.plot,
      crop: entry.crop,
      kind: entry.kind,
      text: entry.text,
      date: entry.date ?? null,
      date_expr: entry.date_expr,
      planting_date: entry.planting_date ?? null,
      planting_date_expr: entry.planting_date_expr,
      quantity: entry.quantity,
      recorded_at: recordedAt,
      grounded: { plot: true, crop: true, kind: true, text: true, quantity: true, date: true, planting_date: true },
      // The transcript the entry came from is the V1 evidence.
      source_span: sourceTranscript,
      confirmed: false,
    });
  }

  return (
    <div>
      <h2 className="text-xl font-bold">Record a note</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Speak your note. It is transcribed on this machine, you check the words, and only the entries
        you store end up in the notebook.
      </p>

      <div className="mt-3">
        <ReadinessIndicator compact />
      </div>

      {mock ? (
        <p className="mt-3 text-sm text-ink-soft">
          <SyntheticBadge /> — mock mode returns a synthetic transcript from eval/transcripts.jsonl.
          No audio is decoded and no speech model runs.
        </p>
      ) : null}

      {sttAvailable ? (
        <section className="card mt-4 p-4" data-testid="record-panel" data-phase={phase}>
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

          <div className="mt-3 flex flex-wrap items-center gap-3" data-testid="clip-summary">
            {clip === null ? (
              <p className="text-sm text-ink-soft">No clip yet.</p>
            ) : (
              <>
                <p className="text-sm">
                  <span className="font-semibold">{clip.name}</span> · {formatSeconds(clip.audioSeconds)}
                </p>
                <span
                  className="rounded-full border border-slate-line bg-surface-2 px-2 py-0.5 text-xs font-bold uppercase tracking-wide"
                  data-testid="phase-badge"
                >
                  {phase === "processing"
                    ? "Processing"
                    : phase === "transcribed"
                      ? "Transcribed"
                      : "Recorded"}
                </span>
              </>
            )}
          </div>
        </section>
      ) : (
        <p className="card mt-4 border-alert bg-alert-soft p-3 text-sm text-alert" data-testid="stt-off">
          Recording and transcription are off on this machine: the speech model is not in the local
          cache. Type your notes by hand on the{" "}
          <Link className="font-semibold underline" href="/entries/">
            Entries
          </Link>{" "}
          screen, or run the setup command shown in the readiness panel above.
        </p>
      )}

      {busy === "transcribing" ? (
        <section
          className="card mt-4 flex items-center gap-3 p-3 text-sm"
          role="status"
          data-testid="processing"
        >
          <SpinnerIcon />
          <span>Processing: transcribing locally, nothing leaves this machine…</span>
        </section>
      ) : null}

      {message !== null ? (
        <p
          className="mt-3 rounded-lg border border-alert bg-alert-soft px-3 py-2 text-sm text-alert"
          role="alert"
          data-testid="record-message"
        >
          {message}
        </p>
      ) : null}

      {stt !== null ? (
        <section className="card mt-4 p-3" data-testid="transcript">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-lg font-bold">
              Transcribed{stt.transcript.trim() === "" ? " (no words)" : ""}
            </h3>
            {stt.synthetic ? <SyntheticBadge compact /> : null}
            <span className="ml-auto font-mono text-xs text-ink-soft">{stt.model}</span>
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            This is a transcript, not a stored entry: nothing is written to the notebook until you
            store the entries below.
          </p>
          <label className="mt-2 block">
            <span className="field-label">Edit before extracting (fix spelling if you like)</span>
            <textarea
              className="input min-h-28 text-lg"
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
            />
          </label>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="stt-numbers">
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
            <div>
              <dt className="text-ink-soft">Language</dt>
              <dd className="font-semibold">{stt.language ?? "not reported in mock mode"}</dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void saveNote()}
              disabled={busy !== "none" || transcriptEmpty}
              className="rounded-lg bg-leaf px-4 py-2 font-semibold text-on-accent disabled:opacity-50"
              data-testid="save-note"
            >
              {busy === "extracting" ? "Saving…" : "Save note"}
            </button>
            <Link
              href="/ask/"
              onClick={() => setPendingQuestion(transcript)}
              aria-disabled={transcriptEmpty}
              className={`rounded-lg border border-sky px-4 py-2 font-semibold text-sky ${
                transcriptEmpty ? "pointer-events-none opacity-50" : ""
              }`}
            >
              Ask a question
            </Link>
            <button
              type="button"
              onClick={() => void runTranscribe()}
              disabled={busy !== "none" || clip === null}
              className="rounded-lg border border-slate-line px-4 py-2 font-semibold text-ink-soft disabled:opacity-50"
            >
              Transcribe again
            </button>
            <button
              type="button"
              onClick={discard}
              className="ml-auto flex items-center gap-1 rounded-lg border border-alert px-4 py-2 font-semibold text-alert"
              data-testid="discard"
            >
              <AlertIcon className="h-4 w-4" />
              Discard recording
            </button>
          </div>
          {transcriptEmpty ? (
            <p className="mt-2 text-sm text-alert" data-testid="empty-transcript">
              The transcript is empty, so it cannot be saved as a note. Record again, or type the
              words above by hand.
            </p>
          ) : null}
        </section>
      ) : null}

      {saved !== null ? (
        <p className="mt-3 rounded-lg border border-leaf bg-leaf-soft px-3 py-2 text-sm" data-testid="saved-note">
          {saved === 0
            ? "Nothing was stored."
            : `${saved} ${saved === 1 ? "entry" : "entries"} stored as “needs review”. `}
          {saved > 0 ? (
            <Link className="font-semibold underline" href="/entries/">
              Open Entries
            </Link>
          ) : null}
        </p>
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
            onConfirm={async (id) => {
              await confirmEntry(id);
            }}
            onStore={storeExtraction}
            onRemove={async (id) => {
              await deleteEntry(id);
            }}
            onSaved={(count) => setSaved(count)}
          />
        )
      ) : null}

      <p className="mt-6 text-xs text-ink-soft">
        {SYNTHETIC_LABEL} is always labelled. The model proposes entries; code resolves dates and
        computes every count. Recordings stay in memory and on this machine.
      </p>
      {isMockMode() ? (
        <p className="mt-1 text-xs text-ink-soft">
          Mock mode is on: no audio is decoded and no model runs. Set NEXT_PUBLIC_MOCK=0 to use the
          local backend and the local speech model.
        </p>
      ) : null}
    </div>
  );
}

function describeTranscribeFailure(cause: unknown): string {
  if (cause instanceof SttUnavailableError) {
    // The backend's message names the missing model and the command that fixes it.
    return `Speech-to-text is unavailable: ${cause.message}`;
  }
  return cause instanceof Error ? cause.message : String(cause);
}
