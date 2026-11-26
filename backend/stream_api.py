"""Authenticated batch ingestion and streaming forecast updates."""
import asyncio
import json
import os
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from .online import OnlineForecasts, Sale, SeriesId

router = APIRouter(prefix="/api/online")
store = OnlineForecasts()
MAX_BODY = 512 * 1024


class Batch(BaseModel):
    records: Annotated[list[Sale], Field(min_length=1, max_length=512)]


def authorize(authorization: Annotated[str | None, Header()] = None):
    token = os.environ.get("FVA_STREAM_TOKEN")
    if not token:
        raise HTTPException(503, "Online forecasts require an operator-configured stream token")
    expected = ("Bearer " + token).encode()
    if not authorization or not secrets.compare_digest(authorization.encode(), expected):
        raise HTTPException(401, "A valid stream token is required", headers={"WWW-Authenticate": "Bearer"})


@router.post("/events", dependencies=[Depends(authorize)])
async def ingest(request: Request):
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_BODY:
            raise HTTPException(413, "Batch exceeds 512 KiB")
        data.extend(chunk)
    try:
        batch = Batch.model_validate_json(data)
    except ValidationError as exc:
        raise HTTPException(422, "Invalid batch or observations") from exc
    try:
        return await asyncio.to_thread(store.ingest, batch.records)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    except OverflowError as exc:
        raise HTTPException(429, str(exc)) from exc


@router.get("/series", dependencies=[Depends(authorize)])
def catalog():
    return store.catalog()


@router.get("/forecast/{series}", dependencies=[Depends(authorize)])
def forecast(series: SeriesId, stock: Annotated[int, Query(ge=0, le=1_000_000)] = 0):
    result = store.snapshot(series, stock)
    if not result:
        raise HTTPException(404, "No observations for this series")
    return result


@router.get("/watch/{series}", dependencies=[Depends(authorize)])
async def watch(request: Request, series: SeriesId, stock: Annotated[int, Query(ge=0, le=1_000_000)] = 0):
    if not store.snapshot(series, stock):
        raise HTTPException(404, "No observations for this series")

    async def messages():
        previous = None
        while not await request.is_disconnected():
            report = store.snapshot(series, stock)
            if report["observations"] != previous:
                previous = report["observations"]
                yield "event: forecast\ndata: " + json.dumps(report) + "\n\n"
            else:
                yield ": heartbeat\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(messages(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
