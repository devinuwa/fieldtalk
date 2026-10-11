"""The API skeleton must import and expose ``/health`` (bound to loopback when served).

Also covers ``POST /api/ask`` failure handling: a malformed/stub plan and a dead
model must produce clear, safe responses — never an uncaught HTTP 500, and never an
internal exception message leaked to the client.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from fieldtalk.app import app


def test_app_metadata() -> None:
    assert app.title == "FieldTalk"
    assert app.version == "0.1.0"
    # No interactive docs: this app has no accounts and no public surface.
    assert app.docs_url is None and app.redoc_url is None


def test_health_route_exists() -> None:
    paths = {route.path for route in app.routes}
    assert "/api/health" in paths


def test_cors_allows_only_the_local_ui() -> None:
    cors = [m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware"]
    assert len(cors) == 1
    options = cors[0].kwargs
    assert options["allow_origins"] == ["http://localhost:3000"]


def test_ask_with_stub_model_returns_safe_clarify_not_500() -> None:
    """Regression: the stub adapter was built with an invalid kwarg -> uncaught 500."""
    client = TestClient(app)
    response = client.post(
        "/api/ask",
        json={"question": "What is the timeline for plot 1?", "model": "stub"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["action"] == "clarify"
    assert body["answer"]  # a clear message, never empty, never a fabricated answer
    assert body["clarify_question"]
    assert body["v3_violations"] == []


def test_ask_model_layer_failure_is_a_clear_503(monkeypatch) -> None:
    import fieldtalk.app as app_module

    def _model_down(*args, **kwargs):
        raise ConnectionError("Ollama at http://127.0.0.1:11434 is not reachable")

    monkeypatch.setattr(app_module, "run_ask", _model_down)
    client = TestClient(app)
    response = client.post("/api/ask", json={"question": "What is the timeline for plot 1?"})

    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"]


def test_ask_unexpected_failure_is_500_with_safe_detail(monkeypatch) -> None:
    import fieldtalk.app as app_module

    def _boom(*args, **kwargs):
        raise ValueError("internal detail that must not leak")

    monkeypatch.setattr(app_module, "run_ask", _boom)
    client = TestClient(app)
    response = client.post("/api/ask", json={"question": "What is the timeline for plot 1?"})

    assert response.status_code == 500
    detail = response.json()["detail"]
    assert "ValueError" in detail  # enough to debug
    assert "must not leak" not in detail  # nothing internal leaks
