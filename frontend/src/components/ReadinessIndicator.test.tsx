// React 19 needs this flag for `act(...)` in a test renderer environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * @vitest-environment jsdom
 *
 * The readiness panel: three independent rows (backend, speech-to-text, local model), each
 * with its own reason, and a summary that only says "ready" when all three are.
 *
 * The store is replaced with a fixed value so every state can be rendered directly. The
 * values used below come from the real clients (`MockFieldTalkClient.health()` and the
 * backend's 503 detail), so what is rendered is the real health shape, not a hand-written
 * guess about it.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Health } from "@/lib/types";

let mockState: {
  health: Health | null;
  error: string | null;
  refresh: () => Promise<void>;
} = { health: null, error: null, refresh: async () => undefined };

vi.mock("@/lib/store", () => ({
  useApp: () => ({ ...mockState, loading: false, mock: true }),
}));

const { ReadinessIndicator } = await import("@/components/ReadinessIndicator");
const { MockFieldTalkClient } = await import("@/lib/mock/client");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ReadinessIndicator />);
  });
  return container;
}

function text(testid: string): string {
  return container?.querySelector(`[data-testid="${testid}"]`)?.textContent ?? "";
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
  mockState = { health: null, error: null, refresh: async () => undefined };
});

/** The real health payload of a machine where everything works. */
async function readyHealth(): Promise<Health> {
  return new MockFieldTalkClient({ today: "2026-10-08" }).health();
}

describe("ReadinessIndicator", () => {
  it("reports every service ready, naming each one", async () => {
    mockState = { ...mockState, health: await readyHealth() };
    mount();

    expect(container?.querySelector('[data-testid="readiness"]')?.getAttribute("data-ready")).toBe("true");
    expect(text("readiness-summary")).toContain("all local services ready");
    expect(text("readiness-backend")).toContain("ready");
    expect(text("readiness-speech-to-text")).toContain("mock-stt");
    expect(text("readiness-local-model")).toContain("mock-router");
  });

  it("shows each unavailable service with the reason and the fix", async () => {
    const health = await new MockFieldTalkClient({ today: "2026-10-08", sttOffline: true }).health();
    mockState = {
      ...mockState,
      health: {
        ...health,
        model: "unavailable",
        model_detail: "Ollama is not reachable at http://127.0.0.1:11434. Start Ollama and pull the model: ollama pull gemma3:4b",
      },
    };
    mount();

    expect(container?.querySelector('[data-testid="readiness"]')?.getAttribute("data-ready")).toBe("false");
    expect(text("readiness-summary")).toContain("some services unavailable");
    expect(text("readiness-speech-to-text")).toContain("not available");
    expect(text("readiness-speech-to-text")).toContain("switched off");
    expect(text("readiness-local-model")).toContain("ollama pull gemma3:4b");
    // The backend itself still answered, so that row keeps saying ready.
    expect(text("readiness-backend")).toContain("ready");
  });

  it("says the backend is unreachable instead of showing a stale ready panel", () => {
    mockState = { health: null, error: "cannot reach http://127.0.0.1:8000", refresh: async () => undefined };
    mount();

    expect(container?.querySelector('[data-testid="readiness"]')?.getAttribute("data-ready")).toBe("false");
    expect(text("readiness-backend")).toContain("cannot reach");
  });

  it("re-checks the backend when the button is pressed", async () => {
    const refresh = vi.fn(async () => undefined);
    mockState = { health: await readyHealth(), error: null, refresh };
    mount();

    await act(async () => {
      (container?.querySelector("button") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
