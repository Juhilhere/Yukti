"""Laya — System-One decision model (v0.1): char+word TF-IDF + logistic-regression heads, exported to ONNX.

Trained at first start from seeded templates (synthetic). Typed output; route is a deterministic rule table.
Also hosts the Company-Guardrail (CG) input classifier used before the domain model.
"""
from __future__ import annotations

import pickle
import random
import re
import time
from pathlib import Path
from typing import Any

import numpy as np

from .config import STORE
from .db import ex, j, now_iso, q1

MODEL_DIR = STORE / "laya"
MODEL_DIR.mkdir(exist_ok=True)
VERSION = "laya-0.3.0"

TAGS = ["A2", "A2B", "P-101", "E-310", "PSV-118", "V-105", "K-401", "B-02", "FE-221", "TR-03", "M-A2"]
UNITS = ["CDU-1", "VDU-1", "HCU", "SRU", "UTIL", "NHT-CCR"]

T: dict[str, list[str]] = {
    "asset_dossier": [
        "{tag} tripped at 02:15 give me the isolation and restart dossier", "{tag} trip — ratings, failure history, open work orders and wiring",
        "full dossier for {tag}", "everything about pump {tag} please", "{tag} ka poora detail chahiye, trip hua hai",
        "what is the rated power and FLA of {tag}", "history of {tag} failures and open WOs", "wiring and feeder of {tag}",
        "{tag} tripped again, need details asap", "show me {tag} datasheet values and isolation points",
    ],
    "procedure_lookup": [
        "procedure to isolate {tag}", "LOTO steps for {tag} motor", "restart procedure after {tag} trip",
        "SOP for electrical isolation of LT motors", "how to do lockout tagout on {tag}", "{tag} restart ka SOP batao",
        "approved troubleshooting procedure for pump trip", "steps to rack out breaker for {tag}",
    ],
    "doc_ingest": [
        "I uploaded a scanned inspection report, extract findings", "read this scanned PDF and summarise", "OCR this attached report",
        "digitise this old letter", "extract readings from the thickness survey scan", "process the uploaded inspection sheet",
    ],
    "finding_review": [
        "review the thickness finding on {tag}", "is the E-310 shell reading below minimum", "approve the inspection finding for {tag}",
        "status of findings pending my approval", "escalate the finding on {tag}",
    ],
    "access_request": [
        "I need access to the finance audit", "request access to confidential report", "give me access to the Q2 audit findings",
        "how do I get permission to view restricted documents", "mujhe finance report ka access chahiye",
    ],
    "asset_expiry": [
        "which certificates expire in the next 30 days", "calibration due list", "when is {tag} calibration due",
        "expired fire extinguishers", "upcoming inspection due dates in {unit}", "PSV ka calibration kab due hai",
        "warranty expiry for {tag}", "licences expiring this month",
    ],
    "production_scenario": [
        "what product mix should we plan next month", "if HCU is down 20 days what happens to diesel", "diesel crack up 3 dollars, change plan?",
        "optimise product slate for november", "petchem margins are weak, should we shift to diesel", "production plan scenario with crude price up",
    ],
    "process_chemistry": [
        "what is the lean MDEA amine strength limit", "caustic wash concentration for LPG treating", "DMDS dosing for catalyst sulphiding",
        "antifoam dosing ppm in amine unit", "H2S loading limit for rich amine", "corrosion inhibitor dosing rate in overhead",
        "amine ka concentration kitna rakhna hai", "safe handling of H2S and exposure limits",
    ],
    "code_task": [
        "write a python script to plot {tag} vibration trend", "generate SQL to list overdue work orders", "code to parse the shift log",
        "make a pandas script for monthly diesel demand",
    ],
    "general_chat": [
        "summarise today's shift log", "who is on call in electrical", "contact number of mechanical maintenance",
        "company history of CDU-1 commissioning", "explain what a mechanical seal plan 11 is", "what does NPSH mean",
    ],
    "company_info": [
        "what is MRPL refining capacity", "who is the managing director of MRPL", "MRPL GRM last financial year", "MRPL revenue and profit",
        "Nelson complexity index of the refinery", "list MRPL products", "polypropylene grades made by MRPL", "how many retail outlets does MRPL have",
        "MRPL shareholding pattern ONGC HPCL", "MRPL history and expansion phases", "which process units does MRPL have", "MRPL sustainability and CSR",
        "MRPL ka turnover kitna hai", "latest news about MRPL", "MRPL crude throughput trend", "MRPL credit rating",
    ],
    "smalltalk": ["hi", "hello", "thanks", "good morning", "who are you", "ok thank you", "namaste"],
}
DEPT = {
    "asset_dossier": "Electrical", "procedure_lookup": "Electrical", "doc_ingest": "Mechanical", "finding_review": "Mechanical",
    "access_request": "Management", "asset_expiry": "Instrumentation", "production_scenario": "Planning",
    "process_chemistry": "Operations", "code_task": "IT", "company_info": "Corporate Communications", "general_chat": "Operations", "smalltalk": "none",
}
ROUTE = {
    "asset_dossier": "small_llm+dossier", "procedure_lookup": "small_llm+rag", "doc_ingest": "ocr_vlm", "finding_review": "small_llm+rag",
    "access_request": "workflow", "asset_expiry": "analytics", "production_scenario": "analytics+optimizer",
    "process_chemistry": "domain_llm+guardrails", "code_task": "sandbox_code", "company_info": "small_llm+rag (public)", "general_chat": "small_llm+rag", "smalltalk": "small_llm",
}
URGENT = re.compile(r"\b(trip|tripped|fire|leak|h2s|gas|emergency|asap|urgent|abhi|immediately|alarm|explosion|injur)", re.I)


