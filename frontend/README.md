# FieldTalk UI (`frontend/`)

The FieldTalk web UI: record a spoken note, review what the extraction proposed, edit and
confirm entries by plot, ask questions about your notes, and print the week.

Next.js (App Router) + TypeScript + Tailwind, built as a **static export** (`out/`). No
fonts, images, analytics or CDN assets are fetched at runtime; notes are never written to
browser storage. The UI runs against a **mock layer** by default, or the local backend when
`NEXT_PUBLIC_MOCK=0`, using `fixtures/` and `eval/transcripts.jsonl`.

The theme is a dark charcoal/graphite field palette (`#10161C` page, `#18212A` cards) with an
emerald accent; every colour is a token in `src/app/globals.css`, and the print sheet flips the
whole palette back to ink on paper for the weekly report.

## Quick start (Windows PowerShell)

```powershell
cd frontend
npm install
$env:NEXT_TELEMETRY_DISABLED = 1
npm run dev                 # http://localhost:3000, mock mode on by default
```

Build and preview the static export:

```powershell
npm run build               # writes frontend/out/
npm run serve:out           # http://127.0.0.1:3000, serves out/ with no runtime deps
npm test                    # vitest: 85 tests (component tests run in jsdom)
npm run typecheck           # tsc --noEmit
```

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_MOCK` | on | `1`/unset = mock layer; `0` = talk to the HTTP backend |
| `NEXT_PUBLIC_API_BASE` | `http://127.0.0.1:8000` | Backend base URL (loopback only); the client appends `/api` |
| `NEXT_PUBLIC_MODEL_OFFLINE` | unset | `1` starts in the "model unavailable" state to exercise the manual path |
| `NEXT_PUBLIC_STT_OFFLINE` | unset | `1` starts in the "speech-to-text unavailable" state to exercise the readiness panel |
| `NEXT_TELEMETRY_DISABLED` | set by every npm script | Next telemetry off; no build-time beacon |

For the real voice workflow: start the backend (`uvicorn`, loopback), start Ollama with the model
pulled, then `NEXT_PUBLIC_MOCK=0 npm run dev`. The readiness panel on the Record screen reports the
backend, the speech model and the local model separately, and the backend's message names the
command when one is missing.

## Screens

1. **Record / Upload** (`/`) — the primary control is a circular microphone button. Pressing it
   asks for the microphone (`getUserMedia`, only on press), draws the real input as an animated
   waveform from a Web Audio `AnalyserNode`, and runs a timer with **Ready → Recording →
   Processing → Transcribed** states. Stopping releases the microphone and sends the clip straight
   to the loopback `POST /api/transcribe`. The transcript lands in an editable box with the audio
   length, the transcription time, the real-time factor and the detected language, next to two
   clear actions: *Save note* (extraction, then review) and *Ask a question* (hands the transcript
   over to the Ask screen), plus *Transcribe again* and *Discard recording*. A file upload is
   offered as an alternative. Nothing is stored until the review keeps the entries; an empty or
   failed transcript can never be saved. Denied permission, no microphone, an unsupported
   recording format and an interrupted recording each get their own message. An **offline
   readiness** panel above the recorder reports the backend, the speech model and the local model
   from `GET /api/health`.
2. **Entries** (`/entries/`) — grouped by plot, kind badges, every field editable (plot, crop,
   kind, text, date, planting date, quantity), one entry at a time, with confirm and a
   two-step delete. Fields the V1 gate could not trace to the transcript are highlighted and
   labelled; editing alone does not clear a highlight, confirming does. *Add an entry by hand*
   is the path that needs no model at all.
3. **Ask** (`/ask/`) — the answer is reached through five staged responses (interpret → tool
   call → validate → engine → verified answer). The ribbon advances as each stage arrives, each
   stage shows its measured time, and the collapsible trace panel shows the raw payload, the V2
   and V3 checks, and the V3 result.
4. **Weekly report** (`/report/`) — week picker (previous / this / next), counts by kind, plots
   touched, issues opened/closed/still open, days since the last note per plot, and days since
   planting. `@media print` hides the navigation, banner and buttons, shows a print-only title
   and keeps the tables. Every number is computed from stored entries; none comes from a model.
5. **Model unavailable banner** — shown on every screen when health reports the model or
   speech-to-text down. Extraction and asking are disabled, and the manual add/edit/confirm and
   the whole report keep working.

### Recording internals

`src/lib/use-recorder.ts` is the whole recording state machine (states, timer, waveform values,
clip, error mapping, microphone release). `src/components/Recorder.tsx` is the view, and
`src/components/Waveform.tsx` renders the bar heights it is given. The waveform is never a
canned animation: in a silent room it is flat and says so.

## Mock layer

`NEXT_PUBLIC_MOCK=1` serves everything from `frontend/src/lib/mock/`:

