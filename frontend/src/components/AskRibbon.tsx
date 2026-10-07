import { ASK_STAGES, type AskStage, type AskStageId } from "@/lib/types";

const LABELS: Record<AskStageId, string> = {
  interpret: "Interpret",
  tool_call: "Tool call",
  validate: "Validate",
  engine: "Engine",
  answer: "Verified answer",
};

const ICONS: Record<string, string> = {
  running: "…",
  done: "✓",
  refused: "⊘",
  clarify: "?",
  error: "!",
  pending: "·",
};

const TONES: Record<string, string> = {
  running: "border-sky bg-sky-soft text-sky",
  done: "border-leaf bg-leaf-soft text-leaf",
  refused: "border-alert bg-alert-soft text-alert",
  clarify: "border-plum bg-plum-soft text-plum",
  error: "border-alert bg-alert-soft text-alert",
  pending: "border-slate-line bg-white text-ink-soft",
};

/**
 * The ribbon is driven by the staged responses: each step appears only when that
 * stage's response has arrived from the client.
 */
export function AskRibbon({ stages, running }: { stages: AskStage[]; running: boolean }) {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const lastStage = stages[stages.length - 1];
  const pending = running ? lastStage?.id : undefined;

  return (
    <ol className="mt-3 grid gap-1 sm:grid-cols-5" aria-label="Ask pipeline stages">
      {ASK_STAGES.map((id, index) => {
        const stage = byId.get(id);
        const status = stage?.status ?? (pending !== undefined && index <= stageIndex(pending) ? "running" : "pending");
        return (
          <li
            key={id}
            aria-current={stage !== undefined ? "step" : undefined}
            className={`rounded-lg border px-2 py-1.5 ${TONES[status] ?? TONES.pending}`}
            data-stage={id}
            data-status={status}
          >
            <div className="flex items-center gap-1.5">
              <span aria-hidden className="text-base font-bold">
                {ICONS[status] ?? ICONS.pending}
              </span>
              <span className="text-xs font-bold uppercase tracking-wide">{LABELS[id]}</span>
            </div>
            <p className="mt-0.5 text-xs leading-snug break-words">
              {stage?.summary ?? (status === "running" ? "working…" : "waiting")}
            </p>
            {stage !== undefined ? (
              <p className="mt-0.5 font-mono text-[0.65rem] opacity-70">{stage.ms} ms</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function stageIndex(id: AskStageId): number {
  return ASK_STAGES.indexOf(id);
}
