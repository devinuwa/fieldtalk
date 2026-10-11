"""Model adapters: the ``ModelAdapter`` interface, Ollama, and a test stub.

``pipeline.extract`` talks only to ``ModelAdapter``; swapping the local Ollama server
for a canned answer in tests is the whole point (AGENTS.md section 3: tests never call
live Ollama or Whisper).

The Ollama adapter uses only the standard library (``urllib``) and is hard-limited to
loopback, per AGENTS.md rule 5: nothing at runtime talks to the network.

Structured output, verified against the installed server (Ollama 0.40.0, ``/api/version``
and a live constrained-decoding call on 2026-10-07): POST ``/api/chat`` with
``"stream": false`` and ``"format": <JSON schema object>`` returns the answer in
``message.content``, constrained to the schema; ``options.temperature = 0`` for
determinism; per-call timings come back as ``load_duration`` / ``prompt_eval_*`` /
``eval_*`` in nanoseconds.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from .schema import ENTRY_JSON_SCHEMA

DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434"
DEFAULT_MODEL = "gemma3:4b"

# AGENTS.md rule 5: the model runs locally; only loopback is an allowed target.
_ALLOWED_HOST_PREFIXES = ("http://127.0.0.1", "http://localhost", "http://[::1]")


@dataclass(frozen=True)
class Completion:
    """One model answer plus the timings the server reported for it."""

    text: str
    timings: dict[str, float | int] = field(default_factory=dict)


@runtime_checkable
class ModelAdapter(Protocol):
    """What the pipeline needs from a model: turn one prompt into one answer."""

    name: str

    def complete(self, prompt: str) -> Completion: ...


class OllamaAdapter:
    """Chat completion from the local Ollama server with schema-constrained output."""

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        host: str = DEFAULT_OLLAMA_HOST,
        *,
        timeout: float = 600.0,
        schema: dict | None = None,
        temperature: float = 0.0,
    ) -> None:
        if not host.startswith(_ALLOWED_HOST_PREFIXES):
            raise ValueError(
                f"Ollama host must be loopback (AGENTS.md rule 5), got {host!r}"
            )
        self.model = model
        self.host = host.rstrip("/")
        self.timeout = timeout
        self.schema = schema if schema is not None else ENTRY_JSON_SCHEMA
        self.temperature = temperature
        self.name = f"ollama/{model}"

    def complete(self, prompt: str) -> Completion:
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "format": self.schema,
            "options": {"temperature": self.temperature},
        }
        request = urllib.request.Request(
            f"{self.host}/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as exc:
            raise ConnectionError(
                f"Ollama at {self.host} is not reachable ({exc}). Is it running?"
            ) from exc
        wall_ms = (time.perf_counter() - started) * 1000.0

        if body.get("error"):
            raise RuntimeError(f"Ollama error: {body['error']}")
        message = body.get("message") or {}
        text = message.get("content")
        if not isinstance(text, str):
            raise RuntimeError(f"Ollama response has no message.content: {body!r}")

        def ms(key: str) -> float:
            return round(float(body.get(key, 0)) / 1e6, 1)

        timings: dict[str, float | int] = {
            "wall_ms": round(wall_ms, 1),
            "total_ms": ms("total_duration"),
            "load_ms": ms("load_duration"),
            "prompt_eval_ms": ms("prompt_eval_duration"),
            "eval_ms": ms("eval_duration"),
            "prompt_eval_count": int(body.get("prompt_eval_count", 0)),
            "eval_count": int(body.get("eval_count", 0)),
        }
        return Completion(text=text, timings=timings)


def ollama_status(
    model: str = DEFAULT_MODEL,
    host: str = DEFAULT_OLLAMA_HOST,
    *,
    timeout: float = 2.0,
) -> tuple[bool, str]:
    """Cheap readiness probe for ``GET /api/health``: is the local model served right now?

    A short ``GET /api/tags`` on loopback: it never loads the model, so health stays fast
    and the UI can show whether Ask-your-notes will work. Returns ``(ok, human detail)``;
    the detail is the string the UI shows, so it names the fix (start Ollama, pull the
    model). This is a live call, so tests monkeypatch it instead of calling it.
    """
    if not host.startswith(_ALLOWED_HOST_PREFIXES):
        raise ValueError(f"Ollama host must be loopback (AGENTS.md rule 5), got {host!r}")
    base = host.rstrip("/")
    try:
        with urllib.request.urlopen(f"{base}/api/tags", timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        return False, (
            f"Ollama is not reachable at {base} ({type(exc).__name__}). "
            "Start Ollama and pull the model: ollama pull " + model
        )
    tags = {
        name
        for entry in body.get("models", [])
        if isinstance(entry, dict)
        for name in (entry.get("name"), entry.get("model"))
        if isinstance(name, str)
    }
    if model in tags or any(tag.split(":")[0] == model for tag in tags):
        return True, f"Ollama at {base} is serving {model}."
    return False, f"Ollama at {base} is up, but {model} is not pulled. Run: ollama pull {model}"


class StubAdapter:
    """Canned answers for tests: no network, no model, fully deterministic.

    Pass a sequence to consume answers in order, or a mapping from transcript fragment
    to answer when several different prompts are involved.
    """

    name = "stub"

    def __init__(self, responses: Sequence[str] | Mapping[str, str]) -> None:
        if isinstance(responses, Mapping):
            self._by_key: dict[str, str] | None = dict(responses)
            self._queue: list[str] | None = None
        else:
            self._by_key = None
            self._queue = list(responses)
        self.prompts: list[str] = []

    def complete(self, prompt: str) -> Completion:
        if self._by_key is not None:
            for key, answer in self._by_key.items():
                if key in prompt:
                    self.prompts.append(prompt)
                    return Completion(
                        text=answer,
                        timings={"wall_ms": 0.0, "prompt_eval_count": 0, "eval_count": 0},
                    )
            raise KeyError(f"StubAdapter has no response for a prompt ending {prompt[-120:]!r}")
        if not self._queue:
            raise IndexError("StubAdapter has no responses left")
        answer = self._queue.pop(0)
        self.prompts.append(prompt)
        return Completion(
            text=answer, timings={"wall_ms": 0.0, "prompt_eval_count": 0, "eval_count": 0}
        )
