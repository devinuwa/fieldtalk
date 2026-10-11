"""Eval: 4 ask questions on a seeded synthetic notebook, live gemma3:4b.

Seeds a temporary synthetic store (labelled synthetic, gitignored data/), then runs the
full ask pipeline (model plan -> V2 -> tool -> template -> V3) for each question and
prints raw outputs, PASS/FAIL, and wall-clock timings.

Run from repo root:

    backend/.venv/Scripts/python.exe backend/scripts/ask_eval.py
"""

from __future__ import annotations

import json
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fieldtalk.pipeline.adapters import OllamaAdapter
from fieldtalk.pipeline.ask import ASK_PLAN_JSON_SCHEMA, ask
from fieldtalk.store import Store
from fieldtalk.store.models import Entry, Quantity

AS_OF = date(2026, 10, 8)  # pinned so the run is reproducible

# Synthetic notebook (AGENTS.md rule 7: labelled synthetic, never presented as real).
SEED = [
    Entry(id="s1", plot="plot 1", crop="maize", kind="observation", date=date(2026, 9, 28),
          text="maize plants knee high, leaves green", planting_date=date(2026, 7, 20)),
    Entry(id="s2", plot="plot 1", crop="maize", kind="issue", date=date(2026, 9, 30),
          text="small holes in the leaves near the fence", planting_date=date(2026, 7, 20)),
    Entry(id="s3", plot="plot 1", crop="maize", kind="action", date=date(2026, 10, 2),
          text="removed the weeds on plot 1", quantity=Quantity(value=2, unit="hours")),
    Entry(id="s4", plot="plot 2", crop="cowpea", kind="observation", date=date(2026, 10, 3),
          text="8 cowpea plants with flowers in one row"),
    Entry(id="s5", plot="plot 3", crop="millet", kind="observation", date=date(2026, 10, 5),
          text="heavy rain yesterday, water stood in the lower corner of plot 3"),
    Entry(id="s6", plot="plot 3", crop="millet", kind="issue", date=date(2026, 10, 6),
          text="waterlogged lower corner on plot 3"),
]

QUESTIONS = [
    # (question, expected action, must-mention in answer)
    ("What is the timeline for plot 1?", "run", "2026-09-28"),
    ("How many days since I planted the maize on plot 1?", "run", "2026-07-20"),
    ("What is still open on plot 3?", "run", "waterlogged"),
    ("What fertilizer should I put on plot 1?", "refuse", "do not give advice"),
]


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "synthetic.db"
        store = Store(db_path)
        store.add(SEED)

        adapter = OllamaAdapter(model="gemma3:4b", schema=ASK_PLAN_JSON_SCHEMA)
        results = []
        for question, expected_action, must_mention in QUESTIONS:
            started = time.perf_counter()
            result = ask(question, adapter, db_path, as_of=AS_OF)
            wall_ms = (time.perf_counter() - started) * 1000.0

            action_ok = result.action == expected_action
            mention_ok = must_mention.lower() in result.answer.lower()
            v3_ok = not result.v3_violations
            passed = action_ok and mention_ok and v3_ok

            row = {
                "question": question,
                "action": result.action,
                "expected_action": expected_action,
                "plan": {
                    "tool": result.plan.tool,
                    "plot_text": result.plan.plot_text,
                    "date_expr": result.plan.date_expr,
                    "keyword": result.plan.keyword,
                },
                "answer": result.answer,
                "v3_violations": result.v3_violations,
                "wall_ms": round(wall_ms, 1),
                "model_timings_ms": dict(result.model_timings) if hasattr(result, "model_timings") else {},
                "PASS": passed,
            }
            results.append(row)
            print("=" * 70)
            print(f"Q: {question}")
            print(f"plan: {json.dumps(row['plan'])}")
            print(f"action: {result.action} (expected {expected_action})")
            print(f"answer:\n{result.answer}")
            print(f"v3_violations: {result.v3_violations}")
            print(f"wall_ms: {row['wall_ms']}")
            print(f"RESULT: {'PASS' if passed else 'FAIL'}")

        print("=" * 70)
        print(json.dumps({"as_of": AS_OF.isoformat(), "results": results}, indent=2))
        return 0 if all(r["PASS"] for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
