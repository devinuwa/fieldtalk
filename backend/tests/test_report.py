"""Regression coverage for the weekly report API."""

from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient

from fieldtalk import app as app_module
from fieldtalk.pipeline import extract as pipeline_extract
from fieldtalk.pipeline import StubAdapter
from fieldtalk.store import Entry, Store


def test_weekly_report_returns_fixture_derived_summary(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "fieldtalk.db"
    Store(db_path).add(
        [
            Entry("e1", "plot 2", None, "observation", date(2026, 9, 28), "e1 text"),
            Entry("e2", "plot 2", None, "issue", date(2026, 9, 30), "e2 text"),
            Entry("e3", "plot 2", None, "action", date(2026, 10, 2), "e3 text"),
            Entry("e4", "plot 1", None, "issue", date(2026, 10, 1), "e4 text"),
            Entry("e5", "plot 1", None, "observation", date(2026, 10, 3), "e5 text"),
        ]
    )
    monkeypatch.setattr(app_module, "DB_PATH", db_path)

    response = TestClient(app_module.app).get("/api/report/weekly?as_of=2026-10-07")

    assert response.status_code == 200
    report = response.json()
    assert report["week_start"] == "2026-10-05"
    assert report["week_end"] == "2026-10-11"
    assert report["counts_by_kind"] == {
        "observation": 0,
        "issue": 0,
        "action": 0,
        "plan": 0,
        "measurement": 0,
    }
    assert report["total_entries"] == 0
    assert report["plots_touched"] == []
    assert report["issues_opened"] == []
    assert report["issues_closed"] == []
    assert report["open_issues"] == [
        {"id": "e4", "plot": "plot 1", "text": "e4 text", "date": "2026-10-01"},
    ]


def test_manual_entry_endpoint_persists_entry(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "fieldtalk.db"
    monkeypatch.setattr(app_module, "DB_PATH", db_path)

    response = TestClient(app_module.app).post(
        "/api/entries",
        json={
            "plot": "plot 9",
            "crop": "maize",
            "kind": "observation",
            "text": "synthetic note: leaves are green",
            "recording_date": "2026-10-07",
        },
    )

    assert response.status_code == 200
    created = response.json()["entry"]
    assert created["plot"] == "plot 9"
    assert created["date"] == "2026-10-07"
    assert Store(db_path).by_id(created["id"]).text == "synthetic note: leaves are green"


def test_extraction_endpoint_returns_review_proposal_until_entry_is_approved(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "fieldtalk.db"
    monkeypatch.setattr(app_module, "DB_PATH", db_path)
    model_output = (
        '{"entries":[{"plot":"plot 9","crop":"maize","kind":"observation",'
        '"text":"leaves are green","date_expr":null,'
        '"planting_date_expr":null,"quantity":null}],'
        '"action":"run","clarify_question":null}'
    )

    def stub_extract(transcript, _adapter, *, recorded_on):
        return pipeline_extract(
            transcript,
            StubAdapter([model_output]),
            recorded_on=recorded_on,
        )

    monkeypatch.setattr(app_module, "extract", stub_extract)
    response = TestClient(app_module.app).post(
        "/api/extract",
        json={
            "transcript": "Plot 9, maize. Leaves are green.",
            "recording_date": "2026-10-07",
            "model": "stub",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["action"] == "run"
    assert body["id"] is None
    assert body["entries"][0]["id"] is None
    assert body["entries"][0]["grounding"]["ungrounded"] == []
    assert Store(db_path).all() == []

    approved = TestClient(app_module.app).post(
        "/api/entries",
        json={
            "plot": body["entries"][0]["plot"],
            "crop": body["entries"][0]["crop"],
            "kind": body["entries"][0]["kind"],
            "text": body["entries"][0]["text"],
            "recording_date": body["entries"][0]["date"],
            "planting_date": body["entries"][0]["planting_date"],
        },
    )
    assert approved.status_code == 200
    assert Store(db_path).by_id(approved.json()["entry"]["id"]).text == "leaves are green"
