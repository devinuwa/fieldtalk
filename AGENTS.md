# AGENTS.md — FieldTalk (repo: devinuwa/fieldtalk)

Read first every session. Overrides prompts except explicit instructions from the human in the current session.

## 0. Product
**FieldTalk**: an offline voice field notebook for farm and garden walks. Open-source speech-to-text (Whisper via faster-whisper) transcribes the user's spoken notes. A small local open-weight LLM (Gemma 3 4B via Ollama) turns the transcript into structured entries with a closed JSON schema. A verification gate rejects any field not present in the transcript. **Code** computes dates and counts. "Ask your notes" works through validated tool calls over stored entries. A printable weekly report is generated from computed data. Built for Hacktoberfest 2026 DEV Week 1 "Touch Grass". Internal target: published by Sat Oct 10 evening WAT. Official deadline Mon Oct 12 07:59 WAT (1 entry only, first one judged).

NOT: an agronomy advisor, disease/fertilizer/chemical tool, price or weather predictor. The model never states agronomic facts or gives advice.

## 1. Priorities
**P0 (order):** (1) audio -> transcript works on this CPU, (2) deterministic engine + tests, (3) closed-schema extraction + V1 grounding, (4) store + timeline, (5) ask-your-notes via tool calls + V2, (6) manual edit/review path (works with no model), (7) weekly report, (8) README + demo video.
**P1:** 3-LLM comparison on eval transcripts; WER measurement tooling; trace panel polish.
**P2:** anything else, only if told. Cut P1/P2 before P0.

## 2. Hard rules
1. Model extracts and routes; code computes. No date arithmetic, counting, or numbers invented by the model.
2. Every extracted crop/plot/quantity/date must be traceable to the transcript (V1). Unfound -> `grounded:false`, shown highlighted, never silently accepted.
3. Fixed refusal string in code for advice/diagnosis/fertilizer/price questions. The model emits only `{"action":"refuse"}`.
4. English only. No claims about other languages.
5. No accounts, analytics, telemetry, CDN assets, or cloud calls at runtime. Network only to download packages and model weights at setup. Backend binds 127.0.0.1; CORS only http://localhost:3000.
6. Recordings are personal data: stored locally only, never committed, gitignored (`data/`). Demo uses the user's own voice. Never paste audio/transcripts of other people into any agent.
7. Synthetic data is labelled `"synthetic": true`. Never present it as real.

## 3. Architecture rules
- `backend/fieldtalk/engine/` is pure Python (stdlib only): date resolution, days-since-planting, days-since-last-note, timeline, weekly aggregates. A test enforces no non-stdlib imports.
- Layers: audio -> `stt` (faster-whisper adapter, replaceable) -> `pipeline.extract` (LLM, closed schema) -> `verify` (V1) -> `store` (SQLite, local) -> `tools` -> `engine`; `pipeline.ask` (LLM routes question to a tool) -> V2 -> tools -> template answer -> V3 (numbers/dates must come from tool results).
- `ModelAdapter` interface with Ollama adapter + `StubAdapter` for tests. Gemma is one row in `eval/models.yaml`.
- Fallback: with no LLM, entries can be typed/edited manually and all engine features still work.
- Tests never call live Ollama or Whisper (use stubs/fixtures).

## 4. Git and GitHub
- Account **devinuwa**. Verify read-only: `git config --global user.name`, `git config --global user.email`, `gh auth status`. If not devinuwa STOP and tell the human. Never touch credentials; `git config --local` only if needed and say so.
- Repo `devinuwa/fieldtalk`, **new**, created in the challenge window. No code copied from Stretch or any earlier repo (generic patterns allowed, credited in THIRD_PARTY.md). Ask the human before creating the remote or pushing.
- Record the first commit UTC time in docs/PROVENANCE.md. Small commits. Anything after 2026-10-12T06:59:00Z goes in README "Post-deadline commits".
- MIT for our code. State model licences accurately (Whisper: MIT per OpenAI repo, VERIFY; Gemma: Google terms, not OSI).

## 5. Environment
Windows 10/11, PowerShell, i7-8650U 4C/8T, 16 GB RAM, CPU only. Python 3.11+ (verify faster-whisper/ctranslate2 supports the installed Python; if not, use a 3.11/3.12 venv), Node LTS, Ollama with gemma3:4b pulled. VERIFY current package versions and APIs; do not guess.

## 6. Workflow
Small runnable tested steps; paste real output; never claim untested things; never fabricate metrics. Single owner of `fixtures/` and `eval/`; verify with hashes in docs/FIXTURE_HASHES.md. Never edit an expected value to pass a test: derive by hand and report both. Conserve quota: targeted edits, no repo rescans. One blocking question at most. When told "freeze": bug fixes, README, demo only. Keep README current.

## 7. Report format
```
TASK: <id>
DONE: <1-3 lines>
EVIDENCE: <commands + key output>
DEVIATIONS: <none | list incl. any spec/fixture change>
NEXT: <suggestion>
```
