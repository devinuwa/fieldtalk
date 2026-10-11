"""Local speech-to-text: faster-whisper on the CPU, ``int8``, nothing leaves the machine.

AGENTS.md: speech-to-text is a *replaceable adapter*. ``pipeline.extract`` never talks to
this module; ``app.py`` talks only to the ``Transcriber`` protocol, so tests inject
``StubTranscriber`` and never load a real Whisper model.

Rules this module enforces:

* **Never download a model during a request.** Inference always passes
  ``local_files_only=True``. Downloading is a separate, explicit setup step
  (``backend/scripts/stt_download.py``); if the weights are not in the local cache,
  ``model_cached()`` is false and the API answers 503 with the command to run.
* **CPU + int8 by default** (the target machine has no GPU). Both are configurable with
  ``FIELD_TALK_STT_DEVICE`` / ``FIELD_TALK_STT_COMPUTE_TYPE``.
* **Temporary files are private and always removed**: audio is written to a fresh
  directory under the OS temp dir and the directory is deleted in a ``finally`` block.

Configuration (environment, read at call time so a test or a launcher can change it):

=============================  ===========  ===========================================
Variable                       Default      Meaning
=============================  ===========  ===========================================
``FIELD_TALK_STT_MODEL``       ``base``     faster-whisper size, HF model id, or a path
``FIELD_TALK_STT_DEVICE``      ``cpu``      ``cpu`` or ``cuda``
``FIELD_TALK_STT_COMPUTE_TYPE`` ``int8``    ctranslate2 compute type
``FIELD_TALK_STT_DOWNLOAD_ROOT`` unset      override the model cache directory
=============================  ===========  ===========================================
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

__all__ = [
    "DEFAULT_MODEL_NAME",
    "MAX_AUDIO_BYTES",
    "SUPPORTED_AUDIO_TYPES",
    "AudioEmptyError",
    "AudioTooLargeError",
    "SttError",
    "SttModelMissingError",
    "SttUnavailableError",
    "UnsupportedAudioError",
    "TranscribeResult",
    "Transcriber",
    "StubTranscriber",
    "WhisperTranscriber",
    "configured_compute_type",
    "configured_device",
    "configured_model",
    "get_transcriber",
    "model_cached",
    "model_hub_dir",
    "reset_transcriber",
    "set_transcriber",
    "stt_status",
]

# The smallest model that is still usable for a short spoken field note (PLAN.md: prefer
# the smallest suitable model on this CPU). ``small`` is cached here too and can be
# selected with FIELD_TALK_STT_MODEL=small.
DEFAULT_MODEL_NAME = "base"

# 25 MiB is roughly 20 minutes of Opus speech in the browser's webm container: far more
# than a field note, and small enough that a request cannot exhaust memory.
MAX_AUDIO_BYTES = 25 * 1024 * 1024

# What a browser MediaRecorder and a normal audio file can send.
SUPPORTED_AUDIO_TYPES = frozenset(
    {
        "audio/webm",
        "audio/ogg",
        "audio/mp4",
        "audio/m4a",
        "audio/x-m4a",
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/wave",
        "audio/x-wav",
        "audio/flac",
        "audio/x-flac",
        "audio/aac",
        "audio/opus",
    }
)

# Some browsers and tools send a bare binary content type; the bytes are still audio and
# the decoder decides. A JSON or text body is never accepted as audio.
_BINARY_CONTENT_TYPES = frozenset({"application/octet-stream", "binary/octet-stream"})


class SttError(RuntimeError):
    """Base class for every speech-to-text failure."""


class SttModelMissingError(SttError):
    """The configured model is not in the local cache and must not be downloaded now."""


class SttUnavailableError(SttError):
    """faster-whisper is not installed, or the model could not be loaded."""


class UnsupportedAudioError(SttError):
    """The submitted content type is not audio."""


class AudioTooLargeError(SttError):
    """The submitted audio is over :data:`MAX_AUDIO_BYTES`."""


class AudioEmptyError(SttError):
    """The submitted audio has no bytes: a failed or stopped-too-early recording."""


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


def configured_model() -> str:
    """The model size, Hugging Face id or local directory to use."""
    return _env("FIELD_TALK_STT_MODEL", DEFAULT_MODEL_NAME)


def configured_device() -> str:
    return _env("FIELD_TALK_STT_DEVICE", "cpu")


def configured_compute_type() -> str:
    return _env("FIELD_TALK_STT_COMPUTE_TYPE", "int8")


def model_hub_dir() -> Path:
    """The Hugging Face cache root faster-whisper downloads into."""
    root = os.environ.get("FIELD_TALK_STT_DOWNLOAD_ROOT") or os.environ.get("HF_HUB_CACHE")
    if root:
        return Path(root).expanduser()
    home = os.environ.get("HF_HOME")
    if home:
        return Path(home).expanduser() / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def _repo_dir_name(model: str) -> str:
    """``base`` -> ``models--Systran--faster-whisper-base``; an id keeps its owner."""
    if "/" in model:
        return "models--" + model.replace("/", "--")
    return f"models--Systran--faster-whisper-{model}"


def model_cached(model: str | None = None, hub_dir: Path | None = None) -> bool:
    """True when the weights are already on this machine, so inference can run offline.

    A local directory (a path, or a converted CTranslate2 model directory) counts as
    cached when it holds ``model.bin``. Nothing here touches the network.
    """
    name = model if model is not None else configured_model()
    candidate = Path(name).expanduser()
    if candidate.is_dir():
        return (candidate / "model.bin").is_file()
    root = hub_dir if hub_dir is not None else model_hub_dir()
    repo = root / _repo_dir_name(name)
    if not repo.is_dir():
        return False
    snapshots = repo / "snapshots"
    if not snapshots.is_dir():
        return False
    return any((snapshot / "model.bin").is_file() for snapshot in snapshots.iterdir() if snapshot.is_dir())


def _faster_whisper_installed() -> bool:
    # ``find_spec`` raises ValueError for a module already in sys.modules without a spec
    # (a test stub), so check sys.modules first and never let a probe raise.
    if "faster_whisper" in sys.modules:
        return True
    try:
        return importlib.util.find_spec("faster_whisper") is not None
    except (ImportError, ValueError):
        return False


def stt_status(model: str | None = None) -> dict[str, str]:
    """Readiness for ``GET /api/health``: is speech-to-text usable right now?

    Cheap and offline: no model is loaded and no network call is made, so the health
    endpoint stays fast. The answer is therefore "can this machine transcribe", not
    "did a transcription just succeed".
    """
    name = model if model is not None else configured_model()
    label = f"faster-whisper {name} ({configured_device()}, {configured_compute_type()})"
    if not _faster_whisper_installed():
        return {
            "stt": "unavailable",
            "stt_name": label,
            "stt_detail": (
                "faster-whisper is not installed in this interpreter. Run: "
                "backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt"
            ),
        }
    if not model_cached(name):
        return {
            "stt": "unavailable",
            "stt_name": label,
            "stt_detail": (
                f"Speech-to-text model '{name}' is not in the local model cache "
                f"({model_hub_dir()}). Download it once at setup: "
                f"backend/.venv/Scripts/python.exe backend/scripts/stt_download.py {name}"
            ),
        }
    return {
        "stt": "ok",
        "stt_name": label,
        "stt_detail": f"Speech-to-text model '{name}' is present in the local cache and runs on the CPU.",
    }


@dataclass
class TranscribeResult:
    """One transcription, with the measurements the UI reports."""

    transcript: str
    model: str
    audio_seconds: float
    wall_seconds: float
    language: str | None
    language_probability: float | None
    model_load_seconds: float
    segments: list[dict[str, Any]] = field(default_factory=list)

    @property
    def rtf(self) -> float | None:
        """Real-time factor = transcribing time / audio length; None when unknown."""
        if self.audio_seconds <= 0:
            return None
        return round(self.wall_seconds / self.audio_seconds, 3)


@runtime_checkable
class Transcriber(Protocol):
    """What the API needs from a speech-to-text engine: bytes in, transcript out."""

    name: str

    def transcribe_bytes(self, audio: bytes, suffix: str = ".webm") -> TranscribeResult: ...


class WhisperTranscriber:
    """faster-whisper on the CPU. The model is loaded once, lazily, on first use.

    The model *is* loaded with ``local_files_only=True`` so a missing weight file fails
    loudly instead of silently downloading during a recording.
    """

    def __init__(
        self,
        model_name: str | None = None,
        *,
        device: str | None = None,
        compute_type: str | None = None,
        local_files_only: bool = True,
        language: str | None = "en",
    ) -> None:
        self.model_name = model_name if model_name is not None else configured_model()
        self.device = device if device is not None else configured_device()
        self.compute_type = compute_type if compute_type is not None else configured_compute_type()
        self.local_files_only = local_files_only
        # English only (AGENTS.md rule 4): pin the language instead of letting Whisper
        # guess and silently transcribe something else.
        self.language = language
        self.name = f"faster-whisper {self.model_name} ({self.device}, {self.compute_type})"
        self._model: Any | None = None
        self._load_seconds = 0.0
        self._lock = threading.Lock()

    # -- model ---------------------------------------------------------

    def _load_model(self) -> Any:
        if self._model is not None:
            return self._model
        if not _faster_whisper_installed():
            raise SttUnavailableError(
                "faster-whisper is not installed in this interpreter (pip install -r backend/requirements.txt)."
            )
        from faster_whisper import WhisperModel  # local import: keeps --help and tests light

        started = time.perf_counter()
        try:
            model = WhisperModel(
                self.model_name,
                device=self.device,
                compute_type=self.compute_type,
                local_files_only=self.local_files_only,
            )
        except Exception as exc:  # download attempted, corrupt cache, unsupported compute type
            if not model_cached(self.model_name):
                raise SttModelMissingError(
                    f"Speech-to-text model '{self.model_name}' is not in the local model cache. "
                    f"Download it once at setup: backend/.venv/Scripts/python.exe "
                    f"backend/scripts/stt_download.py {self.model_name}"
                ) from exc
            raise SttUnavailableError(f"could not load model '{self.model_name}': {exc}") from exc
        self._load_seconds = time.perf_counter() - started
        self._model = model
        return model

    def close(self) -> None:
        self._model = None

    # -- transcription -------------------------------------------------

    def transcribe_bytes(self, audio: bytes, suffix: str = ".webm") -> TranscribeResult:
        """Write the audio to a private temporary file, transcribe it, delete it."""
        if not audio:
            raise AudioEmptyError("the recording is empty")
        workdir = Path(tempfile.mkdtemp(prefix="fieldtalk-stt-"))
        try:
            path = workdir / f"clip{suffix}"
            path.write_bytes(audio)
            return self.transcribe_file(path)
        finally:
            # Always: the recording never outlives the request.
            shutil.rmtree(workdir, ignore_errors=True)

    def transcribe_file(self, path: Path) -> TranscribeResult:
        with self._lock:  # ctranslate2 models are not thread-safe for concurrent calls
            model = self._load_model()
            started = time.perf_counter()
            try:
                segments, info = model.transcribe(
                    str(path),
                    language=self.language,
                    beam_size=5,
                    vad_filter=True,
                )
                rows: list[dict[str, Any]] = []
                parts: list[str] = []
                for segment in segments:  # generator: this loop is the inference
                    text = segment.text.strip()
                    if text:
                        parts.append(text)
                    rows.append(
                        {
                            "start": round(float(segment.start), 2),
                            "end": round(float(segment.end), 2),
                            "text": text,
                        }
                    )
            except SttError:
                raise
            except Exception as exc:
                raise SttUnavailableError(f"transcription failed: {exc}") from exc
            wall_seconds = time.perf_counter() - started

        audio_seconds = float(getattr(info, "duration", 0.0) or 0.0)
        return TranscribeResult(
            transcript=" ".join(parts).strip(),
            model=self.name,
            audio_seconds=round(audio_seconds, 2),
            wall_seconds=round(wall_seconds, 2),
            language=getattr(info, "language", None),
            language_probability=(
                round(float(getattr(info, "language_probability", 0.0)), 3)
                if getattr(info, "language_probability", None) is not None
                else None
            ),
            model_load_seconds=round(self._load_seconds, 2),
            segments=rows,
        )


class StubTranscriber:
    """Deterministic stand-in for tests: no model, no CPU time, no network."""

    def __init__(self, transcript: str = "plot 1 maize knee high", audio_seconds: float = 4.0) -> None:
        self.transcript = transcript
        self.audio_seconds = audio_seconds
        self.name = "stub-stt"
        self.calls: list[tuple[int, str]] = []

    def transcribe_bytes(self, audio: bytes, suffix: str = ".webm") -> TranscribeResult:
        self.calls.append((len(audio), suffix))
        return TranscribeResult(
            transcript=self.transcript,
            model=self.name,
            audio_seconds=self.audio_seconds,
            wall_seconds=0.5,
            language="en",
            language_probability=1.0,
            model_load_seconds=0.0,
            segments=[{"start": 0.0, "end": self.audio_seconds, "text": self.transcript}],
        )


_transcriber: Transcriber | None = None


def get_transcriber() -> Transcriber:
    """The process-wide transcriber: one Whisper model load per server, not per request."""
    global _transcriber
    if _transcriber is None:
        _transcriber = WhisperTranscriber()
    return _transcriber


def set_transcriber(transcriber: Transcriber | None) -> None:
    """Swap the transcriber (tests inject a stub; ``None`` clears it)."""
    global _transcriber
    _transcriber = transcriber


def reset_transcriber() -> None:
    """Drop the cached model so the next call reloads it."""
    global _transcriber
    if isinstance(_transcriber, WhisperTranscriber):
        _transcriber.close()
    _transcriber = None
