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
| STT spike (this CPU, faster-whisper base, CPU/int8) | **measured**: 8.34 s clip → 1.6–3.3 s wall, RTF 0.20–0.39; model `base` cached locally |
| Real speech-to-text in `POST /api/transcribe` | wired; live run returns a transcript with language and real-time factor, 400/413/415/503 on bad input |
| Deterministic engine (`backend/fieldtalk/engine`) + golden/purity tests | done |
| Closed-schema extraction + V1 grounding | wired; live gemma3:4b run resolved 3 grounded entries |
| Store (SQLite) + timeline | wired; deterministic tests pass |
| Ask-your-notes via tool calls + V2/V3 | wired; real-model eval 4/4 passing |
| Manual edit/review path | wired in backend and `frontend/` |
| Weekly report | engine side done; UI side done in `frontend/` |
| UI (record with live waveform, entries, ask, report) | done; runs against the local backend or the labelled mock layer |
| Offline readiness indicator (backend / speech-to-text / model) | done; `GET /api/health` checks all three |
| README, demo video, DEV post | README current; demo video and DEV post pending |

Nothing above is claimed as working until the command in this README produced its result.

## Run it

Use three PowerShell terminals from a fresh clone. The commands below keep every service
on loopback and select the real backend explicitly.

```powershell
# Terminal 1: backend (loopback only). Leave this window open.
cd C:\path\to\fieldtalk-package
$env:PYTHONPATH = "backend"
.\.venv\Scripts\python.exe -m uvicorn fieldtalk.app:app --host 127.0.0.1 --port 8000

# Terminal 2: local model service. Leave this running too.
ollama serve

# Terminal 3: UI against the real backend (mock mode is the default otherwise).
cd frontend
$env:NEXT_PUBLIC_MOCK = "0"
$env:NEXT_PUBLIC_API_BASE = "http://127.0.0.1:8000"
$env:NEXT_TELEMETRY_DISABLED = "1"
npm run dev            # http://localhost:3000
```

Open `http://localhost:3000`. The backend health check is
`http://127.0.0.1:8000/api/health`.

## Fresh setup on Windows PowerShell

Requirements:

- Windows 10 or 11.
- Python 3.11 (3.12 is also suitable when the installed faster-whisper wheels support it).
- Node.js LTS and npm.
- Ollama for Windows.
- CPU-only operation is supported; the measured development machine has an i7-8650U and
  16 GB RAM.

From a fresh clone:

```powershell
cd C:\path\to\fieldtalk-package

# Create the repository-root virtual environment and install backend/test dependencies.
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

# Install frontend dependencies.
cd frontend
npm install
cd ..
```

