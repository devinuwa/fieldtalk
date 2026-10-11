"""Setup step: download one faster-whisper model into the local cache, once.

This is the *only* place FieldTalk downloads speech weights, and it is never called
during a recording: the API loads models with ``local_files_only=True`` (AGENTS.md:
network at setup only).

Run from the repository root:

    backend/.venv/Scripts/python.exe backend/scripts/stt_download.py base
    backend/.venv/Scripts/python.exe backend/scripts/stt_download.py small --json

It prints where the weights landed and how big they are, then re-checks the cache with
``fieldtalk.stt.model_cached`` so the result is the same answer ``GET /api/health`` gives.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fieldtalk.stt import (  # noqa: E402
    DEFAULT_MODEL_NAME,
    model_cached,
    model_hub_dir,
)


def _dir_size_bytes(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("model", nargs="?", default=DEFAULT_MODEL_NAME, help="faster-whisper model name")
    parser.add_argument("--json", action="store_true", help="machine-readable output only")
    args = parser.parse_args(argv)

    try:
        from faster_whisper.utils import download_model
    except ModuleNotFoundError:
        print("error: faster-whisper is not installed in this interpreter.", file=sys.stderr)
        print("       backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt", file=sys.stderr)
        return 2

    if model_cached(args.model):
        if not args.json:
            print(f"{args.model}: already in the local cache ({model_hub_dir()}). Nothing to download.")
        return 0

    if not args.json:
        print(f"downloading {args.model} into {model_hub_dir()} (this happens once)…")
    try:
        path = Path(download_model(args.model))
    except Exception as exc:  # network down, unknown model, disk full
        print(f"error: could not download {args.model}: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    cached = model_cached(args.model)
    size_mb = _dir_size_bytes(path) / (1024 * 1024)
    if args.json:
        print(json.dumps({"model": args.model, "path": str(path), "size_mb": round(size_mb, 1), "cached": cached}))
    else:
        print(f"downloaded to {path} ({size_mb:.1f} MiB)")
        print(f"model_cached('{args.model}') -> {cached}")
        if not cached:
            print("warning: the cache check does not see the weights; GET /api/health will report stt=unavailable.")
    return 0 if cached else 1


if __name__ == "__main__":
    raise SystemExit(main())
