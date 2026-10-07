# FieldTalk UI (`frontend/`)

The FieldTalk web UI: record a spoken note, review what the extraction proposed, edit and
confirm entries by plot, ask questions about your notes, and print the week.

Next.js (App Router) + TypeScript + Tailwind, built as a **static export** (`out/`). No
fonts, images, analytics or CDN assets are fetched at runtime; notes are never written to
browser storage. The backend (`backend/`, owned by another agent) does not exist yet, so
the UI runs against a **mock layer** built from `fixtures/` and `eval/transcripts.jsonl`.

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
npm test                    # vitest: 39 tests
npm run typecheck           # tsc --noEmit
```

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_MOCK` | on | `1`/unset = mock layer; `0` = talk to the HTTP backend |
| `NEXT_PUBLIC_API_BASE` | `http://127.0.0.1:8000` | Backend base URL (loopback only) |
| `NEXT_PUBLIC_MODEL_OFFLINE` | unset | `1` starts in the "model unavailable" state to exercise the manual path |
| `NEXT_TELEMETRY_DISABLED` | set by every npm script | Next telemetry off; no build-time beacon |

## Screens

1. **Record / Upload** (`/`) — MediaRecorder button with a live timer, or an audio file. The
   transcript comes back and is shown in an editable box, together with the audio length, the
   transcription time and the real-time factor. Extraction results are listed for review;
   nothing is stored until you tick entries and press *Store selected entries*. A refusal
   (`{"action":"refuse"}`) shows the fixed refusal string; a clarification shows the question.
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

## Mock layer

`NEXT_PUBLIC_MOCK=1` serves everything from `frontend/src/lib/mock/`:

* **STT** returns a synthetic transcript from `eval/transcripts.jsonl`. A file named `T03.wav`
  picks `T03`; otherwise the choice is deterministic from the file name. **No audio is decoded
  and no model runs**, so the real-time factor is reported as `null` ("not measurable in mock
  mode") instead of being invented.
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
`GET /health`, `POST /stt`, `POST /extract`, `GET|POST /entries`, `PATCH /entries/{id}`,
`POST /entries/{id}/confirm`, `DELETE /entries/{id}`, `POST /ask` (newline-delimited stage
stream), `GET /report/weekly?week_of=YYYY-MM-DD`. Adjust only that file if a shape differs.

## Fixtures

`fixtures/` and `eval/` are owned by the backend agent and are **never edited** here.
`npm run sync:fixtures` copies what the UI needs into `frontend/mock/from-fixtures/` and writes
`manifest.json` with the sha256 of each source. Copies are read-only inputs to the mock layer.

## Tests

`npm test` runs 39 tests in five files:

* `src/lib/engine.test.ts` — the golden cases in `fixtures/golden_engine.json`, with case-count
  assertions first so a shrunken fixture cannot pass vacuously.
* `src/lib/mock/ask.test.ts` — five stages, in order, for answered/refused/clarify runs; tool
  routing; template answers; V3 positive and negative controls.
* `src/lib/mock/client.test.ts` — mock store behaviour, including "model offline: extraction
  fails, manual add/edit/confirm/delete still work".
* `src/lib/mock/seedEntries.test.ts` — the seed store covers every kind, three ungrounded fields
  and two open issues.
* `src/content.test.ts` — scans the whole source tree: no browser storage, no analytics/CDN
  tokens, no non-loopback URLs, no advice/dose text, and the refusal string lives in one place.

## Known fixture issue (reported, not fixed here)

`fixtures/golden_engine.json` → `weekly_cases[0]` names the week Mon 2026-09-28 .. Sun
2026-10-04 but expects `{observation: 1, issue: 2, action: 1}`. The fixture's own entries inside
that week are `e1 09-28 observation`, `e2 09-30 issue`, `e4 10-01 issue`, `e3 10-02 action`,
`e5 10-03 observation` — hand-derived `{observation: 2, issue: 2, action: 1}` (total 5, not 4).
No interval convention explains the fixture: it counts `e3` on 10-02 and drops `e5` on 10-03,
both inside the stated week. The frontend tests assert the hand-derived numbers and record the
fixture's value side by side so the difference stays visible; the file is left untouched for its
owner to fix.

## Conventions this UI keeps

* The model extracts and routes; code computes dates and counts. `src/lib/engine.ts` is the
  frontend mirror of the pure-Python engine and is the only place that computes.
* Ungrounded fields are highlighted and never silently accepted.
* The refusal string is fixed in code (`src/lib/strings.ts`); the model only emits `refuse`.
* Synthetic data is labelled on every screen that shows it.
* English only.
