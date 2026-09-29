"""Production intelligence: simplified planning LP (HiGHS) for a 15 MMTPA, NCI 11.67-class refinery.

Illustrative, synthetic yields/capacities/prices — a planning aid, not an optimizer of record.
"""
from __future__ import annotations

import json
import math
from typing import Any

import numpy as np

from .config import DATA

USD_INR = 84.0
BBL_PER_T = {"Diesel": 7.45, "Petrol": 8.45, "ATF": 7.9, "LPG": 11.6, "Naphtha": 8.9, "Fuel Oil": 6.7}

# month-level plan (kt / month). CDU 1250 kt/m ≈ 15 MMTPA.
CAP = {"CDU": 1250.0, "HCU": 280.0, "PFCC": 190.0, "COKER": 160.0, "CCR": 120.0}
YIELD = {
    "CDU": {"LPG": 0.02, "Naphtha": 0.16, "ATF": 0.10, "Diesel": 0.24, "VGO": 0.30, "Residue": 0.18},
    "HCU": {"Diesel": 0.52, "ATF": 0.20, "Naphtha": 0.14, "LPG": 0.06},            # VGO feed
    "PFCC": {"Propylene": 0.18, "Petrol": 0.42, "Diesel": 0.14, "LPG": 0.10, "Petcoke": 0.06},  # VGO feed
    "COKER": {"Petcoke": 0.30, "Diesel": 0.28, "Naphtha": 0.14, "LPG": 0.05},      # Residue feed
    "CCR": {"Petrol": 0.72, "Paraxylene": 0.12, "Benzene": 0.06, "LPG": 0.04},       # Naphtha feed
}
BASE_MARGIN = {  # USD / tonne net-back over crude (illustrative)
    "Diesel": 128.0, "Petrol": 104.0, "ATF": 131.0, "LPG": 40.0, "Naphtha": 12.0, "Propylene": 175.0,
    "Paraxylene": 190.0, "Benzene": 150.0, "Petcoke": -70.0, "Fuel Oil": -35.0, "Sulphur": 20.0,
}
MAX_SALES = {"Diesel": 560.0, "Petrol": 240.0, "ATF": 175.0, "LPG": 90.0, "Naphtha": 260.0, "Propylene": 40.0,
             "Paraxylene": 22.0, "Benzene": 10.0, "Petcoke": 999.0, "Fuel Oil": 999.0}
MIN_SALES = {"Diesel": 380.0, "Petrol": 150.0, "ATF": 90.0, "LPG": 40.0}


def _history() -> list[dict[str, Any]]:
    p = DATA / "structured" / "production.json"
    if p.exists():
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            out = []
            for m in d.get("months", []):
                for prod, v in (m.get("demand_kt") or {}).items():
                    out.append({"month": m["month"], "product": prod, "demand_kt": v})
            return out
        except Exception:
            pass
    return []


