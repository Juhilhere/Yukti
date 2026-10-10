"""Demand forecast with uncertainty, for production planning.

Input is authorised history only: monthly demand / sales per product entered (or imported) by the planner in the plant
model. Nothing is invented: a product without enough history gets no forecast and the optimizer then uses only the
planner's own limits.

Method: Holt's linear exponential smoothing (level + trend), smoothing constants chosen by least squares on the history,
with a prediction interval from the one-step-ahead errors (widening with the horizon). Short histories (3-5 points)
fall back to the mean with the sample spread. This is deliberately simple and explainable; it estimates, the optimizer
calculates, planners decide.
"""
from __future__ import annotations

import math
from typing import Any

Z80 = 1.2816  # two-sided 80 % interval


def _holt(y: list[float], a: float, b: float) -> tuple[float, float, list[float]]:
    level, trend = y[0], y[1] - y[0]
    errs = []
    for t in range(1, len(y)):
        pred = level + trend
        errs.append(y[t] - pred)
        new_level = a * y[t] + (1 - a) * (level + trend)
        trend = b * (new_level - level) + (1 - b) * trend
        level = new_level
    return level, trend, errs


def forecast_series(values: list[float], horizon: int = 1) -> dict[str, Any] | None:
    y = [float(v) for v in values if v is not None]
    if len(y) < 3:
        return None
    if len(y) < 6:
        m = sum(y) / len(y)
        sd = math.sqrt(sum((v - m) ** 2 for v in y) / (len(y) - 1))
        half = Z80 * sd * math.sqrt(1 + 1 / len(y))
        return {"expected": round(m, 2), "low": round(max(0.0, m - half), 2), "high": round(m + half, 2), "method": "mean (short history)",
                "n": len(y), "params": {}}
    best = None
    for a in [x / 10 for x in range(1, 10)]:
        for b in [x / 10 for x in range(0, 6)]:
            lv, tr, errs = _holt(y, a, b)
            sse = sum(e * e for e in errs[1:])
            if best is None or sse < best[0]:
                best = (sse, a, b, lv, tr, errs)
    sse, a, b, lv, tr, errs = best  # type: ignore[misc]
    exp = lv + horizon * tr
    sd = math.sqrt(sse / max(1, len(errs) - 2))
    # variance of an h-step Holt forecast grows with the horizon
    var_h = sd * sd * (1 + sum((a * (1 + j * b)) ** 2 for j in range(1, horizon)))
    half = Z80 * math.sqrt(var_h)
    return {"expected": round(max(0.0, exp), 2), "low": round(max(0.0, exp - half), 2), "high": round(max(0.0, exp + half), 2),
            "method": "Holt linear smoothing", "n": len(y), "params": {"alpha": a, "beta": b, "residual_sd": round(sd, 3)}}


def forecast_model(model: dict[str, Any], horizon: int = 1) -> dict[str, Any]:
    """Forecast for every product with history in the plant model: {product: {expected, low, high, method, n}}."""
    out: dict[str, Any] = {}
    for p in model.get("products", []) or []:
        hist = p.get("demand_history") or []
        vals = [h.get("kt") for h in sorted(hist, key=lambda h: str(h.get("month")))
                if isinstance(h, dict) and isinstance(h.get("kt"), (int, float))]
        f = forecast_series(vals, horizon)
        if f:
            out[p["name"]] = {**f, "last_month": max(str(h.get("month")) for h in hist), "unit": "kt/month"}
    return out
