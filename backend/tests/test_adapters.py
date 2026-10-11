"""``ModelAdapter``: StubAdapter determinism and the Ollama request contract.

The Ollama request is checked with a fake ``urlopen`` — tests never call live Ollama
(AGENTS.md section 3). The payload assertions are the contract verified by hand against
the installed server (Ollama 0.40.0): ``/api/chat``, ``stream: false``,
``format: <schema>``, ``options.temperature: 0``.
"""

from __future__ import annotations

import json
import urllib.request

import pytest

from fieldtalk.pipeline import ENTRY_JSON_SCHEMA, OllamaAdapter, StubAdapter


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *args: object) -> bool:
        return False


def _fake_payload(content: str = '{"entries":[],"action":"refuse","clarify_question":null}') -> dict:
    return {
        "model": "gemma3:4b",
        "message": {"role": "assistant", "content": content},
        "done": True,
        "total_duration": 2_000_000_000,
        "load_duration": 1_400_000_000,
        "prompt_eval_count": 21,
        "prompt_eval_duration": 170_000_000,
        "eval_count": 20,
        "eval_duration": 700_000_000,
    }


def test_stub_adapter_sequence_returns_answers_in_order() -> None:
    stub = StubAdapter(["first", "second"])
    assert stub.complete("any prompt").text == "first"
    assert stub.complete("any prompt").text == "second"
    with pytest.raises(IndexError):
        stub.complete("any prompt")
    assert stub.prompts == ["any prompt", "any prompt"]


def test_stub_adapter_mapping_keys_on_the_transcript() -> None:
    stub = StubAdapter({"Plot one": '{"entries":[]}', "Plot two": '{"entries":[1]}'})
    assert stub.complete("rules\n\nNow the transcript:\nPlot two\nOutput:").text == (
        '{"entries":[1]}'
    )
    with pytest.raises(KeyError):
        stub.complete("no matching transcript here")


def test_ollama_adapter_refuses_any_non_loopback_host() -> None:
    with pytest.raises(ValueError, match="loopback"):
        OllamaAdapter(host="https://api.example.com")
    with pytest.raises(ValueError, match="loopback"):
        OllamaAdapter(host="http://192.168.1.10:11434")


def test_ollama_adapter_sends_the_verified_chat_payload(monkeypatch) -> None:
    captured: dict = {}

    def fake_urlopen(request, timeout=None):  # noqa: ANN001 - signature mirror
        captured["url"] = request.full_url
        captured["payload"] = json.loads(request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return _FakeResponse(_fake_payload())

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    adapter = OllamaAdapter(model="gemma3:4b", timeout=42.0)
    completion = adapter.complete("the prompt")

    assert captured["url"] == "http://127.0.0.1:11434/api/chat"
    assert captured["timeout"] == 42.0
    payload = captured["payload"]
    assert payload["stream"] is False
    assert payload["format"] == ENTRY_JSON_SCHEMA
    assert payload["options"] == {"temperature": 0}
    assert payload["messages"] == [{"role": "user", "content": "the prompt"}]
    assert payload["model"] == "gemma3:4b"
    # The answer comes back exactly as the server sent it.
    assert completion.text == '{"entries":[],"action":"refuse","clarify_question":null}'
    # Timings are converted from nanoseconds to milliseconds.
    assert completion.timings["total_ms"] == 2000.0
    assert completion.timings["load_ms"] == 1400.0
    assert completion.timings["eval_ms"] == 700.0
    assert completion.timings["prompt_eval_count"] == 21
    assert completion.timings["eval_count"] == 20
    assert completion.timings["wall_ms"] >= 0.0


def test_ollama_adapter_reports_server_errors(monkeypatch) -> None:
    def fake_urlopen(request, timeout=None):  # noqa: ANN001
        return _FakeResponse({"error": "model 'nope' not found"})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(RuntimeError, match="not found"):
        OllamaAdapter(model="nope").complete("prompt")
