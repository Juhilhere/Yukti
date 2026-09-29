"""Department and rank scoping for everything that is not a document (assets, alerts, findings, audit, CMMS records).

Documents are decided by the ABAC policy (policies/core.yaml). Plant records that have no source document (asset master,
CMMS work orders, on-call contacts) are decided by the same policy as a pseudo-document owned by the asset's department,
classified INTERNAL, so department, asset scope and clearance rules apply to them exactly as to documents.
"""
from __future__ import annotations

import fnmatch
from typing import Any

from .policy import Subject, pdp

# who sees plant-wide operational data (not document contents): refinery management, audit, HSE oversight
PLANT_WIDE_ROLES = {"plant_manager", "auditor", "hse"}

# finding discipline -> owning department
DISCIPLINE_DEPT = {
    "mechanical": "Mechanical Maintenance", "electrical": "Electrical Maintenance",
    "instrumentation": "Instrumentation Maintenance", "process": "Process Engineering",
    "operations": "Operations (Production)", "hse": "Health, Safety & Environment",
    "utilities": "Captive Power Plants & Utilities",
}

# document types an HOD may upload; MSDS and contact lists widen the audience plant-wide, so they are limited
UPLOAD_DOC_TYPES = {
    "SOP", "drawing_pid", "drawing_sld", "datasheet", "inspection_report", "calibration_certificate", "manual",
    "troubleshooting_guide", "process_manual", "shift_log", "work_order_export", "asset_register", "audit_report",
    "MSDS", "contact_list", "other",
}
RESTRICTED_UPLOAD_TYPES = {"MSDS": "hse", "contact_list": "plant_manager"}


def plant_wide(s: Subject) -> bool:
    return bool(PLANT_WIDE_ROLES & set(s.roles))


def asset_visible(s: Subject, a: dict[str, Any]) -> bool:
    """An asset is visible to its owning department (INTERNAL clearance and above), to people assigned to its plant
    unit, and to plant-wide roles. Contractors (PUBLIC clearance) see only the units they are assigned to."""
    if plant_wide(s) or (a.get("owner_department") == s.department and s.clearance >= 1):
        return True
    unit, tag = a.get("unit") or "", a.get("tag") or ""
    return any(fnmatch.fnmatch(unit, sc) or fnmatch.fnmatch(tag, sc) for sc in (s.asset_scopes or []))


def record_resource(a: dict[str, Any] | None, doc_type: str = "asset_register") -> dict[str, Any]:
    """Pseudo-document for a structured plant record (asset master, CMMS, contacts) of an asset."""
    a = a or {}
    return {"type": "document", "id": f"record:{a.get('tag', '')}", "department": a.get("owner_department") or "",
            "classification": 1, "doc_type": doc_type, "asset_tags": [a.get("tag")] if a.get("tag") else [],
            "units": [a["unit"]] if a.get("unit") else [], "status": "CURRENT"}


def record_readable(s: Subject, a: dict[str, Any] | None, doc_type: str = "asset_register") -> bool:
    if not a:
        return False
    return pdp.decide(s, "read", record_resource(a, doc_type)).allowed


def finding_department(f: dict[str, Any]) -> str:
    return DISCIPLINE_DEPT.get((f.get("discipline") or "").lower(), "")


def finding_visible(s: Subject, f: dict[str, Any], can_read_source: bool) -> bool:
    """Findings belong to the discipline's department. Others (except plant-wide roles and the named approver)
    do not see them; nobody sees a finding whose source document they may not read."""
    if not can_read_source:
        return False
    return plant_wide(s) or finding_department(f) == s.department or f.get("approver_id") == s.id
