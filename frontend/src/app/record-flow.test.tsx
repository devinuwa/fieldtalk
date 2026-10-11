// React 19 needs this flag for `act(...)` in a test renderer environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * @vitest-environment jsdom
 *
 * The whole recording workflow on one screen, with the real store and the real mock client
 * (mock mode is the default) and a fake microphone:
 *
 *   record → Processing → Transcribed → edit → Save note → review → stored entry
 *
 * It also pins the guard that matters most: a transcript with no words can never be saved
 * as a note, and a discard leaves nothing behind.
 *
 * In mock mode no audio is decoded and no speech model runs, so this proves the *flow* and
 * the UI states — not real inference. Real inference is exercised separately with a real
 * audio file against the Python engine (see the README).
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children?: unknown }) => (
    <a href={typeof href === "string" ? href : "#"}>{children as never}</a>
  ),
}));

const { AppProvider } = await import("@/lib/store");
const { default: RecordPage } = await import("@/app/page");

class FakeTrack {
  stop() {}
}

class FakeMediaRecorder {
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  static isTypeSupported(type: string) {
    return type === "audio/webm;codecs=opus";
  }

  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.ondataavailable?.({ data: new Blob(["recorded-speech-bytes"], { type: this.mimeType }) });
    this.state = "inactive";
    this.onstop?.();
  }
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function installFakes() {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [new FakeTrack()] }));
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  return { getUserMedia };
  class FakeAnalyser {
    fftSize = 256;
    smoothingTimeConstant = 0;
    frequencyBinCount = 128;
    getByteFrequencyData(array: Uint8Array) {
      array.fill(150);
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
    close = async () => undefined;
  }
  vi.stubGlobal("window", Object.assign(globalThis.window, { AudioContext: FakeAudioContext }));
}

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  // The provider loads health and entries on mount; awaiting keeps act() quiet.
  await act(async () => {
    root?.render(
      <AppProvider>
        <RecordPage />
      </AppProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  return container;
}

function pick(testid: string, selector = ".") {
  return container?.querySelector(`[data-testid="${testid}"] ${selector}`) as HTMLElement | null;
}

function textOf(testid: string): string {
  return container?.querySelector(`[data-testid="${testid}"]`)?.textContent ?? "";
}

async function settle(times = 3) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }
}

async function waitFor<T>(check: () => T | false | undefined, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for the expected state");
    await settle(1);
  }
}

function chooseMockTranscript(id: string) {
  const select = container?.querySelector("#mock-clip") as HTMLSelectElement;
  select.value = id;
  act(() => {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function recordAClip() {
  await act(async () => {
    (container?.querySelector('[data-testid="record-button"]') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  act(() => (container?.querySelector('[data-testid="record-button"]') as HTMLButtonElement).click());
}

let getUserMediaMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMediaMock = installFakes().getUserMedia;
  delete process.env.NEXT_PUBLIC_STT_OFFLINE;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("record page workflow", () => {
  it("starts empty, shows the readiness panel, and asks for no permission", async () => {
    await mount();
    expect(textOf("record-panel")).toContain("No clip yet");
    expect(container?.querySelector('[data-testid="readiness"]')).not.toBeNull();
    // Permission is not requested until the user presses Record.
    expect(getUserMediaMock).not.toHaveBeenCalled();
    expect(container?.querySelector('[data-testid="record-button"]')).not.toBeNull();
  });

  it("goes Processing → Transcribed, then saves the reviewed entry", async () => {
    await mount();
    chooseMockTranscript("T03");

    await recordAClip();

    // The clip is transcribing straight away: the UI says so before the words arrive.
    const processing = await waitFor(() =>
      container?.querySelector('[data-testid="processing"]') ? true : false,
    );
    expect(processing).toBe(true);

    await waitFor(() => (textOf("phase-badge").includes("Transcribed") ? true : false));
    const transcript = await waitFor(() => {
      const box = pick("transcript", "textarea") as HTMLTextAreaElement | null;
      return box && box.value.length > 0 ? box.value : false;
    });
    expect(transcript).toContain("Plot one, cowpea");
    // The numbers are reported as measured, and the mock layer does not invent a factor.
    expect(textOf("stt-numbers")).toContain("not measurable in mock mode");

    // Save note → the mock extraction for this synthetic transcript → review → stored.
    act(() => (container?.querySelector('[data-testid="save-note"]') as HTMLButtonElement).click());
    await waitFor(() => (container?.querySelector('[data-testid="extraction-review"]') ? true : false));
    expect(textOf("extraction-review")).toContain("keep this");
    expect(textOf("extraction-review")).toContain("plot one");

    await act(async () => {
      const store = [...(container?.querySelectorAll("button") ?? [])].find((button) =>
        button.textContent?.includes("Store selected entries"),
      );
      store?.click();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    const saved = await waitFor(() => (textOf("saved-note").includes("needs review") ? true : false));
    expect(saved).toBe(true);
    expect(textOf("saved-note")).toContain("1 entry stored");
  });

  it("refuses to save an empty transcript and discards the recording on request", async () => {
    await mount();
    chooseMockTranscript("T03");
    await recordAClip();
    await waitFor(() => ((pick("transcript", "textarea") as HTMLTextAreaElement | null)?.value ? true : false));

    // Empty the transcript by hand: the note must not be saveable.
    const box = pick("transcript", "textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "   ");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle(1);

    expect((container?.querySelector('[data-testid="save-note"]') as HTMLButtonElement).disabled).toBe(true);
    expect(textOf("empty-transcript")).toContain("cannot be saved as a note");

    // Discard: the clip and the transcript are gone, and the page says nothing was stored.
    act(() => (container?.querySelector('[data-testid="discard"]') as HTMLButtonElement).click());
    await settle(1);
    expect(container?.querySelector('[data-testid="transcript"]')).toBeNull();
    expect(textOf("record-panel")).toContain("No clip yet");
    expect(textOf("record-message")).toContain("Nothing was stored");
  });

});
