"""Deterministic ABAC policy decision point (PDP) over YAML policy-as-data.

The LLM never calls this and never supplies its inputs: subject attributes come from the session/DB,
resource attributes from DB rows. Combining algorithm: deny-overrides, default deny.
"""
from __future__ import annotations

import fnmatch
import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from simpleeval import EvalWithCompoundTypes

from .config import POLICY_FILE


@dataclass
class Subject:
    id: str
    username: str
    display_name: str
    post: str
    department: str
    clearance: int
    roles: list[str]
    asset_scopes: list[str]
    grants: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class Decision:
    effect: str  # allow | deny
    matched: list[str]
    reason: str
    policy_version: int

    @property
    def allowed(self) -> bool:
        return self.effect == "allow"


class Obj(dict):
    """dict with attribute access for policy expressions."""

    def __getattr__(self, k: str) -> Any:
        try:
            return self[k]
        except KeyError as e:
            raise AttributeError(k) from e


def _tags_match(units: list[str], scopes: list[str]) -> bool:
    """True if any of the resource's plant units is inside one of the subject's asset scopes (globs)."""
    return any(fnmatch.fnmatch(u, sc) for u in (units or []) for sc in (scopes or []))


def _grant_covers(subject: Obj, resource: Obj, action: str) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    for g in subject.get("grants", []):
        if g.get("expires_at", "") <= now:
            continue
        if g.get("document_id") and g["document_id"] != resource.get("id"):
            continue
        if g.get("department") and g["department"] != resource.get("department"):
            continue
        if g.get("doc_type") and g["doc_type"] != resource.get("doc_type"):
            continue
        # a grant never reaches above the classification ceiling set by its approver (at most the approver's own clearance)
        if g.get("max_classification") is not None and int(resource.get("classification", 0)) > int(g["max_classification"]):
            continue
        return True
    return False


class PDP:
    def __init__(self) -> None:
        self.reload()

    def reload(self) -> None:
        text = POLICY_FILE.read_text(encoding="utf-8")
        self.yaml_text = text
        self.sha = hashlib.sha256(text.encode()).hexdigest()
        doc = yaml.safe_load(text)
        self.version = int(doc.get("version", 1))
        self.rules = doc["rules"]
        # validate expressions parse
        for r in self.rules:
            r.setdefault("actions", ["*"])
            r.setdefault("resources", ["*"])

    def decide(self, subject: Subject, action: str, resource: dict[str, Any], env: dict[str, Any] | None = None) -> Decision:
        s = Obj(subject.__dict__)
        r = Obj(resource)
        e = Obj(env or {})
        names = {"subject": s, "resource": r, "env": e, "action": action, "True": True, "False": False}
        funcs = {
            "tags_match": _tags_match,
            "grant_covers": lambda subj, res, act: _grant_covers(subj, res, act),
            "len": len,
            "set": set,
        }
        ev = EvalWithCompoundTypes(names=names, functions=funcs)
        allows: list[str] = []
        for rule in self.rules:
            if not any(fnmatch.fnmatch(action, a) for a in rule["actions"]):
                continue
            if not any(fnmatch.fnmatch(resource.get("type", ""), t) for t in rule["resources"]):
                continue
            try:
                hit = bool(ev.eval(rule["when"])) if rule.get("when") else True
            except Exception:
                hit = rule["effect"] == "deny"  # fail closed
            if not hit:
                continue
            if rule["effect"] == "deny":
                return Decision("deny", [rule["id"]], rule.get("reason", rule["id"]), self.version)
            allows.append(rule["id"])
        if allows:
            return Decision("allow", allows, "allowed", self.version)
        return Decision("deny", ["DEFAULT-DENY"], "no rule allows this", self.version)


pdp = PDP()
