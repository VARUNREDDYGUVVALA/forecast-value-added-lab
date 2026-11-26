"""Synthetic demand events, as-of scoring and chronological model evaluation."""
import argparse
import json
import random
from datetime import date, timedelta
from pathlib import Path
from statistics import mean

STAGES = ("baseline", "ml", "promotion", "override")
CUTOFF = "2025-03-01T00:00:00Z"
AS_OF = "2025-04-01T00:00:00Z"
CASES = [
    ("YGT-1001", "Greek Yogurt", "Dairy", 850, 1000, 1120, 1300, 1100, "Expected promotion uplift"),
    ("APL-1003", "Fresh Apples", "Produce", 980, 1050, 1100, 950, 1080, "Supply concern"),
    ("BRD-1002", "Whole Wheat Bread", "Bakery", 620, 680, 710, 750, 760, "Local event"),
    ("MLK-1004", "Whole Milk", "Dairy", 450, 490, 490, 510, 500, "Local demand adjustment"),
    ("AVO-1005", "Hass Avocado", "Produce", 720, 780, 810, 830, 815, "Weekend demand"),
    ("CRS-1006", "Butter Croissants", "Bakery", 350, 420, 440, None, 455, "No override"),
]


# Preserve saved replay IDs and the authored historical cases for these catalog entries.
LEGACY_CATALOG_IDS = {"SKU-115", "SKU-102", "SKU-125", "SKU-113", "SKU-103", "SKU-128"}
CATALOG = json.loads((Path(__file__).resolve().parents[1] / "src" / "catalog.json").read_text())


def catalog_cases():
    yield from CASES
    for item in CATALOG:
        if item["id"] in LEGACY_CATALOG_IDS:
            continue
        rng = random.Random(771 + item["index"])
        base = rng.randint(210, 1120)
        model = base + rng.randint(-95, 140)
        promotion = model + rng.randrange(0, 100, 5)
        actual = max(0, promotion + rng.randint(-65, 65))
        override = max(0, promotion + rng.randint(-110, 145)) if rng.random() < 0.8 else None
        reason = "Simulated planning adjustment" if override is not None else "No override"
        yield (item["id"], item["name"], item["category"], base, model, promotion, override, actual, reason)


def latest(events, keys, timestamp, cutoff):
    """Pick the latest eligible immutable version and reject conflicting duplicates."""
    versions = {}
    for event in events:
        if event[timestamp] > cutoff:
            continue
        key = tuple(event[field] for field in keys) + (event[timestamp],)
        if key in versions and versions[key] != event:
            raise ValueError(f"Conflicting versions for {key}")
        versions[key] = event
    selected = {}
    for key in sorted(versions):
        selected[key[:-1]] = versions[key]
    return selected


def score(forecasts, actuals, cutoff=CUTOFF, as_of=AS_OF, override_only=False):
    forecasts = latest(forecasts, ("sku", "target", "stage"), "issued", cutoff)
    actuals = latest(actuals, ("sku", "target"), "available", as_of)
    keys = {(sku, target) for sku, target, _ in forecasts} | set(actuals)
    eligible = []
    for key in sorted(keys):
        actual = actuals.get(key, {})
        values = [forecasts.get((*key, stage), {}).get("units") for stage in STAGES]
        overridden = values[-1] is not None
        if not actual.get("complete") or actual.get("units") is None or None in values[:3]:
            continue
        if override_only and not overridden:
            continue
        if not overridden:
            values[-1] = values[-2]
        eligible.append((actual["units"], values, overridden))
    total = sum(actual for actual, _, _ in eligible)
    result = []
    for index, stage in enumerate(STAGES):
        errors = [values[index] - actual for actual, values, _ in eligible]
        absolute = sum(map(abs, errors))
        result.append(dict(stage=stage, error=absolute, mae=absolute / len(errors) if errors else None,
                           wape=absolute / total if total else None, bias=sum(errors),
                           fva=result[-1]["error"] - absolute if index and errors else None))
    deltas = [abs(values[2] - a) - abs(values[3] - a) for a, values, overridden in eligible if overridden]
    return dict(stages=result, matched=len(eligible), excluded=len(keys) - len(eligible),
                coverage=len(deltas) / len(eligible) if eligible else None,
                win_rate=sum(d > 0 for d in deltas) / len(deltas) if deltas else None,
                tie_rate=deltas.count(0) / len(deltas) if deltas else None)


