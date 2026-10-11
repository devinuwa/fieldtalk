/**
 * The audio helpers the recorder depends on. These are pure, so they are the cheapest place
 * to pin down the parts that must not lie: the waveform follows the samples it is given
 * (flat for silence), the format list matches what the browser supports, and an unknown
 * audio length stays unknown instead of becoming a made-up number.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUDIO_MIME_CANDIDATES,
  canAnalyse,
  canRecord,
  extensionForMime,
  formatClock,
  formatSeconds,
  isSilentFrame,
  pickMimeType,
  waveformLevels,
} from "@/lib/audio";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("waveform levels", () => {
  it("turns analyser buckets into bar heights in 0..1", () => {
    const frequencies = new Uint8Array(64);
    frequencies[0] = 255; // loudest possible sample in the first bucket
    const levels = waveformLevels(frequencies, 8);
    expect(levels).toHaveLength(8);
    expect(levels[0]).toBeCloseTo(1, 5);
    expect(levels.slice(1)).toEqual(new Array(7).fill(0));
  });

  it("draws a flat line for silence instead of a moving shape", () => {
    const levels = waveformLevels(new Uint8Array(128), 16);
    expect(levels).toEqual(new Array(16).fill(0));
    expect(isSilentFrame(levels)).toBe(true);
  });

  it("is silent only when every bar is silent", () => {
    const levels = waveformLevels(new Uint8Array(32), 4);
    levels[3] = 0.5;
    expect(isSilentFrame(levels)).toBe(false);
  });

  it("copes with fewer samples than bars and with no bars", () => {
    expect(waveformLevels(new Uint8Array(3), 8)).toHaveLength(8);
    expect(waveformLevels(new Uint8Array(32), 0)).toEqual([]);
  });
});

describe("recording support", () => {
  it("reports no recording support when MediaRecorder is missing", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(canRecord()).toBe(false);
    expect(pickMimeType()).toBeUndefined();
  });

  it("picks the first format the browser reports as supported", () => {
    vi.stubGlobal(
      "MediaRecorder",
      class {
        static isTypeSupported(type: string) {
          return type === "audio/webm";
        }
      },
    );
    expect(pickMimeType()).toBe("audio/webm");
    expect(AUDIO_MIME_CANDIDATES).toContain("audio/webm");
  });

  it("maps a MIME type to a file extension", () => {
    expect(extensionForMime("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionForMime("audio/ogg")).toBe("ogg");
    expect(extensionForMime("audio/mp4")).toBe("m4a");
  });

  it("detects whether a live waveform is possible", () => {
    vi.stubGlobal("window", { AudioContext: class {} });
    expect(canAnalyse()).toBe(true);
    vi.stubGlobal("window", {});
    expect(canAnalyse()).toBe(false);
  });
});

describe("formatting", () => {
  it("formats the recording clock as mm:ss.d", () => {
    expect(formatClock(0)).toBe("00:00.0");
    expect(formatClock(9.4)).toBe("00:09.4");
    expect(formatClock(125)).toBe("02:05.0");
    expect(formatClock(Number.NaN)).toBe("00:00.0");
  });

  it("says an unknown length is unknown", () => {
    expect(formatSeconds(null)).toBe("not measured");
    expect(formatSeconds(3.456)).toBe("3.46 s");
  });
});
