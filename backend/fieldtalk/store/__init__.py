"""FieldTalk's local SQLite store (gitignored ``data/``) — nothing at runtime talks to the network.

The raw entry structure (after the model's expressions) keeps the original expressions
plus the V1 source spans so the UI can show the transcript highlight and V1 can flag
ungrounded fields. The schema is closed; code still validates and resolves everything."""

from __future__ import annotations

from datetime import date

from ..pipeline import ACTIONS, ENTRY_JSON_SCHEMA, parse_model_output
from .connection import Store, DB_PATH, make_store
from .models import Entry, EntryKind, Quantity, DateExpr, StoreError

__all__ = ["Store", "DB_PATH", "make_store", "Entry", "EntryKind", "Quantity", "DateExpr", "StoreError"]