def demo_events():
    forecasts, actuals, products = [], [], []
    for sku, name, category, base, ml, promo, override, actual, reason in catalog_cases():
        target = "2025-03-08"
        versions = [
            dict(sku=sku, target=target, stage=stage, units=units, issued=f"2025-02-{24 + i}T13:00:00Z")
            for i, (stage, units) in enumerate(zip(STAGES, (base, ml, promo, override))) if units is not None
        ]
        forecasts.extend(versions)
        actuals.append(dict(sku=sku, target=target, units=actual, available="2025-03-09T12:00:00Z", complete=True))
        products.append(dict(sku=sku, name=name, category=category, baseline=base, ml=ml, promotion=promo,
                             override=override, actual=actual, reason=reason, versions=versions))
    return forecasts, actuals, products


def sales_events(count, seed=31):
    """Stream deterministic synthetic daily sales with availability timestamps."""
    rng = random.Random(seed)
    start = date(2023, 1, 1)
    for i in range(count):
        day, sku = divmod(i, len(CASES))
        current = start + timedelta(days=day)
        promo = (day + sku * 3) % 23 in (1, 2, 3)
        units = max(0, round(45 + sku * 12 + 17 * (current.weekday() >= 5) + 21 * promo
                             + day * 0.08 + rng.gauss(0, 4)))
        yield dict(sku=CASES[sku][0], date=current.isoformat(), units=units, promo=promo,
                   available=(current + timedelta(days=1)).isoformat())


def benchmark():
    from sklearn.ensemble import GradientBoostingRegressor

    events = list(sales_events(6 * 245))
    rows = []
    for i in range(42, len(events)):
        event = events[i]
        lag = events[i - 42]["units"]
        features = [i % 6, date.fromisoformat(event["date"]).weekday(), int(event["promo"]),
                    events[i - 6]["units"], lag]
        rows.append((i // 6, features, event["units"], lag))
    actual, baseline, average, predictions, lowers, uppers = [], [], [], [], [], []
    scales = []
    final_holdout = None
    for boundary in (203, 217, 231):
        train = [r for r in rows if r[0] < boundary]
        test = [r for r in rows if boundary <= r[0] < boundary + 14]
        train_x, train_y = [r[1] for r in train], [r[2] for r in train]
        x = [r[1] for r in test]
        outputs = []
        for loss, alpha in (("squared_error", 0.5), ("quantile", 0.1), ("quantile", 0.9)):
            model = GradientBoostingRegressor(loss=loss, alpha=alpha, random_state=31, n_estimators=80)
            model.fit(train_x, train_y)
            outputs.append(model.predict(x).tolist())
        point, lower, upper = outputs
        predictions.extend(point)
        lowers.extend(map(min, zip(lower, upper)))
        uppers.extend(map(max, zip(lower, upper)))
        actual.extend(r[2] for r in test)
        baseline.extend(r[3] for r in test)
        average.extend(mean(events[day * 6 + int(features[0]) - lag * 6]["units"]
                            for lag in range(1, 8)) for day, features, _, _ in test)
        scales.extend([mean(abs(r[2] - r[3]) for r in train)] * len(test))
        if boundary == 231:
            final_holdout = round(sum(abs(p - r[2]) for p, r in zip(point, test))
                                  / sum(r[2] for r in test), 8)
    models = []
    for label, predicted in (("Seasonal Naive", baseline), ("7-day Moving Average", average),
                             ("Gradient Boosting", predictions)):
        errors = [p - a for p, a in zip(predicted, actual)]
        models.append(dict(name=label, mae=round(mean(map(abs, errors)), 8),
                           wape=round(sum(map(abs, errors)) / sum(actual), 8),
                           rmse=round(mean(e ** 2 for e in errors) ** .5, 8),
                           bias=round(mean(errors), 8),
                           mase=round(mean(abs(error) / scale for error, scale in zip(errors, scales)), 8)))
    coverage = mean(lo <= a <= hi for lo, a, hi in zip(lowers, actual, uppers))
    return dict(models=models, samples=len(actual), windows=3, coverage=round(coverage, 8),
                final_holdout_wape=final_holdout,
                pinball_p10=pinball(actual, lowers, 0.1), pinball_p90=pinball(actual, uppers, 0.9),
                demand_samples=actual[-42:])


def pinball(actual, predicted, quantile):
    errors = [a - p for a, p in zip(actual, predicted)]
    return round(mean(max(quantile * e, (quantile - 1) * e) for e in errors), 8)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sales", type=Path)
    parser.add_argument("--records", type=int, default=1470, choices=range(1, 10_000_001),
                        metavar="1..10000000")
    parser.add_argument("--export", type=Path)
    args = parser.parse_args()
    if args.sales:
        with args.sales.open("w") as output:
            for event in sales_events(args.records):
                output.write(json.dumps(event) + "\n")
    if args.export:
        forecasts, actuals, products = demo_events()
        args.export.write_text(json.dumps(dict(products=products, portfolio=score(forecasts, actuals),
                                                benchmark=benchmark(), cutoff=CUTOFF), indent=2) + "\n")


if __name__ == "__main__":
    main()