Install Ollama from [ollama.com/download/windows](https://ollama.com/download/windows), start
it, and download the local model once:

```powershell
ollama serve
ollama pull gemma3:4b
```

Download the faster-whisper `base` weights once during setup. This command may take several
minutes and requires internet access:

```powershell
.\.venv\Scripts\python.exe backend\scripts\stt_download.py base
```

After the packages and model weights are present, runtime inference is local and does not
download anything. The readiness panel on the Record screen reports backend, STT, and Ollama
model status and shows the setup command when one is missing.

To verify the installation:

```powershell
# Backend tests
cd backend
..\.venv\Scripts\python.exe -m pytest -q
cd ..

# Frontend tests, typecheck, and production build
cd frontend
npm test -- --run
npm run typecheck
npm run build
```

The backend database is stored at `data\fieldtalk.db`. Recordings and this database are local
personal data and are gitignored. Do not commit them, and protect the `data\` directory when
backing up or sharing the project.

The recording workflow is: record or upload audio, wait for local transcription, review the
transcript, run extraction, review the grounded extraction preview, select the entries to keep,
and choose **Store selected entries**. `/api/extract` does not persist anything; selected rows
are written to SQLite only after explicit approval through `/api/entries`.

Initial setup needs internet access for npm/Python packages, the faster-whisper weights, and
the Ollama model. After setup, FieldTalk uses only the loopback backend, local faster-whisper,
local Ollama, and SQLite. On CPU-only hardware, model startup and transcription can take
noticeable time; keep the readiness panel open while services warm up.

Common PowerShell troubleshooting:

- If `py -3.11` is unavailable, install Python 3.11 and ensure the Python launcher is enabled.
- If activation is blocked by execution policy, do not activate the environment; use the
  explicit `.\.venv\Scripts\python.exe` commands shown above.
- If `ollama` is not recognized, restart PowerShell after installing Ollama and verify
  `ollama list` before running `ollama pull gemma3:4b`.
- If the UI reports the backend as unavailable, confirm `ollama serve` and Uvicorn are each
  running, then open `http://127.0.0.1:8000/api/health`.
- If STT is unavailable, rerun the weight download command and check that the `base` model is
  cached locally. Runtime inference uses `local_files_only=True` and never silently downloads.

## Offline operation

After that setup, the voice workflow needs no internet: the audio is transcribed by the local
faster-whisper weights (`local_files_only=True`, so a missing model is an error rather than a
download), the model calls go to `127.0.0.1:11434`, the notes live in `data/fieldtalk.db`, and the
UI is a static export served from `frontend/out` with no remote fonts, CDNs or telemetry. Verified
by running a real transcription with the Hugging Face hub forced offline (`HF_HUB_OFFLINE=1`; see
EVIDENCE in the task report) and by the content scan in `frontend/src/content.test.ts`, which
fails on any non-loopback URL. A physical network disconnect has not been run in this environment -
that is the one offline check still outstanding.

## Setup (Windows, PowerShell)

```powershell
# Backend. Use Python 3.11 for the verified faster-whisper wheels.
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

# Tests (they never call a live model or live speech model)
cd backend; ..\.venv\Scripts\python.exe -m pytest -v ; cd ..

# API, loopback only (run from the repository root)
$env:PYTHONPATH = "backend"
..\.venv\Scripts\python.exe -m uvicorn fieldtalk.app:app --host 127.0.0.1 --port 8000

# Frontend (static UI, mock mode by default; set NEXT_PUBLIC_MOCK=0 for the backend)
cd frontend
npm install
$env:NEXT_TELEMETRY_DISABLED = 1
npm run dev            # http://localhost:3000
npm test ; npm run build
```

## Speech-to-text

The spike and the app share one module, `backend/fieldtalk/stt/`:

```powershell
# Measure a clip (base and small are both cached here):
.\.venv\Scripts\python.exe backend\scripts\stt_smoke.py data\sample.wav --models base small

# Cache the weights the API will use (setup only; never during a recording):
.\.venv\Scripts\python.exe backend\scripts\stt_download.py base
```

The API takes the recorded audio **as the request body** (`content-type: audio/webm;codecs=opus`
from the browser, or `audio/wav`, `audio/mpeg`, …):

```bash
curl -X POST http://127.0.0.1:8000/api/transcribe -H "content-type: audio/wav" --data-binary @data/sample.wav
```

It answers with the transcript plus the measurements the UI shows (audio seconds, wall seconds,
real-time factor, detected language). Configuration: `FIELD_TALK_STT_MODEL` (default `base`),
`FIELD_TALK_STT_DEVICE` (`cpu`), `FIELD_TALK_STT_COMPUTE_TYPE` (`int8`). English is pinned
(rule 4). A missing model is a 503 whose message is the setup command, never a silent download.

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
UI origin only. Recordings are held in browser memory for the session and are never written
to browser storage; only the audio you choose to transcribe is sent, to the loopback backend,
and its temporary file is deleted before the response returns. `data/` and every non-fixture
audio file are gitignored. Synthetic test data is labelled `"synthetic": true` wherever it
appears.

## Licences

Our code is MIT (`LICENSE`). Components and model licences — including which ones still
need verification — are listed in `THIRD_PARTY.md`.

## Post-deadline commits

Commits made after 2026-10-12T06:59:00Z are listed here.

*(none yet)*
