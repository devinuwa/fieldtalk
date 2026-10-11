"""Few-shot examples in the prompt must never appear in eval/transcripts.jsonl.

AGENTS.md section 6: eval transcripts are fixtures owned by the backend agent and
recorded by hash. If the prompt borrowed them, the eval would grade memorised answers
instead of extraction. This test checks both directions: no few-shot transcript (nor any
part of the assembled prompt) contains an eval transcript, and no eval transcript
contains a few-shot one.
"""

from __future__ import annotations

import json
from pathlib import Path

from fieldtalk.pipeline import build_prompt
from fieldtalk.pipeline.prompts import load_fewshot
from fieldtalk.pipeline.verify import normalize_with_map

REPO_ROOT = Path(__file__).resolve().parents[2]
EVAL_FILE = REPO_ROOT / "eval" / "transcripts.jsonl"


def _normalize(text: str) -> str:
    normalized, _ = normalize_with_map(text)
    return normalized


def _load_eval() -> list[dict]:
    lines = [line for line in EVAL_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [json.loads(line) for line in lines]


def test_eval_file_is_intact_and_named_cases_exist() -> None:
    rows = _load_eval()
    assert len(rows) == 12, f"expected the 12 given transcripts, found {len(rows)}"
    ids = {row["id"] for row in rows}
    assert {"T01", "T05", "X01", "X02"} <= ids
    assert all(row.get("synthetic") is True for row in rows), "eval data must be labelled"


def test_fewshot_examples_exist() -> None:
    examples = load_fewshot()
    assert len(examples) == 2, "the prompt carries exactly two few-shot examples"
    for example in examples:
        assert _normalize(example["transcript"])
        # The example output must itself be valid-looking JSON with an action.
        parsed = json.loads(example["output"])
        assert parsed["action"] in {"run", "clarify", "refuse"}


def test_no_fewshot_example_appears_in_eval_transcripts() -> None:
    examples = load_fewshot()
    rows = _load_eval()
    eval_normalized = [(row["id"], _normalize(row["transcript"])) for row in rows]

    checked = 0
    leaks: list[str] = []
    for example in examples:
        needle = _normalize(example["transcript"])
        for eval_id, haystack in eval_normalized:
            checked += 1
            if needle in haystack or haystack in needle:
                leaks.append(f"few-shot {needle!r} overlaps eval {eval_id}")

    assert checked == len(examples) * len(rows), "the comparison must actually run"
    assert leaks == [], leaks


def test_no_eval_transcript_appears_anywhere_in_the_assembled_prompt() -> None:
    rows = _load_eval()
    # A neutral transcript so the eval case itself cannot enter the prompt by accident.
    prompt_normalized = _normalize(build_prompt("SYNTHETIC PROBE transcript for the leak test"))

    checked = 0
    leaks: list[str] = []
    for row in rows:
        needle = _normalize(row["transcript"])
        checked += 1
        if needle in prompt_normalized:
            leaks.append(f"eval {row['id']} appears in the prompt")

    assert checked == len(rows) >= 12, "the comparison must actually run"
    assert leaks == [], leaks
    assert "synthetic probe" in prompt_normalized
