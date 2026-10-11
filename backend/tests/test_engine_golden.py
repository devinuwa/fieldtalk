"""Golden cases from ``fixtures/golden_engine.json`` (synthetic, hand-checkable).

The fixture is the specification for the engine. It is read here and never written, and
no expected value in it is ever adjusted to make a test pass (AGENTS.md section 6).
Case counts are asserted first so a shrunken fixture cannot make the suite pass
vacuously, and every parametrized case is asserted individually.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from fieldtalk.engine import (
    ENTRY_KINDS_STR,
    Entry,
    days_since,
    days_since_last_note,
    open_issues,
    weekly_summary,
    week_bounds,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = REPO_ROOT / "fixtures" / "golden_engine.json"

RAW = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _entry(id: str, plot: str, kind: str, date_str: str) -> Entry:
    return Entry(id=id, plot=plot, crop=None, kind=kind, date=date.fromisoformat(date_str), text=f"{id} text", planting_date=None, quantity=None)


ENTRIES: list[Entry] = [_entry(row["id"], row["plot"], row["kind"], row["date"]) for row in RAW["entries"]]


def test_fixture_is_the_expected_shape() -> None:
    raw = RAW
    assert raw["synthetic"] is True, "fixtures must be labelled synthetic"
    assert len(raw["entries"]) == 5
    assert len(raw["days_since_cases"]) == 5
    assert len(raw["last_note_cases"]) == 3
    assert len(raw["open_issue_cases"]) == 2
    assert len(raw["weekly_cases"]) == 1
    assert len(ENTRIES) == 5
    assert all(entry.id and entry.plot for entry in ENTRIES)


def test_days_since_cases() -> None:
    cases = RAW["days_since_cases"]
    assert len(cases) == 5
    for i, c in enumerate(cases):
        expected = c["expected"]
        planting = date.fromisoformat(c["planting"])
        on = date.fromisoformat(c["on"])
        actual = days_since(planting, on)
        assert actual == expected, f"case {i+1}: days_since({c['planting']}, {c['on']}) == {expected}, got {actual}"


def test_last_note_cases() -> None:
    cases = RAW["last_note_cases"]
    assert len(cases) == 3
    for i, c in enumerate(cases):
        plot = c["plot"]
        as_of = date.fromisoformat(c["as_of"])
        expected = c["expected"]
        actual = days_since_last_note(ENTRIES, plot, as_of)
        assert actual == expected, f"case {i+1}: days_since_last_note({plot}, {c['as_of']}) == {expected}, got {actual}"


def test_open_issue_cases() -> None:
    cases = RAW["open_issue_cases"]
    assert len(cases) == 2
    for i, c in enumerate(cases):
        plot = c["plot"]
        expected = c["expected"]
        actual = sorted(e.id for e in open_issues(ENTRIES, plot))
        assert actual == sorted(expected), f"case {i+1}: open_issues({plot}) expected {sorted(expected)}, got {actual}"


def test_weekly_case() -> None:
    cases = RAW["weekly_cases"]
    assert len(cases) == 1
    c = cases[0]
    assert "week_start" in c and "week_end" in c
    monday = date.fromisoformat(c["week_start"])
    sunday = date.fromisoformat(c["week_end"])
    expected_counts = c["expected_counts"]

    ws = weekly_summary(ENTRIES, monday)
    _m, _nm = week_bounds(monday)
    in_window = [e for e in ENTRIES if _m <= e.date < _nm]
    counts_by_kind = {k: sum(1 for e in in_window if e.kind == k) for k in ENTRY_KINDS_STR}
    assert ws.counts_by_kind == counts_by_kind, f"ws.counts_by_kind {ws.counts_by_kind} != derived {counts_by_kind}"
    assert sum(counts_by_kind.values()) == ws.total_entries
    assert ws.total_entries == len(in_window)
    expected_plots = sorted({e.plot for e in in_window})
    actual_plots = sorted(p.plot for p in ws.plots_touched)
    assert actual_plots == expected_plots
    expected_opened = sorted(e.id for e in in_window if e.kind == "issue")
    assert sorted(i.id for i in ws.issues_opened) == expected_opened
    # all-time open issues: e4 is open (no action after), e2 has action after -> closed
    assert [i.id for i in ws.open_issues] == ["e4"]

    # reported weekly counts: derived from the engine and compared to the fixture
    fixture_counts = c["expected_counts"]
    derived_counts = {k: counts_by_kind[k] for k in fixture_counts.keys()}
    assert derived_counts == fixture_counts, f"derived {derived_counts} != fixture {fixture_counts}"

def test_open_issues_all_plots() -> None:
    open_all = open_issues(ENTRIES, None)
    ids_all = sorted(e.id for e in open_all)
    all_expected: list[str] = []
    for c in RAW["open_issue_cases"]:
        all_expected.extend(c["expected"])
    assert ids_all == sorted(all_expected)
    assert len(open_all) == len(all_expected)
