"""FieldTalk backend.

Layers (AGENTS.md section 3): audio -> ``stt`` -> ``pipeline.extract`` -> ``verify`` ->
``store`` -> ``tools`` -> ``engine``. The engine exists today; the rest is built in the
following steps. ``fieldtalk.engine`` is pure standard library.
"""

__version__ = "0.1.0"
