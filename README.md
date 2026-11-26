# Forecast Value Added Scorecard

Forecast Lab is a retail planning demonstration that measures how each forecast stage changes accuracy. It includes a historical override replay, a measured forecasting benchmark, an inventory simulation, and an evidence-linked copilot. All sales and planning data shipped here are synthetic.

![Forecast Lab overview](docs/overview.png)

## Guided walkthrough

1. Open **Explore the yogurt case** on the overview. Observed sales were 1,100 units.
2. Inspect the forecast versions and waterfall. The seasonal baseline of 850 produced 250 units of absolute error. ML at 1,000 removed 150. Promotion at 1,120 removed another 80. The original planner override at 1,300 added 180.
3. Enter 1,100 in **Historical replay**. The replay shows zero absolute error and +20 FVA versus the promotion forecast. This is a hindsight illustration.
4. Save the proposal, then open **Audit history** to record an approval in the browser.
5. Run an override investigation in **Forecast copilot**. Open the forecast lineage evidence or review the trace in **Agent monitor**.

## Run locally

The static demo requires Node.js 24 and works without API or model credentials.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Use `npm run build` to produce the Pages artifact in `dist/`.

For the same-origin dashboard and backend, use Docker Compose and open `http://localhost:8080`. FastAPI includes OpenAPI documentation at `/docs`.

```sh
docker compose up --build --wait
```

If an organization intercepts registry HTTPS with a trusted internal CA, use a Compose overlay that declares a build secret named `build_ca` and points its file at the host's trusted PEM bundle. The Dockerfile mounts it for npm and pip during installation, with TLS verification enabled.

For Python development and data regeneration, use Python 3.12.

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
python -m backend.engine --export src/demo.json
python -m backend.engine --records 1470 --sales /tmp/fva-sales.jsonl
python -m backend.warehouse /tmp/fva.duckdb /tmp/fva-sales.jsonl /tmp/fva-sales.parquet
python -m pytest -q
npm test
npx playwright install chromium
npm run test:e2e
```

Start the FastAPI dev server with `uvicorn backend.api:app --port 8000`. Start Vite with `VITE_USE_API=true npm run dev` to route replay and investigation through the local API.

## Measured model results

The benchmark uses 252 synthetic daily observations from three chronological 14-day windows across six SKUs. The grocery promotion walkthrough uses hand-authored historical scenarios independent of this benchmark.

| Model | WAPE | MAE | RMSE | MASE | Mean bias |
| --- | ---: | ---: | ---: | ---: | ---: |
| Seasonal naive | 8.71% | 8.76 | 12.11 | 0.97 | −0.58 |
| 7-day moving average | 9.56% | 9.62 | 11.79 | 1.07 | −0.33 |
| Gradient Boosting | 5.36% | 5.39 | 6.56 | 0.60 | −4.29 |

Gradient Boosting scored 5.02% WAPE on the final 84-observation holdout. P10–P90 coverage was 73.41% against nominal 80%, so these intervals were undercovered. The moving average had worse WAPE than the seasonal baseline.

## Deployment

The GitHub Actions workflow validates artifact regeneration, Python, browser and frontend tests, npm dependencies, and the production build. On `main` it can publish the static build when the repository's Pages source is configured to use GitHub Actions.

The [Cloud Run Terraform profile](infrastructure/cloud-run/main.tf) describes an IAM-gated deployment. It requires a billing-enabled GCP project, the Cloud Run and IAM APIs, a pushed container pinned by digest, and permissions for the deployment principal and image reader. Review a Terraform plan before applying it. The profile leaves invocation permissions to the project administrator.

See the [methodology, data dictionary, and architecture](docs/methodology.md) for data contracts, evidence boundaries, and implementation scope.

## Live demand lab

Open **Live demand lab** to run a continuous synthetic experiment. Switch between normal trade, promotion surge, and demand shift. The two forecasts are scored against the same simulated actuals, with decisions calculated before the actuals are generated. The comparison measures forecast error under the simulator's assumptions.

The browser retains the last 600 observations and keeps a separate, arbitrary-precision event counter. The CLI uses the same generator and streams newline-delimited JSON with backpressure. Omit `--count` for a stream that runs until stopped or until its consumer closes. Use the next sequence number and the same regime to resume a segment. Keep the regime schedule externally if replaying a run with regime changes.

```sh
node scripts/demand-stream.mjs --regime 'Demand shift' --count 100000 > demand.ndjson
node scripts/demand-stream.mjs --regime 'Promotion surge' --start 9007199254740999 --count 3
node scripts/demand-stream.mjs | head -n 5
```
