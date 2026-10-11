# PROVENANCE — FieldTalk

## First commit

| Field | Value |
|---|---|
| Commit | `60629e26410c09d5b5e473c63c881ecae505c336` |
| **Committer date (UTC)** | **2026-10-07T16:14:34Z** (17:14:34 local, +01:00) |
| Author | `devinuwa <inuwamuhammad930@gmail.com>` |
| Branch | `main` |
| Files | 77 |
| Remote | `https://github.com/devinuwa/fieldtalk` (`main` pushed 2026-10-11) |

The repository was created inside the challenge window for Hacktoberfest 2026, DEV Week 1
"Touch Grass". Per AGENTS.md section 4, commits made after **2026-10-12T06:59:00Z** are
listed in the README under "Post-deadline commits".

## How this repo was built

Each step used the prompt for it in `docs/PROMPTS.md`; the working rules are in
`AGENTS.md`. So far:

1. **A0 (scaffold, engine)** — repo layout, `.gitignore`, MIT licence, README, third-party
   inventory, fixture hashes, `backend/fieldtalk/engine` (pure standard library), the
   FastAPI skeleton, the STT smoke script, and the pytest suite (golden cases, purity,
   date resolution, API stub).
2. **F0 (UI against fixtures)** — the `frontend/` static app and its mock layer, built
   from `fixtures/` and `eval/transcripts.jsonl` because the backend pipeline does not
   exist yet. It never edits `backend/` or `fixtures/`.

No code was copied from any earlier repository of ours or from anyone else's project;
generic framework patterns were written here. Third-party components and their licences,
including the two that still need verification, are listed in `THIRD_PARTY.md`.

## Commit identity (recorded because it is not the machine default)

* The machine's **global** git identity is `shadowboy-tech <inuwamuhammad930@gmail.com>`
  and the GitHub CLI is authenticated with two accounts: **devinuwa** (active) and
  shadowboy-tech.
* T0 of the task requires the identity to be **devinuwa**. Changing global config or
  credentials is not allowed, so this repository sets it **locally only**:

  ```
  git config --local user.name  devinuwa
  git config --local user.email inuwamuhammad930@gmail.com
  ```

  The human authorized this for this repo. The global config was not touched.
* `gh api user` does not expose an email for devinuwa (privacy setting), so the commit
  email is the one already configured on this machine. If that address is not attached to
  the devinuwa account, the commit will not be attributed to it on GitHub and the author
  email has to be amended before publication.
* No collaborator was added to the repository. The intended public remote was created after
  explicit human authorization, configured as `origin`, and pushed to `main`. The GitHub token
  was only used for the repository creation and push; credentials were not modified.

## Environment measured while building this

| Item | Value |
|---|---|
| OS / shell | Windows 10/11, Git Bash (POSIX syntax), PowerShell for the README steps |
| CPU | i7-8650U, 4 cores / 8 threads, **CPU only** — no GPU |
| `python` on PATH | 3.13.13, and it has **no `venv` module** (`import venv` fails) |
| Interpreter used | Python **3.11.1** via `py -3.11` -> `backend/.venv` |
| Why 3.11 | the 3.13 install cannot create virtual environments here; 3.11 is supported by both binary dependencies |
| Dependency support check | PyPI metadata: `ctranslate2` 4.8.2 and `onnxruntime` 1.30.0 both publish **cp311** wheels; `pip install --dry-run faster-whisper==1.2.1` resolved 17 packages cleanly on 3.11.1 |
| Installed | pytest 9.1.1, fastapi 0.142.2, uvicorn 0.54.0 |
| Deferred | `faster-whisper` 1.2.1 itself: not installed yet (the first run also downloads model weights). T1 has no `data/sample.wav` yet. |

## Fixtures

`fixtures/` and `eval/` are synthetic and are recorded by sha256 in
`docs/FIXTURE_HASHES.md`, together with one known inconsistency in
`fixtures/golden_engine.json` (`weekly_cases[0]`) that is reported there and in the test
suite rather than quietly edited.
