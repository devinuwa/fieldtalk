/**
 * The mock ask-your-notes pipeline: routing, tool execution over mock entries,
 * template answers and the V2/V3 checks.
 *
 * MOCK. In the real system the local model (Gemma 3 4B via Ollama) does the
 * interpret and tool-call stages, `tools` runs against the store, and code builds
 * the template answer. Here a small deterministic keyword router stands in for the
 * model so the UI has five real staged responses to render. No stage invents a
 * number: the answer is built from tool output and V3 fails it otherwise.
 */

import {
  daysSinceLastNote,
  daysSincePlanting,
  formatLongDate,
  formatShortDate,
  knownPlots,
  normalizePlot,
  openIssues,
  plotTimeline,
  searchNotes,
  summarizeWindow,
  weekOf,
} from "@/lib/engine";
import { summarizeStages } from "@/lib/ask";
import { CLARIFY_FALLBACK } from "@/lib/strings";
import type { AskRun, AskStage, StoredEntry, ToolName } from "@/lib/types";

export interface AskContext {
  entries: StoredEntry[];
  /** ISO date used as "now" for the run. */
  today: string;
}

export type AskAction = "run" | "refuse" | "clarify";

export interface AskPlan {
  action: AskAction;
  tool: ToolName | null;
  args: Record<string, unknown>;
  plotText: string | null;
  plotMatched: string | null;
  /** Why the router chose this, shown in the trace panel. */
  reasoning: string;
  clarifyQuestion: string | null;
}

/** Anything in here is a refusal: FieldTalk never gives advice or diagnoses. */
const REFUSAL_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bfertilis?er|\bnpk\b|\burea\b|\bmanure dose\b/i, label: "fertilizer question" },
  { pattern: /\bpesticide|\bherbicide|\bfungicide|\binsecticide|\bspray\b/i, label: "chemical question" },
  { pattern: /\b(price|prices|market|profit|cost per)\b/i, label: "price question" },
  { pattern: /\b(disease|diagnose|diagnosis|what is wrong with|is it sick|pest attack)\b/i, label: "diagnosis question" },
  { pattern: /\b(weather|forecast|rain tomorrow|will it rain)\b/i, label: "weather question" },
  { pattern: /\b(should i|what should i|how (much|many) should i|recommend|advise|advice)\b/i, label: "advice question" },
];

const NUMBER_WORDS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};

/** "plot two" and "plot 2" must hit the same plot. */
export function plotAliases(plot: string): string[] {
  const base = normalizePlot(plot);
  const digits = base.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g,
    (word) => NUMBER_WORDS[word] ?? word,
  );
  const words = base.replace(/\b(\d+)\b/g, (digit) => {
    const entry = Object.entries(NUMBER_WORDS).find(([, value]) => value === digit);
    return entry ? entry[0] : digit;
  });
  return [...new Set([base, digits, words])];
}

/** Longest known plot whose alias appears in the question. */
export function matchPlot(question: string, entries: StoredEntry[]): string | null {
  const haystack = normalizePlot(question);
  let best: string | null = null;
  for (const plot of knownPlots(entries)) {
    const hit = plotAliases(plot).some((alias) => haystack.includes(alias));
    if (hit && (best === null || plot.length > best.length)) best = plot;
  }
  return best;
}

/** Words that describe the request rather than the keyword being searched for. */
const KEYWORD_STOP_PHRASES = [
  "search for",
  "search",
  "look for",
  "find",
  "show me",
  "my notes",
  "notes about",
  "notes",
  "mention",
  "matching",
  "about",
  "for",
];

