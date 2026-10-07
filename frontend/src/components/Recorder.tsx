"use client";

import { useEffect, useRef, useState } from "react";

import { canRecord, extensionForMime, pickMimeType } from "@/lib/audio";

export interface RecordedClip {
  blob: Blob;
  name: string;
  audioSeconds: number | null;
  /** Mock mode only: which bundled synthetic transcript stands in for the audio. */
  mockTranscriptId?: string;
}

/** Big record button. The recording stays in memory; nothing leaves the machine. */
export function Recorder({ onClip }: { onClip: (clip: RecordedClip) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "error">("idle");
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);

  const supported = canRecord();

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function start() {
    setMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const usedType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: usedType });
        stream.getTracks().forEach((track) => track.stop());
        const measured = (Date.now() - startedRef.current) / 1000;
        onClip({
          blob,
          name: `field-note.${extensionForMime(usedType)}`,
          audioSeconds: Number(measured.toFixed(2)),
        });
      };
      recorder.start();
      recorderRef.current = recorder;
      startedRef.current = Date.now();
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds((Date.now() - startedRef.current) / 1000);
      }, 200);
      setState("recording");
    } catch (cause) {
      setState("error");
      setMessage(
        `Microphone not available: ${cause instanceof Error ? cause.message : String(cause)}. Use the file upload instead.`,
      );
    }
  }

  function stop() {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setState("idle");
  }

  if (!supported) {
    return (
      <p className="rounded-lg border border-slate-line bg-white px-3 py-2 text-sm text-ink-soft">
        This browser cannot record audio. Use the file upload below.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (state === "recording" ? stop() : void start())}
          aria-pressed={state === "recording"}
          className={`flex h-24 w-24 flex-col items-center justify-center rounded-full text-sm font-bold text-white ${
            state === "recording" ? "bg-alert" : "bg-leaf"
          }`}
        >
          <span aria-hidden className="text-2xl">
            {state === "recording" ? "■" : "●"}
          </span>
          {state === "recording" ? "STOP" : "RECORD"}
        </button>
        <div>
          <p className="text-3xl font-bold tabular-nums" aria-live="polite">
            {seconds.toFixed(1)}s
          </p>
          <p className="text-sm text-ink-soft">
            {state === "recording" ? "Recording… tap STOP when you finish" : "Tap to record a note"}
          </p>
        </div>
      </div>
      {message !== null ? <p className="mt-2 text-sm text-alert">{message}</p> : null}
    </div>
  );
}
