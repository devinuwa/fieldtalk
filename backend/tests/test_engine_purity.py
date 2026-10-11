"""The engine must stay pure Python: standard library only (AGENTS.md section 3).

Two checks, because one alone is easy to fool:

1. static: every import in ``fieldtalk/engine/*.py`` is either relative or a standard
   library module;
2. runtime: the package is imported in a fresh interpreter whose meta path blocks every
   non-standard-library top-level module.

Both count what they inspected, so an empty scan fails instead of passing.
"""

from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
ENGINE_DIR = BACKEND_DIR / "fieldtalk" / "engine"

STDLIB = set(sys.stdlib_module_names)
PACKAGE_ROOT = "fieldtalk"


def _engine_files() -> list[Path]:
    return sorted(ENGINE_DIR.glob("*.py"))


def _top_level_imports(tree: ast.AST) -> list[tuple[str, int]]:
    found: list[tuple[str, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.extend((alias.name.split(".")[0], node.lineno) for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:  # relative import inside the package
                continue
            if node.module:
                found.append((node.module.split(".")[0], node.lineno))
    return found


def test_the_engine_package_is_where_it_should_be() -> None:
    files = _engine_files()
    assert len(files) >= 4, f"expected the engine modules, found {[f.name for f in files]}"
    assert {path.name for path in files} >= {"__init__.py", "aggregate.py", "dates.py", "models.py"}
    assert ENGINE_DIR.parent.name == "fieldtalk"


def test_engine_imports_only_the_standard_library() -> None:
    offenders: list[str] = []
    scanned = 0
    for path in _engine_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for name, lineno in _top_level_imports(tree):
            scanned += 1
            if name != PACKAGE_ROOT and name not in STDLIB:
                offenders.append(f"{path.name}:{lineno} imports {name}")

    # No vacuous pass: the scan must have seen imports.
    assert scanned >= 8, f"only {scanned} imports scanned; the scan looks broken"
    assert offenders == [], f"non-standard-library imports in the engine: {offenders}"


def test_engine_imports_cleanly_with_third_party_imports_blocked() -> None:
    """Import the package in a fresh interpreter that refuses third-party modules."""
    blocker = """
import sys
import importlib.abc

ALLOWED = set(sys.stdlib_module_names) | {"fieldtalk"}


class Blocker(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path=None, target=None):
        top = name.split(".")[0]
        if top not in ALLOWED:
            raise ImportError("third-party import blocked by the purity test: " + name)
        return None


sys.meta_path.insert(0, Blocker())

from datetime import date

from fieldtalk.engine import DateExpr, Entry, days_since, open_issues, resolve_date, weekly_summary

assert days_since(date(2026, 7, 10), date(2026, 10, 7)) == 89
assert resolve_date(DateExpr("days_ago", n=2), date(2026, 10, 7)) == date(2026, 10, 5)
entry = Entry(id="x", plot="plot 1", crop=None, kind="issue", date=date(2026, 10, 1), text="x")
assert [e.id for e in open_issues([entry])] == ["x"]
assert weekly_summary([entry], date(2026, 10, 1)).total_entries == 1
print("engine imported and ran with third-party imports blocked")
"""
    result = subprocess.run(
        [sys.executable, "-c", blocker],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"
    assert "blocked" in result.stdout
