"""Engine data model. Standard library only (AGENTS.md section 3)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Literal, Tuple

ENTRY_KINDS: Tuple[str, ...] = ("observation", "issue", "action", "plan", "measurement")
ENTRY_KINDS_STR: Tuple[str, ...] = tuple(ENTRY_KINDS)
EntryKind = Literal["observation", "issue", "action", "plan", "measurement"]


@dataclass(frozen=True)
class Quantity:
    value: float
    unit: str


@dataclass(frozen=True)
class DateExpr:
    kind: Literal["today", "days_ago", "month_day", None] = None
    n: int | None = None
    month: int | None = None
    day: int | None = None


@dataclass(frozen=True)
class Entry:
    id: str
    plot: str | None
    crop: str | None
    kind: EntryKind
    date: date
    text: str = ""
    planting_date: date | None = None
    quantity: Quantity | None = None


@dataclass(frozen=True)
class IssueRef:
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
    counts_by_kind: dict[EntryKind, int] = field(default_factory=lambda: {k: 0 for k in ENTRY_KINDS})
    total_entries: int = 0
    plots_touched: tuple[PlotTouch, ...] = ()
    issues_opened: tuple[IssueRef, ...] = ()
    issues_closed: tuple[IssueRef, ...] = ()
    open_issues: tuple[IssueRef, ...] = ()
    last_note_by_plot: tuple[PlotRecency, ...] = ()
