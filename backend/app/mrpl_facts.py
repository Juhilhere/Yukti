"""Structured search over researched MRPL public facts (each record carries its source URL)."""
from __future__ import annotations

import re
from typing import Any

from .mrpl import TOPICS, load

_SYN = {
    "md": "managing director", "ceo": "managing director ceo", "cfo": "director finance cfo", "capacity": "capacity nameplate",
    "employees": "employees workforce", "staff": "employees", "profit": "pat profit", "turnover": "revenue", "sales": "revenue sales",
    "grm": "gross refining margin grm", "nci": "nelson complexity", "complexity": "nelson complexity", "owner": "shareholding parent",
    "owns": "shareholding parent", "shareholding": "shareholding ongc hpcl", "outlets": "retail outlets hiq", "pumps": "retail outlets hiq",
    "pp": "polypropylene", "throughput": "crude processed throughput", "net zero": "net-zero", "units": "unit process",
}
_STOP = set(("what is the of a an and or in on for to me tell give show list about mrpl's mrpl company refinery how many much who which "
             "are was were does do latest current please its kitna kaun hai ka ki ke").split())


def _records() -> list[dict[str, Any]]:
    d = load()
    recs: list[dict[str, Any]] = []

    def add(topic: str, label: str, value: Any, period: str = "", url: str = "", title: str = "", extra: str = "") -> None:
        if value in (None, "", []):
            return
        recs.append({"topic": topic, "label": str(label), "value": str(value), "period": str(period or ""), "source_url": url or "",
                     "source_title": title or "", "text": f"{label} {value} {period} {extra}".lower()})

    for t in TOPICS:
        for f in (d.get(t) or {}).get("facts", []):
            unit = f.get("unit") or ""
            val = f"{f.get('value')}" + (f" {unit}" if unit and unit not in str(f.get("value")) else "")
            add(t, f.get("label") or f.get("key"), val, f.get("period") or "", f.get("source_url"), f.get("source_title"),
                str(f.get("key", "")).replace("_", " "))
    corp = d.get("corporate") or {}
    for l in corp.get("leadership", []):
        add("corporate", l.get("role", ""), l.get("name"), l.get("since") or "", l.get("source_url"), "", "leadership board director")
    for x in corp.get("timeline", []):
        add("corporate", f"Timeline {x.get('year')}", x.get("event"), str(x.get("year") or ""), x.get("source_url"), "", "history")
    for x in corp.get("departments", []):
        add("corporate", f"Department: {x.get('name')}", x.get("description"), "", x.get("evidence_url"), "", "department function")
    for x in corp.get("subsidiaries_jvs", []):
        add("corporate", f"Related entity: {x.get('name')}", x.get("relation"), "", x.get("source_url"), "", "subsidiary jv joint venture")
    for x in corp.get("awards", []):
        add("corporate", f"Award {x.get('year')}", x.get("award"), str(x.get("year") or ""), x.get("source_url"), "", "award")
    ref = d.get("refinery") or {}
    for u in ref.get("units", []):
        cap = f"{u.get('capacity') or ''} {u.get('unit') or ''}".strip()
        add("refinery", f"Unit {u.get('code') or ''} — {u.get('name') or ''}", cap + (f"; licensor {u['licensor']}" if u.get("licensor") else ""),
            u.get("phase") or "", u.get("source_url"), "", f"process unit {u.get('purpose') or ''}")
    for x in ref.get("infrastructure", []):
        add("refinery", x.get("name", ""), x.get("detail"), "", x.get("source_url"), "", "infrastructure")
    for x in ref.get("throughput", []):
        add("refinery", f"Crude throughput {x.get('fy')}", f"{x.get('crude_mmt')} MMT (utilisation {x.get('utilisation_pct')}%)",
            x.get("fy") or "", x.get("source_url"), "", "throughput processed")
    for x in ref.get("crude_basket", []):
        add("refinery", f"Crude basket: {x.get('item')}", x.get("value"), "", x.get("source_url"), "", "crude basket grades")
    prod = d.get("products") or {}
    for p in prod.get("products", []):
        add("products", f"Product: {p.get('name')}", f"{p.get('category') or ''} — {p.get('uses') or ''}", "", p.get("source_url"), "",
            f"product {p.get('brand_or_grades') or ''} {p.get('spec_standard') or ''} {p.get('markets') or ''}")
    for g in prod.get("pp_grades", []):
        add("products", f"Polypropylene grade {g.get('grade')}", f"MFI {g.get('mfi')} — {g.get('applications') or ''}", "",
            g.get("source_url"), "", "mangpol polypropylene pp grade")
    for m in prod.get("marketing", []):
        add("products", m.get("item", ""), m.get("value"), "", m.get("source_url"), "", "marketing")
    for m in prod.get("launches", []):
        add("products", f"Launch {m.get('date')}: {m.get('product')}", m.get("detail"), m.get("date") or "", m.get("source_url"), "", "launch new product")
    fin = d.get("finance_esg") or {}
    for r in fin.get("financials", []):
        add("finance_esg", f"Financials {r.get('fy')}",
            f"Revenue ₹{r.get('revenue_cr')} Cr; EBITDA ₹{r.get('ebitda_cr')} Cr; PAT ₹{r.get('pat_cr')} Cr; GRM ${r.get('grm_usd_bbl')}/bbl",
            r.get("fy") or "", r.get("source_url"), "", "revenue profit pat grm ebitda turnover financial")
    for r in fin.get("ratings", []):
        add("finance_esg", f"Credit rating ({r.get('agency')})", r.get("rating"), r.get("date") or "", r.get("source_url"), "", "credit rating")
    for r in fin.get("esg", []):
        add("finance_esg", r.get("metric", ""), f"{r.get('value')} {r.get('unit') or ''}".strip(), r.get("period") or "",
            r.get("source_url"), "", "esg sustainability brsr")
    for r in fin.get("digital", []):
        add("finance_esg", f"Digital: {r.get('initiative')}", r.get("detail"), "", r.get("source_url"), "", "digital technology it ai")
    for r in fin.get("news", []):
        add("finance_esg", f"News {r.get('date')}: {r.get('headline')}", r.get("summary"), r.get("date") or "", r.get("source_url"), "", "news")
    return recs


