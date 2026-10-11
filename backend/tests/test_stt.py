"""Unit tests for the local speech-to-text adapter (no live Whisper, no network).

The real model is never loaded: ``WhisperModel`` is replaced by a fake and the cache
check runs against a temporary directory. What is verified is the contract the API
depends on — offline-only loading, private temporary files that are removed, English
pinned, and no invented numbers when a measurement is unknown.
"""

from __future__ import annotations

import sys
import tempfile
import types
from pathlib import Path

import pytest

from fieldtalk import stt


class FakeSegment:
    def __init__(self, start: float, end: float, text: str) -> None:
        self.start = start
        self.end = end
        self.text = text


class FakeInfo:
    duration = 6.0
    language = "en"
    language_probability = 0.98


class FakeWhisperModel:
    """Records how it was constructed and what it was asked to transcribe."""

    init_kwargs: dict = {}
    transcribe_calls: list[dict] = []
    fail_on_init: Exception | None = None

    def __init__(self, name: str, **kwargs) -> None:
        if FakeWhisperModel.fail_on_init is not None:
            raise FakeWhisperModel.fail_on_init
        FakeWhisperModel.init_kwargs = {"name": name, **kwargs}

    def transcribe(self, path: str, **kwargs):
        FakeWhisperModel.transcribe_calls.append({"path": path, **kwargs})
        return iter([FakeSegment(0.0, 3.0, " plot 1 maize"), FakeSegment(3.0, 6.0, "knee high ")]), FakeInfo()


@pytest.fixture(autouse=True)
def fake_faster_whisper(monkeypatch):
    module = types.ModuleType("faster_whisper")
    module.WhisperModel = FakeWhisperModel  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "faster_whisper", module)
    FakeWhisperModel.init_kwargs = {}
    FakeWhisperModel.transcribe_calls = []
    FakeWhisperModel.fail_on_init = None
    yield
    stt.reset_transcriber()


def test_model_cached_reads_the_hugging_face_cache_layout(tmp_path: Path) -> None:
    snapshot = tmp_path / "models--Systran--faster-whisper-base" / "snapshots" / "abc"
    snapshot.mkdir(parents=True)
    assert stt.model_cached("base", hub_dir=tmp_path) is False  # no model.bin yet

    (snapshot / "model.bin").write_bytes(b"weights")
    assert stt.model_cached("base", hub_dir=tmp_path) is True
    assert stt.model_cached("small", hub_dir=tmp_path) is False


def test_model_cached_accepts_a_local_directory(tmp_path: Path) -> None:
    local = tmp_path / "converted"
    local.mkdir()
    assert stt.model_cached(str(local)) is False
    (local / "model.bin").write_bytes(b"weights")
    assert stt.model_cached(str(local)) is True


def test_stt_status_names_the_setup_command_when_the_model_is_missing(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FIELD_TALK_STT_DOWNLOAD_ROOT", str(tmp_path))
    status = stt.stt_status("base")
    assert status["stt"] == "unavailable"
    assert "stt_download.py base" in status["stt_detail"]  # actionable, not just "unavailable"


def test_stt_status_is_ok_when_the_weights_are_present(monkeypatch, tmp_path: Path) -> None:
    snapshot = tmp_path / "models--Systran--faster-whisper-base" / "snapshots" / "abc"
    snapshot.mkdir(parents=True)
    (snapshot / "model.bin").write_bytes(b"weights")
    monkeypatch.setenv("FIELD_TALK_STT_DOWNLOAD_ROOT", str(tmp_path))
    status = stt.stt_status("base")
    assert status["stt"] == "ok"
    assert "cpu" in status["stt_name"]


def test_stt_status_reports_a_missing_faster_whisper_install(monkeypatch) -> None:
    monkeypatch.setattr(stt, "_faster_whisper_installed", lambda: False)
    status = stt.stt_status("base")
    assert status["stt"] == "unavailable"
    assert "faster-whisper is not installed" in status["stt_detail"]


def test_transcribe_loads_the_model_offline_and_pins_english() -> None:
    transcriber = stt.WhisperTranscriber("base")
    result = transcriber.transcribe_bytes(b"not-really-audio", ".webm")

    assert FakeWhisperModel.init_kwargs["local_files_only"] is True  # never downloads now
    assert FakeWhisperModel.init_kwargs["device"] == "cpu"
    assert FakeWhisperModel.init_kwargs["compute_type"] == "int8"
    assert FakeWhisperModel.transcribe_calls[0]["language"] == "en"
    assert result.language == "en"
    # Segments are joined and trimmed: the transcript is exactly what was decoded.
    assert result.transcript == "plot 1 maize knee high"
    assert result.audio_seconds == 6.0
    # The real-time factor is measured, not invented: it is wall / audio by definition.
    assert result.rtf == pytest.approx(result.wall_seconds / result.audio_seconds)


def test_transcribe_removes_its_temporary_file() -> None:
    before = set(Path(tempfile.gettempdir()).glob("fieldtalk-stt-*"))
    stt.WhisperTranscriber("base").transcribe_bytes(b"audio-bytes", ".webm")
    after = set(Path(tempfile.gettempdir()).glob("fieldtalk-stt-*"))
    assert after == before  # the recording does not outlive the request


def test_transcribe_rejects_empty_audio() -> None:
    with pytest.raises(stt.AudioEmptyError):
        stt.WhisperTranscriber("base").transcribe_bytes(b"", ".webm")


def test_missing_model_is_reported_as_missing_not_unavailable(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FIELD_TALK_STT_DOWNLOAD_ROOT", str(tmp_path))
    FakeWhisperModel.fail_on_init = RuntimeError("no cached files for base")
    with pytest.raises(stt.SttModelMissingError) as excinfo:
        stt.WhisperTranscriber("base").transcribe_bytes(b"audio-bytes", ".webm")
    assert "stt_download.py base" in str(excinfo.value)


def test_a_broken_model_reports_unavailable_with_the_original_error(monkeypatch) -> None:
    # Weights are present, so the failure is a load problem, not a missing download.
    monkeypatch.setattr(stt, "model_cached", lambda *args, **kwargs: True)
    FakeWhisperModel.fail_on_init = RuntimeError("unsupported compute type")
    with pytest.raises(stt.SttUnavailableError) as excinfo:
        stt.WhisperTranscriber("base").transcribe_bytes(b"audio-bytes", ".webm")
    assert "unsupported compute type" in str(excinfo.value)


def test_rtf_is_none_when_the_audio_length_is_unknown() -> None:
    result = stt.TranscribeResult(
        transcript="x", model="m", audio_seconds=0.0, wall_seconds=1.0, language="en",
        language_probability=1.0, model_load_seconds=0.0,
    )
    assert result.rtf is None  # never a divided-by-zero number, never invented


def test_stub_transcriber_never_touches_a_model() -> None:
    stub = stt.StubTranscriber("plot 2 cowpea flowers")
    result = stub.transcribe_bytes(b"bytes", ".wav")
    assert stub.calls == [(5, ".wav")]
    assert result.transcript == "plot 2 cowpea flowers"
    assert result.model == "stub-stt"
