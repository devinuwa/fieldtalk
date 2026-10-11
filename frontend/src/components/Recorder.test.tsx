// React 19 needs this flag for `act(...)` in a test renderer environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * @vitest-environment jsdom
 *
 * The recording UI the user actually touches: the microphone button, the state it reports,
 * the live waveform and the error path. MediaRecorder and getUserMedia are fakes, so no
 * microphone is opened and nothing is recorded.
 */

import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Recorder } from "@/components/Recorder";
import type { RecordedClip } from "@/lib/use-recorder";

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeMediaRecorder {
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  static instances: FakeMediaRecorder[] = [];

  static isTypeSupported(type: string) {
    return type === "audio/webm;codecs=opus";
  }

  constructor(stream: { getTracks: () => FakeTrack[] }, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "";
    this.stream = stream;
    FakeMediaRecorder.instances.push(this);
  }

  private readonly stream: { getTracks: () => FakeTrack[] };

  start() {
    this.state = "recording";
  }

  stop() {
    this.ondataavailable?.({ data: new Blob(["audio-bytes"], { type: this.mimeType }) });
    this.state = "inactive";
    this.onstop?.();
  }
}

function installFakes({ denied = false, canRecord = true, withAnalyser = true } = {}) {
  const track = new FakeTrack();
  const getUserMedia = vi.fn(async () => {
    if (denied) {
      const error = new Error("denied");
      error.name = "NotAllowedError";
      throw error;
    }
    return { getTracks: () => [track] } as unknown as MediaStream;
  });

  if (canRecord) vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  else vi.stubGlobal("MediaRecorder", undefined);
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });

  if (withAnalyser) {
    class FakeAnalyser {
      fftSize = 256;
      smoothingTimeConstant = 0;
      frequencyBinCount = 128;
      getByteFrequencyData(array: Uint8Array) {
        array.fill(200);
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

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(onClip: (clip: RecordedClip) => void = () => undefined) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<Recorder onClip={onClip} />);
  });
  return container;
}

function text(testid: string): string {
  return container?.querySelector(`[data-testid="${testid}"]`)?.textContent ?? "";
}

async function settle(times = 3) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Recorder", () => {
  it("renders a deterministic initializing state before browser capabilities are checked", () => {
    const html = renderToString(<Recorder onClip={() => undefined} />);
    expect(html).toContain('data-testid="recorder-initializing"');
    expect(html).not.toContain('data-testid="record-button"');
    expect(html).not.toContain('data-testid="recorder-unsupported"');
  });

  it("hydrates without changing the initial markup or logging hydration errors", async () => {
    installFakes();
    const serverHtml = renderToString(<Recorder onClip={() => undefined} />);
    container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await act(async () => {
      root = hydrateRoot(container as HTMLDivElement, <Recorder onClip={() => undefined} />);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(consoleError).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="record-button"]')).not.toBeNull();
    consoleError.mockRestore();
  });

  it("shows a microphone button, a timer and an idle state, and asks for nothing yet", () => {
    const { getUserMedia } = installFakes();
    mount();

    const button = container?.querySelector('[data-testid="record-button"]');
    expect(button?.getAttribute("aria-label")).toBe("Start recording");
    expect(button?.querySelector("svg")).not.toBeNull(); // a drawn microphone, no icon font
    expect(text("record-timer")).toBe("00:00.0");
    expect(text("recorder-state")).toBe("Ready");
    expect(text("waveform-caption")).toContain("while recording");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("requests the microphone on press and shows the Recording state with a live waveform", async () => {
    const { getUserMedia } = installFakes();
    mount();

    await act(async () => {
      (container?.querySelector('[data-testid="record-button"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await settle();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(text("recorder-state")).toBe("Recording");
    expect(container?.querySelector('[data-testid="record-button"]')?.getAttribute("aria-label")).toBe("Stop recording");
    expect(container?.querySelector('[data-testid="recording-pulse"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="waveform"]')?.getAttribute("data-live")).toBe("true");
    // The amplitude comes from the analyser: the bars are not a fixed pattern.
    expect(container?.querySelector('[data-testid="waveform"]')?.getAttribute("data-silent")).toBe("false");

    act(() => (container?.querySelector('[data-testid="record-button"]') as HTMLButtonElement).click());
    await settle();
    expect(text("recorder-state")).toBe("Ready");
  });

  it("hands the finished clip to the page when the user stops", async () => {
    installFakes();
    const clips: RecordedClip[] = [];
    mount((clip) => clips.push(clip));

    await act(async () => {
      (container?.querySelector('[data-testid="record-button"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    act(() => (container?.querySelector('[data-testid="record-button"]') as HTMLButtonElement).click());
    await settle();

    expect(clips).toHaveLength(1);
    expect(clips[0].name).toBe("field-note.webm");
    expect(clips[0].blob.size).toBeGreaterThan(0);
  });

  it("explains a denied microphone and offers the upload instead", async () => {
    installFakes({ denied: true });
    mount();

    await act(async () => {
      (container?.querySelector('[data-testid="record-button"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(text("recorder-state")).toBe("Recording failed");
    expect(text("recorder-error")).toContain("permission was denied");
    expect(text("recorder-error")).toContain("upload an audio file");
  });

  it("says so when the browser cannot record at all", () => {
    installFakes({ canRecord: false });
    mount();
    expect(text("recorder-unsupported")).toContain("cannot record audio");
    expect(container?.querySelector('[data-testid="record-button"]')).toBeNull();
  });
});
