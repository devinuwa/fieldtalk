// React 19 needs this flag for `act(...)` in a test renderer environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * @vitest-environment jsdom
 *
 * The recording hook, driven by fakes that behave like the browser: a MediaRecorder that
 * emits chunks (or nothing, or an error), a getUserMedia that resolves or is denied, and an
 * AnalyserNode that reports a level. Every assertion is about what the hook does with that
 * input — when the microphone is opened, what the clip contains, and that a failed
 * recording is never handed on as a clip.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRecorder, type RecordedClip, type RecorderHandle } from "@/lib/use-recorder";

/* ------------------------------------------------------------------ fakes */

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeMediaRecorder {
  static supported = true;
  static emitChunks = true;
  static failOnStart = false;
  static instances: FakeMediaRecorder[] = [];

  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  startedWith: number | null = null;
  readonly track: FakeTrack;

  static isTypeSupported(type: string) {
    return FakeMediaRecorder.supported && type === "audio/webm;codecs=opus";
  }

  constructor(
    private readonly stream: { getTracks: () => FakeTrack[] },
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? "";
    this.track = stream.getTracks()[0];
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice?: number) {
    if (FakeMediaRecorder.failOnStart) throw new Error("the recorder refused to start");
    this.startedWith = timeslice ?? null;
    this.state = "recording";
  }

  stop() {
    if (FakeMediaRecorder.emitChunks) {
      this.ondataavailable?.({ data: new Blob(["fake-audio-bytes"], { type: this.mimeType }) });
    }
    this.state = "inactive";
    this.onstop?.();
  }

  interrupt() {
    this.onerror?.();
  }
}

function installBrowserFakes(options: { denied?: boolean; withAnalyser?: boolean } = {}) {
  const track = new FakeTrack();
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn(async () => {
    if (options.denied) {
      const error = new Error("permission denied");
      error.name = "NotAllowedError";
      throw error;
    }
    return stream as unknown as MediaStream;
  });

  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });

  if (options.withAnalyser !== false) {
    class FakeAnalyser {
      fftSize = 256;
      smoothingTimeConstant = 0;
      frequencyBinCount = 128;
      getByteFrequencyData(array: Uint8Array) {
        array.fill(180); // a steady, audible level
      }
    }
    class FakeAudioContext {
      state: AudioContextState = "running";
      createMediaStreamSource() {
        return { connect: () => undefined };
      }
      createAnalyser() {
        return new FakeAnalyser();
      }
      close = vi.fn(async () => undefined);
    }
    vi.stubGlobal("window", Object.assign(globalThis.window, { AudioContext: FakeAudioContext }));
  }

  return { track, getUserMedia };
}

/* ------------------------------------------------------------------ harness */

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let handle: RecorderHandle | null = null;

function Harness({ onClip }: { onClip: (clip: RecordedClip) => void }) {
  handle = useRecorder({ onClip, bars: 8 });
  return <div data-testid="status">{handle.status}</div>;
}

function render(onClip: (clip: RecordedClip) => void) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<Harness onClip={onClip} />);
  });
  return () => handle as RecorderHandle;
}

async function settle(times = 3) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }
}

async function waitFor<T>(check: () => T | false | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for the expected state");
    await settle(1);
  }
}

