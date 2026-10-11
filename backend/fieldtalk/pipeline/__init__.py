"""FieldTalk's extraction pipeline: model in, verified entries out.

Layers (AGENTS.md section 3): ``pipeline.extract`` asks a ``ModelAdapter`` for the
closed schema, validates it (``schema``), grounds every crop/plot/quantity in the
transcript with spans (``verify``, V1) and resolves date expressions against the
recording date with the pure ``engine`` — the model never calculates.
"""

from .adapters import (
    DEFAULT_MODEL,
    Completion,
    ModelAdapter,
    OllamaAdapter,
    StubAdapter,
    ollama_status,
)
from .extract import (
    DEFAULT_CLARIFY_QUESTION,
    GUARD_CLARIFY_QUESTION,
    REFUSAL_MESSAGE,
    ExtractionResult,
    extract,
)
from .prompts import build_prompt
from .schema import (
    ACTIONS,
    ENTRY_JSON_SCHEMA,
    Extraction,
    ExtractedEntry,
    SchemaError,
    extraction_as_dict,
    parse_model_output,
)
from .verify import (
    GENERIC_CROP_WORDS,
    Grounding,
    VerifiedEntry,
    ground_entry,
    needs_clarify,
    observation_date_phrase_count,
    verify_entries,
)

__all__ = [
    "ACTIONS",
    "DEFAULT_CLARIFY_QUESTION",
    "DEFAULT_MODEL",
    "ENTRY_JSON_SCHEMA",
    "GENERIC_CROP_WORDS",
    "GUARD_CLARIFY_QUESTION",
    "REFUSAL_MESSAGE",
    "Completion",
    "ExtractedEntry",
    "Extraction",
    "ExtractionResult",
    "Grounding",
    "ModelAdapter",
    "OllamaAdapter",
    "ollama_status",
    "SchemaError",
    "StubAdapter",
    "VerifiedEntry",
    "build_prompt",
    "extraction_as_dict",
    "extract",
    "ground_entry",
    "needs_clarify",
    "observation_date_phrase_count",
    "parse_model_output",
    "verify_entries",
]
