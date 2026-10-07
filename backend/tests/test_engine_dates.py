"""Date resolution, derived by hand from PLAN.md's rule:

    ``days_ago``: today minus n. ``month_day``: that month/day in the current year, or
    the previous year if it would be in the future. Invalid dates rejected.

Every expectation below is written out from that rule, not read back from the code.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from fieldtalk.engine import DateExpr, days_since, parse_iso, resolve_date, week_bounds

RECORDED = date(2026, 10, 7)  # a Wednesday


@pytest.mark.parametrize(
    ("expr", "expected", "why"),
    [
        (None, date(2026, 10, 7), "no date in the note -> the recording date"),
        (DateExpr("today"), date(2026, 10, 7), '"today" -> the recording date'),
        (DateExpr("days_ago", n=0), date(2026, 10, 7), "0 days ago -> today"),
        (DateExpr("days_ago", n=1), date(2026, 10, 6), "1 day ago"),
        (DateExpr("days_ago", n=2), date(2026, 10, 5), "2 days ago"),
        (DateExpr("days_ago", n=30), date(2026, 9, 7), "30 days ago crosses a month"),
        (DateExpr("days_ago", n=-1), None, "negative days_ago is rejected"),
        (DateExpr("days_ago", n=None), None, "days_ago without n is rejected"),
        (DateExpr("month_day", month=7, day=10), date(2026, 7, 10), "10 July is in the past this year"),
        (DateExpr("month_day", month=10, day=7), date(2026, 10, 7), "same day counts as this year"),
        (DateExpr("month_day", month=12, day=25), date(2025, 12, 25), "25 Dec would be future -> previous year"),
        (DateExpr("month_day", month=11, day=1), date(2025, 11, 1), "1 Nov would be future -> previous year"),
        (DateExpr("month_day", month=1, day=1), date(2026, 1, 1), "1 Jan this year"),
        (DateExpr("month_day", month=4, day=31), None, "31 April is not a date in any year"),
        (DateExpr("month_day", month=2, day=30), None, "30 February is not a date in any year"),
        (DateExpr("month_day", month=None, day=10), None, "month_day without a month is rejected"),
    ],
)
def test_resolve_date(expr: DateExpr | None, expected: date | None, why: str) -> None:
    assert resolve_date(expr, RECORDED) == expected, why


def test_resolve_date_accepts_29_february_only_in_a_leap_year() -> None:
    # 2028 is a leap year; 2027 and 2026 are not.
    assert resolve_date(DateExpr("month_day", month=2, day=29), date(2028, 3, 1)) == date(2028, 2, 29)
    assert resolve_date(DateExpr("month_day", month=2, day=29), date(2027, 3, 1)) is None


@pytest.mark.parametrize(
    ("planting", "on", "expected"),
    [
        ("2026-07-10", "2026-10-07", 89),
        ("2026-10-07", "2026-10-07", 0),
        ("2026-10-06", "2026-10-07", 1),
        ("2026-01-01", "2027-01-01", 365),
    ],
)
def test_days_since(planting: str, on: str, expected: int) -> None:
    assert days_since(parse_iso(planting), parse_iso(on)) == expected


@pytest.mark.parametrize(
    ("as_of", "expected_start", "expected_end"),
    [
        ("2026-10-07", "2026-10-05", "2026-10-12"),  # Wednesday -> that Monday
        ("2026-10-05", "2026-10-05", "2026-10-12"),  # Monday -> itself
        ("2026-10-11", "2026-10-05", "2026-10-12"),  # Sunday -> the same week
        ("2026-09-28", "2026-09-28", "2026-10-05"),  # the fixture's week starts on a Monday
    ],
)
def test_week_bounds(as_of: str, expected_start: str, expected_end: str) -> None:
    start, end = week_bounds(parse_iso(as_of))
    assert start == parse_iso(expected_start)
    assert end == parse_iso(expected_end)
    assert start.weekday() == 0 and end.weekday() == 0
    assert (end - start) == timedelta(days=7)
