"""Extraction: transcript -> prompt -> model -> validated schema -> V1 -> dates.

The pipeline step that puts the pieces together (AGENTS.md section 3):

    transcript -> build_prompt -> ModelAdapter -> parse_model_output (closed schema)
               -> verify_entries (V1 grounding + engine date resolution)

Actions other than ``run`` never produce entries: a ``refuse`` carries the fixed
refusal string that lives in *code* (AGENTS.md rule 3), a ``clarify`` carries the
model's question or, when it failed to ask one, the fixed default question.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .adapters import Completion, ModelAdapter
from .prompts import build_prompt
from .schema import Extraction, SchemaError, extraction_as_dict, parse_model_output
from .verify import VerifiedEntry, needs_clarify, verify_entries

# AGENTS.md rule 3: the refusal text is fixed in code; the model only chooses the
# action. Used verbatim by the API and the UI; never assembled from model output.
REFUSAL_MESSAGE = (
    "I can't help with that. FieldTalk only keeps your own field notes: "
    "observations, issues, actions, plans and measurements you record yourself. "
    "It does not give advice on fertilizers, diseases, prices or the weather."
)

# If the model says the note is vague but asks nothing, code asks this instead.
DEFAULT_CLARIFY_QUESTION = "Which plot is that, and what exactly are you noting?"

# Guard (b) in pipeline.verify: the result is converted to clarify in code, and this is
# the fixed question it asks (kept here with the other user-facing fixed strings).
GUARD_CLARIFY_QUESTION = "Which plot, and what looks wrong?"


@dataclass(frozen=True)
class ExtractionResult:
    """Everything one extraction produced, for the API, the UI and the eval runner."""

    action: str
    entries: tuple[VerifiedEntry, ...]  # empty unless action == "run"
    clarify_question: str | None
    refusal: str | None  # REFUSAL_MESSAGE when action == "refuse"
    transcript: str
    prompt: str
    raw: str  # the model's raw output, always kept for the trace panel
    parsed: Extraction  # the validated model output (pre-verification)
    timings: dict[str, float | int] = field(default_factory=dict)

    @property
    def parsed_dict(self) -> dict:
        return extraction_as_dict(self.parsed)


def extract(
    transcript: str,
    adapter: ModelAdapter,
    *,
    recorded_on: date | None = None,
    prompt: str | None = None,
) -> ExtractionResult:
    """Run one transcript through the extraction pipeline.

    Raises ``SchemaError`` when the model output does not match the closed schema —
    callers report that as an invalid result, never as an empty success.
    """
    if not transcript or not transcript.strip():
        raise ValueError("transcript is empty")
    recorded_on = recorded_on if recorded_on is not None else date.today()
    prompt = prompt if prompt is not None else build_prompt(transcript)

    completion: Completion = adapter.complete(prompt)
    raw = completion.text
    parsed = parse_model_output(raw)

    if parsed.action == "refuse":
        return ExtractionResult(
            action="refuse",
            entries=(),
            clarify_question=None,
            refusal=REFUSAL_MESSAGE,
            transcript=transcript,
            prompt=prompt,
            raw=raw,
            parsed=parsed,
            timings=dict(completion.timings),
        )

    if parsed.action == "clarify":
        question = parsed.clarify_question or DEFAULT_CLARIFY_QUESTION
        return ExtractionResult(
            action="clarify",
            entries=(),
            clarify_question=question,
            refusal=None,
            transcript=transcript,
            prompt=prompt,
            raw=raw,
            parsed=parsed,
            timings=dict(completion.timings),
        )

    entries = verify_entries(parsed.entries, transcript, recorded_on)
    if needs_clarify(entries):
        # Guard (b): no grounded plot and no specific crop -> ask, do not file.
        return ExtractionResult(
            action="clarify",
            entries=(),
            clarify_question=GUARD_CLARIFY_QUESTION,
            refusal=None,
            transcript=transcript,
            prompt=prompt,
            raw=raw,
            parsed=parsed,
            timings=dict(completion.timings),
        )
    return ExtractionResult(
        action="run",
        entries=entries,
        clarify_question=None,
        refusal=None,
        transcript=transcript,
        prompt=prompt,
        raw=raw,
        parsed=parsed,
        timings=dict(completion.timings),
    )


__all__ = [
    "DEFAULT_CLARIFY_QUESTION",
    "GUARD_CLARIFY_QUESTION",
    "REFUSAL_MESSAGE",
    "ExtractionResult",
    "SchemaError",
    "extract",
]
