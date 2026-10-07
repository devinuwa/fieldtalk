# PROMPTS — FieldTalk

New empty folder `fieldtalk`: AGENTS.md at root, PLAN.md and PROMPTS.md in docs/, fixtures/ and eval/ as given. Never paste real recordings or transcripts of other people into an agent.

## A0 (Antigravity): scaffold + STT smoke + engine + tests
```
You are the implementation agent for FieldTalk. Read AGENTS.md and docs/PLAN.md, obey them. Windows + PowerShell, CPU only.
T0: READ-ONLY GitHub identity check (git config --global user.name/user.email, gh auth status): must be devinuwa, else STOP. Do not change global config or credentials.
Scaffold NEW repo: backend/ (FastAPI, Python venv; verify faster-whisper supports the installed Python, else use a 3.11/3.12 venv), frontend/ (empty, another agent builds it),
docs/, fixtures/, eval/, data/ (gitignored). .gitignore: .venv, node_modules, data/, .env, *.log, *.wav/*.m4a/*.mp3 outside fixtures. MIT LICENSE, README stub, THIRD_PARTY.md,
docs/PROVENANCE.md with the first commit UTC time. git init, first commit. Do not create the remote or push.
T1 STT smoke: backend/scripts/stt_smoke.py transcribes a WAV I provide at data/sample.wav with faster-whisper models "base" and "small" (CPU, int8), printing transcript, audio seconds,
wall seconds, real-time factor. Report numbers. If neither is usable (RTF above ~3), STOP and tell me.
T2 engine: backend/fieldtalk/engine per docs/PLAN.md (stdlib only) + pytest golden tests from fixtures/golden_engine.json with count assertions (no vacuous passes) + purity test.
If a golden case disagrees, derive by hand, show both numbers, do not edit the fixture. Run pytest and paste the full summary. Report in AGENTS.md section 7 format.
```

## F0 (Freebuff): UI against fixtures (start together with A0)
Give it AGENTS.md, docs/PLAN.md (entry schema + tools), fixtures/. It must not touch backend/ or fixtures/.
```
Build the FieldTalk UI in frontend/ (Next.js static app is fine, TypeScript, Tailwind; no CDN/fonts/analytics; NEXT_TELEMETRY_DISABLED=1; no localStorage for notes). Read AGENTS.md and docs/PLAN.md first.
Backend does not exist yet: build a typed client and a MOCK layer (NEXT_PUBLIC_MOCK=1) serving files from fixtures/. Screens, mobile-first, large text: (1) Record/Upload (MediaRecorder + file upload, shows
transcript when returned); (2) Entries list grouped by plot with kind badges, each field editable, ungrounded fields highlighted, confirm/delete; (3) Ask box with a 5-step ribbon driven by real staged responses
(interpret -> tool call -> validate -> engine -> verified answer) and a collapsible trace panel; (4) Weekly report page that prints cleanly on paper (print CSS); (5) banner when the model is unavailable: manual add/edit still works.
Never edit backend/ or fixtures/. No advice or agronomy text anywhere. Report in AGENTS.md section 7 format with `npm run build` output.
```

## A1 (Antigravity): extraction (after G1)
```
Read docs/PLAN.md. Implement the Ollama adapter (VERIFY the current structured-output `format` API on the installed version), StubAdapter, the closed entry schema above, a compact prompt in
backend/fieldtalk/pipeline/prompts/ (the model copies phrases, never calculates or resolves dates; unknown -> null; advice/diagnosis -> action refuse; vague -> clarify), V1 grounding (every crop/plot/quantity must be found
in the transcript after normalization; set source span), date resolution in code. Few-shot examples must not appear in eval/transcripts.jsonl (add a test). Run 4 eval transcripts (T01, T05, X01, X02) on gemma3:4b and paste raw outputs,
parsed results, PASS/FAIL vs gold, timings, including failures. If T01 fails after one schema/prompt fix, stop and show raw outputs.
```

## A2: ask-your-notes + V2/V3 + weekly report; A3: README, offline/fresh-clone verification, eval runner
Same style: read the relevant PLAN.md section, implement, run tests, paste output, no unrequested features, report in section 7 format.
