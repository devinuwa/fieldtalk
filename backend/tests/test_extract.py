"""End-to-end extraction with the StubAdapter: no model, deterministic, complete.

These tests walk the whole pipeline (prompt -> adapter -> schema -> V1 -> dates) the
same way the live eval does, so a broken step fails here first.
"""

from __future__ import annotations

from datetime import date

import pytest

from fieldtalk.pipeline import (
    DEFAULT_CLARIFY_QUESTION,
    REFUSAL_MESSAGE,
    SchemaError,
    StubAdapter,
    build_prompt,
    extract,
)

RECORDED = date(2026, 10, 7)

T01_OUTPUT = (
    '{"entries":[{"plot":"plot two","crop":"maize","kind":"observation",'
    '"text":"Leaves are green and the tassels have started showing",'
    '"date_expr":{"kind":null,"n":null,"month":null,"day":null},'
    '"planting_date_expr":{"kind":"month_day","n":null,"month":7,"day":10},'
    '"quantity":null}],"action":"run","clarify_question":null}'
)

T05_OUTPUT = (
    '{"entries":[{"plot":"plot three","crop":"millet","kind":"observation",'
    '"text":"Two days ago it rained heavily and water stood in the lower corner",'
    '"date_expr":{"kind":"days_ago","n":2,"month":null,"day":null},'
    '"planting_date_expr":null,"quantity":null}],"action":"run","clarify_question":null}'
)


def test_build_prompt_contains_rules_examples_and_the_transcript() -> None:
    prompt = build_prompt("Plot two, maize.")
    assert "Rules — copy, never calculate:" in prompt
    assert "Example 1" in prompt and "Example 2" in prompt
    assert "Example 3" not in prompt, "the prompt carries exactly two examples"
    assert prompt.rstrip().endswith("Output:")
    assert "Plot two, maize." in prompt


def test_extract_run_resolves_dates_in_code() -> None:
    adapter = StubAdapter([T01_OUTPUT])
    result = extract("Plot two, maize, planted on July tenth.", adapter, recorded_on=RECORDED)
    assert result.action == "run"
    assert len(result.entries) == 1
    entry = result.entries[0]
    # planting 7/10 -> 2026-07-10, computed here, never emitted by the model.
    assert entry.planting_date == date(2026, 7, 10)
    # No date in the note -> the recording date (engine rule).
    assert entry.date == RECORDED
    assert entry.grounded is True
    assert entry.plot_span is not None
    assert result.refusal is None and result.clarify_question is None
    assert result.raw == T01_OUTPUT
    assert "Plot two, maize" in result.prompt


def test_extract_days_ago_resolves_against_the_recording_date() -> None:
    adapter = StubAdapter([T05_OUTPUT])
    result = extract(
        "Plot three, millet. Two days ago it rained heavily.", adapter, recorded_on=RECORDED
    )
    assert result.entries[0].date == date(2026, 10, 5), "2026-10-07 minus 2 days, by hand"


def test_extract_refuse_uses_the_fixed_string_from_code() -> None:
    adapter = StubAdapter(['{"entries":[],"action":"refuse","clarify_question":null}'])
    result = extract(
        "What fertilizer should I put on the maize and how much?",
        adapter,
        recorded_on=RECORDED,
    )
    assert result.action == "refuse"
    assert result.entries == ()
    assert result.refusal == REFUSAL_MESSAGE
    # The model cannot influence the refusal text.
    assert "fertilizer" in REFUSAL_MESSAGE


def test_extract_clarify_uses_the_model_question() -> None:
    adapter = StubAdapter(
        [
            '{"entries":[],"action":"clarify",'
            '"clarify_question":"Which plot is this, and which crop is affected?"}'
        ]
    )
    result = extract("Something is eating the leaves.", adapter, recorded_on=RECORDED)
    assert result.action == "clarify"
    assert result.clarify_question == "Which plot is this, and which crop is affected?"
    assert result.entries == ()


def test_extract_clarify_falls_back_to_the_code_default_when_unasked() -> None:
    adapter = StubAdapter(['{"entries":[],"action":"clarify","clarify_question":null}'])
    result = extract("The plants look bad today.", adapter, recorded_on=RECORDED)
    assert result.action == "clarify"
    assert result.clarify_question == DEFAULT_CLARIFY_QUESTION


def test_extract_marks_an_ungrounded_crop_instead_of_accepting_it() -> None:
    output = (
        '{"entries":[{"plot":"plot two","crop":"soybean","kind":"observation",'
        '"text":"Leaves are green","date_expr":null,'
        '"planting_date_expr":null,"quantity":null}],"action":"run","clarify_question":null}'
    )
    result = extract("Plot two, maize.", StubAdapter([output]), recorded_on=RECORDED)
    entry = result.entries[0]
    assert entry.ungrounded == ("crop",), "soybean is not in the transcript"
    assert entry.crop == "soybean", "the value is kept for the UI to highlight"
    assert entry.crop_span is None
    assert entry.grounded is False


def test_extract_rejects_invalid_json_from_the_model() -> None:
    with pytest.raises(SchemaError, match="not valid JSON"):
        extract("Plot two, maize.", StubAdapter(["sorry, I cannot"]))


def test_extract_rejects_an_empty_transcript() -> None:
    with pytest.raises(ValueError, match="empty"):
        extract("   ", StubAdapter(["{}"]))


def test_extract_keeps_timings_from_the_adapter() -> None:
    result = extract("Plot two, maize.", StubAdapter([T01_OUTPUT]), recorded_on=RECORDED)
    assert result.timings["wall_ms"] == 0.0
    assert result.parsed_dict["action"] == "run"