def overview() -> dict[str, Any]:
    hist = _history()
    series: list[dict[str, Any]] = []
    months: list[str] = []
    diesel: list[float] = []
    for r in hist:
        m = r.get("month") or r.get("date")
        prod = r.get("product")
        val = r.get("demand_kt")
        if prod is None and isinstance(r.get("products"), dict):
            for k, v in r["products"].items():
                series.append({"month": m, "product": k, "demand_kt": v})
            continue
        if m and prod and val is not None:
            series.append({"month": m, "product": prod, "demand_kt": val})
    for s in series:
        if s["product"] == "Diesel":
            months.append(s["month"])
            diesel.append(float(s["demand_kt"]))
    if not diesel:  # synthetic fallback
        rng = np.random.default_rng(2026)
        months = [f"{2023 + (9 + i) // 12}-{(9 + i) % 12 + 1:02d}" for i in range(36)]
        diesel = [470 + 1.2 * i + 35 * math.sin(2 * math.pi * (i % 12) / 12) + rng.normal(0, 8) for i in range(36)]
        series = [{"month": m, "product": "Diesel", "demand_kt": round(v, 1)} for m, v in zip(months, diesel)]
    # forecast: seasonal naive + drift with growing interval (statsforecast-lite)
    y = np.array(diesel)
    season = 12 if len(y) >= 24 else 1
    drift = (y[-1] - y[0]) / max(len(y) - 1, 1)
    resid = y[season:] - y[:-season] if season > 1 else np.diff(y)
    sd = float(np.std(resid)) or 10.0
    last_y, last_m = int(months[-1][:4]), int(months[-1][5:7])
    fc = []
    for h in range(1, 7):
        mm = (last_m - 1 + h) % 12 + 1
        yy = last_y + (last_m - 1 + h) // 12
        base = y[-season + (h - 1) % season] if season > 1 else y[-1]
        f = float(base + drift * h * (season if season > 1 else 1) / max(season, 1))
        band = 1.28 * sd * math.sqrt(h)
        fc.append({"month": f"{yy}-{mm:02d}", "product": "Diesel", "forecast_kt": round(f, 1),
                   "lo": round(f - band, 1), "hi": round(f + band, 1)})
    total = sum(v for k, v in MAX_SALES.items() if v < 900)
    return {
        "capacity_mmtpa": 15.0, "nci": 11.67,
        "products": [{"name": k, "share_pct": round(100 * v / total, 1), "margin_usd_t": BASE_MARGIN[k]}
                     for k, v in MAX_SALES.items() if v < 900],
        "history": [s for s in series if s["product"] == "Diesel"] + fc,
        "note": "Synthetic, illustrative planning data — not MRPL data.",
    }


