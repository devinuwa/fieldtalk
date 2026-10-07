"""Timelines, open issues and weekly aggregates. Standard library only.

Every number FieldTalk shows is produced here, from stored entries (AGENTS.md rule 1).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import date, timedelta

from .dates import week_bounds
from .models import (
    ENTRY_KINDS,
    Entry,
    EntryKind,
    IssueRef,
    PlotRecency,
    PlotTouch,
    WeeklySummary,
)


def normalize_plot(plot: str) -> str:
    """Loose plot matching: case and repeated whitespace only, nothing clever."""
    return " ".join(plot.strip().lower().split())


def _sort_key(entry: Entry) -> tuple[date, str]:
    return entry.date, entry.id


def plot_timeline(entries: Iterable[Entry], plot: str) -> list[Entry]:
    """Entries for one plot, oldest first (same day: by id)."""
    key = normalize_plot(plot)
    return sorted(
        (e for e in entries if e.plot is not None and normalize_plot(e.plot) == key),
        key=_sort_key,
    )


def known_plots(entries: Iterable[Entry]) -> list[str]:
    """Every distinct plot name, sorted."""
    names = {e.plot for e in entries if e.plot is not None}
    return sorted(names)


def _issue_closer(entries: Sequence[Entry], issue: Entry) -> Entry | None:
    """The earliest action entry on the same plot after the issue, if any."""
    candidates = [
        e
        for e in entries
        if e.kind == "action"
        and e.plot is not None
        and issue.plot is not None
        and normalize_plot(e.plot) == normalize_plot(issue.plot)
        and e.date > issue.date
    ]
    return min(candidates, key=_sort_key) if candidates else None


def open_issues(entries: Iterable[Entry], plot: str | None = None) -> list[Entry]:
    """Issue entries with no later action entry on the same plot.

    ``plot=None`` means every plot. This is a rule over the user's own entries, not a
    judgement about the crop.
    """
    all_entries = list(entries)
    scope = (
        all_entries
        if plot is None
        else [e for e in all_entries if e.plot is not None and normalize_plot(e.plot) == normalize_plot(plot)]
    )
    return sorted(
        (e for e in scope if e.kind == "issue" and _issue_closer(all_entries, e) is None),
        key=_sort_key,
    )


def days_since_last_note(entries: Iterable[Entry], plot: str, as_of: date) -> int | None:
    """Days since the newest entry on ``plot``; ``None`` when the plot has no entries."""
    timeline = plot_timeline(entries, plot)
    if not timeline:
        return None
    return (as_of - timeline[-1].date).days


def _issue_ref(entry: Entry) -> IssueRef:
    return IssueRef(
        id=entry.id,
        plot=entry.plot if entry.plot is not None else "(no plot)",
        text=entry.text,
        date=entry.date,
    )


def _count_kinds(entries: Iterable[Entry]) -> dict[EntryKind, int]:
    counts: dict[EntryKind, int] = {kind: 0 for kind in ENTRY_KINDS}
    for entry in entries:
        counts[entry.kind] += 1
    return counts


def _plots_touched(entries: Sequence[Entry]) -> tuple[PlotTouch, ...]:
    seen: dict[str, PlotTouch] = {}
    for entry in entries:
        name = entry.plot if entry.plot is not None else "(no plot)"
        current = seen.get(name)
        if current is None:
            seen[name] = PlotTouch(plot=name, entries=1, kinds=(entry.kind,), latest_date=entry.date)
            continue
        kinds = current.kinds if entry.kind in current.kinds else current.kinds + (entry.kind,)
        seen[name] = PlotTouch(
            plot=name,
            entries=current.entries + 1,
            kinds=kinds,
            latest_date=max(current.latest_date, entry.date),
        )
    return tuple(seen[name] for name in sorted(seen))


def _last_note_by_plot(entries: Sequence[Entry], as_of: date) -> tuple[PlotRecency, ...]:
    rows: list[PlotRecency] = []
    for plot in known_plots(entries):
        timeline = plot_timeline(entries, plot)
        newest = timeline[-1]
        rows.append(
            PlotRecency(plot=plot, date=newest.date, days_since=(as_of - newest.date).days)
        )
    rows.sort(key=lambda row: (-row.days_since, row.plot))
    return tuple(rows)


def weekly_summary(
    entries: Iterable[Entry],
    as_of: date,
    *,
    week_start: date | None = None,
    week_end: date | None = None,
) -> WeeklySummary:
    """Aggregates for one Monday-to-Sunday week.

    The week is the one containing ``as_of`` unless ``week_start`` and ``week_end`` are
    given. ``week_end`` is the last day *inside* the window (Sunday); the counting window
    is ``[week_start, week_end + 1 day)``.

    Counts, plots touched, issues opened and closed all come from the entries inside the
    window. ``open_issues`` is all-time (an issue is open until a later action entry on
    the same plot closes it), because a weekly report is where you notice what is still
    open. ``last_note_by_plot`` is measured against ``as_of``.
    """
    if (week_start is None) != (week_end is None):
        raise ValueError("pass both week_start and week_end, or neither")
    if week_start is None or week_end is None:
        week_start, week_end_exclusive = week_bounds(as_of)
        week_end = week_end_exclusive - timedelta(days=1)
    if week_end < week_start:
        raise ValueError("week_end must not be before week_start")

    window_end_exclusive = week_end + timedelta(days=1)
    all_entries = list(entries)
    in_window = sorted(
        (e for e in all_entries if week_start <= e.date < window_end_exclusive),
        key=_sort_key,
    )

    issues = [e for e in all_entries if e.kind == "issue"]
    opened = [e for e in in_window if e.kind == "issue"]
    closed = []
    for issue in issues:
        closer = _issue_closer(all_entries, issue)
        if closer is not None and week_start <= closer.date < window_end_exclusive:
            closed.append(issue)

    return WeeklySummary(
        week_start=week_start,
        week_end=week_end,
        counts_by_kind=_count_kinds(in_window),
        total_entries=len(in_window),
        plots_touched=_plots_touched(in_window),
        issues_opened=tuple(_issue_ref(e) for e in opened),
        issues_closed=tuple(_issue_ref(e) for e in sorted(closed, key=_sort_key)),
        open_issues=tuple(_issue_ref(e) for e in open_issues(all_entries)),
        last_note_by_plot=_last_note_by_plot(all_entries, as_of),
    )
