"use client";

import { useState } from "react";

import { AlertIcon, CheckIcon, SpinnerIcon } from "@/components/icons";
import { apiBaseUrl, isMockMode } from "@/lib/contract";
import { useApp } from "@/lib/store";

/** One dependency row: name, state, and the reason (which names the fix). */
function Row({ label, ok, name, detail }: { label: string; ok: boolean; name: string; detail: string }) {
  return (
    <li className="flex items-start gap-2" data-testid={`readiness-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          ok ? "bg-leaf-soft text-leaf" : "bg-alert-soft text-alert"
        }`}
        aria-hidden
      >
        {ok ? <CheckIcon /> : <AlertIcon />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          {label}: <span className={ok ? "text-leaf" : "text-alert"}>{ok ? "ready" : "not available"}</span>
          <span className="ml-2 font-mono text-xs font-normal text-ink-soft">{name}</span>
        </p>
        <p className="text-xs text-ink-soft">{detail}</p>
      </div>
    </li>
  );
}

/**
 * Offline readiness: the three local pieces the voice workflow needs, checked against the
 * real backend (`GET /api/health`) rather than assumed. The backend itself, the local
 * whisper weights and the local Ollama model are listed separately, because each can be
 * missing on its own and each has a different fix.
 */
export function ReadinessIndicator({ compact = false }: { compact?: boolean }) {
  const { health, loading, error, refresh, mock } = useApp();
  const [checking, setChecking] = useState(false);

  const backendOk = health !== null && error === null;
  const sttOk = health?.stt === "ok";
  const modelOk = health?.model === "ok";
  const fullyReady = backendOk && sttOk && modelOk;

  async function recheck() {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="card p-3" data-testid="readiness" data-ready={fullyReady ? "true" : "false"}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Offline readiness</h3>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
            fullyReady
              ? "border-leaf bg-leaf-soft text-leaf"
              : "border-soil bg-soil-soft text-soil"
          }`}
          data-testid="readiness-summary"
        >
          {loading ? "checking…" : fullyReady ? "all local services ready" : "some services unavailable"}
        </span>
        <button
          type="button"
          onClick={() => void recheck()}
          disabled={checking || loading}
          className="no-print ml-auto flex items-center gap-1 rounded-lg border border-slate-line px-2 py-1 text-xs font-semibold text-ink-soft disabled:opacity-50"
        >
          {checking ? <SpinnerIcon className="h-3 w-3" /> : null}
          Re-check
        </button>
      </div>

      <ul className="mt-2 space-y-2">
        <Row
          label="Backend"
          ok={backendOk}
          name={mock ? "mock layer (no backend)" : apiBaseUrl()}
          detail={
            error !== null
              ? error
              : mock
                ? "Mock mode is on, so the screens run from the bundled fixtures. Set NEXT_PUBLIC_MOCK=0 to use the local backend."
                : "Reached over loopback only; no cloud calls are made."
          }
        />
        <Row
          label="Speech-to-text"
          ok={sttOk}
          name={health?.stt_name ?? "not checked"}
          detail={health?.stt_detail ?? "Waiting for the first health check."}
        />
        <Row
          label="Local model"
          ok={modelOk}
          name={health?.model_name ?? "not checked"}
          detail={health?.model_detail ?? "Waiting for the first health check."}
        />
      </ul>

      {!compact ? (
        <p className="mt-2 text-xs text-ink-soft">
          Recording, transcription and Ask need the local backend and the local model services
          running on this computer. Without a model you can still type, edit and confirm entries by
          hand, and the report keeps working.
        </p>
      ) : null}
    </section>
  );
}
