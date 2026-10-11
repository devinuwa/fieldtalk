"""Build the extraction prompt: rules + few-shot examples + one transcript.

The few-shot examples live in ``fewshot.json`` so that
``tests/test_prompt_no_eval_leak.py`` can check they never overlap
``eval/transcripts.jsonl`` (AGENTS.md section 6: eval material is owned and hashed by
the backend agent, so the prompt must not borrow from it).
"""

from __future__ import annotations

import json
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent
EXTRACT_RULES_PATH = PROMPTS_DIR / "extract.txt"
FEWSHOT_PATH = PROMPTS_DIR / "fewshot.json"


def extract_rules() -> str:
    """The compact rule text shown to the model."""
    return EXTRACT_RULES_PATH.read_text(encoding="utf-8").strip()


def load_fewshot() -> list[dict[str, str]]:
    """The few-shot examples: each has ``transcript`` and ``output`` (JSON text)."""
    examples = json.loads(FEWSHOT_PATH.read_text(encoding="utf-8"))
    if not isinstance(examples, list) or not examples:
        raise ValueError("fewshot.json must contain a non-empty list")
    for example in examples:
        if not isinstance(example, dict) or not {"transcript", "output"} <= set(example):
            raise ValueError(f"bad few-shot example: {example!r}")
    return examples


def build_prompt(transcript: str) -> str:
    """Assemble the one user message: rules, then examples, then the transcript."""
    parts: list[str] = [extract_rules(), ""]
    for index, example in enumerate(load_fewshot(), start=1):
        parts.append(f"Example {index}")
        parts.append(f"Transcript: {example['transcript']}")
        parts.append(f"Output: {example['output']}")
        parts.append("")
    parts.append("Now the transcript:")
    parts.append(transcript.strip())
    parts.append("Output:")
    return "\n".join(parts)