beforeEach(() => {
  FakeMediaRecorder.supported = true;
  FakeMediaRecorder.emitChunks = true;
  FakeMediaRecorder.failOnStart = false;
  FakeMediaRecorder.instances = [];
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
  handle = null;
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ tests */

describe("useRecorder", () => {
  it("stays idle and asks for no permission until start() is called", async () => {
    const { getUserMedia } = installBrowserFakes();
    const clip = vi.fn();
    const recorder = render(clip);

    expect(handle?.status).toBe("idle");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(clip).not.toHaveBeenCalled();
    expect(recorder().supported).toBe(true);
  });

  it("records, follows the microphone level, and hands over a real clip on stop", async () => {
    const { track } = installBrowserFakes();
    const clips: RecordedClip[] = [];
    render((next) => clips.push(next));

    await act(async () => {
      await handle?.start();
    });
    expect(handle?.status).toBe("recording");
    expect(handle?.mimeType).toBe("audio/webm;codecs=opus");

    // The timer and the waveform both come from the live session, not from a canned pattern.
    const timer = await waitFor(() => (handle && handle.seconds > 0 ? handle.seconds : false));
    expect(timer).toBeGreaterThan(0);
    const levels = await waitFor(() => (handle && handle.levels.some((level) => level > 0) ? handle.levels : false));
    expect(levels).toHaveLength(8);
    const raw = document.querySelector('[data-testid="status"]');
    expect(raw?.textContent).toBe("recording");

    act(() => handle?.stop());
    await settle();

    expect(clips).toHaveLength(1);
    expect(clips[0].blob.size).toBeGreaterThan(0);
    expect(clips[0].name).toBe("field-note.webm");
    expect(clips[0].audioSeconds).toBeGreaterThan(0);
    expect(track.stopped).toBe(true); // the device is released
    expect(handle?.status).toBe("idle");
  });

  it("reports a denied microphone and hands over nothing", async () => {
    installBrowserFakes({ denied: true });
    const clip = vi.fn();
    render(clip);

    await act(async () => {
      await handle?.start();
    });

    expect(handle?.status).toBe("error");
    expect(handle?.error).toContain("permission was denied");
    expect(handle?.error).toContain("upload an audio file");
    expect(clip).not.toHaveBeenCalled();
  });

  it("reports an unsupported recording format instead of recording silently", async () => {
    installBrowserFakes();
    FakeMediaRecorder.supported = false;
    const clip = vi.fn();
    render(clip);

    await act(async () => {
      await handle?.start();
    });

    expect(handle?.status).toBe("error");
    expect(handle?.error).toContain("supported audio format");
    expect(clip).not.toHaveBeenCalled();
  });

  it("treats an empty recording as an error, never as an empty note", async () => {
    installBrowserFakes();
    FakeMediaRecorder.emitChunks = false;
    const clip = vi.fn();
    render(clip);

    await act(async () => {
      await handle?.start();
    });
    act(() => handle?.stop());
    await settle();

    expect(handle?.status).toBe("error");
    expect(handle?.error).toContain("empty");
    expect(clip).not.toHaveBeenCalled();
  });

  it("reports an interrupted recording and releases the microphone", async () => {
    const { track } = installBrowserFakes();
    const clip = vi.fn();
    render(clip);

    await act(async () => {
      await handle?.start();
    });
    act(() => FakeMediaRecorder.instances[0].interrupt());
    await settle();

    expect(handle?.status).toBe("error");
    expect(handle?.error).toContain("interrupted");
    expect(clip).not.toHaveBeenCalled();
    expect(track.stopped).toBe(true);
  });

  it("reports a recorder that refuses to start", async () => {
    installBrowserFakes();
    FakeMediaRecorder.failOnStart = true;
    const clip = vi.fn();
    render(clip);

    await act(async () => {
      await handle?.start();
    });

    expect(handle?.status).toBe("error");
    expect(handle?.error).toContain("could not start");
    expect(clip).not.toHaveBeenCalled();
  });

  it("still records when the browser cannot feed a live waveform", async () => {
    installBrowserFakes({ withAnalyser: false });
    delete (globalThis.window as unknown as { AudioContext?: unknown }).AudioContext;
    const clips: RecordedClip[] = [];
    render((next) => clips.push(next));

    await act(async () => {
      await handle?.start();
    });
    expect(handle?.status).toBe("recording");
    expect(handle?.analyserAvailable).toBe(false);

    act(() => handle?.stop());
    await settle();
    expect(clips).toHaveLength(1);
  });
});
