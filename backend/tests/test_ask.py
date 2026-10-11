"""Regression tests for safe handling of invalid ask plans."""

from __future__ import annotations

from datetime import date

from fieldtalk.pipeline import StubAdapter
from fieldtalk.pipeline.ask import ASK_CLARIFY_FALLBACK, ASK_REFUSAL_MESSAGE, ask
from fieldtalk.store import Entry, Store


def _store(tmp_path):
    path = tmp_path / "ask.db"
    Store(path).add(
        [
            Entry(
                id="e1",
                plot="plot 1",
                crop="maize",
                kind="observation",
                date=date(2026, 9, 28),
                text="maize plants are green",
            )
        ]
    )
    return path


def test_model_refusal_plan_returns_fixed_refusal_without_calling_tool(tmp_path) -> None:
    result = ask(
        "Tell me something about plot 1",
        StubAdapter(
            [
                '{"action":"refuse","tool":null,"plot_text":null,'
                '"date_expr":null,"keyword":null,"clarify_question":null}'
            ]
        ),
        _store(tmp_path),
        as_of=date(2026, 10, 8),
    )

    assert result.action == "refuse"
    assert result.answer == ASK_REFUSAL_MESSAGE
    assert result.tool_result["error"] == "plan refused by model"
    assert result.v3_violations == []


def test_malformed_model_plan_returns_clarification_instead_of_raising(tmp_path) -> None:
    result = ask(
        "What happened on plot 1?",
        StubAdapter(["not json"]),
        _store(tmp_path),
        as_of=date(2026, 10, 8),
    )

    assert result.action == "clarify"
    assert "could not safely interpret" in result.answer
    assert result.clarify_question == result.answer
    assert result.tool_result["error"] == "invalid model plan"
    assert result.v3_violations == []


def test_incomplete_run_plan_returns_clarification_instead_of_raising(tmp_path) -> None:
    result = ask(
        "What happened on plot 1?",
        StubAdapter(
            [
                '{"action":"run","tool":null,"plot_text":null,'
                '"date_expr":null,"keyword":null,"clarify_question":null}'
            ]
        ),
        _store(tmp_path),
        as_of=date(2026, 10, 8),
    )

    assert result.action == "clarify"
    assert "could not safely route" in result.answer
    assert result.tool_result["error"] == "tool is required for action run"
    assert result.v3_violations == []


def _plan(**over) -> str:
    import json

    base = {
        "action": "run",
        "tool": "plot_timeline",
        "plot_text": "plot 1",
        "date_expr": None,
        "keyword": None,
        "clarify_question": None,
    }
    base.update(over)
    return json.dumps(base)


def test_out_of_range_days_ago_is_clarified_instead_of_raising(tmp_path) -> None:
    """Regression: date_expr.n beyond date arithmetic raised OverflowError -> HTTP 500."""
    result = ask(
        "What happened recently?",
        StubAdapter(
            [
                _plan(
                    tool="days_since_last_note",
                    date_expr={"kind": "days_ago", "n": 999999999999, "month": None, "day": None},
                )
            ]
        ),
        _store(tmp_path),
        as_of=date(2026, 10, 8),
    )

    assert result.action == "clarify"
    assert "could not safely route" in result.answer
    assert result.answer  # never empty
    assert result.v3_violations == []


def test_float_overflow_date_expr_is_clarified_instead_of_raising(tmp_path) -> None:
    result = ask(
        "What happened recently?",
        StubAdapter(
            [
                _plan(
                    tool="days_since_last_note",
                    date_expr={"kind": "days_ago", "n": 1e30, "month": None, "day": None},
                )
            ]
        ),
        _store(tmp_path),
        as_of=date(2026, 10, 8),
    )

    assert result.action == "clarify"
    assert result.answer
    assert result.v3_violations == []


def test_model_clarify_plan_returns_its_question_without_running_a_tool(tmp_path) -> None:
    question_text = "Which plot do you mean?"
    result = ask(
        "What happened?",
        StubAdapter([_plan(action="clarify", tool=None, plot_text=None, clarify_question=question_text)]),
        _store(tmp_path),
        as_of=date(2026, 10, 8),
    )

    assert result.action == "clarify"
    assert result.answer == question_text
    assert result.clarify_question == question_text
    assert result.tool_result == {"clarify_question": question_text}  # no tool ran
    assert result.v3_violations == []


def test_model_clarify_with_null_string_sentinel_uses_safe_fallback(tmp_path) -> None:
    """The plan prompt spells "absent" as the literal word null; honour it as absent."""
    result = ask(
        "What happened?",
        StubAdapter([_plan(action="clarify", tool=None, plot_text=None, clarify_question="null")]),
        _store(tmp_path),
        as_of=date(2026, 10, 8),
    )

    assert result.action == "clarify"
    assert result.answer == ASK_CLARIFY_FALLBACK
    assert "null" not in result.answer.lower()
    assert result.clarify_question == ASK_CLARIFY_FALLBACK
    assert result.v3_violations == []


def test_null_string_keyword_does_not_run_a_pointless_search(tmp_path) -> None:
    result = ask(
        "Search my notes",
        StubAdapter([_plan(tool="search_notes", plot_text=None, keyword="null")]),
        _store(tmp_path),
        as_of=date(2026, 10, 8),
    )

    assert result.action == "clarify"
    assert "search_notes requires a keyword" in result.answer
    assert "Notes mentioning" not in result.answer  # no successful-looking empty search
    assert result.v3_violations == []


def test_unknown_plot_clarifies_with_a_non_empty_answer_listing_plots(tmp_path) -> None:
    """Regression: this path used to be dead (error-string mismatch), then answer-empty."""
    result = ask(
        "What is the timeline for plot 99?",
        StubAdapter([_plan(plot_text="plot 99")]),
        _store(tmp_path),
        as_of=date(2026, 10, 8),
    )

    assert result.action == "clarify"
    assert result.answer  # never an empty answer
    assert result.answer == result.clarify_question
    assert "plot 1" in result.answer  # known plots offered back
    assert result.tool_result["error"].startswith("unknown plot")
    assert result.v3_violations == []


def test_plot_scoped_tool_without_plot_text_clarifies(tmp_path) -> None:
    result = ask(
        "What is the timeline?",
        StubAdapter([_plan(plot_text=None)]),
        _store(tmp_path),
        as_of=date(2026, 10, 8),
    )

    assert result.action == "clarify"
    assert "plot_timeline requires plot_text" in result.answer
    assert result.v3_violations == []
