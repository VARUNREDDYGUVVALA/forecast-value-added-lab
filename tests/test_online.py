from fastapi.testclient import TestClient

from backend.api import app
from backend.online import OnlineForecasts, Sale
from backend.online_demo import events
from backend import stream_api


def test_evaluates_the_forecast_as_issued_and_recovers_after_shift():
    engine = OnlineForecasts()
    dataset = list(events(1200, series_count=1))
    engine.ingest(dataset[:100])
    before = engine.snapshot("DEMO:SKU-1")
    next_observation = dataset[100].model_copy(update={"promotion": not before["forecast"]["promotion"]})
    engine.ingest([next_observation])
    after = engine.snapshot("DEMO:SKU-1")
    assert after["latest"]["predicted"] == before["forecast"]["units"]
    assert after["latest"]["promotion_changed"]
    engine.ingest(dataset[101:])
    result = engine.snapshot("DEMO:SKU-1", 80)
    assert 0.75 < result["interval_coverage"] < 1
    assert result["model_wape"] < result["baseline_wape"]
    assert result["forecast"]["period"] == 1200
    assert result["planning_gap"] >= 0
    assert len(engine.models["DEMO:SKU-1"].residuals) == 128


def test_batch_validation_does_not_partially_apply_and_retries_are_idempotent(monkeypatch):
    monkeypatch.setattr(stream_api, "store", OnlineForecasts(limit=1))
    monkeypatch.setenv("FVA_STREAM_TOKEN", "test-only-token")
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-only-token"}
    url = "/api/online/events"
    first = Sale(series="A", period=5, units=10).model_dump()
    gap = dict(first, period=7)
    assert client.post(url, json={"records": [first]}).status_code == 401
    assert client.post(url, headers=headers, json={"records": [first, gap]}).status_code == 409
    assert client.get("/api/online/series", headers=headers).json()["active"] == 0
    assert client.post(url, headers=headers, json={"records": [first]}).json()["accepted"] == 1
    assert client.post(url, headers=headers, json={"records": [first]}).json()["stale"] == 1
    assert client.post(url, headers=headers, json={"records": [dict(first, series="B")]}).status_code == 429
    assert client.post(url, headers=headers, content=b"x" * (512 * 1024 + 1)).status_code == 413
    result = client.get("/api/online/forecast/A", headers=headers).json()
    assert result["observations"] == 1
    assert result["forecast"]["period"] == 6
    assert result["forecast"]["low"] is None
