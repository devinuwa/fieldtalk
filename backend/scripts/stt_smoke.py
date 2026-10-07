"""Transcribe one WAV with faster-whisper on this CPU and report the real numbers.

Usage (PowerShell or bash, from the repo root):

    backend/.venv/Scripts/python.exe backend/scripts/stt_smoke.py data/sample.wav
    backend/.venv/Scripts/python.exe backend/scripts/stt_smoke.py data/sample.wav --models base small

It prints, for each model: the transcript, the audio length, the wall-clock time and the
real-time factor (wall / audio). ``--json`` prints the same as JSON for the eval tooling.

Notes
* CPU only, ``int8`` (the machine has no GPU: AGENTS.md section 5).
* The first run downloads the model weights (network at setup only). Nothing is sent
  anywhere at run time.
* A real-time factor above 3.0 (the clip takes more than three times longer to transcribe
  than to speak) is reported as NOT USABLE, which is the pivot condition in PLAN.md.
* Model weights: Whisper, MIT per the OpenAI repository - confirm with THIRD_PARTY.md.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

DEFAULT_MODELS = ("base", "small")
DEFAULT_COMPUTE_TYPE = "int8"
RTF_LIMIT = 3.0


def transcribe(path: Path, model_name: str, compute_type: str) -> dict[str, Any]:
    """Load the model, transcribe the file, and return measurements only."""
    from faster_whisper import WhisperModel  # imported here so --help works without it

    load_started = time.perf_counter()
    model = WhisperModel(model_name, device="cpu", compute_type=compute_type)
    load_seconds = time.perf_counter() - load_started

    transcribe_started = time.perf_counter()
    segments, info = model.transcribe(str(path), language="en", beam_size=5, vad_filter=True)
    text_parts: list[str] = []
    segment_rows: list[dict[str, Any]] = []
    for segment in segments:
        text_parts.append(segment.text.strip())
        segment_rows.append(
            {"start": round(segment.start, 2), "end": round(segment.end, 2), "text": segment.text.strip()}
        )
    wall_seconds = time.perf_counter() - transcribe_started

    audio_seconds = float(info.duration)
    rtf = (wall_seconds / audio_seconds) if audio_seconds > 0 else None
    return {
        "model": model_name,
        "compute_type": compute_type,
        "device": "cpu",
        "audio_seconds": round(audio_seconds, 2),
        "load_seconds": round(load_seconds, 2),
        "wall_seconds": round(wall_seconds, 2),
        "rtf": round(rtf, 3) if rtf is not None else None,
        "usable": bool(rtf is not None and rtf <= RTF_LIMIT),
        "language": getattr(info, "language", None),
        "language_probability": round(float(getattr(info, "language_probability", 0.0)), 3),
        "segments": segment_rows,
        "transcript": " ".join(part for part in text_parts if part).strip(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("audio", type=Path, help="audio file to transcribe, e.g. data/sample.wav")
    parser.add_argument("--models", nargs="+", default=list(DEFAULT_MODELS), help="model names to try")
    parser.add_argument("--compute-type", default=DEFAULT_COMPUTE_TYPE, help="faster-whisper compute type")
    parser.add_argument("--json", action="store_true", help="print machine-readable output only")
    args = parser.parse_args(argv)

    if not args.audio.is_file():
        print(f"error: {args.audio} does not exist.", file=sys.stderr)
        print("       Record a clip of your own voice and save it there (data/ is gitignored).", file=sys.stderr)
        return 2

    try:
        import faster_whisper  # noqa: F401
    except ModuleNotFoundError:
        print("error: faster-whisper is not installed in this interpreter.", file=sys.stderr)
        print("       backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt", file=sys.stderr)
        return 2

    size_mb = args.audio.stat().st_size / (1024 * 1024)
    if not args.json:
        print(f"file: {args.audio} ({size_mb:.2f} MiB)")
        print(f"models: {', '.join(args.models)}  device: cpu  compute_type: {args.compute_type}\n")

    results: list[dict[str, Any]] = []
    for model_name in args.models:
        if not args.json:
            print(f"--- {model_name} ---")
        try:
            result = transcribe(args.audio, model_name, args.compute_type)
        except Exception as exc:  # report and keep going: the other model may still work
            results.append({"model": model_name, "error": f"{type(exc).__name__}: {exc}"})
            if not args.json:
                print(f"FAILED: {type(exc).__name__}: {exc}\n")
            continue

        results.append(result)
        if not args.json:
            print(f"transcript      : {result['transcript'] or '(empty)'}")
            print(f"audio seconds   : {result['audio_seconds']}")
            print(f"model load (s)  : {result['load_seconds']}")
            print(f"wall seconds    : {result['wall_seconds']}")
            print(f"real-time factor: {result['rtf']}")
            print(f"usable (RTF<={RTF_LIMIT}): {'yes' if result['usable'] else 'NO'}\n")

    usable = [result["model"] for result in results if result.get("usable")]
    if args.json:
        print(json.dumps({"file": str(args.audio), "rtf_limit": RTF_LIMIT, "results": results}, indent=2))
    else:
        print(f"usable models: {', '.join(usable) if usable else 'none'}")
        if not usable:
            print("=> STOP: no model on this CPU is fast enough (RTF above the limit).")

    # Exit code: 0 when at least one model is usable, 1 when none is, 2 for bad input.
    return 0 if usable else 1


if __name__ == "__main__":
    raise SystemExit(main())
