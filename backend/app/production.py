"""Production intelligence — no invented numbers.

- Overview charts use MRPL's PUBLISHED production / financial data (with source URLs) from data/mrpl/*.json.
- The planning LP (HiGHS) runs on a plant model that the planner/admin enters in Yukti. Only publicly published unit
  capacities are pre-filled; yields, prices and contract limits start EMPTY and the optimizer refuses to run until they exist.
"""
from __future__ import annotations

import re
from typing import Any

from . import mrpl
from .db import get_setting, set_setting


# ------------------------------------------------------------------ public overview
def overview() -> dict[str, Any]:
    d = mrpl.load()
    prod = (d.get("products") or {}).get("production_sales", [])
    fin = (d.get("finance_esg") or {}).get("financials", [])
    thr = (d.get("refinery") or {}).get("throughput", [])
    nci = [f for t in ("refinery", "corporate", "finance_esg") for f in (d.get(t) or {}).get("facts", [])
           if re.search(r"complexity", str(f.get("label", "")), re.I)]
    cap = next((f for f in (d.get("corporate") or {}).get("facts", []) if f.get("key") == "refining_capacity"), None)
    model = get_model()
    return {
        "capacity_mmtpa": float(cap["value"]) if cap else None, "capacity_source": cap.get("source_url") if cap else None,
        "nci": 11.67 if any("11.67" in str(f.get("value")) for f in nci) else None,
        "nci_sources": [{"value": f.get("value"), "label": f.get("label"), "period": f.get("period"), "source_url": f.get("source_url")} for f in nci],
        "public": {"production_by_fy": prod, "financials": fin, "throughput": thr},
        "model_complete": model["complete"], "note": "All figures are MRPL's published data with source links.",
    }


# ------------------------------------------------------------------ plant model (entered by planner)
def _kt_month(capacity: Any, unit: str) -> float | None:
    try:
        v = float(str(capacity).replace(",", "").split()[0])
    except Exception:
        return None
    u = (unit or "").upper()
    if "MMTPA" in u:
        return round(v * 1000 / 12, 2)
    if "KTPA" in u or "TMTPA" in u:
        return round(v / 12, 2)
    return None  # other units (KBPSD, MW, KLPD…) are not converted — planner enters them


def default_model() -> dict[str, Any]:
    d = mrpl.load()
    units = []
    for u in (d.get("refinery") or {}).get("units", []):
        cap = _kt_month(u.get("capacity"), u.get("unit") or "")
        if cap is None:
            continue
        units.append({"code": u.get("code") or u.get("name"), "name": u.get("name"), "capacity": u.get("capacity"), "unit": u.get("unit"),
                      "capacity_kt_month": cap, "source_url": u.get("source_url"), "feed": "", "yields": {}, "enabled": False})
    names = []
    for r in (d.get("products") or {}).get("production_sales", []):
        n = r.get("product")
        if n and n not in names:
            names.append(n)
    products = [{"name": n, "price_usd_t": None, "min_kt": None, "max_kt": None} for n in names]
    return {"units": units, "products": products, "crude_cost_usd_t": None, "notes": ""}


def get_model() -> dict[str, Any]:
    m = get_setting("production_model") or default_model()
    m["missing"] = validate(m)
    m["complete"] = not m["missing"]
    return m


def _check_numbers(m: dict[str, Any]) -> list[str]:
    """Physical values can never be negative; yields are fractions of the feed."""
    bad: list[str] = []

    def num(v: Any) -> float | None:
        if v in (None, ""):
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return float("nan")

    def check(label: str, v: Any, hi: float | None = None) -> None:
        x = num(v)
        if x is None:
            return
        if x != x or x < 0 or (hi is not None and x > hi):
            bad.append(f"{label} must be a number {'between 0 and ' + str(hi) if hi is not None else 'of 0 or more'} (got {v}).")

    check("Crude cost (US$/t)", m.get("crude_cost_usd_t"))
    for u in m.get("units", []) or []:
        code = u.get("code") or "unit"
        check(f"{code}: capacity (kt/month)", u.get("capacity_kt_month"))
        for k in ("min_kt_month", "opex_usd_t"):
            if k in u:
                check(f"{code}: {k}", u.get(k))
        for prod, y in (u.get("yields") or {}).items():
            check(f"{code}: yield of {prod}", y, 1.0)
    for pr in m.get("products", []) or []:
        for k in ("price_usd_t", "min_demand_kt", "max_demand_kt"):
            if k in pr:
                check(f"{pr.get('name', 'product')}: {k}", pr.get(k))
    return bad


