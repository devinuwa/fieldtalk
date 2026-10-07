/**
 * Turns the staged responses of an ask run into a result the UI can render.
 *
 * The stages themselves come from the client (mock or HTTP); this function only
 * reads them, so the same code works for both. Refusals always return the fixed
 * refusal string from code, never model prose.
 */

import { CLARIFY_FALLBACK, REFUSAL_STRING } from "@/lib/strings";
import type { AskRun, AskStage, ToolName } from "@/lib/types";

export function summarizeStages(question: string, stages: AskStage[]): AskRun {
  const interpret = stages.find((stage) => stage.id === "interpret");
  const answer = stages.find((stage) => stage.id === "answer");
  const toolCall = stages.find((stage) => stage.id === "tool_call");
  const action = (interpret?.payload as { action?: string } | undefined)?.action;
  const toolPayload = toolCall?.payload as { tool?: unknown } | undefined;
  const tool = typeof toolPayload?.tool === "string" ? (toolPayload.tool as ToolName) : null;

  if (action === "refuse") {
    return { question, stages, outcome: "refused", answer: REFUSAL_STRING, refused: true, tool: null };
  }
  if (action === "clarify") {
    const clarify = (interpret?.payload as { clarify_question?: string | null } | undefined)
      ?.clarify_question;
    return {
      question,
      stages,
      outcome: "clarify",
      answer: clarify ?? CLARIFY_FALLBACK,
      refused: false,
      tool,
    };
  }
  return {
    question,
    stages,
    outcome: "answered",
    answer: String((answer?.payload as { answer?: string } | undefined)?.answer ?? ""),
    refused: false,
    tool,
  };
}

/** The stage list is complete and in order: used by the tests and the trace panel. */
export function stageOrderOk(stages: AskStage[]): boolean {
  const order = ["interpret", "tool_call", "validate", "engine", "answer"];
  return stages.length === order.length && stages.every((stage, index) => stage.id === order[index]);
}
