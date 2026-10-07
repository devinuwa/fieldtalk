"""Minimal FastAPI application.

Stub for the first step: only ``/health`` exists so the UI can ask whether the local
speech-to-text and the local model are up. The real endpoints (``/stt``, ``/extract``,
``/entries``, ``/ask``, ``/report/weekly``) are added with the pipeline and the store.

Run it bound to loopback only (AGENTS.md rule 5):

    backend/.venv/Scripts/python.exe -m uvicorn fieldtalk.app:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="FieldTalk",
    version="0.1.0",
    description="Offline voice field notebook. Local only: no accounts, no telemetry.",
    docs_url=None,
    redoc_url=None,
)

# The UI is served on localhost:3000 during development. Nothing else is allowed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["content-type"],
)


@app.get("/health")
def health() -> dict[str, str]:
    """Report what is available. Filled in as the stt and model layers land."""
    return {
        "stt": "unavailable",
        "model": "unavailable",
        "stt_name": "faster-whisper (not wired up yet)",
        "model_name": "gemma3:4b (not wired up yet)",
        "detail": "Scaffold only: the engine works, speech and model layers are next.",
    }
