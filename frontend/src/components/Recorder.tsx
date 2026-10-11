"use client";

import { AlertIcon, MicIcon, StopIcon } from "@/components/icons";
import { Waveform } from "@/components/Waveform";
import { formatClock } from "@/lib/audio";
import { useRecorder, type RecordedClip } from "@/lib/use-recorder";

export type { RecordedClip } from "@/lib/use-recorder";

/**
 * The primary recording control: a big circular microphone button, a live waveform fed by
 * the real microphone, a timer and the idle / requesting / recording / error states.
 *
 * The microphone is opened only when the button is pressed. The clip is delivered as a
 * Blob through `onClip`; the recording stays in memory and is only sent to the loopback
 * backend when the user asks for a transcript.
 */
export function Recorder({ onClip }: { onClip: (clip: RecordedClip) => void }) {
  const {
    status,
    seconds,
    levels,
    error,
    supported,
    capabilitiesReady,
    analyserAvailable,
    start,
    stop,
  } = useRecorder({ onClip });

  const recording = status === "recording";
  const requesting = status === "requesting";
  const statusLabel =
    status === "recording"
      ? "Recording"
      : status === "requesting"
        ? "Requesting the microphone…"
        : status === "error"
          ? "Recording failed"
          : "Ready";

  if (!capabilitiesReady) {
    return (
      <p
        className="rounded-lg border border-slate-line bg-surface-2 px-3 py-2 text-sm text-ink-soft"
        data-testid="recorder-initializing"
      >
        Checking microphone support…
      </p>
    );
  }

  if (!supported) {
    return (
      <p className="rounded-lg border border-slate-line bg-surface-2 px-3 py-2 text-sm text-ink-soft" data-testid="recorder-unsupported">
        This browser cannot record audio. Use the file upload below.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative">
        {recording ? (
          <span
            aria-hidden
            className="absolute inset-0 animate-ping rounded-full bg-alert/30"
            data-testid="recording-pulse"
          />
        ) : null}
        <button
          type="button"
          onClick={() => (recording ? stop() : void start())}
          disabled={requesting}
          aria-pressed={recording}
          aria-label={recording ? "Stop recording" : "Start recording"}
          data-testid="record-button"
          data-status={status}
          className={`relative flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-full font-semibold shadow-lg transition disabled:opacity-60 ${
            recording
              ? "bg-alert text-on-accent ring-4 ring-alert/30"
              : "bg-leaf text-on-accent hover:brightness-110"
          }`}
        >
          {recording ? <StopIcon /> : <MicIcon className="h-10 w-10" />}
          <span className="text-xs font-bold uppercase tracking-wider">
            {recording ? "Stop" : requesting ? "Wait" : "Record"}
          </span>
        </button>
      </div>

      <div className="w-full flex-1">
        <div className="flex items-baseline gap-3">
          <p className="font-mono text-3xl font-bold tabular-nums" aria-live="polite" data-testid="record-timer">
            {formatClock(seconds)}
          </p>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
              recording
                ? "border-alert bg-alert-soft text-alert"
                : status === "error"
                  ? "border-alert bg-alert-soft text-alert"
                  : "border-slate-line bg-surface-2 text-ink-soft"
            }`}
            data-testid="recorder-state"
          >
            {statusLabel}
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          {recording
            ? "Speak your note, then press Stop. It stays on this machine."
            : "Press Record to speak a note. Nothing is uploaded anywhere."}
        </p>
        <Waveform levels={levels} live={recording} className="mt-3" />
        {recording && !analyserAvailable ? (
          <p className="mt-1 text-xs text-soil" data-testid="waveform-unavailable">
            This browser cannot show a live waveform, but the recording is still running.
          </p>
        ) : null}
      </div>

      {error !== null ? (
        <p
          className="flex w-full items-start gap-2 rounded-lg border border-alert bg-alert-soft px-3 py-2 text-sm text-alert sm:w-auto"
          role="alert"
          data-testid="recorder-error"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