def _expand() -> tuple[list[str], list[str]]:
    rnd = random.Random(2026)
    X, y = [], []
    for intent, temps in T.items():
        for t in temps:
            for _ in range(14):
                s = t.format(tag=rnd.choice(TAGS), unit=rnd.choice(UNITS))
                r = rnd.random()
                if r < 0.2:
                    s = s.lower()
                elif r < 0.3:
                    s = s.upper()
                elif r < 0.45:
                    s = s + rnd.choice([" pls", " urgently", " now", " thanks", " sir", " jaldi"])
                elif r < 0.55 and len(s) > 8:
                    i = rnd.randrange(len(s) - 1)
                    s = s[:i] + s[i + 1] + s[i] + s[i + 2:]
                X.append(s)
                y.append(intent)
    return X, y


class Laya:
    def __init__(self) -> None:
        self.pipe = None
        self.onnx = None
        self.runtime = "sklearn"
        self.labels: list[str] = []
        self._load_or_train()

    def _load_or_train(self) -> None:
        pk = MODEL_DIR / f"{VERSION}.pkl"
        if pk.exists():
            self.pipe = pickle.loads(pk.read_bytes())
        else:
            from sklearn.feature_extraction.text import TfidfVectorizer
            from sklearn.linear_model import LogisticRegression
            from sklearn.pipeline import Pipeline
            X, y = _expand()
            self.pipe = Pipeline([("tfidf", TfidfVectorizer(analyzer="word", ngram_range=(1, 2), token_pattern=r"[a-zA-Z0-9]+", sublinear_tf=True)),
                                  ("clf", LogisticRegression(max_iter=2000, C=8.0))])
            self.pipe.fit([x.lower() for x in X], y)
            pk.write_bytes(pickle.dumps(self.pipe))
        self.labels = list(self.pipe.classes_)
        self._try_onnx()

    def _try_onnx(self) -> None:
        on = MODEL_DIR / f"{VERSION}.onnx"
        try:
            import onnxruntime as ort
            if not on.exists():
                from skl2onnx import to_onnx
                from skl2onnx.common.data_types import StringTensorType
                m = to_onnx(self.pipe, initial_types=[("text", StringTensorType([None, 1]))],
                            options={id(self.pipe.steps[-1][1]): {"zipmap": False}}, target_opset=17)
                on.write_bytes(m.SerializeToString())
            self.onnx = ort.InferenceSession(str(on), providers=["CPUExecutionProvider"])
            self.onnx.run(None, {"text": np.array([["warmup"]])})
            self.labels = [str(x) for x in self.onnx.run(None, {"text": np.array([["hi"]])})[0][:0]] or self.labels
            self.runtime = "onnxruntime"
        except Exception:
            self.onnx = None
            self.runtime = "sklearn"

    def _proba(self, text: str) -> np.ndarray:
        if self.onnx is not None:
            try:
                out = self.onnx.run(None, {"text": np.array([[text]])})
                return np.asarray(out[1][0], dtype=float)
            except Exception:
                pass
        return self.pipe.predict_proba([text])[0]

    def classify(self, text: str, has_attachment: bool = False) -> dict[str, Any]:
        t0 = time.perf_counter()
        p = self._proba(text.lower())
        order = np.argsort(-p)
        top, second = int(order[0]), int(order[1])
        intent = self.labels[top]
        conf = float(p[top])
        margin = conf - float(p[second])
        abstain = conf < 0.40 or margin < 0.10
        urg = 0.15
        if URGENT.search(text):
            urg = 0.85 if re.search(r"trip|fire|leak|h2s|emergency|explosion", text, re.I) else 0.6
        dept = DEPT[intent]
        if re.search(r"\b(finance|audit|budget|cost)\b", text, re.I):
            dept = "Finance"
        sens = "restricted" if intent in ("process_chemistry",) or dept == "Finance" else "internal"
        route = "ocr_vlm" if has_attachment else ROUTE[intent]
        if abstain:
            route = "small_llm+rag (fallback: low confidence)"
        needs_review = intent in ("access_request", "finding_review") or urg >= 0.8 or sens == "restricted" or abstain
        dt = (time.perf_counter() - t0) * 1000
        d = {"intent": intent, "department": dept, "urgency": round(urg, 2), "needs_review": needs_review, "sensitivity": sens,
             "route": route, "confidence": round(conf, 3), "abstain": abstain, "latency_ms": round(dt, 2),
             "model_version": f"{VERSION}+{self.runtime}"}
        ex("INSERT INTO laya_log(text, decision_json, latency_ms, at) VALUES(?,?,?,?)", (text[:500], j(d), dt, now_iso()))
        return d

    def stats(self) -> dict[str, Any]:
        r = q1("SELECT COUNT(*) n, AVG(latency_ms) l FROM laya_log")
        rows = q1("SELECT COUNT(*) n FROM laya_log WHERE decision_json NOT LIKE '%\"abstain\": true%'")
        from .db import q
        by: dict[str, int] = {}
        for x in q("SELECT decision_json FROM laya_log ORDER BY id DESC LIMIT 2000"):
            import json
            k = json.loads(x["decision_json"]).get("intent", "?")
            by[k] = by.get(k, 0) + 1
        return {"total": r["n"], "llm_calls_saved": rows["n"], "avg_latency_ms": round(r["l"] or 0, 2),
                "by_intent": by, "model_version": f"{VERSION}+{self.runtime}",
                "baseline_llm_router_ms": 650}


