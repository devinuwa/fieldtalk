"""Ask-your-notes pipeline: question -> model plan -> V2 -> tool -> template -> V3.

Layered exactly as PLAN.md describes (AGENTS.md section 3 / docs/PLAN.md):

    question -> ModelAdapter (plan schema) -> parse_model_plan
               -> V2 validate (allowlist, plot_text must match a known plot, date parsed by code)
               -> call tool
               -> template answer
               -> V3 verify (every number/date in the answer comes from the tool output;
                   denylist: fertilizer, pesticide, should, recommend, advice, diagnose, disease)

The model emits a *plan*, never an answer. The answer is assembled from the tool output
by code. Advice questions -> the fixed refusal string in code (AGENTS.md rule 3).
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from ..engine import ENTRY_KINDS, ENTRY_KINDS_STR, resolve_date
from ..engine.models import DateExpr, Quantity
from ..pipeline.adapters import Completion, ModelAdapter
from ..pipeline.schema import ENTRY_JSON_SCHEMA, _require_exact_keys, _require_object, _optional_str

class ParseError(ValueError):
    pass
from ..tools import (
    days_since_last_note_tool,
    days_since_planting_tool,
    normalize_plot,
    open_issues_tool,
    plot_timeline_tool,
    search_notes_tool,
    weekly_summary_tool,
    all_entries,
    _resolve_plot,
    _unknown_plot_payload,
)


# ---------------------------------------------------------------------------
# Closed plan schema (what the model emits for an ask), derived from PLAN.md
# ---------------------------------------------------------------------------

ASK_PLAN_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "action": {"enum": ["run", "clarify", "refuse"]},
        "tool": {
            "type": "string",
            "enum": [
                "plot_timeline",
                "days_since_planting",
                "days_since_last_note",
                "open_issues",
                "weekly_summary",
                "search_notes",
            ],
        },
        "plot_text": {"type": ["string", "null"]},
        "date_expr": {"type": ["object", "null"]},
        "keyword": {"type": ["string", "null"]},
        "clarify_question": {"type": ["string", "null"]},
    },
    "required": ["action", "tool", "plot_text", "date_expr", "keyword", "clarify_question"],
}


@dataclass(frozen=True)
class AskPlan:
    """What the model plans to do — parsed and validated from its JSON text."""

    action: str
    tool: str | None
    plot_text: str | None
    date_expr: dict[str, Any] | None  # {kind, n, month, day} or null
    keyword: str | None
    clarify_question: str | None


_NULL_SENTINELS = frozenset({"null", "none"})


def _sentinel_none(value: str | None) -> str | None:
    """Honour the plan prompt's own spelling of "absent": the literal word ``null``.

    The prompt shows ``"keyword":"search term or null"``, so the model sometimes
    returns the *string* ``"null"`` instead of JSON ``null``. Treating that as a real
    value produces semantically empty behaviour (searching for the word "null",
    answering with the string "null"); normalizing it here never invents data — it
    drops a sentinel the prompt itself defined.
    """
    if value is not None and value.strip().lower() in _NULL_SENTINELS:
        return None
    return value


def parse_model_plan(raw: str) -> AskPlan:
    """Parse and validate the model's plan against the closed ask schema.

    Raises ``ParseError`` on anything that does not match. Nothing is guessed around.
    """
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ParseError(f"ask plan is not valid JSON: {exc}") from exc

    obj = _require_object(data, "ask plan")
    _require_exact_keys(obj, frozenset(ASK_PLAN_JSON_SCHEMA["required"]), "ask plan")

    if obj["action"] not in ASK_PLAN_JSON_SCHEMA["properties"]["action"]["enum"]:
        raise ParseError(f"action {obj['action']!r} not in {ASK_PLAN_JSON_SCHEMA['properties']['action']['enum']}")

    tool = obj["tool"]
    if tool is not None:
        allowed = ASK_PLAN_JSON_SCHEMA["properties"]["tool"]["enum"]
        if tool not in allowed:
            raise ParseError(f"tool {tool!r} not in allowed set {allowed}")

    plot_text = _optional_str(obj.get("plot_text"), "plot_text")
    keyword = _sentinel_none(_optional_str(obj.get("keyword"), "keyword"))
    clarify_question = _sentinel_none(_optional_str(obj.get("clarify_question"), "clarify_question"))

    date_expr: dict[str, Any] | None = None
    raw_de = obj.get("date_expr")
    if raw_de is not None:
        if not isinstance(raw_de, dict):
            raise ParseError("date_expr must be an object or null")
        # loosely validate: must have at least a kind, any other fields are ints or null
        if "kind" not in raw_de:
            raise ParseError("date_expr must have a kind")
        kind = raw_de["kind"]
        if kind not in ("today", "days_ago", "month_day", None):
            raise ParseError(f"date_expr.kind {kind!r} not allowed")
        date_expr = {
            "kind": kind,
            "n": (int(raw_de["n"]) if raw_de.get("n") is not None else None),
            "month": (int(raw_de["month"]) if raw_de.get("month") is not None else None),
            "day": (int(raw_de["day"]) if raw_de.get("day") is not None else None),
        }

    return AskPlan(
        action=obj["action"],
        tool=tool,
        plot_text=plot_text,
        date_expr=date_expr,
        keyword=keyword,
        clarify_question=clarify_question,
    )


# ---------------------------------------------------------------------------
# V2 — allowlist + plot_text must match a known plot + date parsed by code
# ---------------------------------------------------------------------------

VALID_TOOLS = frozenset(ASK_PLAN_JSON_SCHEMA["properties"]["tool"]["enum"])

ADVICE_QUESTION_DENYLIST = frozenset(
    [
        "fertilizer",
        "pesticide",
        "pesticides",
        "herbicide",
        "should",
        "recommend",
        "advice",
        "diagnose",
        "diagnosis",
        "disease",
        "what should",
        "can you tell me",
    ]
)


def is_advice_question(question: str) -> bool:
    """Detect whether the user is asking for advice/diagnosis/recommendation.

    Static denylist — no model involved. If the question contains a denylisted phrase,
    the ask pipeline refuses with the fixed code string.
    """
    q = question.lower()
    return any(term in q for term in ADVICE_QUESTION_DENYLIST)


def plan_to_tool_call(plan: AskPlan, known_plots: list[str], as_of: date) -> dict[str, Any]:
    """Convert a validated plan into a call signature for the matching tool.

    V2 validates: tool in allowlist, plot_text (if non-null) matches a known plot
    (after normalization), date_expr parsed by code (not the model). On failure,
    returns an error dict the pipeline turns into a clarify.
    """
    errors: list[str] = []

    if plan.action == "refuse":
        return {"error": "plan refused by model", "refuse": True}

    if plan.tool is None:
        errors.append("tool is required for action run")
        return {"error": "; ".join(errors), "errors": errors}

    if plan.tool not in VALID_TOOLS:
        errors.append(f"tool {plan.tool!r} not in allowlist")
        return {"error": "; ".join(errors), "errors": errors}

    # A plot-scoped tool with no plot, or a search with no term, would otherwise
    # produce a "successful-looking" but meaningless answer (e.g. dumping every note).
    if plan.tool in ("plot_timeline", "days_since_planting", "days_since_last_note") and plan.plot_text is None:
        errors.append(f"{plan.tool} requires plot_text")
        return {"error": "; ".join(errors), "errors": errors}
    if plan.tool == "search_notes" and not plan.keyword:
        errors.append("search_notes requires a keyword")
        return {"error": "; ".join(errors), "errors": errors}

    # plot_text must match a known plot (case-insensitive, collapsed whitespace)
    resolved_plot: str | None = None
    if plan.plot_text is not None:
        norm = normalize_plot(plan.plot_text).strip()
        if norm:
            matches = [p for p in known_plots if normalize_plot(p) == norm]
            if not matches:
                return {
                    "error": f"unknown plot {plan.plot_text!r}",
                    "plot_text": plan.plot_text,
                    "known_plots": known_plots,
                }
            resolved_plot = matches[0]

    # date_expr -> resolved date by code (never by the model)
    resolved_date: date | None = None
    if plan.date_expr is not None:
        date_expr_obj = DateExpr(
            kind=plan.date_expr.get("kind", "today"),
            n=plan.date_expr.get("n"),
            month=plan.date_expr.get("month"),
            day=plan.date_expr.get("day"),
        )
        resolved_date = resolve_date(date_expr_obj, as_of)
        if resolved_date is None:
            errors.append("could not resolve date_expr")
            return {"error": "; ".join(errors), "errors": errors}

    # Build the tool call args
    kwargs: dict[str, Any] = {"db_path": None}  # set by caller
    if plan.tool == "plot_timeline":
        kwargs["plot_text"] = plan.plot_text
    elif plan.tool == "days_since_planting":
        kwargs["plot_text"] = plan.plot_text
        kwargs["planting_date"] = resolved_date
    elif plan.tool == "days_since_last_note":
        kwargs["plot_text"] = plan.plot_text
        kwargs["as_of"] = resolved_date or as_of
    elif plan.tool == "open_issues":
        kwargs["plot_text"] = plan.plot_text
    elif plan.tool == "weekly_summary":
        kwargs["week_of"] = resolved_date or as_of
    elif plan.tool == "search_notes":
        kwargs["keyword"] = plan.keyword or ""

    return {
        "tool": plan.tool,
        "resolved_plot": resolved_plot,
        "resolved_date": resolved_date,
        "args": kwargs,
    }


# ---------------------------------------------------------------------------
# V3 — template answer + verification that every number/date comes from tool output
# ---------------------------------------------------------------------------

# Fixed refusal message for advice questions (AGENTS.md rule 3: fixed string in code)
ASK_REFUSAL_MESSAGE = (
    "I can only help you look through your own field notes here. "
    "I do not give advice on fertilizers, pesticides, diseases, prices, or the weather, "
    "and I do not make recommendations."
)

# Safe fallback when the model plans "clarify" but sends no usable question.
ASK_CLARIFY_FALLBACK = (
    "Could you rephrase that? You can ask about a plot's timeline, days since "
    "planting, days since the last note, open issues, or a weekly summary."
)


def build_answer(plan: AskPlan, tool_result: dict[str, Any], as_of: date) -> str:
    """Assemble a template answer from the tool result.

    The answer is a template over tool output only — no model-generated prose, no
    invented numbers or dates. V3 then checks that every number and date in the answer
    appears in the tool output.
    """
    tool = plan.tool
    if "error" in tool_result:
        if tool_result.get("error") == "unknown plot":
            candidates = tool_result.get("known_plots", [])
            cand = ", ".join(candidates[:5]) if candidates else "none"
            return (
                f"I do not have a plot called {plan.plot_text!r}. "
                f"The plots I have are: {cand}. "
                "Can you rephrase or pick one of those?"
            )
        if tool_result.get("error") == "plan refused by model":
            return ASK_REFUSAL_MESSAGE
        return f"I could not run that: {tool_result.get('error', 'unknown error')}."

    if tool == "plot_timeline":
        if not tool_result:
            return f"There are no entries for {plan.plot_text}."
        lines = [f"Timeline for {plan.plot_text}:"]
        for e in tool_result:
            q = ""
            if e.get("quantity"):
                q = f" ({e['quantity']['value']} {e['quantity']['unit']})"
            lines.append(f"  * {e['date']}: {e['text']}{q}")
        return "\n".join(lines)

    if tool == "days_since_planting":
        d = tool_result
        if d.get("days_since_planting") is None:
            return f"I have {d['plot']} but no planting date on record."
        return (
            f"{d['plot']} was planted on {d['planting_date']} — "
            f"that is {d['days_since_planting']} days before {d['as_of']}."
        )

    if tool == "days_since_last_note":
        d = tool_result
        if d.get("days_since_last_note") is None:
            return f"I have no notes yet for {d['plot']}."
        return (
            f"The last note on {d['plot']} is {d['last_note']} — "
            f"that is {d['days_since_last_note']} days before {d['as_of']}."
        )

    if tool == "open_issues":
        if not tool_result:
            return "There are no open issues right now."
        lines = ["Open issues:"]
        for e in tool_result:
            lines.append(f"  * {e['date']} ({e['plot']}): {e['text']}")
        return "\n".join(lines)

    if tool == "weekly_summary":
        d = tool_result
        lines = [f"Week {d['week_start']} … {d['week_end']}:"]
        lines.append(f"  {d['total_entries']} entries total")
        counts = d.get("counts_by_kind", {})
        if counts:
            lines.append("  by kind: " + ", ".join(f"{k}: {v}" for k, v in counts.items() if v))
        if d.get("plots_touched"):
            lines.append("  plots: " + ", ".join(p['plot'] for p in d['plots_touched']))
        if d.get("open_issues"):
            lines.append("  open issues: " + ", ".join(f"{i['id']} ({i['plot']}, {i['date']})" for i in d['open_issues']))
        if d.get("last_note_by_plot"):
            lines.append("  last note by plot:")
            for p in d['last_note_by_plot']:
                lines.append(f"    - {p['plot']}: {p['days_since']} days ago ({p['date']})")
        return "\n".join(lines)

    if tool == "search_notes":
        if not tool_result:
            return f"No notes mention {plan.keyword!r}."
        lines = [f"Notes mentioning {plan.keyword}:"]
        for e in tool_result:
            lines.append(f"  * {e['date']} ({e['plot'] or 'no plot'}): {e['text']}")
        return "\n".join(lines)

    return f"Unhandled tool {tool!r}."


# Dates and numbers that might appear in an answer — extracted for V3.
_DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
_NUMBER_RE = re.compile(r"\b\d+(?:\.\d+)?\b")


def _tool_strings(tool_result: dict[str, Any]) -> set[str]:
    """All numeric and date strings appearing anywhere in the tool output."""
    blobs: list[str] = []

    def _rec(value: Any) -> None:
        if value is None:
            return
        if isinstance(value, str):
            blobs.append(value)
        elif isinstance(value, (int, float)):
            blobs.append(str(value))
        elif isinstance(value, dict):
            for v in value.values():
                _rec(v)
        elif isinstance(value, (list, tuple)):
            for v in value:
                _rec(v)

    _rec(tool_result)
    return set(blobs)


def _answer_strings(answer: str) -> tuple[set[str], set[str]]:
    """ISO dates and standalone numbers in the answer.

    ISO dates are masked out before the number pass so a date's components
    ('09', '28', ...) are not misread as answer numbers.
    """
    dates = {m.group(0) for m in _DATE_RE.finditer(answer)}
    masked = _DATE_RE.sub(" ", answer)
    numbers = {m.group(0) for m in _NUMBER_RE.finditer(masked)}
    return dates, numbers


def verify_answer(answer: str, tool_result: dict[str, Any]) -> list[str]:
    """V3: every number and date in the answer must appear in the tool output.

    Dates must appear as ISO-date substrings of the tool output; numbers must appear
    as substrings of some tool-output string (so a plot name ``plot 1`` grounds the
    ``1`` in the answer, while a digit inventable only from nothing matches nothing).
    Returns a list of violations (empty = the answer passes).
    """
    tool_set = _tool_strings(tool_result)
    answer_dates, answer_numbers = _answer_strings(answer)
    violations: list[str] = []
    missing_dates = sorted(d for d in answer_dates if not any(d in s for s in tool_set))
    if missing_dates:
        violations.append(f"dates in answer not from tool output: {missing_dates}")
    missing_numbers = sorted(n for n in answer_numbers if not any(n in s for s in tool_set))
    if missing_numbers:
        violations.append(f"numbers in answer not from tool output: {missing_numbers}")
    low = answer.lower()
    for term in ADVICE_QUESTION_DENYLIST:
        if term in low:
            violations.append(f"answer contains forbidden term {term!r}")
    return violations


# ---------------------------------------------------------------------------
# Ask pipeline entry point
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AskResult:
    action: str  # "run" | "clarify" | "refuse"
    answer: str
    clarify_question: str | None
    plan: AskPlan
    tool_result: dict[str, Any]
    v3_violations: list[str]
    question: str
    path: Path


def ask(
    question: str,
    model: ModelAdapter,
    db_path: Path,
    *,
    as_of: date | None = None,
) -> AskResult:
    """Run one ask-your-notes question through the full pipeline.

    1. Detects advice questions at code level (denylist, no model).
    2. Asks the model for a plan (closed schema) via the same adapter.
    3. Parses and validates the plan (V2).
    4. Calls the tool.
    5. Builds a template answer.
    6. Verifies the answer (V3).
    """
    as_of = as_of or date.today()

    # Advice check first (code-level, AGENTS.md rule 3)
    if is_advice_question(question):
        return AskResult(
            action="refuse",
            answer=ASK_REFUSAL_MESSAGE,
            clarify_question=None,
            plan=AskPlan(action="refuse", tool=None, plot_text=None, date_expr=None, keyword=None, clarify_question=None),
            tool_result={},
            v3_violations=[],
            question=question,
            path=db_path,
        )

    # Model plan
    plan_prompt = f"Question: {question}\n\nKnown plots in the notebook (use exactly these spellings for plot_text):\n"
    entries = all_entries(db_path)
    plots = [e.plot for e in entries if e.plot]
    if plots:
        plan_prompt += "\n".join(sorted(plots)) + "\n\n"
    plan_prompt += (
        "Reply with a JSON plan only:\n"
        '{"action":"run","tool":"plot_timeline"|"days_since_planting"|"days_since_last_note"|"open_issues"|"weekly_summary"|"search_notes",'
        '"plot_text":"exact plot name or null","date_expr":{"kind":"today"|"days_ago"|"month_day","n":int|null,"month":int|null,"day":int|null}|null,'
        '"keyword":null or "search term","clarify_question":null or "a short question"}\n\n'
        "Routing rules: "
        "plot_timeline is only for a chronological list of notes on a plot; "
        "days_since_planting is for elapsed days since the recorded planting date, "
        "so any question asking how many days since planting or since I planted MUST use "
        'tool="days_since_planting", never plot_timeline, and set date_expr=null; '
        "the planting date comes from the stored note, not from date_expr; "
        "open_issues is for issues that remain unresolved or are still open, "
        "so questions asking what is still open or asking for open issues MUST use "
        'tool="open_issues", never search_notes; '
        "search_notes is only for finding notes that mention an explicit keyword or phrase, "
        "not for open-issue questions; "
        "days_since_last_note is for elapsed days since the most recent note; "
        "weekly_summary is for counts or a summary of a week. "
        "Copy plot names exactly (case-insensitive match by code). "
        "For open_issues with no plot, set plot_text=null. "
        "date_expr is optional and code resolves it. "
        "If unsure which tool, set action='clarify' with clarify_question.\n\n"
        'Examples: '
        '{"question":"How many days since I planted the maize on plot 1?","tool":"days_since_planting",'
        '"plot_text":"plot 1","keyword":null}; '
        '{"question":"What is still open on plot 3?","tool":"open_issues","plot_text":"plot 3","keyword":null}.'
    )

    completion: Completion = model.complete(plan_prompt)
    try:
        plan = parse_model_plan(completion.text)
    except (ParseError, TypeError, ValueError) as exc:
        message = f"I could not safely interpret that question plan: {exc}"
        return AskResult(
            action="clarify",
            answer=message,
            clarify_question=message,
            plan=AskPlan(
                action="clarify",
                tool=None,
                plot_text=None,
                date_expr=None,
                keyword=None,
                clarify_question=message,
            ),
            tool_result={"error": "invalid model plan", "detail": str(exc)},
            v3_violations=[],
            question=question,
            path=db_path,
        )

    # action clarify: the model is asking the user something. Return that question
    # (or the safe fallback) — no tool runs, nothing is guessed, and an incomplete
    # clarify plan never becomes a successful-looking answer.
    if plan.action == "clarify":
        clarify = plan.clarify_question or ASK_CLARIFY_FALLBACK
        return AskResult(
            action="clarify",
            answer=clarify,
            clarify_question=clarify,
            plan=plan,
            tool_result={"clarify_question": clarify},
            v3_violations=[],
            question=question,
            path=db_path,
        )

    # V2: validate plot_text against known plots and resolve date by code
    known_plots_list = [e.plot for e in entries if e.plot]
    try:
        call = plan_to_tool_call(plan, known_plots_list, as_of)
    except (TypeError, ValueError, OverflowError) as exc:
        # A malformed plan value must never surface as an uncaught HTTP 500.
        message = f"I could not safely route that question: {exc}"
        return AskResult(
            action="clarify",
            answer=message,
            clarify_question=message,
            plan=plan,
            tool_result={"error": "invalid plan value", "detail": str(exc)},
            v3_violations=[],
            question=question,
            path=db_path,
        )

    error = call.get("error")
    if isinstance(error, str) and error.startswith("unknown plot"):
        known = [p for p in (call.get("known_plots") or known_plots_list) if p][:5]
        clarify = f"Which plot? I know: {', '.join(known)}." if known else "Which plot do you mean?"
        return AskResult(
            action="clarify",
            answer=clarify,
            clarify_question=clarify,
            plan=plan,
            tool_result=call,
            v3_violations=[],
            question=question,
            path=db_path,
        )
    if "error" in call:
        if call.get("refuse"):
            return AskResult(
                action="refuse",
                answer=ASK_REFUSAL_MESSAGE,
                clarify_question=None,
                plan=plan,
                tool_result=call,
                v3_violations=[],
                question=question,
                path=db_path,
            )
        message = f"I could not safely route that question: {call['error']}."
        return AskResult(
            action="clarify",
            answer=message,
            clarify_question=message,
            plan=plan,
            tool_result=call,
            v3_violations=[],
            question=question,
            path=db_path,
        )

    # Call the tool
    tool_result = _call_tool(call, db_path, as_of)

    # Build answer
    answer = build_answer(plan, tool_result, as_of)

    # V3
    v3_violations = verify_answer(answer, tool_result)

    # If V3 failed, still return the answer but flag it
    if v3_violations:
        answer = answer + "\n\n[v3 check: " + "; ".join(v3_violations) + "]"

    return AskResult(
        action=plan.action if plan.action != "refuse" else "run",
        answer=answer,
        clarify_question=plan.clarify_question,
        plan=plan,
        tool_result=tool_result,
        v3_violations=v3_violations,
        question=question,
        path=db_path,
    )


def _call_tool(call: dict[str, Any], db_path: Path, as_of: date) -> dict[str, Any]:
    tool = call["tool"]
    args = call["args"].copy()
    args["db_path"] = db_path
    if tool == "plot_timeline":
        return plot_timeline_tool(call.get("resolved_plot") or (args.get("plot_text") or ""), db_path)
    if tool == "days_since_planting":
        return days_since_planting_tool(call.get("resolved_plot") or (args.get("plot_text") or ""), db_path, call.get("resolved_date") or as_of)
    if tool == "days_since_last_note":
        return days_since_last_note_tool(call.get("resolved_plot") or (args.get("plot_text") or ""), db_path, call.get("resolved_date") or as_of)
    if tool == "open_issues":
        pt = call.get("resolved_plot") or (args.get("plot_text"))
        if pt:
            return open_issues_tool(pt, db_path)
        return open_issues_tool(db_path=db_path)
    if tool == "weekly_summary":
        return weekly_summary_tool(call.get("resolved_date") or as_of, db_path)
    if tool == "search_notes":
        return search_notes_tool(args.get("keyword") or "", db_path)
    return {"error": f"unknown tool {tool}"}
