"use client";

import {
  MODEL_UNAVAILABLE_BODY,
  MODEL_UNAVAILABLE_TITLE,
  STT_UNAVAILABLE_BODY,
  STT_UNAVAILABLE_TITLE,
} from "@/lib/strings";
import { useApp } from "@/lib/store";

/**
 * Status banner. When the model or speech-to-text is unavailable the UI says so and
 * points at the manual path instead of failing silently (screen 5).
 */
export function ModelBanner() {
  const { health, mock, setModelAvailable, error } = useApp();

  if (error !== null) {
    return (
      <Banner tone="alert" title="Cannot reach the local backend">
        <p className="text-sm">{error}</p>
        <p className="mt-1 text-sm">
          The backend binds 127.0.0.1 only. Start it, or run the UI in mock mode
          (NEXT_PUBLIC_MOCK=1) to work from the bundled fixtures.
        </p>
      </Banner>
    );
  }

  if (health !== null && health.stt === "unavailable") {
    return (
      <Banner tone="alert" title={STT_UNAVAILABLE_TITLE}>
        <p className="text-sm">{STT_UNAVAILABLE_BODY}</p>
      </Banner>
    );
  }

  if (health !== null && health.model === "unavailable") {
    return (
      <Banner tone="alert" title={MODEL_UNAVAILABLE_TITLE}>
        <p className="text-sm">{MODEL_UNAVAILABLE_BODY}</p>
        {mock ? (
          <button
            type="button"
            onClick={() => void setModelAvailable(true)}
            className="mt-2 rounded-lg border border-alert px-3 py-1 text-sm font-semibold text-alert"
          >
            Switch the mock model back on
          </button>
        ) : null}
      </Banner>
    );
  }

  if (mock) {
    return (
      <Banner tone="info" title="Mock mode">
        <p className="text-sm">
          No backend yet: the screens below are driven by the synthetic fixtures in
          fixtures/ and eval/transcripts.jsonl. Nothing here is real audio or a real model
          output.
        </p>
        <button
          type="button"
          onClick={() => void setModelAvailable(false)}
          className="mt-2 rounded-lg border border-soil px-3 py-1 text-sm font-semibold text-soil"
        >
          Simulate model offline
        </button>
      </Banner>
    );
  }

  return null;
}

function Banner({
  tone,
  title,
  children,
}: {
  tone: "info" | "alert";
  title: string;
  children: React.ReactNode;
}) {
  const styles =
    tone === "alert"
      ? "border-alert bg-alert-soft text-alert"
      : "border-soil bg-soil-soft text-soil";
  return (
    <section
      role="status"
      className={`no-print mt-3 rounded-xl border px-3 py-2 ${styles}`}
    >
      <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
      <div className="text-ink">{children}</div>
    </section>
  );
}