# ---------------------------------------------------------------- Company Guardrail classifier (CG v0.1)
CG_PATTERNS: list[tuple[str, str]] = [
    ("off_domain_harm", r"\b(bomb|ied|explosive device|make (an )?explosive|weapon|nerve agent|sarin|poison (someone|a person)|kill (someone|people)|meth(amphetamine)?|synthesi[sz]e (drugs?|narcotics)|ricin|anthrax)\b"),
    ("control_system_change", r"\b(change|set|increase|decrease|raise|lower|override|bypass|disable|force)\b.{0,40}\b(setpoint|set point|interlock|trip|sis|esd|controller|fic-?\d+|pic-?\d+|tic-?\d+|lic-?\d+|valve position)\b|\bsetpoint\b"),
    ("formulation_confidential", r"\b(proprietary|recipe|formulation|additive package|blend recipe)\b"),
    ("hazmat_handling", r"\b(h2s|hydrogen sulphide|hydrogen sulfide|hf acid|hydrofluoric|benzene exposure|msds|ppe|toxic|flammable|exposure limit|tlv|stel)\b"),
    ("process_chemistry", r"\b(amine|mdea|dea|caustic|naoh|wt ?%|concentration|dosing|dmds|sulphiding|sulfiding|antifoam|inhibitor|acid strength|catalyst|ppm|loading|stoichiometr)\b"),
    ("commercial_confidential", r"\b(audit|budget|capex|cost variance|margin|price negotiation|contract value)\b"),
    ("personal_data", r"\b(salary|aadhaar|pan number|medical record|home address)\b"),
    ("safety_procedure", r"\b(loto|lockout|isolation|permit|restart|procedure|sop)\b"),
    ("asset_info", r"\b(pump|motor|feeder|datasheet|rated|fla|wiring|work order)\b"),
]


def guard_category(text: str) -> str:
    for cat, pat in CG_PATTERNS:
        if re.search(pat, text, re.I):
            return cat
    return "general"


laya: Laya | None = None


def get() -> Laya:
    global laya
    if laya is None:
        laya = Laya()
    return laya
