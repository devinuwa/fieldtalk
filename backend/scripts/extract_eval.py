"""Run extraction on eval transcripts against the local Ollama model and grade vs gold.

Usage (from the repo root):

    backend/.venv/Scripts/python.exe backend/scripts/extract_eval.py
    backend/.venv/Scripts/python.exe backend/scripts/extract_eval.py --ids T01 T05 X01 X02
    backend/.venv/Scripts/python.exe backend/scripts/extract_eval.py --host http://127.0.0.1:11434

For every selected transcript it prints: the raw model output, the parsed (validated)
result with grounding spans and code-resolved dates, PASS/FAIL against the gold record
field by field, and the timings the server reported. Failures are printed, not hidden.

The model never sees the gold record; grading happens after extraction
(AGENTS.md section 6: eval material is owned and hashed, never edited to pass).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "backend"))

from fieldtalk.pipeline import OllamaAdapter, SchemaError, build_prompt, extract  # noqa: E402
from fieldtalk.pipeline.verify import normalize_with_map  # noqa: E402

DEFAULT_EVAL_FILE = REPO_ROOT / "eval" / "transcripts.jsonl"
DEFAULT_IDS = ("T01", "T05", "X01", "X02")


def _normalize(text: str) -> str:
    normalized, _ = normalize_with_map(text)
    return normalized


def _canon_expr(expr: dict | None) -> tuple | None:
    """Canonical form of a date expression, model output or gold, for comparison."""
    if expr is None or expr.get("kind") is None:
        return None
    kind = expr["kind"]
    if kind == "today":
        return ("today",)
    if kind == "days_ago":
        return ("days_ago", expr.get("n"))
    if kind == "month_day":
        return ("month_day", expr.get("month"), expr.get("day"))
    return ("unknown", kind)


def _canon_quantity(quantity: dict | None) -> tuple | None:
    if quantity is None:
        return None
    return (float(quantity["value"]), _normalize(quantity["unit"]))


def entry_as_dict_from_verified(entry) -> dict:
    """The same view as schema.entry_as_dict, but for a VerifiedEntry."""
    quantity = None
    if entry.quantity is not None:
        quantity = {"value": entry.quantity.value, "unit": entry.quantity.unit}
    date_expr = None
    if entry.date_expr is not None:
        date_expr = {
            "kind": entry.date_expr.kind,
            "n": entry.date_expr.n,
            "month": entry.date_expr.month,
            "day": entry.date_expr.day,
        }
    planting = None
    if entry.planting_date_expr is not None:
        planting = {
            "kind": entry.planting_date_expr.kind,
            "n": entry.planting_date_expr.n,
            "month": entry.planting_date_expr.month,
            "day": entry.planting_date_expr.day,
        }
    return {
        "plot": entry.plot,
        "crop": entry.crop,
        "kind": entry.kind,
        "text": entry.text,
        "date_expr": date_expr,
        "planting_date_expr": planting,
        "quantity": quantity,
    }


def compare_to_gold(result, gold: dict) -> tuple[list[str], list[str]]:
    """Return (checked field names, mismatch messages). Messages empty == PASS."""
    checked: list[str] = []
    problems: list[str] = []

    expected_action = gold.get("action", "run")
    checked.append("action")
    if result.action != expected_action:
        problems.append(f"action: model {result.action!r} != gold {expected_action!r}")

    if expected_action != "run":
        return checked, problems

    entries = result.entries
    model_entries = [entry_as_dict_from_verified(entry) for entry in entries]

    # plot: sets, normalised (gold may list one plot, the model may repeat it)
    checked.append("plot")
    gold_plot = {_normalize(gold["plot"])} if gold.get("plot") else set()
    model_plots = {_normalize(e["plot"]) for e in model_entries if e["plot"]}
    if model_plots != gold_plot:
        problems.append(f"plot: model {sorted(model_plots)!r} != gold {sorted(gold_plot)!r}")

    checked.append("crop")
    gold_crop = {_normalize(gold["crop"])} if gold.get("crop") else set()
    model_crops = {_normalize(e["crop"]) for e in model_entries if e["crop"]}
    if model_crops != gold_crop:
        problems.append(f"crop: model {sorted(model_crops)!r} != gold {sorted(gold_crop)!r}")

    checked.append("kinds")
    gold_kinds = sorted(gold.get("kinds", []))
    model_kinds = sorted(e["kind"] for e in model_entries)
    if model_kinds != gold_kinds:
        problems.append(f"kinds: model {model_kinds!r} != gold {gold_kinds!r}")

    first = model_entries[0] if model_entries else None

    checked.append("date_expr")
    model_date = _canon_expr(first["date_expr"] if first else None)
    gold_date = _canon_expr(gold.get("date_expr"))
    if model_date != gold_date:
        problems.append(f"date_expr: model {model_date!r} != gold {gold_date!r}")

    checked.append("planting_date_expr")
    model_planting = _canon_expr(first["planting_date_expr"] if first else None)
    gold_planting = _canon_expr(gold.get("planting_date_expr"))
    if model_planting != gold_planting:
        problems.append(
            f"planting_date_expr: model {model_planting!r} != gold {gold_planting!r}"
        )

    checked.append("quantity")
    model_quantity = _canon_quantity(first["quantity"] if first else None)
    gold_quantity = _canon_quantity(gold.get("quantity"))
    if model_quantity != gold_quantity:
        problems.append(
            f"quantity: model {model_quantity!r} != gold {gold_quantity!r}"
        )

    # V1: ungrounded fields must be zero (AGENTS.md rule 2: never accepted silently).
    checked.append("grounding")
    for index, entry in enumerate(entries):
        if entry.ungrounded:
            problems.append(f"entry[{index}] ungrounded fields: {list(entry.ungrounded)!r}")

    return checked, problems


def run_one(row: dict, adapter, recorded_on: date) -> dict:
    transcript = row["transcript"]
    prompt = build_prompt(transcript)
    outcome: dict = {"id": row["id"], "transcript": transcript}

    started = time.perf_counter()
    try:
        result = extract(transcript, adapter, recorded_on=recorded_on, prompt=prompt)
    except SchemaError as exc:
        outcome["wall_ms_outer"] = round((time.perf_counter() - started) * 1000, 1)
        outcome["error"] = f"SchemaError: {exc}"
        outcome["checked"], outcome["problems"] = [], ["output did not match the schema"]
        outcome["passed"] = False
        return outcome
    outcome["wall_ms_outer"] = round((time.perf_counter() - started) * 1000, 1)
    outcome["result"] = result
    outcome["timings"] = dict(result.timings)

    checked, problems = compare_to_gold(result, row["gold"])
    outcome["checked"] = checked
    outcome["problems"] = problems
    outcome["passed"] = not problems
    return outcome


def print_outcome(outcome: dict, gold: dict) -> None:
    print("=" * 78)
    print(f"[{outcome['id']}] transcript: {outcome['transcript']}")
    result = outcome.get("result")

    if result is not None:
        print("-" * 78)
        print("RAW MODEL OUTPUT:")
        print(result.raw)
        print("-" * 78)
        print("PARSED (validated schema):")
        print(json.dumps(result.parsed_dict, indent=2))
        if result.action == "run":
            print("VERIFIED ENTRIES (grounding + dates resolved in code):")
            for index, entry in enumerate(result.entries):
                print(
                    f"  entry[{index}] kind={entry.kind} plot={entry.plot!r} "
                    f"crop={entry.crop!r} quantity={entry.quantity!r}"
                )
                print(
                    f"           spans: plot={entry.plot_span} crop={entry.crop_span} "
                    f"quantity={entry.quantity_span} ungrounded={list(entry.ungrounded)}"
                )
                print(
                    f"           date_expr={entry.date_expr} -> {entry.date}; "
                    f"planting={entry.planting_date_expr} -> {entry.planting_date}"
                )
                print(f"           text={entry.text!r}")
        elif result.action == "refuse":
            print(f"REFUSAL (fixed string in code): {result.refusal}")
        else:
            print(f"CLARIFY question: {result.clarify_question!r}")
    else:
        print("-" * 78)
        print("RAW MODEL OUTPUT: (none — the adapter or schema rejected the call)")
        print(f"ERROR: {outcome.get('error')}")

    print("-" * 78)
    print(f"GOLD: {json.dumps(gold)}")
    status = "PASS" if outcome["passed"] else "FAIL"
    print(f"RESULT: {status}  (checked: {', '.join(outcome['checked']) or '—'})")
    for problem in outcome["problems"]:
        print(f"  - {problem}")

    timings = outcome.get("timings", {})
    timing_bits = [f"wall {timings.get('wall_ms', outcome['wall_ms_outer'])} ms"]
    for key in (
        "prompt_eval_ms",
        "eval_ms",
        "load_ms",
        "prompt_eval_count",
        "eval_count",
    ):
        if key in timings:
            timing_bits.append(f"{key} {timings[key]}")
    timing_bits.append(f"script_wall {outcome['wall_ms_outer']} ms")
    print("TIMINGS: " + " | ".join(timing_bits))
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ids", nargs="+", default=list(DEFAULT_IDS))
    parser.add_argument("--model", default="gemma3:4b")
    parser.add_argument("--host", default="http://127.0.0.1:11434")
    parser.add_argument("--eval-file", default=str(DEFAULT_EVAL_FILE))
    parser.add_argument(
        "--recorded-on",
        default=None,
        help="Recording date for date resolution, YYYY-MM-DD (default: today)",
    )
    args = parser.parse_args()

    rows = [
        json.loads(line)
        for line in Path(args.eval_file).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    by_id = {row["id"]: row for row in rows}
    missing = [wanted for wanted in args.ids if wanted not in by_id]
    if missing:
        print(f"unknown transcript ids: {missing}", file=sys.stderr)
        return 2

    recorded_on = (
        date.fromisoformat(args.recorded_on) if args.recorded_on else date.today()
    )
    adapter = OllamaAdapter(model=args.model, host=args.host)
    print(f"model={adapter.name} host={args.host} recorded_on={recorded_on.isoformat()}")
    print(f"ids={args.ids}\n")

    outcomes = []
    for wanted in args.ids:
        outcome = run_one(by_id[wanted], adapter, recorded_on)
        outcomes.append(outcome)
        print_outcome(outcome, by_id[wanted]["gold"])

    print("=" * 78)
    print("SUMMARY")
    passed = sum(1 for outcome in outcomes if outcome["passed"])
    for outcome in outcomes:
        status = "PASS" if outcome["passed"] else "FAIL"
        detail = "" if outcome["passed"] else f"  ({'; '.join(outcome['problems'])})"
        print(f"  {outcome['id']}: {status}{detail}")
    walls = [outcome["timings"].get("wall_ms") for outcome in outcomes if outcome.get("timings")]
    if walls:
        ordered = sorted(walls)
        p50 = ordered[len(ordered) // 2]
        print(
            f"  {passed}/{len(outcomes)} passed | wall_ms p50={p50} "
            f"min={min(walls)} max={max(walls)}"
        )
    else:
        print(f"  {passed}/{len(outcomes)} passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
