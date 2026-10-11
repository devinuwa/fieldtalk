"""Both deterministic guards, tested with the *recorded* gemma3:4b outputs.

No model calls (AGENTS.md section 3): the raw outputs of the two live eval runs of
2026-10-07 are stubbed verbatim (see docs/PROMPTS.md A1 report), and grading reuses the
eval script's own ``compare_to_gold`` so "T01 gold passes" means exactly what the eval
means.

Guard (a): date_expr equal to planting_date_expr + fewer than two date phrases in the
transcript -> date_expr becomes null.
Guard (b): after V1 no grounded plot and crop null or generic -> the whole result
becomes action "clarify" with the fixed question.
"""

from __future__ import annotations

import importlib.util
import json
from datetime import date
from pathlib import Path

import pytest

from fieldtalk.pipeline import (
    GUARD_CLARIFY_QUESTION,
    REFUSAL_MESSAGE,
    SchemaError,
    StubAdapter,
    extract,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
EVAL_FILE = REPO_ROOT / "eval" / "transcripts.jsonl"
RECORDED_ON = date(2026, 10, 7)  # the recording date used in both live runs

# --- raw model outputs, verbatim from the two live runs --------------------
RAW_T01_RUN1 = (
    '{"entries":[{"plot":"plot two","crop":"maize","kind":"observation",'
    '"text":"Leaves are green and the tassels have started showing",'
    '"date_expr":{"kind":"month_day","n":10,"month":7,"day":10},'
    '"planting_date_expr":{"kind":"month_day","n":null,"month":7,"day":10},'
    '"quantity":null}],"action":"run","clarify_question":null}'
)
RAW_T01_RUN2 = (
    '{"entries":[{"plot":"plot two","crop":"maize","kind":"observation",'
    '"text":"Leaves are green and the tassels have started showing",'
    '"date_expr":{"kind":"month_day","n":null,"month":7,"day":10},'
    '"planting_date_expr":{"kind":"month_day","n":null,"month":7,"day":10},'
    '"quantity":null}],"action":"run","clarify_question":null}'
)
RAW_T05_RUN2 = (
    '{"entries":[{"plot":"plot three","crop":"millet","kind":"observation",'
    '"text":"Two days ago it rained heavily and water stood in the lower corner",'
    '"date_expr":{"kind":"days_ago","n":2,"month":null,"day":null},'
    '"planting_date_expr":null,"quantity":null}], "action": "run", "clarify_question": null}'
)
RAW_X01 = '{"entries":[],"action":"refuse","clarify_question":null}'
RAW_X02_RUN1 = (
    '{"entries":[{"plot":null,"crop":"plants","kind":"observation",'
    '"text":"look bad today",'
    '"date_expr":{"kind":"today","n":null,"month":null,"day":null},'
    '"planting_date_expr":null,"quantity":null}], "action": "run", "clarify_question": null}'
)
RAW_X02_RUN2 = (
    '{"entries":[{"plot":null,"crop":"plants","kind":"observation",'
    '"text":"The plants look bad today",'
    '"date_expr":{"kind":"today","n":null,"month":null,"day":null},'
    '"planting_date_expr":null,"quantity":null}], "action": "run", "clarify_question": null}'
)


def _eval_rows() -> dict[str, dict]:
    return {
        row["id"]: row
        for row in (
            json.loads(line)
            for line in EVAL_FILE.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    }


def _compare_module():
    """Import the eval script so the tests grade with the real comparator."""
    path = REPO_ROOT / "backend" / "scripts" / "extract_eval.py"
    spec = importlib.util.spec_from_file_location("extract_eval_under_test", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


ROWS = _eval_rows()
EVAL_MOD = _compare_module()


def _gold_passes(transcript_id: str, raw: str):
    row = ROWS[transcript_id]
    result = extract(row["transcript"], StubAdapter([raw]), recorded_on=RECORDED_ON)
    checked, problems = EVAL_MOD.compare_to_gold(result, row["gold"])
    return result, checked, problems


# ---------------------------------------------------------------------------
# The four eval cases, with recorded outputs
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("raw", [RAW_T01_RUN1, RAW_T01_RUN2], ids=["run1", "run2"])
def test_T01_gold_passes_with_recorded_raw_output(raw: str) -> None:
    result, checked, problems = _gold_passes("T01", raw)
    assert problems == [], problems
    assert "date_expr" in checked and "planting_date_expr" in checked
    entry = result.entries[0]
    assert entry.date_expr is None, "guard (a): the copied planting date is dropped"
    assert entry.planting_date == date(2026, 7, 10), "the planting date itself is kept"
    assert entry.date == RECORDED_ON, "no observation date -> the recording date"


def test_T01_phrase_count_is_one_so_the_guard_may_fire() -> None:
    from fieldtalk.pipeline import observation_date_phrase_count

    assert observation_date_phrase_count(ROWS["T01"]["transcript"]) == 1


@pytest.mark.parametrize("raw", [RAW_X02_RUN1, RAW_X02_RUN2], ids=["run1", "run2"])
def test_X02_recorded_raw_becomes_clarify(raw: str) -> None:
    result, _, problems = _gold_passes("X02", raw)
    assert problems == [], problems
    assert result.action == "clarify", "guard (b) overrode the model's run"
    assert result.clarify_question == GUARD_CLARIFY_QUESTION
    assert result.clarify_question == "Which plot, and what looks wrong?"
    assert result.entries == ()


def test_T05_still_passes_with_recorded_raw_output() -> None:
    result, _, problems = _gold_passes("T05", RAW_T05_RUN2)
    assert problems == [], problems
    assert result.action == "run"
    assert result.entries[0].date == date(2026, 10, 5)
    assert result.entries[0].date_expr is not None, "guard (a) must not touch T05"


def test_X01_still_refuses_with_recorded_raw_output() -> None:
    result, _, problems = _gold_passes("X01", RAW_X01)
    assert problems == [], problems
    assert result.action == "refuse"
    assert result.refusal == REFUSAL_MESSAGE
    assert result.entries == ()


# ---------------------------------------------------------------------------
# Guard (a): three extra stub cases
# ---------------------------------------------------------------------------


def _run_output(date_expr: dict, planting: dict, text: str) -> str:
    return json.dumps(
        {
            "entries": [
                {
                    "plot": "onion bed",
                    "crop": "spring onions",
                    "kind": "observation",
                    "text": text,
                    "date_expr": date_expr,
                    "planting_date_expr": planting,
                    "quantity": None,
                }
            ],
            "action": "run",
            "clarify_question": None,
        }
    )


_EXPR = {"kind": "month_day", "month": 3, "day": 5}
_NULL_EXPR = {"kind": None, "n": None, "month": None, "day": None}


def test_guard_a_fires_with_exactly_one_date_phrase() -> None:
    transcript = "Onion bed, spring onions, planted on March fifth. The blades are upright."
    raw = _run_output({**_EXPR, "n": None}, {**_EXPR, "n": None}, "The blades are upright")
    result = extract(transcript, StubAdapter([raw]), recorded_on=RECORDED_ON)
    entry = result.entries[0]
    assert entry.date_expr is None
    assert entry.planting_date == date(2026, 3, 5)
    assert entry.date == RECORDED_ON


def test_guard_a_fires_when_the_transcript_has_no_date_phrase_at_all() -> None:
    transcript = "Onion bed, spring onions."
    raw = _run_output({**_EXPR, "n": None}, {**_EXPR, "n": None}, "The blades are upright")
    result = extract(transcript, StubAdapter([raw]), recorded_on=RECORDED_ON)
    entry = result.entries[0]
    assert entry.date_expr is None, "two identical expressions, zero phrases -> null"
    assert entry.planting_date == date(2026, 3, 5), "planting date is never touched"


def test_guard_a_does_not_fire_with_two_date_phrases() -> None:
    transcript = (
        "Onion bed, spring onions planted on March fifth. Weeded again on March twelfth."
    )
    raw = _run_output({**_EXPR, "n": None}, {**_EXPR, "n": None}, "Weeded again")
    result = extract(transcript, StubAdapter([raw]), recorded_on=RECORDED_ON)
    entry = result.entries[0]
    assert entry.date_expr is not None, "a second date phrase exists: keep the date"
    assert entry.date_expr.kind == "month_day"
    assert (entry.date_expr.month, entry.date_expr.day) == (3, 5)


def test_guard_a_does_not_fire_when_the_expressions_differ() -> None:
    from fieldtalk.pipeline import parse_model_output
    from fieldtalk.pipeline.verify import guard_duplicate_date

    parsed = parse_model_output(
        _run_output(
            {"kind": "days_ago", "n": 1, "month": None, "day": None},
            {**_EXPR, "n": None},
            "Weeded yesterday",
        )
    )
    # 1 phrase ("March") but different expressions -> untouched.
    assert guard_duplicate_date(parsed.entries[0], 1) == parsed.entries[0].date_expr


# ---------------------------------------------------------------------------
# Guard (b): three extra stub cases
# ---------------------------------------------------------------------------


def _clarify_case_output(plot, crop, text, kind="issue") -> str:
    return json.dumps(
        {
            "entries": [
                {
                    "plot": plot,
                    "crop": crop,
                    "kind": kind,
                    "text": text,
                    "date_expr": None,
                    "planting_date_expr": None,
                    "quantity": None,
                }
            ],
            "action": "run",
            "clarify_question": None,
        }
    )


def test_guard_b_fires_when_the_named_plot_is_not_grounded_and_crop_is_generic() -> None:
    transcript = "The leaves are yellowing badly."
    raw = _clarify_case_output("plot nine", "leaves", "The leaves are yellowing badly")
    result = extract(transcript, StubAdapter([raw]), recorded_on=RECORDED_ON)
    assert result.action == "clarify", "plot nine is not in the transcript; crop is generic"
    assert result.clarify_question == GUARD_CLARIFY_QUESTION
    assert result.entries == ()
    assert result.parsed.action == "run", "the raw model action stays inspectable"


def test_guard_b_does_not_fire_when_a_specific_crop_anchors_the_note() -> None:
    transcript = "Millet is looking dry."
    raw = _clarify_case_output(None, "millet", "Millet is looking dry", kind="observation")
    result = extract(transcript, StubAdapter([raw]), recorded_on=RECORDED_ON)
    assert result.action == "run", "no plot, but the crop is specific"
    assert len(result.entries) == 1
    assert result.entries[0].crop == "millet"


def test_guard_b_does_not_fire_when_the_plot_is_grounded() -> None:
    transcript = "Plot one, plants look bad."
    raw = _clarify_case_output("plot one", "plants", "plants look bad", kind="observation")
    result = extract(transcript, StubAdapter([raw]), recorded_on=RECORDED_ON)
    assert result.action == "run", "grounded plot anchors even a generic crop"
    assert len(result.entries) == 1


def test_guard_b_never_touches_refuse_or_clarify_results() -> None:
    result = extract(
        "What price will fetch for this?", StubAdapter([RAW_X01]), recorded_on=RECORDED_ON
    )
    assert result.action == "refuse" and result.refusal == REFUSAL_MESSAGE

    clarify_raw = json.dumps(
        {"entries": [], "action": "clarify", "clarify_question": "Which plot?"}
    )
    result = extract("Something is off.", StubAdapter([clarify_raw]), recorded_on=RECORDED_ON)
    assert result.action == "clarify" and result.clarify_question == "Which plot?"


def test_guards_survive_an_invalid_model_output() -> None:
    with pytest.raises(SchemaError):
        extract("Plot two, maize.", StubAdapter(["not json"]), recorded_on=RECORDED_ON)
