"""Data model for the deterministic engine.

Standard library only (AGENTS.md section 3). Nothing in this package imports a
third-party module; ``tests/test_engine_purity.py`` enforces that.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Literal

# The closed set of entry kinds. The model may only emit one of these.
EntryKind = Literal["observation", "issue", "action", "plan", "measurement"]

ENTRY_KINDS: tuple[EntryKind, ...] = (
    "observation",
    "issue",
    "action",
    "plan",
    "measurement",
)

# The date expressions the model is allowed to emit (PLAN.md entry schema).
DateExprKind = Literal["today", "days_ago", "month_day"]


@dataclass(frozen=True)
class Quantity:
    """A number the user spoke, with the unit they used."""

    value: float
    unit: str


@dataclass(frozen=True)
class DateExpr:
    """What the model emitted for a date: never a resolved calendar date."""

    kind: DateExprKind
    n: int | None = None
    month: int | None = None
    day: int | None = None


@dataclass(frozen=True)
class Entry:
    """A stored entry, with its dates already resolved in code."""

    id: str
    plot: str | None
    kind: EntryKind
    date: date
    crop: str | None = None
    text: str = ""
    planting_date: date | None = None
    quantity: Quantity | None = None


@dataclass(frozen=True)
class IssueRef:
    """An issue as the weekly report and the tools report it."""

    id: str
    plot: str
    text: str
    date: date


@dataclass(frozen=True)
class PlotTouch:
    plot: str
    entries: int
    kinds: tuple[EntryKind, ...]
    latest_date: date


@dataclass(frozen=True)
class PlotRecency:
    plot: str
    date: date
    days_since: int


@dataclass(frozen=True)
class WeeklySummary:
    """Everything the printable weekly report shows, computed from entries."""

    week_start: date
    week_end: date
    counts_by_kind: dict[EntryKind, int] = field(default_factory=dict)
    total_entries: int = 0
    plots_touched: tuple[PlotTouch, ...] = ()
    issues_opened: tuple[IssueRef, ...] = ()
    issues_closed: tuple[IssueRef, ...] = ()
    open_issues: tuple[IssueRef, ...] = ()
    last_note_by_plot: tuple[PlotRecency, ...] = ()
