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
    Entry,
    days_since,
    days_since_last_note,
    open_issues,
    weekly_summary,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = REPO_ROOT / "fixtures" / "golden_engine.json"
GOLDEN = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _entry(row: dict) -> Entry:
    return Entry(
        id=row["id"],
        plot=row["plot"],
        kind=row["kind"],
        date=date.fromisoformat(row["date"]),
        text=f"{row['id']} text",
    )


ENTRIES: list[Entry] = [_entry(row) for row in GOLDEN["entries"]]


def test_fixture_is_the_expected_shape() -> None:
    assert GOLDEN["synthetic"] is True, "fixtures must be labelled synthetic"
    assert len(GOLDEN["entries"]) == 5
    assert len(GOLDEN["days_since_cases"]) == 5
    assert len(GOLDEN["last_note_cases"]) == 3
    assert len(GOLDEN["open_issue_cases"]) == 2
    assert len(GOLDEN["weekly_cases"]) == 1
    # No vacuous passes: the parsed inputs must be non-empty too.
    assert len(ENTRIES) == 5
    assert all(entry.id and entry.plot for entry in ENTRIES)


def test_fixture_states_the_week_it_means() -> None:
    case = GOLDEN["weekly_cases"][0]
    start = date.fromisoformat(case["week_start"])
    end = date.fromisoformat(case["week_end"])
    # 2026-09-28 is a Monday and 2026-10-04 a Sunday: the fixture names a whole week.
    assert start.weekday() == 0
    assert end.weekday() == 6
    assert (end - start).days == 6


@pytest.mark.parametrize(
    "case",
    GOLDEN["days_since_cases"],
    ids=lambda case: f"{case['planting']}->{case['on']}",
)
def test_days_since_planting_matches_golden(case: dict) -> None:
    assert days_since(
        date.fromisoformat(case["planting"]), date.fromisoformat(case["on"])
    ) == case["expected"]


@pytest.mark.parametrize(
    "case",
    GOLDEN["last_note_cases"],
    ids=lambda case: f"{case['plot']}@{case['as_of']}",
)
def test_days_since_last_note_matches_golden(case: dict) -> None:
    assert (
        days_since_last_note(ENTRIES, case["plot"], date.fromisoformat(case["as_of"]))
        == case["expected"]
    )


@pytest.mark.parametrize("case", GOLDEN["open_issue_cases"], ids=lambda case: case["plot"])
def test_open_issues_match_golden(case: dict) -> None:
    assert [entry.id for entry in open_issues(ENTRIES, case["plot"])] == case["expected"]


def test_weekly_counts_match_the_hand_derivation() -> None:
    """The week named by the fixture, counted by hand from the fixture's own entries.

    e1 2026-09-28 observation, e2 2026-09-30 issue, e4 2026-10-01 issue,
    e3 2026-10-02 action, e5 2026-10-03 observation  ->  5 entries:
    observation 2, issue 2, action 1, plan 0, measurement 0.

    Both readings of the window give the same result, because the only entry near the end
    is e5 on Saturday 2026-10-03: inclusive [09-28 .. 10-04] and half-open
    [09-28 .. 10-04) both contain it. See the test below for the fixture's differing
    expectation, which is reported rather than edited.
    """
    case = GOLDEN["weekly_cases"][0]
    start = date.fromisoformat(case["week_start"])
    end = date.fromisoformat(case["week_end"])

    summary = weekly_summary(ENTRIES, end, week_start=start, week_end=end)

    assert summary.counts_by_kind == {
        "observation": 2,
        "issue": 2,
        "action": 1,
        "plan": 0,
        "measurement": 0,
    }
    assert summary.total_entries == 5
    assert [touch.plot for touch in summary.plots_touched] == ["plot 1", "plot 2"]
    assert [touch.entries for touch in summary.plots_touched] == [2, 3]
    assert [issue.id for issue in summary.issues_opened] == ["e2", "e4"]
    assert [issue.id for issue in summary.issues_closed] == ["e2"]
    assert [issue.id for issue in summary.open_issues] == ["e4"]


def test_fixture_weekly_case_disagrees_with_its_own_entries() -> None:
    """KNOWN FIXTURE DISAGREEMENT - recorded here, not worked around.

    ``weekly_cases[0].expected_counts`` says observation 1 / issue 2 / action 1 (total 4),
    but the entries the same fixture gives for that week contain two observations: e1 on
    2026-09-28 and e5 on 2026-10-03. The hand-derived counts for the stated week are
    observation 2 / issue 2 / action 1 (total 5).

    No window convention can reconcile this: e5 on Saturday 10-03 is inside the week
    2026-09-28 .. 2026-10-04 whether the end day is treated as inclusive or exclusive.

    The engine implements the hand derivation (see the test above). This test fails the
    moment somebody corrects the fixture, so the correction cannot go unnoticed, and the
    fixture itself is left untouched for its owner to fix (AGENTS.md section 6).
    """
    expected = GOLDEN["weekly_cases"][0]["expected_counts"]
    derived = {"observation": 2, "issue": 2, "action": 1}

    assert expected == {"observation": 1, "issue": 2, "action": 1}
    assert derived["observation"] != expected["observation"], "fixture now agrees; retire this note"
    assert sum(expected.values()) == 4
    assert sum(derived.values()) == 5