def solve(hcu_down_days: float = 0, diesel_crack_delta: float = 0, petchem_margin_delta: float = 0,
          crude_price_delta: float = 0) -> dict[str, Any]:
    import highspy

    def run(hcu_avail: float, margins: dict[str, float]) -> dict[str, Any]:
        h = highspy.Highs()
        h.setOptionValue("output_flag", False)
        inf = highspy.kHighsInf
        # variables: throughputs CDU, HCU, PFCC, COKER, CCR ; sales per product ; VGO/Residue/Naphtha to fuel oil/naphtha sale
        prods = list(MAX_SALES)
        var = ["CDU", "HCU", "PFCC", "COKER", "CCR"] + [f"S_{p}" for p in prods]
        idx = {v: i for i, v in enumerate(var)}
        n = len(var)
        cost = np.zeros(n)
        crude_cost = 0.0 + crude_price_delta * 7.33  # USD/t per $/bbl
        cost[idx["CDU"]] = crude_cost
        for p in prods:
            cost[idx[f"S_{p}"]] = margins[p]
        lb = np.zeros(n)
        ub = np.full(n, inf)
        ub[idx["CDU"]] = CAP["CDU"]
        ub[idx["HCU"]] = CAP["HCU"] * hcu_avail
        ub[idx["PFCC"]] = CAP["PFCC"]
        ub[idx["COKER"]] = CAP["COKER"]
        ub[idx["CCR"]] = CAP["CCR"]
        for p in prods:
            ub[idx[f"S_{p}"]] = MAX_SALES[p]
            lb[idx[f"S_{p}"]] = 0.0
        h.addVars(n, lb, ub)
        h.changeColsCost(n, np.arange(n, dtype=np.int32), cost)
        h.changeObjectiveSense(highspy.ObjSense.kMaximize)
        rows: list[str] = []

        def add_row(name: str, coefs: dict[str, float], lo: float, hi: float) -> None:
            ii = np.array([idx[k] for k in coefs], dtype=np.int32)
            vv = np.array(list(coefs.values()), dtype=float)
            h.addRow(lo, hi, len(ii), ii, vv)
            rows.append(name)

        # intermediate balances: VGO -> HCU + PFCC (excess to Fuel Oil); Residue -> Coker (excess Fuel Oil); Naphtha pool -> CCR + sales
        add_row("VGO balance", {"HCU": 1, "PFCC": 1, "CDU": -YIELD["CDU"]["VGO"]}, -inf, 0)
        add_row("Residue balance", {"COKER": 1, "CDU": -YIELD["CDU"]["Residue"]}, -inf, 0)
        # product balances: sales ≤ production (fuel oil absorbs leftover VGO/residue)
        for p in prods:
            coefs: dict[str, float] = {f"S_{p}": 1}
            for u in ["CDU", "HCU", "PFCC", "COKER", "CCR"]:
                y = YIELD[u].get(p, 0.0)
                if y:
                    coefs[u] = coefs.get(u, 0) - y
            if p == "Naphtha":
                coefs["CCR"] = coefs.get("CCR", 0) + 1.0
            if p == "Fuel Oil":
                coefs.update({"CDU": -(YIELD["CDU"]["VGO"] + YIELD["CDU"]["Residue"]), "HCU": 1.0, "PFCC": 1.0, "COKER": 1.0})
            add_row(f"{p} balance", coefs, -inf, 0)
        for p, mn in MIN_SALES.items():
            add_row(f"{p} contract min", {f"S_{p}": 1}, mn, inf)
        h.run()
        sol = h.getSolution()
        x = sol.col_value
        duals = sol.row_dual
        info = h.getInfo()
        sales = {p: round(float(x[idx[f"S_{p}"]]), 1) for p in prods}
        units = {u: round(float(x[idx[u]]), 1) for u in ["CDU", "HCU", "PFCC", "COKER", "CCR"]}
        margin_usd = float(info.objective_function_value) * 1000  # kt → t
        binding = [f"{u} at capacity" for u in units if ub[idx[u]] < inf and abs(units[u] - ub[idx[u]]) < 1e-3]
        binding += [f"{p} market limit" for p in prods if MAX_SALES[p] < 900 and abs(sales[p] - MAX_SALES[p]) < 1e-3]
        shadow = sorted(
            [{"constraint": r, "value_usd_per_t": round(float(d), 1)} for r, d in zip(rows, duals) if abs(d) > 1e-6],
            key=lambda s: -abs(s["value_usd_per_t"]))[:6]
        # capacity shadow prices = reduced costs of throughput vars at bound
        rc = sol.col_dual
        for u in ["HCU", "PFCC", "COKER", "CCR", "CDU"]:
            if abs(rc[idx[u]]) > 1e-6:
                shadow.append({"constraint": f"+1 kt {u} capacity", "value_usd_per_t": round(float(rc[idx[u]]), 1)})
        return {"sales": sales, "units": units, "margin_cr": round(margin_usd * USD_INR / 1e7, 2),
                "binding": binding, "shadow": shadow}

    base_m = dict(BASE_MARGIN)
    scen_m = dict(BASE_MARGIN)
    scen_m["Diesel"] += diesel_crack_delta * BBL_PER_T["Diesel"]
    for p in ("Propylene", "Paraxylene", "Benzene"):
        scen_m[p] += petchem_margin_delta
    avail = max(0.0, 1 - hcu_down_days / 30.0)
    base = run(1.0, base_m)
    scen = run(avail, scen_m)
    delta = {p: (round(100 * (scen["sales"][p] - base["sales"][p]) / base["sales"][p], 1) if base["sales"][p] > 1e-6 else 0.0)
             for p in base["sales"]}
    assumptions = [
        "Monthly LP, simplified fixed-yield units (CDU, HCU, PFCC, Coker, CCR); linear blending ignored for brevity.",
        f"HCU availability {avail * 100:.0f}% ({hcu_down_days:g} days down); diesel crack Δ {diesel_crack_delta:+g} $/bbl; "
        f"petchem margin Δ {petchem_margin_delta:+g} $/t; crude Δ {crude_price_delta:+g} $/bbl.",
        "Contract minimums: Diesel 380, Petrol 150, ATF 90, LPG 40 kt/month; market caps per product.",
        "Synthetic, illustrative yields and margins — not MRPL data. Advisory only: planners decide; no DCS/SCADA writes.",
    ]
    return {"baseline": base["sales"], "scenario": scen["sales"], "units_baseline": base["units"], "units_scenario": scen["units"],
            "delta_pct": delta, "margin_cr": {"baseline": base["margin_cr"], "scenario": scen["margin_cr"]},
            "binding": scen["binding"], "shadow_prices": [{"constraint": s["constraint"], "value": s["value_usd_per_t"]} for s in scen["shadow"]],
            "assumptions": assumptions}
