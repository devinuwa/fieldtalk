"""FieldTalk API — local only, bound to 127.0.0.1.

Endpoints:

* ``GET /api/health`` — readiness of the API, speech-to-text and the local model.
* ``POST /api/transcribe`` — real speech-to-text. The recorded audio is the **request
  body** (``content-type: audio/webm`` …), transcribed locally by faster-whisper and the
  temporary file is deleted before the response. A missing model is a 503 that names the
  setup command; an empty recording is a 400; nothing is ever transcribed remotely.
* ``POST /api/extract`` — run a transcript through the pipeline and return a review proposal.
* ``GET /api/entries`` — list stored entries.
* ``POST /api/entries`` — manual add (no model needed).
* ``PATCH /api/entries/{id}`` — manual edit.
* ``DELETE /api/entries/{id}`` — delete.
* ``POST /api/ask`` — ask-your-notes, model plan + tools + V3.
* ``GET /api/report/weekly`` — weekly summary (pure engine over the store).

All endpoints that touch the store use the SQLite file at ``data/fieldtalk.db``
(gitignored). Run with:

    backend/.venv/Scripts/python.exe -m uvicorn fieldtalk.app:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from .engine.models import ENTRY_KINDS_STR, Entry, EntryKind, Quantity, DateExpr
from .engine.dates import parse_iso

Entry = Entry
Quantity = Quantity
DateExpr = DateExpr
parse_iso = parse_iso


def new_entry_id() -> str:
    import uuid
    return uuid.uuid4().hex[:12]

from .pipeline import (
    DEFAULT_MODEL,
    ExtractionResult,
    OllamaAdapter,
    SchemaError,
    StubAdapter,
    ask,
    build_prompt,
    extract,
    ollama_status,
)
from .pipeline.ask import ask as run_ask
from .pipeline.ask import ASK_PLAN_JSON_SCHEMA
from .pipeline.schema import ENTRY_JSON_SCHEMA, ParseError
from .pipeline.search import search_notes
from .stt import (
    MAX_AUDIO_BYTES,
    SUPPORTED_AUDIO_TYPES,
    AudioEmptyError,
    AudioTooLargeError,
    SttError,
    SttModelMissingError,
    SttUnavailableError,
    UnsupportedAudioError,
    get_transcriber,
    stt_status,
)
from .store import Entry as StoreEntry, Store, DB_PATH
from .tools import (
    days_since_last_note_tool,
    days_since_planting_tool,
    open_issues_tool,
    plot_timeline_tool,
    weekly_summary_tool,
    normalize_plot,
    all_entries,
    search_notes_tool as _search_notes_tool,
)


app = FastAPI(
    title="FieldTalk",
    version="0.1.0",
    description="Offline voice field notebook. Local only: no accounts, no telemetry.",
    docs_url=None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["content-type"],
)

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "fieldtalk.db"


# ------------------------------------------------------------------
# Health
# ------------------------------------------------------------------


@app.get("/api/health")
def health() -> dict[str, str]:
    """What is ready on this machine right now: the API, speech-to-text, the local model.

    Both probes are cheap and local: ``stt_status`` only inspects the model cache (no
    load, no download) and ``ollama_status`` is a 2 s loopback call. No model is ever
    loaded just because a page asked for health.
    """
    stt = stt_status()
    model_ok, model_detail = ollama_status(DEFAULT_MODEL)
    return {
        "backend": "ok",
        "stt": stt["stt"],
        "stt_name": stt["stt_name"],
        "stt_detail": stt["stt_detail"],
        "model": "ok" if model_ok else "unavailable",
        "model_name": DEFAULT_MODEL,
        "model_detail": model_detail,
        "detail": f"{stt['stt_detail']} {model_detail}",
    }


# ------------------------------------------------------------------
# Transcribe (real, local faster-whisper over the uploaded audio bytes)
# ------------------------------------------------------------------

# The browser posts the recorded Blob as the raw request body with its own content type
# (audio/webm;codecs=opus from MediaRecorder). That keeps the upload free of multipart
# parsing and of an extra dependency, and the bytes go straight to a temp file.
_SUFFIX_BY_CONTENT_TYPE = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/opus": ".ogg",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-wav": ".wav",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
    "audio/aac": ".aac",
    "application/octet-stream": ".webm",
    "binary/octet-stream": ".webm",
}


def _audio_suffix(content_type: str) -> str:
    return _SUFFIX_BY_CONTENT_TYPE.get(content_type, ".webm")


@app.post("/api/transcribe")
async def transcribe(request: Request) -> dict[str, Any]:
    """Speech-to-text for one recording: raw audio body in, transcript out.

    Local only: the audio is written to a private temporary file, transcribed by
    faster-whisper on this CPU, and the file is deleted before the response returns.
    The model is never downloaded here — a missing model is a 503 with the setup
    command, so the UI can say exactly what to do.
    """
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in SUPPORTED_AUDIO_TYPES and content_type not in _SUFFIX_BY_CONTENT_TYPE:
        raise HTTPException(
            status_code=415,
            detail=(
                f"content type {content_type or '(missing)'!r} is not supported. Send the recorded "
                "audio bytes with an audio/* content type "
                f"({', '.join(sorted(SUPPORTED_AUDIO_TYPES))})."
            ),
        )

    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"audio is larger than the {MAX_AUDIO_BYTES // (1024 * 1024)} MiB limit",
        )

    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_AUDIO_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"audio is larger than the {MAX_AUDIO_BYTES // (1024 * 1024)} MiB limit",
            )
        chunks.append(chunk)
    audio = b"".join(chunks)

    if not audio:
        raise HTTPException(
            status_code=400,
            detail="the recording is empty: nothing was captured, so there is nothing to transcribe.",
        )

    transcriber = get_transcriber()
    try:
        result = transcriber.transcribe_bytes(audio, _audio_suffix(content_type))
    except AudioEmptyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except AudioTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc))
    except SttModelMissingError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except SttUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except UnsupportedAudioError as exc:
        raise HTTPException(status_code=415, detail=str(exc))
    except SttError as exc:
        raise HTTPException(status_code=500, detail=f"transcription failed ({type(exc).__name__})")

    return {
        "transcript": result.transcript,
        "model": result.model,
        "model_id": getattr(transcriber, "model_name", result.model),
        "duration_seconds": result.audio_seconds,
        "wall_seconds": result.wall_seconds,
        "rtf": result.rtf,
        "language": result.language,
        "language_probability": result.language_probability,
        "model_load_seconds": result.model_load_seconds,
        "segments": len(result.segments),
        "synthetic": False,
    }


# ------------------------------------------------------------------
# Extract
# ------------------------------------------------------------------


@dataclass
class ExtractRequest:
    transcript: str
    recording_date: str | None = None  # YYYY-MM-DD
    model: str | None = None


@app.post("/api/extract")
def extract_preview(body: ExtractRequest) -> dict[str, Any]:
    try:
        recording_date = date.fromisoformat(body.recording_date) if body.recording_date else date.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="recording_date must be YYYY-MM-DD")

    # Accept the model override only for "stub" (manual) or "gemma3:4b" (live).
    model_name: str = body.model or DEFAULT_MODEL
    if model_name == "stub":
        adapter = StubAdapter([""])
    else:
        adapter = OllamaAdapter(model=model_name if model_name else DEFAULT_MODEL)

    try:
        result: ExtractionResult = extract(body.transcript, adapter, recorded_on=recording_date)
    except SchemaError as exc:
        raise HTTPException(status_code=422, detail=f"model output did not match schema: {exc}")

    return {
        # Extraction is a preview. The UI must explicitly approve each row through
        # POST /api/entries; no note reaches SQLite merely by running the model.
        "id": None,
        "action": result.action,
        "clarify_question": result.clarify_question,
        "refusal": result.refusal,
        "entries": [
            {
                "id": None,
                "plot": e.plot,
                "crop": e.crop,
                "kind": e.kind,
                "text": e.text,
                "date": e.date.isoformat(),
                "planting_date": (e.planting_date.isoformat() if e.planting_date else None),
                "quantity": ({"value": e.quantity.value, "unit": e.quantity.unit} if e.quantity else None),
                "grounding": {"plot": e.plot_span, "crop": e.crop_span, "quantity": e.quantity_span, "ungrounded": list(e.ungrounded)},
            }
            for e in result.entries
        ],
        "raw": result.raw,
        "prompt": result.prompt,
        "parsed": result.parsed_dict,
        "timings": result.timings,
    }


# ------------------------------------------------------------------
# Entries CRUD (manual add/edit works with no model)
# ------------------------------------------------------------------


@dataclass
class EntryCreate:
    plot: str | None = None
    crop: str | None = None
    kind: EntryKind = "observation"
    text: str = ""
    recording_date: str | None = None
    quantity_value: float | None = None
    quantity_unit: str | None = None
    planting_date: str | None = None


@app.get("/api/entries")
def list_entries() -> dict[str, Any]:
    store = Store(DB_PATH)
    try:
        store.init_schema()
    except Exception:
        pass
    return {"entries": encode_entries(store.all(), store)}


@app.post("/api/entries")
def create_entry(body: EntryCreate) -> dict[str, Any]:
    from fieldtalk.engine import Entry as EngineEntry, Quantity, parse_iso

    try:
        recording_date = date.fromisoformat(body.recording_date) if body.recording_date else date.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="recording_date must be YYYY-MM-DD")

    if body.kind not in ENTRY_KINDS_STR:
        raise HTTPException(status_code=422, detail=f"kind must be one of {list(ENTRY_KINDS_STR)}")

    if not body.text.strip():
        raise HTTPException(status_code=422, detail="text is required")

    quantity = Quantity(body.quantity_value or 0.0, body.quantity_unit or "") if body.quantity_value is not None else None
    entry = StoreEntry(
        id=new_entry_id(),
        plot=(body.plot.strip() if body.plot else None),
        crop=(body.crop.strip() if body.crop else None),
        kind=body.kind,
        date=recording_date,
        text=body.text.strip(),
        planting_date=(parse_iso(body.planting_date) if body.planting_date else None),
        quantity=quantity,
    )
    store = Store(DB_PATH)
    try:
        store.init_schema()
    except Exception:
        pass
    return {"entry": encode_entry(store.add([entry])[0], store), "created": True}


@app.patch("/api/entries/{entry_id}")
def update_entry(entry_id: str, body: dict[str, Any]) -> dict[str, Any]:
    store = Store(DB_PATH)
    try:
        store.init_schema()
    except Exception:
        pass
    existing = store.by_id(entry_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="entry not found")

    plot = body.get("plot", existing.plot)
    crop = body.get("crop", existing.crop)
    kind = body.get("kind", existing.kind)
    text = body.get("text", existing.text)
    quantity_value = body.get("quantity_value", (existing.quantity.value if existing.quantity else None))
    quantity_unit = body.get("quantity_unit", (existing.quantity.unit if existing.quantity else None))
    recording_date_str = body.get("recording_date")
    recording_date = date.fromisoformat(recording_date_str) if recording_date_str else existing.date
    planting_date_str = body.get("planting_date")
    planting_date = parse_iso(planting_date_str) if planting_date_str else existing.planting_date

    if kind not in ENTRY_KINDS_STR:
        raise HTTPException(status_code=422, detail=f"kind must be one of {list(ENTRY_KINDS_STR)}")

    quantity = Quantity(quantity_value or 0.0, quantity_unit or "") if quantity_value is not None else None
    updated = store.update(
        StoreEntry(
            id=entry_id,
            plot=(plot.strip() if plot else None),
            crop=(crop.strip() if crop else None),
            kind=kind,
            date=recording_date,
            text=(text.strip() if text else existing.text),
            planting_date=planting_date,
            quantity=quantity,
        )
    )
    return {"entry": encode_entry(updated, store), "updated": True}


@app.delete("/api/entries/{entry_id}")
def delete_entry(entry_id: str) -> dict[str, Any]:
    store = Store(DB_PATH)
    try:
        store.init_schema()
    except Exception:
        pass
    deleted = store.delete(entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="entry not found")
    return {"deleted": entry_id}


# ------------------------------------------------------------------
# Ask
# ------------------------------------------------------------------


@dataclass
class AskRequest:
    question: str
    model: str | None = None


# No-model (stub) plan: a fixed clarify so ``POST /api/ask`` stays safe when the local
# model is not wired up — never a fabricated answer, and never an uncaught 500 from
# building an adapter with the wrong arguments.
STUB_CLARIFY_PLAN = json.dumps(
    {
        "action": "clarify",
        "tool": None,
        "plot_text": None,
        "date_expr": None,
        "keyword": None,
        "clarify_question": (
            "The local model is not available, so I cannot interpret this question. "
            "You can still add and edit notes manually."
        ),
    }
)


@app.post("/api/ask")
def ask_question(body: AskRequest) -> dict[str, Any]:
    model_name = body.model or DEFAULT_MODEL
    if model_name == "stub":
        adapter = StubAdapter([STUB_CLARIFY_PLAN])
    else:
        adapter = OllamaAdapter(
            model=model_name if model_name else DEFAULT_MODEL,
            schema=ASK_PLAN_JSON_SCHEMA,
        )

    try:
        result = run_ask(body.question, adapter, DB_PATH)
    except (OSError, RuntimeError):
        # Model layer failure (unreachable, timed out, or Ollama reported an error):
        # a clear, safe, retryable error — not a generic 500.
        raise HTTPException(
            status_code=503,
            detail="The local model is unavailable. Please try again in a moment.",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"ask failed ({type(exc).__name__})")

    return {
        "answer": result.answer,
        "action": result.action,
        "clarify_question": result.clarify_question,
        "plan": {
            "action": result.plan.action,
            "tool": result.plan.tool,
            "plot_text": result.plan.plot_text,
            "date_expr": result.plan.date_expr,
            "keyword": result.plan.keyword,
        },
        "tool_result": result.tool_result,
        "v3_violations": result.v3_violations,
        "question": result.question,
        "model": model_name,
    }


# ------------------------------------------------------------------
# Weekly report (pure engine over store)
# ------------------------------------------------------------------


@app.get("/api/report/weekly")
def weekly_report(as_of: str | None = None) -> dict[str, Any]:
    try:
        as_of_date = date.fromisoformat(as_of) if as_of else date.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="as_of must be YYYY-MM-DD")
    store = Store(DB_PATH)
    try:
        store.init_schema()
    except Exception:
        pass
    from fieldtalk.engine import weekly_summary as _weekly_summary, week_bounds as _week_bounds
    monday, next_monday = _week_bounds(as_of_date)
    ws = _weekly_summary(store.all(), as_of_date, week_start=monday, week_end=next_monday - date.resolution)
    return encode_weekly(ws)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------




def encode_entry(entry: Any, store: Store) -> dict[str, Any]:
    e = entry
    qty = None
    if e.quantity:
        qty = {"value": e.quantity.value, "unit": e.quantity.unit}
    return {
        "id": e.id, "plot": e.plot, "crop": e.crop, "kind": e.kind,
        "text": e.text, "date": e.date.isoformat(),
        "planting_date": (e.planting_date.isoformat() if e.planting_date else None),
        "quantity": qty,
    }


def encode_entries(entries: list[Any], store: Store) -> list[dict[str, Any]]:
    return [encode_entry(e, store) for e in entries]


def encode_weekly(ws: Any) -> dict[str, Any]:
    counts = {k: v for k, v in ws.counts_by_kind.items()}
    return {
        "week_start": ws.week_start.isoformat(), "week_end": ws.week_end.isoformat(),
        "counts_by_kind": counts,
        "total_entries": ws.total_entries,
        "plots_touched": [{"plot": pt.plot, "entries": pt.entries, "kinds": list(pt.kinds), "latest_date": pt.latest_date.isoformat()} for pt in ws.plots_touched],
        "issues_opened": [{"id": i.id, "plot": i.plot, "text": i.text, "date": i.date.isoformat()} for i in ws.issues_opened],
        "issues_closed": [{"id": i.id, "plot": i.plot, "text": i.text, "date": i.date.isoformat()} for i in ws.issues_closed],
        "open_issues": [{"id": i.id, "plot": i.plot, "text": i.text, "date": i.date.isoformat()} for i in ws.open_issues],
        "last_note_by_plot": [{"plot": pr.plot, "date": pr.date.isoformat(), "days_since": pr.days_since} for pr in ws.last_note_by_plot],
    }
