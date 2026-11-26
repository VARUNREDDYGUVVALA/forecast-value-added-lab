"""Reproducible sales feed and offline demonstration export."""
import argparse
import json
import random
import sys
from pathlib import Path

from .online import OnlineForecasts, Sale


def events(count, series_count=6):
    rng = random.Random(42)
    for index in range(count):
        period, series = divmod(index, series_count)
        promotion = (period + series * 2) % 16 < 3
        next_promotion = (period + 1 + series * 2) % 16 < 3
        volume = 90 + series * 6 + (26 if period % 7 in (5, 6) else 0)
        shift = 21 if period >= 120 else 0
        units = max(0, round(volume + shift + 45 * promotion + rng.gauss(0, 4)))
        yield Sale(series=f"DEMO:SKU-{series + 1}", period=period, units=units,
                   promotion=promotion, next_promotion=next_promotion)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", type=int, default=1200)
    parser.add_argument("--export", type=Path)
    args = parser.parse_args()
    if args.records < 1:
        parser.error("--records must be positive")
    if not args.export:
        for event in events(args.records):
            sys.stdout.write(event.model_dump_json() + "\n")
        return
    engine = OnlineForecasts()
    batch = []
    for event in events(args.records):
        batch.append(event)
        if len(batch) == 512:
            engine.ingest(batch)
            batch.clear()
    engine.ingest(batch)
    result = dict(catalog=engine.catalog(),
                  forecast=engine.snapshot("DEMO:SKU-1", 110))
    args.export.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
