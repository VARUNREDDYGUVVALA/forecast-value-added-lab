"""Read-only analytics and a deterministic historical override replay API."""
from typing import Annotated

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from .engine import demo_events, score
from .investigation import Stage, investigate

app = FastAPI(title="Forecast Value Added Scorecard")
forecasts, actuals, products = demo_events()


@app.get("/api/scorecard")
def scorecard(category: str | None = None, override_only: bool = False):
    selected = [p for p in products if category is None or p["category"] == category]
    skus = {p["sku"] for p in selected}
    return {"products": selected, "portfolio": score([x for x in forecasts if x["sku"] in skus],
                                                     [x for x in actuals if x["sku"] in skus],
                                                     override_only=override_only)}


class Replay(BaseModel):
    sku: str
    units: Annotated[int, Field(ge=0, le=100000)]


@app.post("/api/replay")
def replay(proposal: Replay):
    product = next((p for p in products if p["sku"] == proposal.sku), None)
    if product is None:
        raise HTTPException(404, "Unknown product")
    error = abs(proposal.units - product["actual"])
    return {"absolute_error": error, "fva": abs(product["promotion"] - product["actual"]) - error}


@app.get("/api/health")
def health():
    return {"status": "ok"}


class InvestigationRequest(BaseModel):
    sku: Annotated[str, Field(min_length=1, max_length=40)]
    stage: Stage


@app.post("/api/investigate")
def run_investigation(request: InvestigationRequest):
    try:
        return investigate(request.sku, request.stage)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
