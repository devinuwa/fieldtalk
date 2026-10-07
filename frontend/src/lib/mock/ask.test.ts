/**
 * Ask-your-notes tests over the synthetic seed store.
 *
 * The store is fixed (SEED_ENTRIES) and "today" is pinned to 2026-10-07, so every
 * expected number below is derived by hand from the seed dates. Stage counts are
 * asserted so a truncated run cannot pass vacuously.
 */

import { describe, expect, it } from "vitest";

import { stageOrderOk } from "@/lib/ask";
import { daysSinceLastNote, openIssues, summarizeWindow, weekOf } from "@/lib/engine";
import { buildAskRun, extractKeyword, planStages, streamAsk, verifyAnswerNumbers } from "@/lib/mock/ask";
import { SEED_ENTRIES } from "@/lib/mock/seedEntries";
import { REFUSAL_STRING } from "@/lib/strings";
import type { AskStage } from "@/lib/types";

const TODAY = "2026-10-07";
const context = { entries: SEED_ENTRIES, today: TODAY };

function enginePayload(stages: AskStage[]): unknown {
  return stages.find((stage) => stage.id === "engine")?.payload;
}

describe("mock ask pipeline", () => {
  it("returns five stages in order, for answered, refused and clarify runs alike", () => {
    const questions = [
      "What happened on plot 2?",
      "How many days since I planted plot 2?",
      "When did I last note plot 1?",
      "Any open issues?",
      "What did I record this week?",
      "Search my notes for holes",
      "What fertilizer should I put on the maize?",
      "The plants look bad",
    ];
    expect(questions).toHaveLength(8);

    for (const question of questions) {
      const run = buildAskRun(question, context);
      expect(run.stages).toHaveLength(5);
      expect(stageOrderOk(run.stages), question).toBe(true);
    }
  });

  it("answers a timeline question from the tool result", () => {
    const run = buildAskRun("What happened on plot 2?", context);
    expect(run.outcome).toBe("answered");
    expect(run.tool).toBe("plot_timeline");
    // Hand-derived: plot 2 has e-1001, e-1002, e-1003 and e-1012.
    expect(run.answer).toContain("4 entries");
    const v3 = verifyAnswerNumbers(run.answer, enginePayload(run.stages));
    expect(v3.numbers.length).toBeGreaterThan(3);
    expect(v3.ok, `missing: ${v3.missing.join(", ")}`).toBe(true);
  });

  it("computes days since planting from the stored planting date", () => {
    const run = buildAskRun("How many days since I planted plot 2?", context);
    expect(run.tool).toBe("days_since_planting");
    // 2026-07-10 -> 2026-10-07 = 89 days.
    expect(run.answer).toContain("89 days");
    expect(verifyAnswerNumbers(run.answer, enginePayload(run.stages)).ok).toBe(true);
  });

  it("computes days since the last note", () => {
    const run = buildAskRun("When did I last note plot 1?", context);
    expect(run.tool).toBe("days_since_last_note");
    // Plot 1's newest entry is 2026-10-03, so 4 days before 2026-10-07.
    expect(run.answer).toContain("4 days");
    expect(daysSinceLastNote(SEED_ENTRIES, "plot 1", TODAY)).toBe(4);
    expect(verifyAnswerNumbers(run.answer, enginePayload(run.stages)).ok).toBe(true);
  });

  it("lists the open issues computed by the engine", () => {
    const run = buildAskRun("Any open issues?", context);
    expect(run.tool).toBe("open_issues");
    // Derived: e-1004 (plot 1) and e-1007 (beans plot near the gate); e-1002 is closed by e-1003.
    expect(openIssues(SEED_ENTRIES)).toHaveLength(2);
    expect(run.answer).toContain("2 open issues");
    expect(verifyAnswerNumbers(run.answer, enginePayload(run.stages)).ok).toBe(true);
  });

  it("summarises the current week with code-computed counts", () => {
    const run = buildAskRun("What did I record this week?", context);
    expect(run.tool).toBe("weekly_summary");
    const week = weekOf(TODAY);
    const summary = summarizeWindow(SEED_ENTRIES, week.week_start, week.week_end_exclusive, TODAY);
    expect(summary.week_start).toBe("2026-10-05");
    expect(summary.total_entries).toBe(7);
    expect(summary.plots_touched).toHaveLength(7);
    expect(run.answer).toContain("7 entries on 7 plots");
    expect(verifyAnswerNumbers(run.answer, enginePayload(run.stages)).ok).toBe(true);
  });

  it("searches notes with a plain substring", () => {
    const run = buildAskRun("Search my notes for holes", context);
    expect(run.tool).toBe("search_notes");
    expect(extractKeyword("Search my notes for holes")).toBe("holes");
    // e-1002 and e-1007 both say "Small holes in the leaves."
    expect(run.answer).toContain("2 notes mention");
    expect(verifyAnswerNumbers(run.answer, enginePayload(run.stages)).ok).toBe(true);
  });

  it("refuses advice questions with the fixed string and runs no tool", () => {
    const run = buildAskRun("What fertilizer should I put on the maize?", context);
    expect(run.outcome).toBe("refused");
    expect(run.refused).toBe(true);
    expect(run.answer).toBe(REFUSAL_STRING);
    expect(run.tool).toBeNull();
    const toolCall = run.stages.find((stage) => stage.id === "tool_call");
    expect(toolCall?.status).toBe("refused");
    expect(run.stages.filter((stage) => stage.status === "refused")).toHaveLength(4);
  });

  it("asks for a detail instead of guessing when the question is vague", () => {
    const run = buildAskRun("The plants look bad", context);
    expect(run.outcome).toBe("clarify");
    expect(run.tool).toBeNull();
    const engine = run.stages.find((stage) => stage.id === "engine");
    expect(engine?.status).toBe("clarify");
    expect(run.answer.length).toBeGreaterThan(10);
  });

  it("streams the five stages one response at a time, with measured timings", async () => {
    const received: AskStage[] = [];
    for await (const stage of streamAsk("What happened on plot 2?", context)) received.push(stage);
    expect(received).toHaveLength(5);
    expect(stageOrderOk(received)).toBe(true);
    expect(received.every((stage) => stage.ms >= 0)).toBe(true);
    expect(received[0].status).toBe("done");
  });

  it("V3 fails an answer whose number is not in the tool output (control test)", () => {
    // Positive control: the number is present as a standalone value.
    expect(verifyAnswerNumbers("2 open issues", { issue_count: 2 }).ok).toBe(true);
    // Negative control: 12 baskets appears nowhere in the tool output.
    const bad = verifyAnswerNumbers("Harvested 12 baskets today", { issue_count: 2 });
    expect(bad.ok).toBe(false);
    expect(bad.missing).toEqual(["12"]);
  });

  it("planStages stops the later stages when the run refuses", () => {
    const planned = planStages("Should I spray the cowpea?", context);
    expect(planned).toHaveLength(5);
    const actions = planned.map(({ stage }) => `${stage.id}:${stage.status}`);
    expect(actions).toEqual([
      "interpret:done",
      "tool_call:refused",
      "validate:refused",
      "engine:refused",
      "answer:refused",
    ]);
  });
});
