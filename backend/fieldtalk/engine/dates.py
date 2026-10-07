"""Date resolution and day counting. Standard library only.

The model never resolves a date and never does arithmetic (AGENTS.md rule 1). It emits
``date_expr`` / ``planting_date_expr``; this module turns those into calendar dates
against the recording date, and rejects anything invalid instead of guessing.
"""

from __future__ import annotations

from datetime import date, timedelta

from .models import DateExpr

ISO_FORMAT = "%Y-%m-%d"


def parse_iso(value: str) -> date:
    """Parse ``YYYY-MM-DD``. Raises ValueError on anything else, including bad days."""
    return date.fromisoformat(value)


def format_iso(value: date) -> str:
    return value.strftime(ISO_FORMAT)


def _valid_month_day(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def resolve_date(expr: DateExpr | None, recorded_on: date) -> date | None:
    """Resolve a date expression against the recording date.

    * ``None`` (the note stated no date) -> the recording date.
    * ``today`` -> the recording date.
    * ``days_ago`` with ``n`` -> ``n`` days before the recording date (``n`` must be a
      whole number and not negative).
    * ``month_day`` -> that month and day in the recording year, or in the previous year
      if it would fall in the future. Invalid calendar dates (31 April, 30 February) are
      rejected.

    Returns ``None`` when the expression cannot be resolved; the caller must show that
    entry as needing review rather than inventing a date.
    """
    if expr is None:
        return recorded_on

    if expr.kind == "today":
        return recorded_on

    if expr.kind == "days_ago":
        if expr.n is None or isinstance(expr.n, bool) or not isinstance(expr.n, int):
            return None
        if expr.n < 0:
            return None
        return recorded_on - timedelta(days=expr.n)

    if expr.kind == "month_day":
        if expr.month is None or expr.day is None:
            return None
        for year in (recorded_on.year, recorded_on.year - 1):
            candidate = _valid_month_day(year, expr.month, expr.day)
            if candidate is None:
                # Not a date in this year (29 February outside a leap year): try the
                # previous year before giving up.
                continue
            if candidate <= recorded_on:
                return candidate
        # 31 April, 30 February and friends are not dates in any year.
        return None

    return None


def days_since(planting: date, on: date) -> int:
    """Whole days from planting to ``on``; 0 on the planting day, negative if future."""
    return (on - planting).days


def week_bounds(as_of: date) -> tuple[date, date]:
    """The Monday-to-Sunday week containing ``as_of`` as a half-open pair.

    Returns ``(monday, next_monday)``; the second value is exclusive, which keeps the
    counting code simple and unambiguous.
    """
    monday = as_of - timedelta(days=as_of.weekday())
    return monday, monday + timedelta(days=7)
