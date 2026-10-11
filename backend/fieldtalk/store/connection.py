"""Local SQLite store for FieldTalk entries — ``data/fieldtalk.db`` (gitignored).

Nothing in the store computes. It persists a validated, code-resolved entry and exposes
CRUD plus a reader that hands entries back to the pure engine. Manual add/edit works
without a model: the caller supplies a resolved date and a closed-set kind; code still
validates.

Design note (why this module looks like this): the store used to keep its own
Entry/DateExpr/Quantity definitions, which collided with the engine's copies and produced
circular imports. Now both layers import the single shared model from
``fieldtalk.store.models``, so there is exactly one Entry in the tree.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import date
from pathlib import Path

from sqlite3 import Connection

from .models import Entry, EntryKind, Quantity, StoreError, DateExpr
from .models import Entry, EntryKind, Quantity, StoreError, DateExpr

DB_PATH = Path("data") / "fieldtalk.db"


def make_store(path: Path | None = None) -> Store:
    """Open (or create) the store at ``path``; the repo root is the default."""
    return Store(path or DB_PATH)


class Store:
    """Thin persistence wrapper over a single SQLite file."""

    def __init__(self, path: Path) -> None:
        self._path = path.resolve()

    # ------------------------------------------------------------------
    # connection + schema
    # ------------------------------------------------------------------

    @contextmanager
    def _connect(self) -> Connection:
        import sqlite3

        conn = sqlite3.connect(str(self._path), detect_types=sqlite3.PARSE_DECLTYPES)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            yield conn
        finally:
            conn.close()

    def _ensure_schema(self, conn: Connection) -> None:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS entries (
                id              TEXT PRIMARY KEY,
                plot            TEXT,
                crop            TEXT,
                kind            TEXT NOT NULL,
                text            TEXT NOT NULL,
                date            TEXT NOT NULL,
                planting_date   TEXT,
                quantity_value  REAL,
                quantity_unit   TEXT,
                date_expr_kind  TEXT,
                date_expr_n     INTEGER,
                date_expr_month INTEGER,
                date_expr_day   INTEGER,
                planting_month  INTEGER,
                planting_day    INTEGER,
                source_span_plot   TEXT,
                source_span_crop   TEXT,
                source_span_quantity TEXT,
                grounding_ungrounded TEXT
            )
            """
        )
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS entries_by_id ON entries (id)")

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------

    def init_schema(self) -> None:
        with self._connect() as conn:
            self._ensure_schema(conn)
            conn.commit()

    def all(self) -> list[Entry]:
        """Every stored entry, oldest first (date, then id)."""
        with self._connect() as conn:
            self._ensure_schema(conn)
            rows = conn.execute(
                """
                SELECT * FROM entries ORDER BY date, id
                """
            ).fetchall()
        return [self._row_to_entry(row) for row in rows]

    def by_id(self, entry_id: str) -> Entry | None:
        with self._connect() as conn:
            self._ensure_schema(conn)
            row = conn.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
            return self._row_to_entry(row) if row else None

    def add(self, entries: list[Entry]) -> list[Entry]:
        """Insert one or more entries; return the persisted copies."""
        with self._connect() as conn:
            self._ensure_schema(conn)
            cur = conn.cursor()
            for e in entries:
                cur.execute(
                    """
                    INSERT INTO entries (
                        id, plot, crop, kind, text, date, planting_date,
                        quantity_value, quantity_unit,
                        date_expr_kind, date_expr_n, date_expr_month, date_expr_day,
                        planting_month, planting_day,
                        source_span_plot, source_span_crop, source_span_quantity,
                        grounding_ungrounded
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        e.id,
                        e.plot,
                        e.crop,
                        e.kind,
                        e.text,
                        e.date.isoformat(),
                        (e.planting_date.isoformat() if e.planting_date else None),
                        (e.quantity.value if e.quantity else None),
                        (e.quantity.unit if e.quantity else None),
                        (e.date_expr.kind if e.date_expr else None),
                        (e.date_expr.n if e.date_expr else None),
                        (e.date_expr.month if e.date_expr else None),
                        (e.date_expr.day if e.date_expr else None),
                        (e.planting_expr.month if e.planting_expr else None),
                        (e.planting_expr.day if e.planting_expr else None),
                        json.dumps([list(e.plot_span)]) if e.plot_span else None,
                        json.dumps([list(e.crop_span)]) if e.crop_span else None,
                        json.dumps([list(e.quantity_span)]) if e.quantity_span else None,
                        json.dumps(list(e.ungrounded)),
                    ),
                )
            conn.commit()
        # Re-read so callers get what is actually on disk.
        return [self.by_id(e.id) for e in entries]

    def update(self, entry: Entry) -> Entry:
        """Replace one existing entry; raises ``StoreError`` when it does not exist."""
        with self._connect() as conn:
            self._ensure_schema(conn)
            cur = conn.execute(
                """
                UPDATE entries SET
                    plot=?, crop=?, kind=?, text=?, date=?,
                    planting_date=?, quantity_value=?, quantity_unit=?,
                    date_expr_kind=?, date_expr_n=?, date_expr_month=?, date_expr_day=?,
                    planting_month=?, planting_day=?,
                    source_span_plot=?, source_span_crop=?, source_span_quantity=?,
                    grounding_ungrounded=?
                WHERE id=?
                """,
                (
                    entry.plot,
                    entry.crop,
                    entry.kind,
                    entry.text,
                    entry.date.isoformat(),
                    (entry.planting_date.isoformat() if entry.planting_date else None),
                    (entry.quantity.value if entry.quantity else None),
                    (entry.quantity.unit if entry.quantity else None),
                    (entry.date_expr.kind if entry.date_expr else None),
                    (entry.date_expr.n if entry.date_expr else None),
                    (entry.date_expr.month if entry.date_expr else None),
                    (entry.date_expr.day if entry.date_expr else None),
                    (entry.planting_expr.month if entry.planting_expr else None),
                    (entry.planting_expr.day if entry.planting_expr else None),
                    json.dumps([list(entry.plot_span)]) if entry.plot_span else None,
                    json.dumps([list(entry.crop_span)]) if entry.crop_span else None,
                    json.dumps([list(entry.quantity_span)]) if entry.quantity_span else None,
                    json.dumps(list(entry.ungrounded)),
                    entry.id,
                ),
            )
            if cur.rowcount != 1:
                raise StoreError(f"entry not found for update: {entry.id}")
            conn.commit()
        return self.by_id(entry.id)

    def delete(self, entry_id: str) -> bool:
        with self._connect() as conn:
            self._ensure_schema(conn)
            cur = conn.execute("DELETE FROM entries WHERE id=?", (entry_id,))
            conn.commit()
            return cur.rowcount == 1

    def known_plots(self) -> list[str]:
        with self._connect() as conn:
            self._ensure_schema(conn)
            rows = conn.execute(
                "SELECT DISTINCT plot FROM entries WHERE plot IS NOT NULL ORDER BY plot"
            ).fetchall()
        return [r["plot"] for r in rows]

    # ------------------------------------------------------------------
    # serialization
    # ------------------------------------------------------------------

    @staticmethod
    @staticmethod
    def _row_to_entry(row: object) -> Entry:
        r = row  # sqlite3.Row
        quantity: Quantity | None = None
        if r["quantity_value"] is not None:
            quantity = Quantity(value=r["quantity_value"], unit=r["quantity_unit"] or "")
        date_expr: DateExpr | None = None
        if r["date_expr_kind"] is not None:
            date_expr = DateExpr(
                kind=r["date_expr_kind"],
                n=r["date_expr_n"],
                month=r["date_expr_month"],
                day=r["date_expr_day"],
            )
        planting_expr: DateExpr | None = None
        if r["planting_month"] is not None or r["planting_day"] is not None:
            planting_expr = DateExpr(
                kind="month_day" if r["planting_month"] is not None else "days_ago",
                month=r["planting_month"],
                day=r["planting_day"],
            )
        plot_span: tuple[int, int] | None = None
        crop_span: tuple[int, int] | None = None
        quantity_span: tuple[int, int] | None = None
        for key, json_key in (("plot_span", "source_span_plot"), ("crop_span", "source_span_crop"), ("quantity_span", "source_span_quantity")):
            raw = r[json_key]
            if raw:
                try:
                    parsed = json.loads(raw)
                    if isinstance(parsed, list) and parsed and isinstance(parsed[0], (list, tuple)):
                        span = tuple(tuple(p) for p in parsed)[0]
                        store = {"plot_span": plot_span, "crop_span": crop_span, "quantity_span": quantity_span}
                        if store[key] is None:
                            if key == "plot_span":
                                plot_span = span
                            elif key == "crop_span":
                                crop_span = span
                            else:
                                quantity_span = span
                except (json.JSONDecodeError, TypeError, ValueError):
                    pass
        ungrounded: tuple[str, ...] = ()
        raw_ung = r["grounding_ungrounded"]
        if raw_ung:
            try:
                parsed = json.loads(raw_ung)
                if isinstance(parsed, list):
                    ungrounded = tuple(parsed)
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
        return Entry(
            id=r["id"],
            plot=r["plot"],
            crop=r["crop"],
            kind=r["kind"],
            date=date.fromisoformat(r["date"]),
            text=r["text"],
            planting_date=(date.fromisoformat(r["planting_date"]) if r["planting_date"] else None),
            quantity=quantity,
            date_expr=date_expr,
            planting_expr=planting_expr,
            plot_span=plot_span,
            crop_span=crop_span,
            quantity_span=quantity_span,
            ungrounded=ungrounded,
        )
