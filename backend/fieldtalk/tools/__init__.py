"""FieldTalk's ask-your-notes tools.

Thin wrappers over the pure engine. ``plot_timeline``, ``days_since_planting``,
``days_since_last_note`` and ``open_issues`` all accept a plot name (case-insensitive,
collapsed-whitespace) and reject unknown plots with a small ``{"error":...,
"known_plots":[...]}`` payload the ask pipeline turns into a clarify.

``weekly_summary`` and ``search_notes`` have no plot arg.
"""

from __future__ import annotations

from datetime import date as _Date
from pathlib import Path

from ..engine import (
    ENTRY_KINDS_STR,
    Entry,
    Quantity,
    days_since,
    days_since_last_note,
    known_plots,
    open_issues,
    parse_iso,
    plot_timeline as _plot_timeline,
    weekly_summary as _weekly_summary,
    week_bounds,
)
from ..store import Store

_KNOWN_PLOTS_LIMIT = 20


def normalize_plot(plot_text: str) -> str:
    """Case-insensitive, collapsed-whitespace plot comparison key."""
    return " ".join(plot_text.strip().lower().split())


def _resolve_plot(plot_text: str, entries: list[Entry]) -> str | None:
    """Return the canonical plot name if *plot_text* matches a known plot, else None."""
    target = normalize_plot(plot_text).strip()
    if not target:
        return None
    plots = known_plots(entries)
    for p in plots:
        if normalize_plot(p) == target:
            return p
    return None


def _unknown_plot_payload(plot_text: str, entries: list[Entry]) -> dict:
    return {
        "error": "unknown plot",
        "plot_text": plot_text,
        "known_plots": known_plots(entries)[:_KNOWN_PLOTS_LIMIT],
    }


def plot_timeline_tool(plot_text: str, db_path: Path) -> list[dict]:
    store = Store(db_path)
    entries = store.all()
    resolved = _resolve_plot(plot_text, entries)
    if resolved is None:
        return _unknown_plot_payload(plot_text, entries)
    timeline = _plot_timeline(entries, resolved)
    return [
        {
            "id": e.id,
            "date": e.date.isoformat(),
            "kind": e.kind,
            "plot": e.plot,
            "crop": e.crop,
            "text": e.text,
            "quantity": (e.quantity and {"value": e.quantity.value, "unit": e.quantity.unit}),
        }
        for e in timeline
    ]


def days_since_planting_tool(plot_text: str, db_path: Path, planting_date: _Date | None = None) -> dict:
    store = Store(db_path)
    entries = store.all()
    resolved = _resolve_plot(plot_text, entries)
    if resolved is None:
        return _unknown_plot_payload(plot_text, entries)
    on = planting_date or _Date.today()
    planted = next((e.planting_date for e in entries if e.plot == resolved and e.planting_date), None)
    if planted is None:
        return {
            "plot": resolved,
            "planting_date": None,
            "as_of": on.isoformat(),
            "days_since_planting": None,
        }
    return {
        "plot": resolved,
        "planting_date": planted.isoformat(),
        "as_of": on.isoformat(),
        "days_since_planting": days_since(planted, on),
    }


def days_since_last_note_tool(plot_text: str, db_path: Path, as_of: _Date | None = None) -> dict:
    store = Store(db_path)
    entries = store.all()
    resolved = _resolve_plot(plot_text, entries)
    if resolved is None:
        return _unknown_plot_payload(plot_text, entries)
    ref = as_of or _Date.today()
    ds = days_since_last_note(entries, resolved, ref)
    # newest note on that plot, if any
    newest: _Date | None = None
    for e in entries:
        if e.plot == resolved and (newest is None or e.date > newest):
            newest = e.date
    return {
        "plot": resolved,
        "as_of": ref.isoformat(),
        "last_note": (newest.isoformat() if newest else None),
        "days_since_last_note": ds,
    }


def open_issues_tool(plot_text: str | None = None, db_path: Path | None = None) -> list[dict]:
    if db_path is None:
        db_path = Store()._path
    store = Store(db_path)
    entries = store.all()
    if plot_text is None:
        issues = open_issues(entries, None)
    else:
        resolved = _resolve_plot(plot_text, entries)
        if resolved is None:
            return _unknown_plot_payload(plot_text, entries)
        issues = open_issues(entries, resolved)
    return [
        {
            "id": e.id,
            "date": e.date.isoformat(),
            "kind": e.kind,
            "plot": e.plot,
            "crop": e.crop,
            "text": e.text,
        }
        for e in issues
    ]


def weekly_summary_tool(week_of: _Date | None = None, db_path: Path | None = None) -> dict:
    if db_path is None:
        db_path = Store()._path
    store = Store(db_path)
    entries = store.all()
    as_of = week_of or _Date.today()
    monday, next_monday = week_bounds(as_of)
    ws = _weekly_summary(entries, as_of, week_start=monday, week_end=next_monday - _Date.resolution)
    return {
        "week_start": ws.week_start.isoformat(),
        "week_end": ws.week_end.isoformat(),
        "counts_by_kind": dict(ws.counts_by_kind),
        "total_entries": ws.total_entries,
        "plots_touched": [
            {"plot": pt.plot, "entries": pt.entries, "kinds": list(pt.kinds), "latest_date": pt.latest_date.isoformat()}
            for pt in ws.plots_touched
        ],
        "issues_opened": [ref_dict(i) for i in ws.issues_opened],
        "issues_closed": [ref_dict(i) for i in ws.issues_closed],
        "open_issues": [ref_dict(i) for i in ws.open_issues],
        "last_note_by_plot": [
            {"plot": pr.plot, "date": pr.date.isoformat(), "days_since": pr.days_since} for pr in ws.last_note_by_plot
        ],
    }


def search_notes_tool(keyword: str, db_path: Path) -> list[dict]:
    store = Store(db_path)
    entries = store.all()
    kw = keyword.lower()
    return [
        {
            "id": e.id,
            "date": e.date.isoformat(),
            "kind": e.kind,
            "plot": e.plot,
            "crop": e.crop,
            "text": e.text,
            "quantity": (e.quantity and {"value": e.quantity.value, "unit": e.quantity.unit}),
        }
        for e in entries
        if kw in (e.text or "").lower()
    ]


def all_entries(db_path: Path) -> list[Entry]:
    return Store(db_path).all()


def ref_dict(ref) -> dict:
    return {"id": ref.id, "plot": ref.plot, "text": ref.text, "date": ref.date.isoformat()}
