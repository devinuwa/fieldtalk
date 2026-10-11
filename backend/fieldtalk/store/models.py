"""Shared entry model for the store and the engine.

This is the single authoritative Entry/Quantity/DateExpr dataclass used by both layers.
The engine and the store do not each define their own — that is the source of the
circular-import fragility this project has hit twice. One definition, imported by both.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal

EntryKind = Literal["observation", "issue", "action", "plan", "measurement"]

ENTRY_KINDS: tuple[EntryKind, ...] = ("observation", "issue", "action", "plan", "measurement")
ENTRY_KINDS_STR: tuple[str, ...] = tuple(ENTRY_KINDS)


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
    # Raw model expressions, preserved for the UI / V1 trace panel.
    date_expr: DateExpr | None = None
    planting_expr: DateExpr | None = None
    # Source spans from V1 (nullable).
    plot_span: tuple[int, int] | None = None
    crop_span: tuple[int, int] | None = None
    quantity_span: tuple[int, int] | None = None
    ungrounded: tuple[str, ...] = ()


class StoreError(Exception):
    """The store could not satisfy a request."""