* **STT** returns a synthetic transcript from `eval/transcripts.jsonl`. A file named `T03.wav`
  picks `T03`; otherwise the choice is deterministic from the file name. **No audio is decoded
  and no model runs**, so the real-time factor is reported as `null` ("not measurable in mock
  mode") instead of being invented. An empty recording is rejected here too, so the mock flow
  cannot save a note the real one would refuse.
* **Extraction** maps a bundled synthetic transcript to its gold fields. Any other text returns
  `action: "clarify"` with a note that only the bundled transcripts are known. There is no
  pretence of real extraction.
* **Store** starts from 12 synthetic seed entries (`synthetic: true`, always labelled in the UI)
  and keeps edits in memory for the session.
* **Ask** routes with a small deterministic keyword router standing in for the local model, runs
  the tools from PLAN.md over the seed entries, and builds template answers. V2 checks the tool
  name and plot text; V3 rejects any number in the answer that is not in the tool output (there
  is a negative-control test for this).

With `NEXT_PUBLIC_MOCK=0` the same UI talks to the HTTP client in `src/lib/http/client.ts`:
`GET /api/health`, `POST /api/transcribe` (**the recorded Blob is the request body**, with its
audio content type), `POST /api/extract`, `GET|POST /api/entries`, `PATCH /api/entries/{id}`,
`DELETE /api/entries/{id}`, `POST /api/ask`, and `GET /api/report/weekly?as_of=YYYY-MM-DD`.
Adjust only that file if a shape differs. A 503 from `/api/transcribe` (missing model) surfaces
the backend's setup message verbatim.

## Fixtures

`fixtures/` and `eval/` are owned by the backend agent and are **never edited** here.
`npm run sync:fixtures` copies what the UI needs into `frontend/mock/from-fixtures/` and writes
`manifest.json` with the sha256 of each source. Copies are read-only inputs to the mock layer.

## Tests

`npm test` runs 85 tests in thirteen files (node by default; component and hook tests opt into
jsdom with a `@vitest-environment jsdom` docblock):

* `src/lib/engine.test.ts` — the golden cases in `fixtures/golden_engine.json`, with case-count
  assertions first so a shrunken fixture cannot pass vacuously.
* `src/lib/mock/ask.test.ts` — five stages, in order, for answered/refused/clarify runs; tool
  routing; template answers; V3 positive and negative controls.
* `src/lib/mock/client.test.ts` — mock store behaviour, including "model offline: extraction
  fails, manual add/edit/confirm/delete still work" and the speech-to-text readiness states.
* `src/lib/mock/seedEntries.test.ts` — the seed store covers every kind, three ungrounded fields
  and two open issues.
* `src/lib/audio.test.ts` — waveform buckets from analyser samples (flat for silence), format
  detection, the recording clock, and "unknown length stays unknown".
* `src/lib/use-recorder.test.tsx` — the recording hook driven by fake MediaRecorder /
  getUserMedia / AudioContext: permission on press only, live levels, clip on stop, microphone
  released, and the denied / unsupported-format / empty / interrupted failures.
* `src/components/Recorder.test.tsx` — the recorder UI: mic button, Ready → Recording, pulse,
  live waveform, clip handover, and the actionable error messages.
* `src/components/ReadinessIndicator.test.tsx` — the readiness panel: all ready, each service
  missing with its fix, backend unreachable, and the re-check button.
* `src/lib/http/client.test.ts` — the wire contract: audio posted as the body, measured numbers
  mapped, 503 setup message surfaced, empty recording never sent.
* `src/lib/workflow.test.ts` — transcript → extract → store → listed/reportable/askable, and
  refuse/clarify store nothing.
* `src/app/record-flow.test.tsx` — the whole screen with the real store and a fake microphone:
  Processing → Transcribed → Save → reviewed entry, and the empty-transcript guard.
* `src/app/record-stt-off.test.tsx` — a missing speech model turns recording off and points at
  the manual path.
* `src/content.test.ts` — scans the whole source tree: no browser storage, no analytics/CDN
  tokens, no non-loopback URLs, no advice/dose text, and the refusal string lives in one place.

These tests use fakes and never run real inference. Real transcriptions are verified separately
against the Python engine, e.g.
`backend/.venv/Scripts/python.exe backend/scripts/stt_smoke.py data/sample.wav --models base`.

## Conventions this UI keeps

* The model extracts and routes; code computes dates and counts. `src/lib/engine.ts` is the
  frontend mirror of the pure-Python engine and is the only place that computes.
* Ungrounded fields are highlighted and never silently accepted.
* The refusal string is fixed in code (`src/lib/strings.ts`); the model only emits `refuse`.
* Synthetic data is labelled on every screen that shows it.
* English only.
* A transcript is not an entry: nothing is stored until the review keeps it, and an empty or
  failed transcription is never stored as a note.
* Mock behaviour is always labelled as mock, and mock measurements are reported as `null`
  rather than invented.

## Service worker / PWA

Not added, deliberately. This UI is a static export of four prerendered pages, served from local
disk or the local static server, so there is nothing to fetch on startup; a service worker would
mainly risk caching `/api/*` responses and handing back a stale transcript or entry. If the app is
ever hosted off-machine, revisit it then.
