/**
 * Browser audio helpers. Everything is local: recordings are held in memory and the
 * only network call is to the loopback backend.
 *
 * The waveform helpers work on the byte frequency data of a Web Audio `AnalyserNode`,
 * i.e. on the actual microphone signal. Nothing here generates a decorative pattern.
 */

/** MediaRecorder MIME candidates, most preferred first. */
export const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const;

/** Documented alternatives, used in the "unsupported format" message. */
export const AUDIO_FORMAT_LIST = "webm/Opus, webm, ogg/Opus or mp4";

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return AUDIO_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia !== undefined
  );
}

/** Can this browser give us live microphone samples for the waveform? */
export function canAnalyse(): boolean {
  if (typeof window === "undefined") return false;
  const scope = window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
  return typeof (scope.AudioContext ?? scope.webkitAudioContext) === "function";
}

export function createAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

export function extensionForMime(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  return "webm";
}

/**
 * Turn one frame of `AnalyserNode.getByteFrequencyData` into `bars` values in 0..1 by
 * taking the peak of each bucket. Empty input gives all zeros, so a silent room draws a
 * flat line instead of a moving shape.
 */
export function waveformLevels(frequencies: ArrayLike<number>, bars = 32): number[] {
  if (bars <= 0) return [];
  const levels: number[] = [];
  const step = Math.max(1, Math.floor(frequencies.length / bars));
  for (let bar = 0; bar < bars; bar += 1) {
    let peak = 0;
    const from = bar * step;
    const to = Math.min(from + step, frequencies.length);
    for (let index = from; index < to; index += 1) {
      const value = frequencies[index] ?? 0;
      if (value > peak) peak = value;
    }
    levels.push(Math.min(1, peak / 255));
  }
  return levels;
}

/** An all-zero frame: silence, so the waveform must not pretend otherwise. */
export function isSilentFrame(levels: number[]): boolean {
  return levels.every((level) => level <= 0.02);
}

/** `mm:ss.d`, the clock shown while recording. */
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

/**
 * Measure how long an audio file is, using the browser's own metadata reader.
 * Returns null when the browser cannot decode the file, in which case the UI says so
 * instead of guessing.
 */
export function measureAudioSeconds(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof Audio === "undefined") {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    let settled = false;
    const finish = (seconds: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      resolve(seconds);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    audio.addEventListener("loadedmetadata", () => {
      window.clearTimeout(timer);
      const duration = audio.duration;
      finish(Number.isFinite(duration) && duration > 0 ? Number(duration.toFixed(2)) : null);
    });
    audio.addEventListener("error", () => {
      window.clearTimeout(timer);
      finish(null);
    });
    audio.preload = "metadata";
    audio.src = url;
  });
}

export function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "not measured";
  return `${seconds.toFixed(2)} s`;
}
