import json

import duckdb
import pytest

from backend.engine import sales_events
from backend.warehouse import ingest


def test_incremental_ingestion_is_idempotent_and_retains_revisions(tmp_path):
    database, source, snapshot = (tmp_path / name for name in ("sales.duckdb", "sales.jsonl", "sales.parquet"))
    original = list(sales_events(6))
    source.write_text("\n".join(map(json.dumps, original)))
    assert ingest(database, source, snapshot) == 6
    assert ingest(database, source, snapshot) == 6
    revised = dict(original[0], available="2023-01-10", units=99)
    source.write_text(json.dumps(revised))
    assert ingest(database, source, snapshot) == 7
    with duckdb.connect(str(database)) as conn:
        assert conn.execute("SELECT units FROM read_parquet(?) WHERE sku = ?", [str(snapshot), revised["sku"]]).fetchone() == (99,)
    source.write_text(json.dumps(dict(revised, units=100)))
    with pytest.raises(ValueError, match="conflicting"):
        ingest(database, source, snapshot)
    assert snapshot.exists()
