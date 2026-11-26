"""Bounded, prequential retail forecasting for ordered, granular demand totals."""
from collections import deque
from dataclasses import dataclass, field
from math import ceil
from threading import Lock
from typing import Annotated

import numpy as np
from pydantic import BaseModel, Field, StringConstraints

SeriesId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$")]
FEATURES = 10
WARMUP = 21
MAX_SERIES = 1024
WINDOW = 128


class Sale(BaseModel):
    series: SeriesId
    period: Annotated[int, Field(strict=True, ge=0, le=2**53 - 2)]
    units: Annotated[int, Field(strict=True, ge=0, le=1_000_000)]
    promotion: bool = False
    next_promotion: bool = False


@dataclass
class Model:
    last: int | None = None
    observations: int = 0
    scale: int = 20
    history: deque = field(default_factory=lambda: deque(maxlen=7))
    residuals: deque = field(default_factory=lambda: deque(maxlen=WINDOW))
    weights: np.ndarray = field(default_factory=lambda: np.zeros(FEATURES))
    covariance: np.ndarray = field(default_factory=lambda: np.eye(FEATURES) * 4)
    actual_sum: int = 0
    model_error: float = 0
    baseline_error: float = 0
    scored: int = 0
    anomaly_count: int = 0
    interval_scored: int = 0
    next_forecast: dict = field(default_factory=dict)
    last_comparison: dict | None = None

    def inputs(self, period, promotion):
        lag = self.history[-1] if self.history else 0
        baseline = self.history[0] if len(self.history) == 7 else lag
        weekday = period % 7
        features = np.array([1, lag / self.scale, baseline / self.scale, float(promotion),
                             *(float(weekday == day) for day in range(1, 7))])
        return baseline, features

    def predict(self, period, promotion):
        baseline, features = self.inputs(period, promotion)
        estimate = baseline if self.observations < WARMUP else float(self.weights @ features) * self.scale
        return min(1_000_000, max(0, estimate)), baseline

    def observe(self, event: Sale):
        prior = self.next_forecast
        if self.last is None:
            self.scale = max(20, event.units)
        _, features = self.inputs(event.period, event.promotion)
        if self.observations >= WARMUP:
            # Score the prediction actually published before this observation arrived.
            error = abs(event.units - prior["units"])
            naive_error = abs(event.units - prior["baseline"])
            lo, hi = prior["low"], prior["high"]
            outside = lo is not None and not lo <= event.units <= hi
            self.anomaly_count += int(outside)
            self.interval_scored += int(lo is not None)
            self.scored += 1
            self.actual_sum += event.units
            self.model_error += error
            self.baseline_error += naive_error
            self.last_comparison = dict(period=event.period, actual=event.units, predicted=prior["units"],
                                        anomaly=outside, promotion_changed=prior["promotion"] != event.promotion)
            self.residuals.append(error / self.scale)
        target = event.units / self.scale
        projection = self.covariance @ features
        gain = projection / (0.985 + features @ projection)
        self.weights += gain * (target - self.weights @ features)
        self.covariance = (self.covariance - np.outer(gain, projection)) / 0.985
        if self.observations % 32 == 31:
            # Bound covariance in seldom-observed directions during long-running streams.
            symmetric = (self.covariance + self.covariance.T) / 2
            values, vectors = np.linalg.eigh(symmetric)
            self.covariance = (vectors * np.clip(values, 1e-9, 100)) @ vectors.T
        self.history.append(event.units)
        self.last = event.period
        self.observations += 1
        point, next_baseline = self.predict(event.period + 1, event.next_promotion)
        width = None
        if len(self.residuals) >= 20:
            # Empirical rank with a finite-sample correction. Coverage can shift with the data.
            rank = min(len(self.residuals), (9 * (len(self.residuals) + 1) + 9) // 10)
            width = sorted(self.residuals)[rank - 1] * self.scale
        self.next_forecast = dict(period=event.period + 1, units=round(point, 2), baseline=next_baseline,
                                  low=round(max(0, point - width), 2) if width is not None else None,
                                  high=round(point + width, 2) if width is not None else None,
                                  promotion=event.next_promotion)

    def report(self, stock):
        forecast = self.next_forecast.copy()
        if self.last is None:
            return {}
        high = forecast["high"]
        return dict(
            observations=self.observations, scored=self.scored, forecast=forecast, latest=self.last_comparison,
            model_wape=self.model_error / self.actual_sum if self.actual_sum else None,
            baseline_wape=self.baseline_error / self.actual_sum if self.actual_sum else None,
            fva=round(self.baseline_error - self.model_error, 2) if self.scored else None,
            anomalies=self.anomaly_count,
            interval_coverage=1 - self.anomaly_count / self.interval_scored if self.interval_scored else None,
            model="Recursive least squares" if self.observations >= WARMUP else "Seasonal warm-up",
            stock=stock, planning_gap=max(0, ceil(high) - stock) if high is not None else None,
        )


class OnlineForecasts:
    def __init__(self, limit=MAX_SERIES):
        self.models: dict[str, Model] = {}
        self.limit = limit
        self.version = 0
        self.lock = Lock()

    def ingest(self, records: list[Sale]):
        with self.lock:
            periods: dict[str, int] = {}
            accepted = []
            stale = 0
            for record in records:
                model = self.models.get(record.series)
                previous = periods.get(record.series, model.last if model else None)
                if previous is not None and record.period <= previous:
                    stale += 1
                    continue
                if previous is not None and record.period != previous + 1:
                    raise ValueError(f"Missing period for {record.series}. Expected {previous + 1}.")
                periods[record.series] = record.period
                accepted.append(record)
            if len(self.models.keys() | periods.keys()) > self.limit:
                raise OverflowError("Active series capacity reached")
            for record in accepted:
                model = self.models.get(record.series)
                if model is None:
                    model = self.models[record.series] = Model()
                model.observe(record)
            self.version += len(accepted)
            return dict(accepted=len(accepted), stale=stale, version=self.version)

    def snapshot(self, series, stock=0):
        with self.lock:
            model = self.models.get(series)
            return dict(version=self.version, series=series, **model.report(stock)) if model else None

    def catalog(self):
        with self.lock:
            return dict(active=len(self.models), capacity=self.limit, observations=self.version,
                        series=sorted(self.models))
