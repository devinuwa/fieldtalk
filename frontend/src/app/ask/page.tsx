"use client";

import { useEffect, useState } from "react";

import { AskRibbon } from "@/components/AskRibbon";
import { TracePanel } from "@/components/TracePanel";
import { ModelUnavailableError } from "@/lib/errors";
import { useApp } from "@/lib/store";
import type { AskRun, AskStage } from "@/lib/types";

const SUGGESTIONS = [
  "What happened on plot 2?",
  "How many days since I planted plot 2?",
  "When did I last note plot 1?",
  "Any open issues?",
  "What did I record this week?",
  "Search my notes for holes",
];

export default function AskPage() {
  const { runAsk, modelUnavailable, entries, pendingQuestion, setPendingQuestion } = useApp();
  const [question, setQuestion] = useState("");
  const [stages, setStages] = useState<AskStage[]>([]);
  const [run, setRun] = useState<AskRun | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A question handed over from the record screen ("Ask a question" on a transcript).
  useEffect(() => {
    if (pendingQuestion === null) return;
    setQuestion(pendingQuestion);
    setPendingQuestion(null);
  }, [pendingQuestion, setPendingQuestion]);

  async function submit(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (trimmed === "" || running) return;
    setQuestion(trimmed);
    setRunning(true);
    setRun(null);
    setStages([]);
    setMessage(null);
    try {
      const result = await runAsk(trimmed, (stage) => setStages((current) => [...current, stage]));
      setRun(result);
    } catch (cause) {
      if (cause instanceof ModelUnavailableError) {
        setMessage(
          "The local model is unavailable, so questions cannot be routed to a tool. The Entries and Report screens still work.",
        );
      } else {
        setMessage(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>        <h2 className="text-xl font-bold">Ask your notes</h2>
        <p className="mt-1 text-sm text-ink-soft">
          The model only picks a tool and fills in its arguments. Counts and dates come back from the
          engine over your stored entries.
        </p>
        {question !== "" && !running && run === null ? (
          <p className="mt-2 text-sm text-ink-soft" data-testid="handed-over">
            The question was carried over from your recording. Ask it as it is, or make it about a
            plot you stored.
          </p>
        ) : null}

      <form
        className="mt-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(question);
        }}
      >
        <label className="field-label" htmlFor="question">
          Question
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="question"
            className="input flex-1 text-lg"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about a plot, a date or a keyword"
          />
          <button
            type="submit"
            disabled={running || modelUnavailable}
            className="rounded-lg bg-leaf px-4 py-2 font-semibold text-on-accent disabled:opacity-50"
          >
            {running ? "Working…" : "Ask"}
          </button>
        </div>
      </form>

      <div className="no-print mt-2 flex flex-wrap gap-1">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => void submit(suggestion)}
            className="rounded-full border border-slate-line px-3 py-1 text-sm"
          >
            {suggestion}
          </button>
        ))}
      </div>

      {modelUnavailable ? (
        <p className="mt-3 rounded-lg border border-soil bg-soil-soft px-3 py-2 text-sm">
          The local model is unavailable. Recording and asking are off; everything computed by code
          still works.
        </p>
      ) : null}

      {stages.length > 0 || running ? <AskRibbon stages={stages} running={running} /> : null}

      {message !== null ? (
        <p className="mt-3 rounded-lg border border-alert bg-alert-soft px-3 py-2 text-sm text-alert">
          {message}
        </p>
      ) : null}

      {run !== null ? (
        <section
          className={`mt-4 rounded-xl border p-3 ${
            run.outcome === "refused"
              ? "border-alert bg-alert-soft"
              : run.outcome === "clarify"
                ? "border-soil bg-soil-soft"
                : "border-leaf bg-leaf-soft"
          }`}
          data-testid="answer"
          data-outcome={run.outcome}
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="font-bold">
              {run.outcome === "refused"
                ? "Refused by design"
                : run.outcome === "clarify"
                  ? "Needs a clearer question"
                  : "Answer"}
            </h3>
            {run.tool !== null ? (
              <span className="font-mono text-xs text-ink-soft">tool: {run.tool}</span>
            ) : null}
          </div>
          <p className="mt-1 text-lg">{run.answer}</p>
          <p className="mt-2 text-xs text-ink-soft">
            {run.outcome === "answered"
              ? "Every number and date above came from the tool output over your stored entries."
              : run.outcome === "refused"
                ? "The refusal string is fixed in code; the model only emitted a refusal."
                : "No tool ran, so nothing was guessed."}
          </p>
        </section>
      ) : null}

      <TracePanel stages={stages} />

      <p className="mt-6 text-xs text-ink-soft">
        {entries.length} entries are available to the tools. Nothing is sent anywhere: the model runs
        on this machine over the local store.
      </p>
    </div>
  );
}
