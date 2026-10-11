// React 19 needs this flag for `act(...)` in a test renderer environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The store builds its client once per process, so this file exists to start from a clean
// module graph with speech-to-text off: "the model is missing" is a first-load state.
process.env.NEXT_PUBLIC_STT_OFFLINE = "1";

/**
 * @vitest-environment jsdom
 *
 * Missing speech model behavior in the UI. The backend answers `stt: "unavailable"` with the
 * setup command; the record screen must turn recording off, say why, and point at the manual
 * path — never show a record button that would fail on press.
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

class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  start() {}
  stop() {}
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: () => undefined }] }));
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function settle(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }
}

describe("record page with speech-to-text unavailable", () => {
  it("turns recording off and names the setup step instead", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <AppProvider>
          <RecordPage />
        </AppProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    await settle();

    const panel = container.querySelector('[data-testid="stt-off"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("not in the local cache");
    expect(panel?.textContent).toContain("Entries");
    // No record button that would fail on press, and no permission prompt.
    expect(container.querySelector('[data-testid="record-button"]')).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    // The manual path is still offered.
    expect(container.querySelector('[data-testid="readiness"]')).not.toBeNull();
  });
});
