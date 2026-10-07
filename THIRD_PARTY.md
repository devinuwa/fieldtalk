# THIRD_PARTY — FieldTalk

Our own code is MIT (see `LICENSE`). Everything else we use is listed here. Licences
are stated as they appear on the upstream project; entries marked **VERIFY** have not
been confirmed against the upstream text yet and must be before publication.

## Speech to text

| Component | Role | Licence | Status |
|---|---|---|---|
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 1.2.1 | Whisper inference (CTranslate2) | MIT | from package metadata; VERIFY upstream text |
| [CTranslate2](https://github.com/OpenNMT/CTranslate2) 4.8.2 | CPU inference runtime | MIT | from package metadata; VERIFY upstream text |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) 1.30.0 | VAD / runtime dependency | MIT | from package metadata; VERIFY upstream text |
| OpenAI Whisper model weights (`base`, `small`) | Speech model | MIT per the OpenAI Whisper repository | **VERIFY** — confirm the licence file shipped with the weights before publication |

## The local model

| Component | Role | Licence | Status |
|---|---|---|---|
| Gemma 3 4B (`gemma3:4b` via Ollama) | Turns a transcript into structured entries and routes questions to tools | Google Gemma Terms of Use — **not** an OSI-approved licence | VERIFY the current terms text before publication |

FieldTalk does not redistribute model weights. Setup pulls them on the user's machine.

## Backend and tooling

| Component | Role | Licence |
|---|---|---|
| [FastAPI](https://github.com/fastapi/fastapi) 0.142.2 | HTTP API | MIT |
| [Uvicorn](https://github.com/encode/uvicorn) 0.54.0 | ASGI server (loopback) | BSD-3-Clause |
| [pytest](https://github.com/pytest-dev/pytest) 9.1.1 | Tests | MIT |
| Python 3.11 (standard library) | Everything in `backend/fieldtalk/engine` | PSF-2.0 |

## Frontend

| Component | Role | Licence |
|---|---|---|
| [Next.js](https://github.com/vercel/next.js) 16.4.0 | Static UI | MIT |
| [React](https://github.com/facebook/react) 19.3.0 | UI runtime | MIT |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) 4.3.3 | Styling | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) 5.0.3 | UI tests | MIT |
| [cross-env](https://github.com/kentcdodds/cross-env) 10.1.0 | Setting `NEXT_TELEMETRY_DISABLED` in npm scripts | MIT |

## Credits

* No code was copied from any earlier repository of ours or from another team's project.
  Generic patterns (FastAPI app layout, pytest fixtures, Next.js App Router structure)
  were written here.
* The Whisper quality claim follows the faster-whisper project's own documentation; we
  report only measurements taken on our machine (see `eval/`).

## Verified by measurement, not by claim

Real-time factor, word error rate and extraction accuracy numbers, when we publish them,
come from runs on this machine (i7-8650U, CPU only) and the commands that produced them
are recorded in the README and `eval/`. Nothing in this file is a performance claim.
