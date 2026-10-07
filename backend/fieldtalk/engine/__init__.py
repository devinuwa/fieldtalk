"""FieldTalk's deterministic engine: pure Python, standard library only.

The model extracts and routes; this package computes. Dates are resolved here, counts
and timelines are built here, and nothing in it imports a third-party module
(AGENTS.md section 3, enforced by ``tests/test_engine_purity.py``).
"""

from .aggregate import (
    days_since_last_note,
    known_plots,
    normalize_plot,
    open_issues,
    plot_timeline,
    weekly_summary,
)
from .dates import days_since, format_iso, parse_iso, resolve_date, week_bounds
from .models import (
    ENTRY_KINDS,
    DateExpr,
    Entry,
    EntryKind,
    IssueRef,
    PlotRecency,
    PlotTouch,
    Quantity,
    WeeklySummary,
)

__all__ = [
    "ENTRY_KINDS",
    "DateExpr",
    "Entry",
    "EntryKind",
    "IssueRef",
    "PlotRecency",
    "PlotTouch",
    "Quantity",
    "WeeklySummary",
    "days_since",
    "days_since_last_note",
    "format_iso",
    "known_plots",
    "normalize_plot",
    "open_issues",
    "parse_iso",
    "plot_timeline",
    "resolve_date",
    "week_bounds",
    "weekly_summary",
]
