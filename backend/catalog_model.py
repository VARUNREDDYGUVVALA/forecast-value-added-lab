"""Train a shared normalized ridge model and export a browser inference artifact."""
import argparse
import json
import math
import random
from pathlib import Path

import numpy as np
from sklearn.linear_model import Ridge

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / "src/catalog.json").read_text())
DEPARTMENTS = list(dict.fromkeys(item["category"] for item in CATALOG))
CONTEXTS = (1, 3, 7, 14)
HORIZONS = (1, 2, 3, 4, 5, 6, 7, 10, 14)
FIRST_VALIDATION = 100
FIRST_TEST = 150
DAYS = 210


def features(history, department, next_weekday, recent_promotion, target_promotion, lead):
    recent = history[-7:]
    scale = max(1, sum(recent) / len(recent))
    return [
        len(history) / 14, lead / 14, recent[-1] / scale,
        sum(recent[-3:]) / (len(recent[-3:]) * scale), math.log(scale) / 14,
        int(recent_promotion), int(target_promotion),
        *(int(department == d) for d in DEPARTMENTS),
        *(int(next_weekday == day) for day in range(7)),
        *(int((next_weekday - lead) % 7 == day) for day in range(7)),
    ], scale


def series(item):
    rng = random.Random(6021 + item["index"])
    department = DEPARTMENTS.index(item["category"])
    volume = rng.uniform(14, 100)
    growth = rng.uniform(-0.055, 0.11)
    actuals, promotions = [], []
    for day in range(DAYS):
        weekday = day % 7
        weekend = weekday in (5, 6)
        promoted = (day + item["index"] * 3) % 23 in (1, 2, 3)
        lift = (0.17 + department * 0.035) if weekend else (0.06 if weekday == 4 else 0)
        actuals.append(max(0, round((volume + day * growth) * (1 + lift + promoted * 0.43) + rng.gauss(0, 4))))
        promotions.append(promoted)
    return actuals, promotions


def examples(context, start, end, max_lead=14):
    for item in CATALOG:
        actuals, promotions = series(item)
        for origin in range(max(context, start), end - max_lead + 1, 2):
            history = actuals[origin - context:origin]
            recent = history[-7:]
            baseline = [recent[lead % 7] if context >= 7 else sum(recent) / len(recent)
                        for lead in range(max_lead)]
            rows = [features(history, item["category"], (origin + lead) % 7,
                             promotions[origin - 1], promotions[origin + lead], lead + 1)
                    for lead in range(max_lead)]
            yield rows, actuals[origin:origin + max_lead], baseline


def compare(model, context, horizon, start, end):
    actual, cold_error, pooled_error, windows = 0, 0, 0, 0
    for rows, observed, baseline in examples(context, start, end, horizon):
        x, scales = zip(*rows)
        total = sum(observed)
        estimate = np.maximum(0, model.predict(x) * scales).sum()
        actual += total
        cold_error += abs(total - sum(baseline))
        pooled_error += abs(total - estimate)
        windows += 1
    return {"windows": windows, "baseline": round(cold_error / actual, 6),
            "pooled": round(float(pooled_error / actual), 6)}


def export(path):
    x, y = [], []
    for context in CONTEXTS:
        for rows, observed, _ in examples(context, 0, FIRST_VALIDATION):
            for (values, scale), units in zip(rows, observed):
                x.append(values)
                y.append(units / scale)
    model = Ridge(alpha=15).fit(np.asarray(x), np.asarray(y))
    evaluation = {}
    for context in CONTEXTS:
        evaluation[str(context)] = {}
        for horizon in HORIZONS:
            validation = compare(model, context, horizon, FIRST_VALIDATION, FIRST_TEST)
            test = compare(model, context, horizon, FIRST_TEST, DAYS)
            evaluation[str(context)][str(horizon)] = {
                "usePooled": validation["pooled"] < validation["baseline"],
                "validation": validation, "test": test,
            }
    check, scale = features([24, 30, 38], "Produce", 6, False, True, 3)
    contents = dict(items=len(CATALOG), rows=len(x), departments=DEPARTMENTS,
                    intercept=round(float(model.intercept_), 8),
                    coefficients=[round(float(v), 8) for v in model.coef_],
                    evaluation=evaluation,
                    check=round(float(model.predict([check])[0] * scale), 6))
    path.write_text(json.dumps(contents, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path, default=ROOT / "src/catalog-model.json")
    export(parser.parse_args().export)
