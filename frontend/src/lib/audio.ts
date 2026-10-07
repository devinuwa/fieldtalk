/**
 * Browser audio helpers. Everything is local: recordings are held in memory and the
 * only network call is to the loopback backend.
 */

/** MediaRecorder MIME candidates, most preferred first. */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia !== undefined
  );
}

export function extensionForMime(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  return "webm";
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