_CACHE: dict[str, Any] = {}


def reset() -> None:
    _CACHE.clear()


def fact_search(query: str, k: int = 10, min_score: float = 4.0) -> list[dict[str, Any]]:
    if "recs" not in _CACHE:
        _CACHE["recs"] = _records()
    ql = query.lower()
    for a, b in _SYN.items():
        if re.search(rf"\b{re.escape(a)}\b", ql):
            ql += " " + b
    toks = {t for t in re.findall(r"[a-z0-9\-]+", ql) if t not in _STOP and len(t) > 1}
    if not toks:
        return []
    scored = []
    for r in _CACHE["recs"]:
        lab = r["label"].lower()
        s = sum((3 if t in lab else 0) + (1 if t in r["text"] else 0) for t in toks)
        if s >= min_score:
            if r["label"].startswith(("News", "Department", "Timeline", "Award", "Launch")):
                s *= 0.6
            scored.append((s, r))
    scored.sort(key=lambda x: -x[0])
    if scored:
        top = scored[0][0]
        scored = [x for x in scored if x[0] >= top * 0.5]  # keep only records close to the best match
    return [r for _, r in scored[:k]]


def looks_like_company_question(text: str) -> bool:
    return bool(re.search(r"\b(mrpl|mangalore refinery|company|md|managing director|chairman|board|revenue|profit|grm|turnover|"
                          r"shareholding|ongc|hpcl|employees|outlets|hiq|mangpol|capacity|nelson|products?|csr|esg|net.?zero|rating|"
                          r"history|department|subsidiar|dividend|exports?)\b", text, re.I))
