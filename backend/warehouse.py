"""Validate synthetic sales JSONL and maintain an idempotent DuckDB revision store."""
import argparse
from pathlib import Path

import duckdb


def ingest(database: Path, source: Path, snapshot: Path):
    with duckdb.connect(str(database)) as conn:
        conn.execute("BEGIN")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sales_revisions (
                sku VARCHAR, date DATE, available DATE, units BIGINT CHECK (units >= 0),
                promo BOOLEAN NOT NULL, PRIMARY KEY (sku, date, available),
                CHECK (available >= date)
            )
        """)
        conn.execute("""
            CREATE TEMP TABLE incoming AS
            SELECT sku, date, available, units, promo FROM read_json(?, format='newline_delimited',
                columns={'sku':'VARCHAR','date':'DATE','available':'DATE','units':'BIGINT','promo':'BOOLEAN'})
        """, [str(source)])
        invalid = conn.execute("""
            SELECT count(*) FROM incoming WHERE sku IS NULL OR trim(sku) = '' OR date IS NULL
                OR available IS NULL OR units IS NULL OR units < 0 OR promo IS NULL OR available < date
        """).fetchone()[0]
        conflicts = conn.execute("""
            WITH versions AS (
                SELECT DISTINCT * FROM incoming
                UNION
                SELECT s.* FROM sales_revisions s
                JOIN incoming i USING (sku, date, available)
            )
            SELECT count(*) FROM (
                SELECT sku, date, available FROM versions GROUP BY ALL HAVING count(*) > 1
            )
        """).fetchone()[0]
        if invalid or conflicts:
            raise ValueError(f"Rejected batch with {invalid} invalid rows and {conflicts} conflicting versions")
        conn.execute("INSERT OR IGNORE INTO sales_revisions SELECT * FROM incoming")
        conn.execute("""
            CREATE OR REPLACE VIEW latest_sales AS
            SELECT * FROM sales_revisions QUALIFY row_number() OVER (
                PARTITION BY sku, date ORDER BY available DESC
            ) = 1
        """)
        count = conn.execute("SELECT count(*) FROM sales_revisions").fetchone()[0]
        conn.execute("COMMIT")
        temporary = snapshot.with_name(snapshot.name + ".tmp")
        conn.execute("COPY (SELECT * FROM latest_sales ORDER BY sku, date) TO ? (FORMAT PARQUET)", [str(temporary)])
        temporary.replace(snapshot)
        return count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("source", type=Path)
    parser.add_argument("snapshot", type=Path)
    args = parser.parse_args()
    print(f"Stored {ingest(args.database, args.source, args.snapshot):,} sales revisions")