def save_model(m: dict[str, Any], by: str) -> dict[str, Any]:
    bad = _check_numbers(m)
    if bad:
        from .i18n import tr
        raise ValueError(" ".join(tr(b) for b in bad[:6]))
    clean = {"units": m.get("units", []), "products": m.get("products", []), "crude_cost_usd_t": m.get("crude_cost_usd_t"),
             "notes": m.get("notes", "")}
    set_setting("production_model", clean, by)
    return get_model()


def validate(m: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    active = [u for u in m.get("units", []) if u.get("enabled")]
    if not active:
        missing.append("Enable at least one process unit and enter its feed and product yields.")
    if m.get("crude_cost_usd_t") in (None, ""):
        missing.append("Crude cost (US$/t).")
    prod_names = {p["name"] for p in m.get("products", [])}
    for u in active:
        if not u.get("capacity_kt_month"):
            missing.append(f"{u['code']}: capacity (kt/month).")
        if not u.get("feed"):
            missing.append(f"{u['code']}: feed (\"crude\" or an intermediate product).")
        ys = {k: v for k, v in (u.get("yields") or {}).items() if v not in (None, "")}
        if not ys:
            missing.append(f"{u['code']}: product yields.")
        elif sum(float(v) for v in ys.values()) > 1.0001:
            missing.append(f"{u['code']}: yields sum to more than 1.")
        for p in ys:
            if p not in prod_names:
                missing.append(f"{u['code']}: yield product '{p}' is not in the product list.")
    produced = {p for u in active for p, v in (u.get("yields") or {}).items() if v not in (None, "")}
    for p in m.get("products", []):
        if p["name"] in produced and p.get("price_usd_t") in (None, ""):
            missing.append(f"{p['name']}: net-back price (US$/t).")
    return missing


# ------------------------------------------------------------------ optimizer
def solve(body: dict[str, Any]) -> dict[str, Any]:
    import highspy

    m = get_model()
    if not m["complete"]:
        return {"error": "model_incomplete", "missing": m["missing"]}
    down: dict[str, float] = {k: float(v) for k, v in (body.get("unit_down_days") or {}).items()}
    if body.get("hcu_down_days"):
        for u in m["units"]:
            if "HCU" in str(u["code"]).upper() or "HYDROCRACK" in str(u.get("name", "")).upper():
                down[u["code"]] = float(body["hcu_down_days"])
    price_delta: dict[str, float] = {k: float(v) for k, v in (body.get("price_delta_usd_t") or {}).items()}
    if body.get("petchem_margin_delta"):
        for p in m["products"]:
            if re.search(r"polyprop|paraxyl|benzene|xylene", p["name"], re.I):
                price_delta[p["name"]] = price_delta.get(p["name"], 0) + float(body["petchem_margin_delta"])
    crude_delta = float(body.get("crude_cost_delta_usd_t") or 0)

    def run(apply: bool) -> dict[str, Any]:
        h = highspy.Highs()
        h.setOptionValue("output_flag", False)
        inf = highspy.kHighsInf
        units = [u for u in m["units"] if u.get("enabled")]
        prods = [p["name"] for p in m["products"]]
        var = [f"U:{u['code']}" for u in units] + [f"S:{p}" for p in prods]
        idx = {v: i for i, v in enumerate(var)}
        n = len(var)
        import numpy as np
        lb, ub, cost = np.zeros(n), np.full(n, inf), np.zeros(n)
        crude_cost = float(m["crude_cost_usd_t"]) + (crude_delta if apply else 0)
        for u in units:
            i = idx[f"U:{u['code']}"]
            avail = max(0.0, 1 - (down.get(u["code"], 0) / 30.0 if apply else 0))
            ub[i] = float(u["capacity_kt_month"]) * avail
            if u["feed"] == "crude":
                cost[i] = -crude_cost
        for p in m["products"]:
            i = idx[f"S:{p['name']}"]
            price = p.get("price_usd_t")
            cost[i] = (float(price) + (price_delta.get(p["name"], 0) if apply else 0)) if price not in (None, "") else 0.0
            if p.get("max_kt") not in (None, ""):
                ub[i] = float(p["max_kt"])
            if p.get("min_kt") not in (None, ""):
                lb[i] = float(p["min_kt"])
        h.addVars(n, lb, ub)
        h.changeColsCost(n, np.arange(n, dtype=np.int32), cost)
        h.changeObjectiveSense(highspy.ObjSense.kMaximize)
        rows: list[str] = []
        for p in prods:  # sales + feed consumption ≤ production
            coefs: dict[int, float] = {idx[f"S:{p}"]: 1.0}
            for u in units:
                y = float((u.get("yields") or {}).get(p) or 0)
                if y:
                    coefs[idx[f"U:{u['code']}"]] = coefs.get(idx[f"U:{u['code']}"], 0) - y
                if u["feed"] == p:
                    coefs[idx[f"U:{u['code']}"]] = coefs.get(idx[f"U:{u['code']}"], 0) + 1.0
            ii = np.array(list(coefs), dtype=np.int32)
            h.addRow(-inf, 0, len(ii), ii, np.array(list(coefs.values())))
            rows.append(f"{p} balance")
        st = h.run()
        status = h.modelStatusToString(h.getModelStatus())
        if status != "Optimal":
            return {"status": status}
        sol = h.getSolution()
        x, rc, duals = sol.col_value, sol.col_dual, sol.row_dual
        sales = {p: round(float(x[idx[f"S:{p}"]]), 2) for p in prods}
        thr = {u["code"]: round(float(x[idx[f"U:{u['code']}"]]), 2) for u in units}
        binding = [f"{c} at capacity" for c in thr if ub[idx[f"U:{c}"]] < inf and abs(thr[c] - ub[idx[f"U:{c}"]]) < 1e-6]
        shadow = [{"constraint": f"+1 kt/month {c} capacity", "value": round(float(rc[idx[f"U:{c}"]]) * 1000, 1)}
                  for c in thr if abs(rc[idx[f"U:{c}"]]) > 1e-9]
        shadow += [{"constraint": r, "value": round(float(dv) * 1000, 1)} for r, dv in zip(rows, duals) if abs(dv) > 1e-9]
        return {"status": status, "sales": sales, "units": thr, "margin_usd": round(h.getInfo().objective_function_value * 1000, 0),
                "binding": binding, "shadow": shadow}

    base, scen = run(False), run(True)
    if base.get("status") != "Optimal" or scen.get("status") != "Optimal":
        return {"error": "infeasible", "missing": [f"Optimizer status: baseline {base.get('status')}, scenario {scen.get('status')} — check limits."]}
    delta = {p: (round(100 * (scen["sales"][p] - base["sales"][p]) / base["sales"][p], 1) if base["sales"][p] > 1e-9 else 0.0)
             for p in base["sales"]}
    return {"baseline": base["sales"], "scenario": scen["sales"], "units_baseline": base["units"], "units_scenario": scen["units"],
            "delta_pct": delta, "margin_usd": {"baseline": base["margin_usd"], "scenario": scen["margin_usd"]},
            "binding": scen["binding"], "shadow_prices": scen["shadow"],
            "assumptions": ["Linear model of the plant as entered by the planner in Yukti (capacities, yields, prices, limits).",
                            f"Scenario: unit downtime {down or 'none'}, price changes {price_delta or 'none'}, crude cost change {crude_delta:+g} US$/t.",
                            "Advisory only — planners decide; Yukti never writes to DCS/SCADA."]}
