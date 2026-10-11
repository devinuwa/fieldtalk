"""Search notes tool: plain substring match over stored entry text — no embeddings.

A single tool exposed via the ask pipeline. Case-insensitive literal substring of the
stored ``text`` field, returning the matching entries' id, date, kind, plot, crop, text,
quantity. Nothing is indexed; every call scans the store.
"""

from __future__ import annotations

from pathlib import Path

from ..engine import Entry


def search_notes(keyword: str, entries: list[Entry], *, case_insensitive: bool = True) -> list[dict]:
    """Return all entries whose ``text`` contains ``keyword`` (substring)."""
    if not keyword:
        return []
    kw = keyword.lower() if case_insensitive else keyword
    out: list[dict] = []
    for e in entries:
        text = (e.text or "")
        hay = text.lower() if case_insensitive else text
        if kw in hay:
            out.append(entry_dict(e))
    return out


def entry_dict(e: Entry) -> dict:
    return {
        "id": e.id,
        "date": e.date.isoformat(),
        "kind": e.kind,
        "plot": e.plot,
        "crop": e.crop,
        "text": e.text,
        "quantity": ({"value": e.quantity.value, "unit": e.quantity.unit} if e.quantity else None),
    }


def search_notes_tool(keyword: str, db_path: Path) -> list[dict]:
    """Public entry point used by ``pipeline.ask`` and the API."""
    from ..store import Store
    store = Store(db_path)
    entries = store.all()
    return search_notes(keyword, entries)
