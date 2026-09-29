"""Business document generation: asset dossier PDF (reportlab), rendered from the same fact records as chat."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from . import rag
from .auth import Ctx
from .config import REPORTS
from .db import q, q1

STATUS_COL = {"KNOWN": colors.HexColor("#0E9AA7"), "MISSING": colors.HexColor("#8A98B3"), "CONFLICTING": colors.HexColor("#E0A100")}


def _footer(c, doc):  # type: ignore[no-untyped-def]
    c.saveState()
    c.setFont("Helvetica", 7.5)
    c.setFillColor(colors.grey)
    c.drawString(15 * mm, 10 * mm, f"Yukti Sovereign Industrial AI Workbench · generated {datetime.now():%Y-%m-%d %H:%M} · SYNTHETIC – SIH DEMO · "
                                   "Advisory only — verify with permit-to-work; not an approval.")
    c.drawRightString(195 * mm, 10 * mm, f"p.{doc.page}")
    c.setFillColor(colors.Color(0.9, 0.2, 0.2, alpha=0.08))
    c.setFont("Helvetica-Bold", 60)
    c.translate(105 * mm, 150 * mm)
    c.rotate(35)
    c.drawCentredString(0, 0, "INTERNAL")
    c.restoreState()


def dossier_pdf(ctx: Ctx, tag: str) -> Path:
    a = q1("SELECT * FROM assets WHERE tag=?", (tag,)) or {"tag": tag, "name": tag, "unit": "", "vendor": "", "serial": "", "location": ""}
    facts = rag.dossier_facts(ctx.subject, tag)
    from .scope import record_readable
    wos = q("SELECT * FROM work_orders WHERE tag=? ORDER BY opened_at DESC LIMIT 10", (tag,))         if record_readable(ctx.subject, q1("SELECT * FROM assets WHERE tag=?", (tag,)), "work_order_export") else []
    path = REPORTS / f"Dossier_{tag}_{datetime.now():%Y%m%d_%H%M%S}.pdf"
    ss = getSampleStyleSheet()
    h = ss["Heading1"]
    h.textColor = colors.HexColor("#0D1C50")
    small = ss["BodyText"]
    small.fontSize = 8.5
    small.leading = 11
    story = [Paragraph(f"Asset Dossier — {a['tag']} · {a['name']}", h),
             Paragraph(f"Unit {a['unit']} · Vendor {a.get('vendor') or '-'} · Serial {a.get('serial') or '-'} · Location {a.get('location') or '-'}", small),
             Paragraph(f"Prepared for {ctx.user['display_name']} ({ctx.user['post']}) — content filtered by access policy.", small),
             Spacer(1, 6 * mm), Paragraph("Facts with evidence status", ss["Heading3"])]
    rows = [["Slot", "Attribute", "Value", "Status", "Sources"]]
    styles = [("GRID", (0, 0), (-1, -1), 0.3, colors.lightgrey), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0D1C50")),
              ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTSIZE", (0, 0), (-1, -1), 7.8), ("VALIGN", (0, 0), (-1, -1), "TOP")]
    for i, f in enumerate(facts, start=1):
        src = "; ".join(f"{c['value']} — {c['source_label']}{' (recommended)' if c['recommended'] else ''}" for c in f["candidates"]) or f["note"]
        rows.append([f["slot"], f["attribute"].replace("_", " "), Paragraph(str(f["value"] or "—"), small), f["status"], Paragraph(src, small)])
        styles.append(("TEXTCOLOR", (3, i), (3, i), STATUS_COL[f["status"]]))
    t = Table(rows, colWidths=[20 * mm, 36 * mm, 42 * mm, 24 * mm, 58 * mm], repeatRows=1)
    t.setStyle(TableStyle(styles))
    story += [t, Spacer(1, 5 * mm)]
    conf = [f for f in facts if f["status"] == "CONFLICTING"]
    if conf:
        story.append(Paragraph("Conflicts requiring field verification", ss["Heading3"]))
        for f in conf:
            story.append(Paragraph(f"<b>{f['attribute'].replace('_', ' ')}</b>: {f['note']}", small))
    story += [Spacer(1, 4 * mm), Paragraph("Recent work orders (CMMS)", ss["Heading3"])]
    wrows = [["WO", "Type", "Opened", "Status", "Cause / action"]] + [
        [w["wo_no"], w["type"], (w["opened_at"] or "")[:16], w["status"], Paragraph(f"{w['cause'] or ''} — {w['action'] or ''}", small)] for w in wos]
    wt = Table(wrows, colWidths=[26 * mm, 12 * mm, 28 * mm, 18 * mm, 96 * mm], repeatRows=1)
    wt.setStyle(TableStyle(styles[:4]))
    story.append(wt)
    SimpleDocTemplate(str(path), pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=18 * mm,
                      title=f"Dossier {tag}").build(story, onFirstPage=_footer, onLaterPages=_footer)
    return path
