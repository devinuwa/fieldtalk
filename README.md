# FieldTalk

An offline voice field notebook for farm and garden walks. You speak a note; open-source
speech-to-text writes it down; a small local model turns it into structured entries; code
resolves every date and computes every count; a printable weekly report comes out of the
stored entries.

**What FieldTalk is not:** an agronomy advisor. It does not diagnose disease, recommend
fertilizer or chemicals, or predict prices or weather. Advice questions get a fixed
refusal. The model records and recalls what you told it — nothing more.

Built for Hacktoberfest 2026, DEV Week 1 "Touch Grass". English only.

## Status (honest, updated as work lands)

| Piece | State |
|---|---|
| Repo scaffold, licences, docs, fixtures recorded | done |
| STT spike (this CPU, faster-whisper base/small) | **not measured yet** — script ready, waiting for `data/sample.wav` |
| Deterministic engine (`backend/fieldtalk/engine`) + golden/purity tests | done |
| Closed-schema extraction + V1 grounding | not started |
| Store (SQLite) + timeline | not started |
| Ask-your-notes via tool calls + V2/V3 | not started |
| Manual edit/review path | UI side done in `frontend/`; backend store pending |
| Weekly report | engine side done; UI side done in `frontend/` |
| UI (record/upload, entries, ask, report) | done against fixtures in `frontend/` (mock mode) |
| README, demo video, DEV post | pending |

Nothing above is claimed as working until the command in this README produced its result.

## Setup (Windows, PowerShell)

```powershell
# Backend. The Python on PATH here (3.13) has no venv module, so use 3.11.
py -3.11 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt

# Tests (engine only; they never call a live model or a live speech model)
cd backend; ../backend/.venv/Scripts/python.exe -m pytest -v ; cd ..

# API skeleton, loopback only
backend/.venv/Scripts/python.exe -m uvicorn fieldtalk.app:app --host 127.0.0.1 --port 8000
# (run from backend/, so the `fieldtalk` package is importable)

# Frontend (static UI, mock mode until the backend lands)
cd frontend
npm install
$env:NEXT_TELEMETRY_DISABLED = 1
npm run dev            # http://localhost:3000
npm test ; npm run build
```

## Speech-to-text spike

```powershell
# Put your own 30-60 s clip at data/sample.wav (data/ is gitignored; never a recording
# of somebody else), then:
backend/.venv/Scripts/python.exe backend/scripts/stt_smoke.py data/sample.wav --models base small
```

It prints the transcript, audio seconds, wall seconds and the real-time factor for each
model, and exits non-zero when no model is fast enough (RTF above 3). The first run
downloads the model weights (setup-time network only).

## Layout

```
AGENTS.md            working rules for this repo
docs/PLAN.md         product plan, entry schema, engine spec, tools, schedule
docs/PROMPTS.md      the exact prompts used for each agent step
docs/PROVENANCE.md   first commit UTC time and how the repo was built
docs/FIXTURE_HASHES.md  fixture hashes + one known fixture inconsistency (open)
backend/             FastAPI app, pure-Python engine, tests, stt smoke script
frontend/            static UI (Next.js), works in mock mode without the backend
fixtures/ eval/      synthetic test data (never real recordings)
data/                your recordings and the local database (gitignored, never committed)
```

## Privacy

Recordings and notes stay on this machine. No accounts, no analytics, no telemetry, no
CDN assets, no cloud calls at runtime; the backend binds `127.0.0.1` and allows the local
UI origin only. `data/` and every non-fixture audio file are gitignored. Synthetic test
data is labelled `"synthetic": true` wherever it appears.

## Licences

Our code is MIT (`LICENSE`). Components and model licences — including which ones still
need verification — are listed in `THIRD_PARTY.md`.

## Post-deadline commits

Commits made after 2026-10-12T06:59:00Z are listed here.

*(none yet)*
