"""Send ordered NDJSON observations to the online forecast API in bounded batches."""
import argparse
import json
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def send(endpoint, token, records):
    request = Request(endpoint, data=json.dumps({"records": records}).encode(),
                      headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    for attempt in range(4):
        try:
            with urlopen(request, timeout=20) as reply:
                return json.load(reply)
        except HTTPError as error:
            if error.code not in (502, 503, 504) or attempt == 3:
                raise SystemExit(f"Ingestion failed: HTTP {error.code}: {error.read(2048).decode(errors='replace')}") from error
        except (URLError, TimeoutError) as error:
            if attempt == 3:
                raise SystemExit(f"Ingestion unavailable: {error}") from error
        time.sleep(2**attempt)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default="http://127.0.0.1:8080/api/online/events")
    parser.add_argument("--batch-size", type=int, default=128, choices=range(1, 513), metavar="1..512")
    args = parser.parse_args()
    token = os.environ.get("FVA_STREAM_TOKEN")
    if not token:
        parser.error("set FVA_STREAM_TOKEN in the process environment")
    batch = []
    for line in sys.stdin:
        if not line.strip():
            continue
        batch.append(json.loads(line))
        if len(batch) == args.batch_size:
            print(json.dumps(send(args.endpoint, token, batch)), file=sys.stderr, flush=True)
            batch.clear()
    if batch:
        print(json.dumps(send(args.endpoint, token, batch)), file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
