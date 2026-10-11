"use client";

/**
 * Browser recording, in one reusable hook.
 *
 * - permission is requested only when `start()` is called (never on load);
 * - the MIME type is detected from what the browser actually supports;
 * - the waveform values come from a Web Audio `AnalyserNode` fed by the microphone
 *   stream, so they follow the real input and go flat in a silent room;
 * - the microphone tracks are released on stop, on error and on unmount;
 * - a recording that produced no bytes is an error, never an empty "success";
 * - nothing is uploaded anywhere: the clip is handed to `onClip` as a Blob.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AUDIO_FORMAT_LIST,
  canAnalyse,
  canRecord,
  createAudioContext,
  extensionForMime,
  pickMimeType,
  waveformLevels,
} from "@/lib/audio";

export type RecorderStatus = "idle" | "requesting" | "recording" | "error";

export interface RecordedClip {
  blob: Blob;
  name: string;
  /** Measured audio length in seconds, or null when it could not be measured. */
  audioSeconds: number | null;
  /** Mock mode only: which bundled synthetic transcript stands in for the audio. */
  mockTranscriptId?: string;
}

export interface RecorderHandle {
  status: RecorderStatus;
  /** True after browser recording capabilities have been checked on the client. */
  capabilitiesReady: boolean;
  /** Seconds since recording started. */
  seconds: number;
  /** Live waveform values (0..1) from the microphone; the last frame is kept after stop. */
  levels: number[];
  /** Human-readable problem, or null. */
  error: string | null;
  /** The MIME type actually used by MediaRecorder, when known. */
  mimeType: string | null;
  /** False when this browser cannot record at all (use the upload instead). */
  supported: boolean;
  /** False when the browser records but cannot feed a live waveform. */
  analyserAvailable: boolean;
  start: () => Promise<void>;
  stop: () => void;
  /** Clear the error and the timer for a fresh attempt. */
  reset: () => void;
}

export interface UseRecorderOptions {
  onClip: (clip: RecordedClip) => void;
  /** Number of waveform bars. */
  bars?: number;
}

const WAVEFORM_BARS = 32;
const TICK_MS = 200;

export function useRecorder({ onClip, bars = WAVEFORM_BARS }: UseRecorderOptions): RecorderHandle {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => new Array(bars).fill(0));
  const [error, setError] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const [analyserAvailable, setAnalyserAvailable] = useState(false);
  const [capabilitiesReady, setCapabilitiesReady] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stoppedRef = useRef(false);
  const onClipRef = useRef(onClip);
  onClipRef.current = onClip;

  useEffect(() => {
    setSupported(canRecord());
    setAnalyserAvailable(canAnalyse());
    setCapabilitiesReady(true);
  }, []);

  const releaseMicrophone = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    analyserRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context !== null && context.state !== "closed") void context.close();
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const drawWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    if (analyser === null) return;
    const frame = new Uint8Array(analyser.frequencyBinCount);
    const render = () => {
      const current = analyserRef.current;
      if (current === null) return;
      current.getByteFrequencyData(frame);
      setLevels(waveformLevels(frame, bars));
      setSeconds((Date.now() - startedAtRef.current) / 1000);
      frameRef.current = window.requestAnimationFrame(render);
    };
    frameRef.current = window.requestAnimationFrame(render);
  }, [bars]);

  const start = useCallback(async () => {
    setError(null);
    setLevels(new Array(bars).fill(0));
    stoppedRef.current = false;

    if (!canRecord()) {
      setStatus("error");
      setError("This browser cannot record audio. Upload an audio file instead.");
      return;
    }

    setStatus("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      setStatus("error");
      setError(describeMicrophoneError(cause));
      return;
    }
    streamRef.current = stream;

    const selected = pickMimeType();
    if (selected === undefined) {
      releaseMicrophone();
      setStatus("error");
      setError(
        `This browser cannot record in a supported audio format (tried ${AUDIO_FORMAT_LIST}). Upload an audio file instead.`,
      );
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: selected });
    } catch (cause) {
      releaseMicrophone();
      setStatus("error");
      setError(
        `Recording could not start with ${selected}: ${messageOf(cause)}. Upload an audio file instead.`,
      );
      return;
    }

    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      releaseMicrophone();
      setStatus("error");
      setError("The recording was interrupted by the browser. Nothing was saved; try again.");
    };
    recorder.onstop = () => {
      const usedType = recorder.mimeType || selected;
      const blob = new Blob(chunksRef.current, { type: usedType });
      chunksRef.current = [];
      const measured = (Date.now() - startedAtRef.current) / 1000;
      releaseMicrophone();
      if (blob.size === 0) {
        // A failed or stopped-immediately recording is an error, never an empty note.
        setStatus("error");
        setError("The recording is empty: nothing was captured. Check the microphone and try again.");
        return;
      }
      setMimeType(usedType);
      setSeconds(measured);
      setStatus("idle");
      onClipRef.current({
        blob,
        name: `field-note.${extensionForMime(usedType)}`,
        audioSeconds: Number(measured.toFixed(2)),
      });
    };

    try {
      recorder.start(250); // periodic chunks: an interrupted recording still has data
    } catch (cause) {
      releaseMicrophone();
      setStatus("error");
      setError(`Recording could not start: ${messageOf(cause)}.`);
      return;
    }

    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setSeconds(0);
    setMimeType(selected);

    const context = createAudioContext();
    if (context !== null) {
      try {
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);
        audioContextRef.current = context;
        analyserRef.current = analyser;
        drawWaveform();
      } catch {
        // The waveform is a view of the audio, not the audio itself: recording continues.
        analyserRef.current = null;
      }
    }

    timerRef.current = window.setInterval(() => {
      setSeconds((Date.now() - startedAtRef.current) / 1000);
    }, TICK_MS);
    setStatus("recording");
  }, [bars, drawWaveform, releaseMicrophone]);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    stoppedRef.current = true;
    if (recorder !== null && recorder.state !== "inactive") {
      recorder.stop(); // onstop builds the clip and releases the microphone
    } else {
      releaseMicrophone();
      setStatus("idle");
    }
  }, [releaseMicrophone]);

  const reset = useCallback(() => {
    setError(null);
    setSeconds(0);
    setLevels(new Array(bars).fill(0));
    setStatus("idle");
  }, [bars]);

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder !== null && recorder.state !== "inactive") {
        recorder.onstop = null; // unmounting: no clip, just release the device
        recorder.stop();
      }
      releaseMicrophone();
    };
  }, [releaseMicrophone]);

  return {
    status,
    capabilitiesReady,
    seconds,
    levels,
    error,
    mimeType,
    supported,
    analyserAvailable,
    start,
    stop,
    reset,
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Every getUserMedia failure the field turns up, with the fix rather than the code. */
export function describeMicrophoneError(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Microphone permission was denied. Allow it for this page, or upload an audio file instead.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was found on this machine. Plug one in, or upload an audio file instead.";
    case "NotReadableError":
    case "TrackStartError":
      return "The microphone is already in use by another program. Close it, or upload an audio file instead.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "This microphone does not support the requested settings. Try another device.";
    case "SecurityError":
      return "Microphone access needs a secure context (https or localhost). Open the app on localhost.";
    default:
      return `The microphone could not be opened: ${messageOf(cause)}. Upload an audio file instead.`;
  }
}
