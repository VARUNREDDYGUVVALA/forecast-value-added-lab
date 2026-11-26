from fastapi.testclient import TestClient

from backend.api import app
from backend.engine import CASES, CATALOG, benchmark, demo_events, score, sales_events


def test_yogurt_fva_and_cutoff():
    forecasts, actuals, _ = demo_events()
    yogurt = [r for r in forecasts if r["sku"] == "YGT-1001"]
    late = dict(yogurt[-1], units=1100, issued="2025-03-02T00:00:00Z")
    result = score(yogurt + [late, yogurt[0]], actuals[:1])
    assert [r["error"] for r in result["stages"]] == [250, 100, 20, 200]
    assert [r["fva"] for r in result["stages"]] == [None, 150, 80, -180]
    assert result["matched"] == 1


def test_incomplete_actual_and_zero_sales_visible():
    forecasts, actuals, _ = demo_events()
    actuals[0] = dict(actuals[0], complete=False)
    result = score(forecasts, actuals)
    assert (result["matched"], result["excluded"]) == (95, 1)
    yogurt = [r for r in forecasts if r["sku"] == "YGT-1001"]
    zero = [dict(actuals[0], complete=True, units=0)]
    assert score(yogurt, zero)["stages"][0]["wape"] is None


def test_as_of_actual_revisions():
    forecasts, actuals, _ = demo_events()
    yogurt = [r for r in forecasts if r["sku"] == "YGT-1001"]
    later = dict(actuals[0], units=1200, available="2025-04-05T00:00:00Z")
    assert score(yogurt, [actuals[0], later])["stages"][0]["error"] == 250
    assert score(yogurt, [actuals[0], later], as_of="2025-04-06T00:00:00Z")["stages"][0]["error"] == 350


def test_portfolio_carry_forward_and_override_only():
    forecasts, actuals, _ = demo_events()
    original_skus = {case[0] for case in CASES}
    forecasts = [event for event in forecasts if event["sku"] in original_skus]
    actuals = [event for event in actuals if event["sku"] in original_skus]
    all_rows = score(forecasts, actuals)
    only_overrides = score(forecasts, actuals, override_only=True)
    assert all_rows["matched"] == 6
    assert only_overrides["matched"] == 5
    assert all_rows["stages"][-1]["fva"] == only_overrides["stages"][-1]["fva"]
    assert (all_rows["coverage"], all_rows["win_rate"], all_rows["tie_rate"]) == (5 / 6, 1 / 5, 1 / 5)


def test_benchmark_out_of_sample_and_reproducible_generator():
    assert list(sales_events(42)) == list(sales_events(42))
    report = benchmark()
    assert report["samples"] == 252
    assert 0 < report["coverage"] < 1
    assert report["models"][-1]["wape"] < report["models"][0]["wape"]


def test_api_routes_and_invalid_decision():
    client = TestClient(app)
    assert client.get("/api/scorecard?category=Dairy").json()["portfolio"]["matched"] == 12
    response = client.post("/api/replay", json={"sku": "YGT-1001", "units": 1100})
    assert response.json() == {"absolute_error": 0, "fva": 20}
    assert client.post("/api/replay", json={"sku": "YGT-1001", "units": -1}).status_code == 422
    assert client.post("/api/replay", json={"sku": "missing", "units": 0}).status_code == 404


def test_full_catalog_has_forecast_and_investigation_support():
    client = TestClient(app)
    response = client.get("/api/scorecard").json()
    assert response["portfolio"]["matched"] == 96
    assert {product["name"] for product in response["products"]} == {item["name"] for item in CATALOG}
    frozen = next(product for product in response["products"] if product["sku"] == "SKU-137")
    replay = client.post("/api/replay", json={"sku": frozen["sku"], "units": frozen["actual"]})
    assert replay.json()["absolute_error"] == 0
    investigation = client.post("/api/investigate", json={"sku": frozen["sku"], "stage": "override"})
    assert investigation.status_code == 200
