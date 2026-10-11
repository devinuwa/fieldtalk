"""The closed entry schema (docs/PLAN.md): every acceptance rule, derived from PLAN.

A wrong model output must raise ``SchemaError`` — it is never guessed around
(AGENTS.md rule 1: the model extracts, code validates).
"""

from __future__ import annotations

import json

import pytest

from fieldtalk.pipeline import ENTRY_JSON_SCHEMA, SchemaError, parse_model_output
from fieldtalk.pipeline.schema import extraction_as_dict

VALID_RUN = {
    "entries": [
        {
            "plot": "plot two",
            "crop": "maize",
            "kind": "observation",
            "text": "Leaves are green and the tassels have started showing",
            "date_expr": {"kind": None, "n": None, "month": None, "day": None},
            "planting_date_expr": {"kind": "month_day", "n": None, "month": 7, "day": 10},
            "quantity": None,
        }
    ],
    "action": "run",
    "clarify_question": None,
}


def _text(payload: dict) -> str:
    return json.dumps(payload)


def test_valid_run_parses_every_field() -> None:
    parsed = parse_model_output(_text(VALID_RUN))
    assert parsed.action == "run"
    assert len(parsed.entries) == 1
    entry = parsed.entries[0]
    assert entry.plot == "plot two"
    assert entry.crop == "maize"
    assert entry.kind == "observation"
    assert entry.date_expr is None
    assert entry.planting_date_expr is not None
    assert entry.planting_date_expr.kind == "month_day"
    assert (entry.planting_date_expr.month, entry.planting_date_expr.day) == (7, 10)
    assert entry.quantity is None


def test_valid_refuse_and_clarify() -> None:
    refuse = parse_model_output(
        _text({"entries": [], "action": "refuse", "clarify_question": None})
    )
    assert refuse.action == "refuse" and refuse.entries == ()

    clarify = parse_model_output(
        _text(
            {
                "entries": [],
                "action": "clarify",
                "clarify_question": "Which plot is this?",
            }
        )
    )
    assert clarify.action == "clarify"
    assert clarify.clarify_question == "Which plot is this?"


def test_days_ago_expression_parses_with_n() -> None:
    payload = json.loads(_text(VALID_RUN))
    payload["entries"][0]["date_expr"] = {
        "kind": "days_ago",
        "n": 2,
        "month": None,
        "day": None,
    }
    parsed = parse_model_output(json.dumps(payload))
    expr = parsed.entries[0].date_expr
    assert expr is not None and expr.kind == "days_ago" and expr.n == 2


def test_quantity_parses_to_float_value_and_unit() -> None:
    payload = json.loads(_text(VALID_RUN))
    payload["entries"][0]["quantity"] = {"value": 5, "unit": "baskets"}
    parsed = parse_model_output(json.dumps(payload))
    quantity = parsed.entries[0].quantity
    assert quantity is not None
    assert quantity.value == 5.0 and quantity.unit == "baskets"


@pytest.mark.parametrize(
    ("raw", "why"),
    [
        ("not json at all", "plain text is not JSON"),
        ("[1, 2, 3]", "a top-level array is not the schema object"),
        ('{"entries": [], "action": "run", "clarify_question": null}',
         "run with zero entries"),
        ('{"entries": [], "action": "advise", "clarify_question": null}',
         "action outside the closed set"),
        ('{"entries": [], "clarify_question": null}', "missing top-level key"),
        ('{"entries": [], "action": "refuse", "clarify_question": null, "note": "x"}',
         "unknown top-level key"),
        ("random words", "not JSON"),
    ],
)
def test_rejects_invalid_shapes(raw: str, why: str) -> None:
    with pytest.raises(SchemaError):
        parse_model_output(raw), why


def test_rejects_unknown_entry_kind() -> None:
    payload = json.loads(_text(VALID_RUN))
    payload["entries"][0]["kind"] = "harvest"
    with pytest.raises(SchemaError, match="kind"):
        parse_model_output(json.dumps(payload))


def test_rejects_unknown_entry_keys() -> None:
    payload = json.loads(_text(VALID_RUN))
    payload["entries"][0]["confidence"] = 0.9
    with pytest.raises(SchemaError, match="unknown keys"):
        parse_model_output(json.dumps(payload))


def test_rejects_missing_entry_keys() -> None:
    payload = json.loads(_text(VALID_RUN))
    del payload["entries"][0]["text"]
    with pytest.raises(SchemaError, match="missing keys"):
        parse_model_output(json.dumps(payload))


def test_rejects_today_as_a_planting_date_expression() -> None:
    payload = json.loads(_text(VALID_RUN))
    payload["entries"][0]["planting_date_expr"] = {
        "kind": "today",
        "n": None,
        "month": None,
        "day": None,
    }
    with pytest.raises(SchemaError, match="planting_date_expr"):
        parse_model_output(json.dumps(payload))


def test_rejects_boolean_as_quantity_value() -> None:
    payload = json.loads(_text(VALID_RUN))
    payload["entries"][0]["quantity"] = {"value": True, "unit": "baskets"}
    with pytest.raises(SchemaError, match="value"):
        parse_model_output(json.dumps(payload))


def test_rejects_missing_n_for_days_ago_expression() -> None:
    payload = json.loads(_text(VALID_RUN))
    payload["entries"][0]["date_expr"] = {
        "kind": "days_ago",
        "month": None,
        "day": None,
    }
    with pytest.raises(SchemaError, match="missing keys"):
        parse_model_output(json.dumps(payload))


def test_json_schema_covers_the_plan_shape() -> None:
    """The schema handed to Ollama must describe exactly the PLAN.md fields."""
    assert set(ENTRY_JSON_SCHEMA["required"]) == {"entries", "action", "clarify_question"}
    entry_schema = ENTRY_JSON_SCHEMA["properties"]["entries"]["items"]
    assert set(entry_schema["required"]) == {
        "plot", "crop", "kind", "text", "date_expr", "planting_date_expr", "quantity",
    }
    action_enum = ENTRY_JSON_SCHEMA["properties"]["action"]["enum"]
    assert action_enum == ["run", "clarify", "refuse"]
    kind_enum = entry_schema["properties"]["kind"]["enum"]
    assert kind_enum == ["observation", "issue", "action", "plan", "measurement"]
    planting_kinds = entry_schema["properties"]["planting_date_expr"]["properties"]["kind"]["enum"]
    assert planting_kinds == ["month_day", "days_ago", None]


def test_extraction_as_dict_gives_the_api_view_of_the_valid_payload() -> None:
    view = extraction_as_dict(parse_model_output(_text(VALID_RUN)))
    # The view is canonical: an expression whose kind is null collapses to null.
    expected = json.loads(_text(VALID_RUN))
    expected["entries"][0]["date_expr"] = None
    assert json.loads(json.dumps(view)) == expected
