"""``POST /api/transcribe`` and ``GET /api/health``: real contract, stub engine.

The transcription engine is injected (``fieldtalk.stt.set_transcriber``), so these tests
are deterministic and never load a Whisper model. What they pin down is what the browser
depends on: audio bytes go in as the request body, the response carries the real
measurements, and every failure mode is a specific status with a message the UI can act
on instead of a silent empty transcript.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import fieldtalk.app as app_module
from fieldtalk.app import app
from fieldtalk import stt


@pytest.fixture
def client(monkeypatch):
    """A client whose speech-to-text is a stub, so no model is ever loaded."""
    stub = stt.StubTranscriber("plot 1 maize knee high", audio_seconds=4.0)
    stt.set_transcriber(stub)
    yield TestClient(app), stub
    stt.reset_transcriber()


def test_transcribe_returns_the_measured_transcript(client) -> None:
    test_client, stub = client
    response = test_client.post(
        "/api/transcribe",
        content=b"fake-webm-bytes",
        headers={"content-type": "audio/webm;codecs=opus"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["transcript"] == "plot 1 maize knee high"
    assert body["duration_seconds"] == 4.0
    assert body["wall_seconds"] == 0.5
    assert body["rtf"] == 0.125  # wall / audio, computed by code
    assert body["language"] == "en"
    assert body["synthetic"] is False  # this really ran an engine, not the fixture mock
    assert "stub-stt" in body["model"]
    assert stub.calls == [(len(b"fake-webm-bytes"), ".webm")]


@pytest.mark.parametrize(
    "content_type,suffix",
    [
        ("audio/webm", ".webm"),
        ("audio/ogg;codecs=opus", ".ogg"),
        ("audio/mp4", ".m4a"),
        ("audio/mpeg", ".mp3"),
        ("audio/wav", ".wav"),
        ("application/octet-stream", ".webm"),
    ],
)
def test_transcribe_maps_content_type_to_a_file_suffix(client, content_type, suffix) -> None:
    test_client, stub = client
    response = test_client.post("/api/transcribe", content=b"bytes", headers={"content-type": content_type})
    assert response.status_code == 200
    assert stub.calls[-1][1] == suffix


def test_an_empty_recording_is_a_400_not_an_empty_note(client) -> None:
    test_client, stub = client
    response = test_client.post("/api/transcribe", content=b"", headers={"content-type": "audio/webm"})
    assert response.status_code == 400
    assert "empty" in response.json()["detail"]
    assert stub.calls == []  # nothing was transcribed


@pytest.mark.parametrize("content_type", ["application/json", "text/plain", "audio/not-a-real-type"])
def test_a_non_audio_body_is_rejected(client, content_type) -> None:
    test_client, stub = client
    response = test_client.post("/api/transcribe", content=b"{}", headers={"content-type": content_type})
    assert response.status_code == 415
    assert "not supported" in response.json()["detail"]
    assert stub.calls == []


def test_an_oversized_recording_is_a_413(client, monkeypatch) -> None:
    test_client, stub = client
    monkeypatch.setattr(app_module, "MAX_AUDIO_BYTES", 8)
    response = test_client.post(
        "/api/transcribe", content=b"way-more-than-eight-bytes", headers={"content-type": "audio/webm"}
    )
    assert response.status_code == 413
    assert stub.calls == []


def test_a_missing_model_is_a_503_with_the_setup_command(monkeypatch) -> None:
    class MissingModel:
        name = "missing"

        def transcribe_bytes(self, audio: bytes, suffix: str = ".webm"):
            raise stt.SttModelMissingError(
                "Speech-to-text model 'base' is not in the local model cache. "
                "Download it once at setup: backend/.venv/Scripts/python.exe backend/scripts/stt_download.py base"
            )

    stt.set_transcriber(MissingModel())
    try:
        response = TestClient(app).post(
            "/api/transcribe", content=b"bytes", headers={"content-type": "audio/webm"}
        )
    finally:
        stt.reset_transcriber()

    assert response.status_code == 503
    detail = response.json()["detail"]
    assert "stt_download.py base" in detail  # the UI shows this verbatim
    assert "cache" in detail


def test_a_broken_engine_is_a_503_and_an_unexpected_error_a_safe_500(client) -> None:
    class BrokenEngine:
        name = "broken"

        def __init__(self, error: Exception) -> None:
            self.error = error

        def transcribe_bytes(self, audio: bytes, suffix: str = ".webm"):
            raise self.error

    test_client, _ = client
    stt.set_transcriber(BrokenEngine(stt.SttUnavailableError("could not load model 'base'")))
    assert test_client.post("/api/transcribe", content=b"bytes", headers={"content-type": "audio/webm"}).status_code == 503

    stt.set_transcriber(BrokenEngine(stt.SttError("ctranslate2 exploded: secret detail")))
    response = test_client.post("/api/transcribe", content=b"bytes", headers={"content-type": "audio/webm"})
    assert response.status_code == 500
    assert "secret detail" not in response.json()["detail"]  # nothing internal leaks
    assert "SttError" in response.json()["detail"]  # enough to debug


def test_health_reports_each_dependency(monkeypatch) -> None:
    monkeypatch.setattr(
        app_module,
        "stt_status",
        lambda *args, **kwargs: {"stt": "ok", "stt_name": "faster-whisper base (cpu, int8)", "stt_detail": "cached"},
    )
    monkeypatch.setattr(app_module, "ollama_status", lambda *args, **kwargs: (False, "Ollama is not reachable at http://127.0.0.1:11434"))
    body = TestClient(app).get("/api/health").json()

    assert body["backend"] == "ok"
    assert body["stt"] == "ok"
    assert body["model"] == "unavailable"
    assert body["stt_detail"] == "cached"
    assert "not reachable" in body["model_detail"]
    assert "not reachable" in body["detail"]  # the combined line the UI shows


def test_health_is_unavailable_when_the_model_is_not_cached(monkeypatch) -> None:
    monkeypatch.setattr(
        app_module,
        "stt_status",
        lambda *args, **kwargs: {"stt": "unavailable", "stt_name": "faster-whisper base", "stt_detail": "run stt_download.py"},
    )
    monkeypatch.setattr(app_module, "ollama_status", lambda *args, **kwargs: (True, "Ollama at http://127.0.0.1:11434 is serving gemma3:4b."))
    body = TestClient(app).get("/api/health").json()

    assert body["stt"] == "unavailable"
    assert body["model"] == "ok"
    assert body["model_name"] == "gemma3:4b"
    assert "stt_download.py" in body["stt_detail"]
