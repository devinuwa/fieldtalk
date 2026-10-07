"""The API skeleton must import and expose ``/health`` (bound to loopback when served)."""

from __future__ import annotations

from fieldtalk.app import app


def test_app_metadata() -> None:
    assert app.title == "FieldTalk"
    assert app.version == "0.1.0"
    # No interactive docs: this app has no accounts and no public surface.
    assert app.docs_url is None and app.redoc_url is None


def test_health_route_exists() -> None:
    paths = {route.path for route in app.routes}
    assert "/health" in paths


def test_cors_allows_only_the_local_ui() -> None:
    cors = [m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware"]
    assert len(cors) == 1
    options = cors[0].kwargs
    assert options["allow_origins"] == ["http://localhost:3000"]
