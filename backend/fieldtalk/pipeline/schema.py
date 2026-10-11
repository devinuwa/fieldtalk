"""The closed entry schema: what the model must emit, and the code that validates it.

The schema comes from ``docs/PLAN.md``. It is passed to Ollama's ``format`` parameter so
constrained decoding makes the shape syntactically right, and the result is parsed and
validated *again* here, so a wrong value can never reach the store (AGENTS.md rule 1:
the model extracts, code computes; a bad value is rejected, never guessed around).

The schema is closed: unknown keys, wrong types and out-of-set values are errors
(``SchemaError``), not warnings. Date *expressions* are validated as expressions only —
resolving them to calendar dates happens in ``pipeline.extract`` via the engine.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ..engine import ENTRY_KINDS, DateExpr, Quantity

# ---------------------------------------------------------------------------
# JSON Schema handed to Ollama's structured-output `format` parameter.
# Verified against the installed server (see docs/PROVENANCE.md): Ollama 0.40.0,
# /api/chat with "format": <schema object>, "stream": false, temperature 0.
# ---------------------------------------------------------------------------

_DATE_EXPR_SCHEMA: dict[str, Any] = {
    "type": ["object", "null"],
    "properties": {
        "kind": {"enum": ["today", "days_ago", "month_day", None]},
        "n": {"type": ["integer", "null"]},
        "month": {"type": ["integer", "null"]},
        "day": {"type": ["integer", "null"]},
    },
    "required": ["kind", "n", "month", "day"],
}

PLANTING_EXPR_SCHEMA: dict[str, Any] = {
    "type": ["object", "null"],
    "properties": {
        "kind": {"enum": ["month_day", "days_ago", None]},
        "n": {"type": ["integer", "null"]},
        "month": {"type": ["integer", "null"]},
        "day": {"type": ["integer", "null"]},
    },
    "required": ["kind", "n", "month", "day"],
}

ENTRY_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "entries": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "plot": {"type": ["string", "null"]},
                    "crop": {"type": ["string", "null"]},
                    "kind": {"enum": list(ENTRY_KINDS)},
                    "text": {"type": "string"},
                    "date_expr": _DATE_EXPR_SCHEMA,
                    "planting_date_expr": PLANTING_EXPR_SCHEMA,
                    "quantity": {
                        "type": ["object", "null"],
                        "properties": {
                            "value": {"type": "number"},
                            "unit": {"type": "string"},
                        },
                        "required": ["value", "unit"],
                    },
                },
                "required": [
                    "plot",
                    "crop",
                    "kind",
                    "text",
                    "date_expr",
                    "planting_date_expr",
                    "quantity",
                ],
            },
        },
        "action": {"enum": ["run", "clarify", "refuse"]},
        "clarify_question": {"type": ["string", "null"]},
    },
    "required": ["entries", "action", "clarify_question"],
}

ACTIONS: tuple[str, ...] = ("run", "clarify", "refuse")

TOP_LEVEL_KEYS = frozenset({"entries", "action", "clarify_question"})
ENTRY_KEYS = frozenset(
    {"plot", "crop", "kind", "text", "date_expr", "planting_date_expr", "quantity"}
)
EXPR_KEYS = frozenset({"kind", "n", "month", "day"})


class SchemaError(ValueError):
    """The model output does not match the closed schema."""


ParseError = SchemaError


# ---------------------------------------------------------------------------
# Parsed (validated) forms
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ExtractedEntry:
    """One entry exactly as the model emitted it, before verification."""

    plot: str | None
    crop: str | None
    kind: str
    text: str
    date_expr: DateExpr | None
    planting_date_expr: DateExpr | None
    quantity: Quantity | None


@dataclass(frozen=True)
class Extraction:
    """A validated model output. Dates are still expressions, never resolved."""

    entries: tuple[ExtractedEntry, ...]
    action: str
    clarify_question: str | None


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


def _require_object(value: Any, where: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SchemaError(f"{where}: expected an object, got {type(value).__name__}")
    return value


def _require_exact_keys(value: dict[str, Any], expected: frozenset[str], where: str) -> None:
    keys = set(value)
    missing = expected - keys
    extra = keys - expected
    if missing:
        raise SchemaError(f"{where}: missing keys {sorted(missing)}")
    if extra:
        raise SchemaError(f"{where}: unknown keys {sorted(extra)}")


def _optional_str(value: Any, where: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise SchemaError(f"{where}: expected string or null, got {type(value).__name__}")
    stripped = value.strip()
    return stripped or None


def _int_or_none(value: Any, where: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise SchemaError(f"{where}: expected integer or null, got {value!r}")
    return value


def _parse_expr(value: Any, where: str, allowed_kinds: tuple[str, ...]) -> DateExpr | None:
    """Validate one date expression. ``kind: null`` (or a null object) means no date."""
    if value is None:
        return None
    obj = _require_object(value, where)
    _require_exact_keys(obj, EXPR_KEYS, where)
    kind = obj["kind"]
    if kind is None:
        return None
    if kind not in allowed_kinds:
        raise SchemaError(f"{where}.kind: {kind!r} not in {allowed_kinds}")
    return DateExpr(
        kind=kind,  # type: ignore[arg-type]
        n=_int_or_none(obj["n"], f"{where}.n"),
        month=_int_or_none(obj["month"], f"{where}.month"),
        day=_int_or_none(obj["day"], f"{where}.day"),
    )


def _parse_quantity(value: Any, where: str) -> Quantity | None:
    if value is None:
        return None
    obj = _require_object(value, where)
    _require_exact_keys(obj, frozenset({"value", "unit"}), where)
    number = obj["value"]
    if isinstance(number, bool) or not isinstance(number, (int, float)):
        raise SchemaError(f"{where}.value: expected a number, got {number!r}")
    unit = obj["unit"]
    if not isinstance(unit, str) or not unit.strip():
        raise SchemaError(f"{where}.unit: expected a non-empty string, got {unit!r}")
    return Quantity(value=float(number), unit=unit.strip())


def _parse_entry(value: Any, index: int) -> ExtractedEntry:
    where = f"entries[{index}]"
    obj = _require_object(value, where)
    _require_exact_keys(obj, ENTRY_KEYS, where)

    kind = obj["kind"]
    if kind not in ENTRY_KINDS:
        raise SchemaError(f"{where}.kind: {kind!r} not in {ENTRY_KINDS}")

    text = obj["text"]
    if not isinstance(text, str) or not text.strip():
        raise SchemaError(f"{where}.text: expected a non-empty string copied from the transcript")

    return ExtractedEntry(
        plot=_optional_str(obj["plot"], f"{where}.plot"),
        crop=_optional_str(obj["crop"], f"{where}.crop"),
        kind=kind,
        text=text.strip(),
        date_expr=_parse_expr(obj["date_expr"], f"{where}.date_expr", ("today", "days_ago", "month_day")),
        planting_date_expr=_parse_expr(
            obj["planting_date_expr"], f"{where}.planting_date_expr", ("month_day", "days_ago")
        ),
        quantity=_parse_quantity(obj["quantity"], f"{where}.quantity"),
    )


def parse_model_output(raw: str) -> Extraction:
    """Parse and validate the model's raw text against the closed schema.

    Raises ``SchemaError`` on anything that does not match. Nothing is guessed around:
    a rejected output is an invalid result, reported as such.
    """
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SchemaError(f"not valid JSON: {exc}") from exc

    obj = _require_object(data, "output")
    _require_exact_keys(obj, TOP_LEVEL_KEYS, "output")

    action = obj["action"]
    if action not in ACTIONS:
        raise SchemaError(f"action: {action!r} not in {ACTIONS}")

    raw_entries = obj["entries"]
    if not isinstance(raw_entries, list):
        raise SchemaError("entries: expected an array")
    entries = tuple(_parse_entry(item, index) for index, item in enumerate(raw_entries))

    clarify_question = _optional_str(obj["clarify_question"], "clarify_question")

    if action == "run" and not entries:
        raise SchemaError('action "run" requires at least one entry')
    # A refusal or a clarification with entries: the model was told to send none, but
    # parse them anyway so the raw output stays inspectable; the pipeline discards them.

    return Extraction(entries=entries, action=action, clarify_question=clarify_question)


# ---------------------------------------------------------------------------
# JSON-friendly views (eval reports, API responses)
# ---------------------------------------------------------------------------


def _expr_as_dict(expr: DateExpr | None) -> dict[str, Any] | None:
    if expr is None:
        return None
    return {"kind": expr.kind, "n": expr.n, "month": expr.month, "day": expr.day}


def entry_as_dict(entry: ExtractedEntry) -> dict[str, Any]:
    quantity = None
    if entry.quantity is not None:
        quantity = {"value": entry.quantity.value, "unit": entry.quantity.unit}
    return {
        "plot": entry.plot,
        "crop": entry.crop,
        "kind": entry.kind,
        "text": entry.text,
        "date_expr": _expr_as_dict(entry.date_expr),
        "planting_date_expr": _expr_as_dict(entry.planting_date_expr),
        "quantity": quantity,
    }


def extraction_as_dict(extraction: Extraction) -> dict[str, Any]:
    return {
        "entries": [entry_as_dict(entry) for entry in extraction.entries],
        "action": extraction.action,
        "clarify_question": extraction.clarify_question,
    }
