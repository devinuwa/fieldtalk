import type { AskStage } from "@/lib/types";

const STATUS_STYLE: Record<string, string> = {
  done: "text-leaf",
  running: "text-sky",
  refused: "text-alert",
  clarify: "text-plum",
  error: "text-alert",
};

/** Collapsible trace: the raw stage payloads, the V2/V3 checks and the timings. */
export function TracePanel({ stages }: { stages: AskStage[] }) {
  if (stages.length === 0) return null;

  const totalMs = stages.reduce((sum, stage) => sum + stage.ms, 0);
  const answer = stages.find((stage) => stage.id === "answer");
  const v3 = (answer?.payload as { v3?: { ok: boolean; missing: string[] } } | undefined)?.v3;

  return (
    <details className="no-print card mt-4 p-3" data-testid="trace-panel">
      <summary className="cursor-pointer text-sm font-bold">
        Trace: {stages.length} staged responses, {totalMs} ms total
        {v3 !== undefined ? (v3.ok ? " · V3 passed" : ` · V3 failed (missing ${v3.missing.join(", ")})`) : ""}
      </summary>

      <ol className="mt-3 space-y-3">
        {stages.map((stage) => (
          <li key={stage.id} className="border-t border-slate-line pt-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h4 className={`text-sm font-bold ${STATUS_STYLE[stage.status] ?? ""}`}>
                {stage.label}
              </h4>
              <span className="text-xs uppercase tracking-wide text-ink-soft">{stage.status}</span>
              <span className="ml-auto font-mono text-xs text-ink-soft">{stage.ms} ms</span>
            </div>
            <ul className="mt-1 list-disc pl-5 text-xs text-ink-soft">
              {stage.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
            <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-leaf-soft p-2 font-mono text-[0.7rem] whitespace-pre-wrap">
              {JSON.stringify(stage.payload, null, 2)}
            </pre>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-xs text-ink-soft">
        V2 checks the tool name and the plot text before anything runs; V3 checks that every number
        in the answer came from the tool output. Neither stage lets the model state a number.
      </p>
    </details>
  );
}