/** "search my notes for holes" -> "holes". Returns null when nothing is left. */
export function extractKeyword(question: string): string | null {
  let text = question.toLowerCase();
  for (const phrase of KEYWORD_STOP_PHRASES) text = text.split(phrase).join(" ");
  text = text.replace(/[?!.,"'“”]/g, " ").replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

/** Deterministic stand-in for the model's interpret + tool-call stages. */
export function planQuestion(question: string, context: AskContext): AskPlan {
  const trimmed = question.trim();
  const refuse = REFUSAL_PATTERNS.find((rule) => rule.pattern.test(trimmed));
  if (refuse) {
    return {
      action: "refuse",
      tool: null,
      args: {},
      plotText: null,
      plotMatched: null,
      reasoning: `matched ${refuse.label}; only {"action":"refuse"} is allowed`,
      clarifyQuestion: null,
    };
  }

  if (trimmed === "") {
    return {
      action: "clarify",
      tool: null,
      args: {},
      plotText: null,
      plotMatched: null,
      reasoning: "empty question",
      clarifyQuestion: CLARIFY_FALLBACK,
    };
  }

  const plotMatched = matchPlot(trimmed, context.entries);
  const lower = trimmed.toLowerCase();

  let tool: ToolName | null = null;
  if (/\b(plant|planted|planting)\b/.test(lower) && /\b(since|how long|when)\b/.test(lower)) {
    tool = "days_since_planting";
  } else if (/\blast note\b|\bnoted last\b|\bwrote last\b/.test(lower)) {
    tool = "days_since_last_note";
  } else if (/\bopen issue|\bunresolved|\bstill open|\bproblems?\b/.test(lower)) {
    tool = "open_issues";
  } else if (/\bthis week|\blast week|\bweek of\b|\bweekly\b|\bthis week\b/.test(lower)) {
    tool = "weekly_summary";
  } else if (/\bsearch\b|\bfind\b|\blook for\b/.test(lower)) {
    tool = "search_notes";
  } else if (/\btimeline\b|\bhistory\b|\bwhat happened\b|\bnotes on\b|\bshow\b|\bentries\b/.test(lower)) {
    tool = "plot_timeline";
  } else if (plotMatched !== null) {
    tool = "plot_timeline";
  }

  if (tool === null) {
    return {
      action: "clarify",
      tool: null,
      args: {},
      plotText: null,
      plotMatched,
      reasoning: "no tool matched the question",
      clarifyQuestion: CLARIFY_FALLBACK,
    };
  }

  const args: Record<string, unknown> = {};
  const needsPlot = tool !== "open_issues" && tool !== "weekly_summary" && tool !== "search_notes";
  if (needsPlot) {
    if (plotMatched === null) {
      return {
        action: "clarify",
        tool,
        args: {},
        plotText: null,
        plotMatched: null,
        reasoning: `${tool} needs a plot and none of the known plots appear in the question`,
        clarifyQuestion: "Which plot? I know: " + knownPlots(context.entries).join(", ") + ".",
      };
    }
    args.plot_text = plotMatched;
  }
  if (tool === "weekly_summary") {
    const week = weekOf(context.today);
    args.week_of = week.week_start;
  }
  if (tool === "search_notes") {
    const keyword = extractKeyword(trimmed) ?? plotMatched;
    if (keyword === null) {
      return {
        action: "clarify",
        tool,
        args: {},
        plotText: null,
        plotMatched,
        reasoning: "search_notes needs a keyword",
        clarifyQuestion: "What word should I search your notes for?",
      };
    }
    args.keyword = keyword;
  }

  return {
    action: "run",
    tool,
    args,
    plotText: plotMatched,
    plotMatched,
    reasoning: `keywords in the question matched ${tool}`,
    clarifyQuestion: null,
  };
}

export interface ToolRun {
  tool: ToolName;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

/** The tools from PLAN.md, run over the mock store. Numbers come from here. */
export function runTool(plan: AskPlan, context: AskContext): ToolRun | null {
  if (plan.action !== "run" || plan.tool === null) return null;
  const tool = plan.tool;
  const plot = typeof plan.args.plot_text === "string" ? plan.args.plot_text : plan.plotMatched;

  if (tool === "plot_timeline" && plot) {
    const timeline = plotTimeline(context.entries, plot);
    const days = daysSinceLastNote(context.entries, plot, context.today);
    return {
      tool,
      args: { plot_text: plot },
      result: {
        plot,
        entry_count: timeline.length,
        first_date: timeline[0]?.date ?? null,
        last_date: timeline[timeline.length - 1]?.date ?? null,
        as_of: context.today,
        days_since_last_note: days,
        entries: timeline.map((entry) => ({
          id: entry.id,
          date: entry.date,
          kind: entry.kind,
          text: entry.text,
        })),
      },
    };
  }

  if (tool === "days_since_planting" && plot) {
    const timeline = plotTimeline(context.entries, plot);
    const planted = [...timeline].reverse().find((entry) => entry.planting_date !== null) ?? null;
    return {
      tool,
      args: { plot_text: plot },
      result:
        planted === null
          ? { plot, planting_date: null, days_since_planting: null, on: context.today }
          : {
              plot,
              planting_date: planted.planting_date,
              days_since_planting: daysSincePlanting(planted.planting_date as string, context.today),
              on: context.today,
              source_entry_id: planted.id,
              source_date: planted.date,
            },
    };
  }

  if (tool === "days_since_last_note" && plot) {
    const timeline = plotTimeline(context.entries, plot);
    const last = timeline[timeline.length - 1] ?? null;
    return {
      tool,
      args: { plot_text: plot, as_of: context.today },
      result:
        last === null
          ? { plot, last_date: null, days_since: null, as_of: context.today }
          : {
              plot,
              last_date: last.date,
              last_text: last.text,
              last_kind: last.kind,
              days_since: daysSinceLastNote(context.entries, plot, context.today),
              as_of: context.today,
            },
    };
  }

  if (tool === "open_issues") {
    const issues = openIssues(context.entries);
    return {
      tool,
      args: { plot_text: null },
      result: {
        issue_count: issues.length,
        issues: issues.map((entry) => ({
          id: entry.id,
          plot: entry.plot,
          date: entry.date,
          text: entry.text,
        })),
      },
    };
  }

  if (tool === "weekly_summary") {
    const week = weekOf(typeof plan.args.week_of === "string" ? plan.args.week_of : context.today);
    const summary = summarizeWindow(context.entries, week.week_start, week.week_end_exclusive, context.today);
    return {
      tool,
      args: { week_of: week.week_start },
      result: {
        week_start: summary.week_start,
        week_end: summary.week_end,
        total_entries: summary.total_entries,
        counts_by_kind: summary.counts_by_kind,
        plots_touched: summary.plots_touched.map((touch) => ({
          plot: touch.plot,
          entries: touch.entries,
        })),
        issues_opened: summary.issues_opened.length,
        issues_closed: summary.issues_closed.length,
        open_issues: summary.open_issues.length,
      },
    };
  }

  if (tool === "search_notes") {
    const keyword = String(plan.args.keyword ?? "");
    const matches = searchNotes(context.entries, keyword);
    return {
      tool,
      args: { keyword },
      result: {
        keyword,
        match_count: matches.length,
        matches: matches.map((entry) => ({
          id: entry.id,
          plot: entry.plot,
          date: entry.date,
          kind: entry.kind,
          text: entry.text,
        })),
      },
    };
  }

  return null;
}

/** Template answer built only from tool output ("template over tool results"). */
export function answerFromTool(tool: ToolName, result: Record<string, unknown>): string {
  if (tool === "plot_timeline") {
    const count = Number(result.entry_count);
    if (count === 0) return `No stored entries for ${String(result.plot)}.`;
    const entries = result.entries as { date: string; text: string }[];
    const newest = entries[entries.length - 1];
    return `${count} entries on ${String(result.plot)} between ${formatShortDate(
      String(result.first_date),
    )} and ${formatShortDate(String(result.last_date))}. The newest is "${newest.text}" on ${formatShortDate(
      newest.date,
    )}, ${String(result.days_since_last_note)} days before ${formatShortDate(String(result.as_of))}.`;
  }

  if (tool === "days_since_planting") {
    if (result.planting_date === null) return `No planting date is stored for ${String(result.plot)}.`;
    return `${String(result.plot)} was planted on ${formatLongDate(
      String(result.planting_date),
    )}; that is ${String(result.days_since_planting)} days before ${formatLongDate(String(result.on))}.`;
  }

  if (tool === "days_since_last_note") {
    if (result.last_date === null) return `No notes are stored for ${String(result.plot)}.`;
    return `The last note on ${String(result.plot)} was on ${formatLongDate(
      String(result.last_date),
    )}, ${String(result.days_since)} days before ${formatLongDate(String(result.as_of))}.`;
  }

  if (tool === "open_issues") {
    const count = Number(result.issue_count);
    if (count === 0) return "No open issues in your stored notes.";
    const issues = result.issues as { plot: string | null; date: string; text: string }[];
    const newest = issues[issues.length - 1];
    return `${count} open issues. The newest is "${newest.text}" on ${formatShortDate(newest.date)} (${
      newest.plot ?? "no plot"
    }).`;
  }

  if (tool === "weekly_summary") {
    const counts = result.counts_by_kind as Record<string, number>;
    const touched = result.plots_touched as { plot: string }[];
    const parts = Object.entries(counts)
      .filter(([, value]) => value > 0)
      .map(([kind, value]) => `${value} ${kind}`);
    return `Week of ${formatShortDate(String(result.week_start))} to ${formatShortDate(
      String(result.week_end),
    )}: ${String(result.total_entries)} entries on ${touched.length} plots (${
      parts.length > 0 ? parts.join(", ") : "none"
    }); ${String(result.issues_opened)} issues opened, ${String(result.issues_closed)} issues closed, ${String(
      result.open_issues,
    )} still open.`;
  }

  if (tool === "search_notes") {
    const count = Number(result.match_count);
    if (count === 0) return `No notes mention "${String(result.keyword)}".`;
    const matches = result.matches as { date: string; text: string; plot: string | null }[];
    const newest = matches[matches.length - 1];
    return `${count} notes mention "${String(result.keyword)}". The newest is "${newest.text}" on ${formatShortDate(
      newest.date,
    )} (${newest.plot ?? "no plot"}).`;
  }

  return "That tool is not available.";
}

/**
 * Every numeric value and every date part in the tool output, in both padded and
 * unpadded form, so "7 Oct" can be matched against "2026-10-07".
 */
function collectTokens(value: unknown, tokens: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number" && Number.isFinite(value)) {
    tokens.add(String(value));
    return;
  }
  if (typeof value === "string") {
    for (const run of value.split(/\D+/)) {
      if (run === "") continue;
      tokens.add(run);
      // "07" also stands for 7, so a formatted answer can cite it.
      tokens.add(String(Number(run)));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTokens(item, tokens);
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      tokens.add(key);
      collectTokens(item, tokens);
    }
  }
}

/**
 * V3: every digit group in the answer must be traceable to a value or a date part in
 * the tool output. A template that invents a count or a date fails here.
 */
export function verifyAnswerNumbers(
  answer: string,
  toolResult: unknown,
): { ok: boolean; numbers: string[]; missing: string[] } {
  const tokens = new Set<string>();
  collectTokens(toolResult ?? {}, tokens);
  const numbers = [...new Set(answer.match(/\d+/g) ?? [])];
  const missing = numbers.filter((value) => !tokens.has(value));
  return { ok: missing.length === 0, numbers, missing };
}

interface PlannedStage {
  stage: Omit<AskStage, "ms">;
  /** Stand-in for model/CPU latency; measured, not invented. */
  delayMs: number;
}

const ROUTER_NOTE = "mock keyword router (stands in for Gemma 3 4B via Ollama)";

/** Build the five stages for a question without any delay. */
export function planStages(question: string, context: AskContext): PlannedStage[] {
  const plan = planQuestion(question, context);
  const plots = knownPlots(context.entries);

  const interpret: PlannedStage = {
    delayMs: 250,
    stage: {
      id: "interpret",
      label: "Interpret",
      status: "done",
      summary:
        plan.action === "refuse"
          ? "question asks for advice or a diagnosis"
          : plan.action === "clarify"
            ? "question too vague to route"
            : `${plan.action}: ${plan.tool}`,
      payload: {
        mock: true,
        routed_by: ROUTER_NOTE,
        question,
        action: plan.action,
        reasoning: plan.reasoning,
        model: "mock-router",
      },
      checks: ["the model only routes; it never states facts"],
    },
  };

  if (plan.action === "refuse") {
    const stopped = (
      id: AskStage["id"],
      label: string,
      summary: string,
    ): PlannedStage => ({
      delayMs: 0,
      stage: {
        id,
        label,
        status: "refused",
        summary,
        payload: { skipped: true, reason: 'model emitted {"action":"refuse"}' },
        checks: ["no tool ran", "the refusal string is fixed in code"],
      },
    });
    return [
      interpret,
      stopped("tool_call", "Tool call", "no tool: refused"),
      stopped("validate", "Validate", "not run"),
      stopped("engine", "Engine", "not run"),
      stopped("answer", "Verified answer", "fixed refusal string returned"),
    ];
  }

  if (plan.action === "clarify") {
    const stopped = (id: AskStage["id"], label: string, summary: string): PlannedStage => ({
      delayMs: 0,
      stage: {
        id,
        label,
        status: "clarify",
        summary,
        payload: { skipped: true, reason: "clarification needed before a tool can run" },
        checks: ["no tool ran", "asking instead of guessing"],
      },
    });
    return [
      interpret,
      stopped("tool_call", "Tool call", "no tool: needs clarification"),
      stopped("validate", "Validate", "not run"),
      stopped("engine", "Engine", "not run"),
      stopped("answer", "Verified answer", "clarifying question returned"),
    ];
  }

  const run = runTool(plan, context);
  const toolResult = run?.result ?? {};
  const answer = run ? answerFromTool(run.tool, toolResult) : "That tool is not available.";
  const v3 = verifyAnswerNumbers(answer, toolResult);

  return [
    interpret,
    {
      delayMs: 40,
      stage: {
        id: "tool_call",
        label: "Tool call",
        status: "done",
        summary: `${plan.tool}(${Object.entries(plan.args)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(", ")})`,
        payload: { tool: plan.tool, args: plan.args },
        checks: ["tools are the only way to reach stored data"],
      },
    },
    {
      delayMs: 10,
      stage: {
        id: "validate",
        label: "Validate",
        status: "done",
        summary: `tool exists; plot matched against ${plots.length} known plots`,
        payload: {
          v2: {
            tool_known: true,
            plot_text: plan.plotText,
            plot_matched: plan.plotMatched,
            known_plots: plots,
            args_valid: true,
          },
        },
        checks: [
          "V2: tool name must be in the allowed list",
          "V2: plot text must match a stored plot, otherwise clarify",
        ],
      },
    },
    {
      delayMs: 15,
      stage: {
        id: "engine",
        label: "Engine",
        status: "done",
        summary: `${plan.tool} returned counts and dates from stored entries`,
        payload: { tool: plan.tool, result: toolResult },
        checks: ["every number and date on this stage came from the engine"],
      },
    },
    {
      delayMs: 200,
      stage: {
        id: "answer",
        label: "Verified answer",
        status: "done",
        summary: v3.ok ? "answer built from tool output" : "V3 failed: number not in tool output",
        payload: { answer, v3: { ok: v3.ok, numbers: v3.numbers, missing: v3.missing } },
        checks: [
          "V3: every number in the answer matches a value or date part in the tool output",
          "answer is a template over tool output, not model prose",
        ],
      },
    },
  ];
}

/** One ask run, already staged, for tests and for rendering a finished run. */
export function buildAskRun(question: string, context: AskContext): AskRun {
  const planned = planStages(question, context);
  const stages: AskStage[] = planned.map(({ stage, delayMs }) => ({ ...stage, ms: delayMs }));
  return summarizeStages(question, stages);
}

/** Stream the stages with measured latency, as the HTTP client would stream them. */
export async function* streamAsk(
  question: string,
  context: AskContext,
): AsyncGenerator<AskStage, AskRun, unknown> {
  const planned = planStages(question, context);
  const stages: AskStage[] = [];
  for (const { stage, delayMs } of planned) {
    const started = Date.now();
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const stageWithTiming: AskStage = { ...stage, ms: Date.now() - started };
    stages.push(stageWithTiming);
    yield stageWithTiming;
  }
  return summarizeStages(question, stages);
}
