"""Photos attached to a chat question (e.g. a worker photographs a rusty pipe or a nameplate).

Every photo is cleaned before it is stored: orientation fixed, EXIF/GPS and any other metadata removed, re-encoded as
JPEG at most 1600 px on the long side. Only the person who uploaded a photo can see it. The text on the photo is read
with the same offline OCR used for scanned documents; equipment tags found in that text are matched to the asset
register, within what the person is allowed to see.
"""
from __future__ import annotations

import base64
import io
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

from . import journal, rag
from .config import STORE
from .db import ex, j, new_id, now_iso, q, q1, uj
from .policy import Subject
from .scope import asset_visible

DIR = STORE / "attachments"
DIR.mkdir(parents=True, exist_ok=True)
MAX_BYTES = 15 * 1024 * 1024
MAX_SIDE = 1600
THUMB_SIDE = 320
MAX_PER_MESSAGE = 4
MAX_PER_DAY = 200            # photos one person may add in 24 hours
UNUSED_AFTER_H = 24          # a photo that was uploaded but never sent with a question is removed after this
# Pillow's own guard only warns above MAX_IMAGE_PIXELS and raises above twice that, so the real limit is checked by
# hand right after the header is read and BEFORE any pixel is decoded (40 MP covers every phone camera in use).
MAX_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = 80_000_000

# something that looks like a plant tag on a stencil or tag plate: V-501, E-310, XV-2043, PSV-118, 10-P-101A, MCC-2
TAG_RX = re.compile(r"(?<![A-Z0-9])(?:\d{1,3}-)?[A-Z]{1,4}-?\d{1,5}[A-Z]?(?![A-Z0-9])")
# ... and things on a nameplate that look the same but are ratings, sizes, materials or standards, not equipment:
# IP65, DN100, PN16, NB50, SS316, M12, API610, ISO9001, IS2062, EN10204, ASME…, REV2, HZ50, KW75, HP10, PT100, RTD100.
# With a hyphen, only the prefixes that are never a plant tag are excluded: "PT-101", "M-101", "HP-2" are real tag styles.
NOT_TAG_RX = re.compile(r"(?:IP|DN|PN|NB|SS|M|API|ISO|IS|EN|ASME|REV|HZ|KW|HP|PT|RTD)\d+[A-Z]?"
                        r"|(?:IP|DN|PN|NB|SS|API|ISO|IS|EN|ASME|REV)-\d+[A-Z]?")


def looks_like_rating(code: str) -> bool:
    """IP65, DN100, ISO9001 …: tag-shaped text that is a rating or a standard (only used for codes not in the asset register)."""
    return bool(NOT_TAG_RX.fullmatch(code.upper()))


class PhotoError(ValueError):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _paths(aid: str) -> tuple[Path, Path]:
    if not re.fullmatch(r"[0-9a-f]{8,64}", aid or ""):
        raise PhotoError(404, "not_found", "Photo not found")
    return DIR / f"{aid}.jpg", DIR / f"{aid}_thumb.jpg"


def save(user_id: str, data: bytes) -> dict[str, Any]:
    if len(data) > MAX_BYTES:
        raise PhotoError(413, "too_large", "The photo is larger than 15 MB. Please send a smaller photo.")
    day_ago = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat(timespec="seconds")
    if q1("SELECT COUNT(*) n FROM attachments WHERE user_id=? AND created_at>?", (user_id, day_ago))["n"] >= MAX_PER_DAY:
        raise PhotoError(429, "too_many", "You have added too many photos today. Please try again tomorrow.")
    try:
        img = Image.open(io.BytesIO(data))
        if img.format not in ("JPEG", "PNG", "WEBP", "BMP", "GIF", "TIFF", "MPO"):
            raise PhotoError(422, "unsupported", "This file is not a supported photo. Please send a JPG, PNG or WEBP photo.")
        if img.width * img.height > MAX_PIXELS:  # known from the header: nothing has been decoded yet
            raise PhotoError(413, "too_large", "The photo is too large. Please send a smaller photo.")
        if img.format == "JPEG":  # decode large JPEGs directly at a reduced size (less memory, faster)
            img.draft("RGB", (MAX_SIDE * 2, MAX_SIDE * 2))
        img.load()
    except PhotoError:
        raise
    except Image.DecompressionBombError:
        raise PhotoError(413, "too_large", "The photo is too large. Please send a smaller photo.")
    except Exception:  # noqa: BLE001
        raise PhotoError(422, "unsupported", "This file is not a supported photo. Please send a JPG, PNG or WEBP photo.")
    img = ImageOps.exif_transpose(img)  # phones store rotation in EXIF
    if img.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        rgba = img.convert("RGBA")
        bg.paste(rgba, mask=rgba.split()[-1])
        img = bg
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    aid = new_id()
    full, thumb = _paths(aid)
    img.save(full, "JPEG", quality=88, optimize=True)  # a fresh JPEG carries no EXIF / GPS
    t = img.copy()
    t.thumbnail((THUMB_SIDE, THUMB_SIDE), Image.Resampling.LANCZOS)
    t.save(thumb, "JPEG", quality=80)
    size = full.stat().st_size
    ex("INSERT INTO attachments(id, user_id, width, height, size_bytes, created_at) VALUES(?,?,?,?,?,?)",
       (aid, user_id, img.width, img.height, size, now_iso()))
    return {"id": aid, "width": img.width, "height": img.height, "size_bytes": size, "mime": "image/jpeg"}


def get(user_id: str, aid: str) -> dict[str, Any]:
    _paths(aid)
    r = q1("SELECT * FROM attachments WHERE id=? AND user_id=?", (aid, user_id))
    if not r:
        raise PhotoError(404, "not_found", "Photo not found")
    return r


def file_path(user_id: str, aid: str, thumb: bool = False) -> Path:
    get(user_id, aid)
    full, th = _paths(aid)
    p = th if thumb and th.exists() else full
    if not p.exists():
        raise PhotoError(404, "not_found", "Photo not found")
    return p


def b64(user_id: str, aid: str) -> str:
    return base64.b64encode(file_path(user_id, aid).read_bytes()).decode()


def referenced_ids(except_chat: str | None = None) -> set[str]:
    """Photo ids that a stored question refers to (optionally leaving one chat out of the count)."""
    out: set[str] = set()
    for r in q("SELECT chat_id, meta_json FROM messages WHERE role='user' AND meta_json LIKE '%\"images\"%'"):
        if except_chat is not None and r["chat_id"] == except_chat:
            continue
        imgs = uj(r["meta_json"], {}).get("images") or []
        out.update(x for x in imgs if isinstance(x, str))
    return out


def _remove(aid: str) -> None:
    for p in _paths(aid):
        try:
            p.unlink(missing_ok=True)
        except OSError as e:
            journal.swallowed("photos", "removing a photo file", e)
    ex("DELETE FROM attachments WHERE id=?", (aid,))


def delete(user_id: str, ids: list[str], except_chat: str | None = None) -> None:
    """Remove this person's photos. With `except_chat` (the chat being deleted) a photo that another chat of the same
    person still shows is kept."""
    if not ids:
        return
    still_used = referenced_ids(except_chat) if except_chat is not None else set()
    for aid in dict.fromkeys(ids):
        try:
            get(user_id, aid)
        except PhotoError:
            continue
        if aid in still_used:
            continue
        _remove(aid)


def delete_one(user_id: str, aid: str) -> None:
    """The uploader removes a photo that was attached but not sent. A photo that is part of a stored question stays
    (it goes when its chat is deleted)."""
    get(user_id, aid)  # owner only; anyone else gets "not found"
    if aid in referenced_ids():
        raise PhotoError(409, "in_use", "This photo is part of a saved question. Delete the chat to remove it.")
    _remove(aid)


def sweep_unreferenced(max_age_h: float = UNUSED_AFTER_H) -> int:
    """Remove photos older than `max_age_h` that no stored question refers to (uploaded, then never sent), and photo
    files without a database entry. Returns how many photos were removed."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_h)).isoformat(timespec="seconds")
    used = referenced_ids()
    n = 0
    for r in q("SELECT id FROM attachments WHERE created_at<?", (cutoff,)):
        if r["id"] not in used:
            try:
                _remove(r["id"])
                n += 1
            except PhotoError:
                ex("DELETE FROM attachments WHERE id=?", (r["id"],))
    known = {r["id"] for r in q("SELECT id FROM attachments")}
    limit = time.time() - max_age_h * 3600
    for p in DIR.glob("*.jpg"):
        try:
            if p.stem.removesuffix("_thumb") not in known and p.stat().st_mtime < limit:
                p.unlink(missing_ok=True)
        except OSError as e:
            journal.swallowed("photos", "removing a leftover photo file", e)
    return n


def _ocr(aid: str) -> dict[str, Any]:
    """Text on the photo, line by line with confidence. Small photos are enlarged first (OCR misses small text)."""
    img = Image.open(_paths(aid)[0]).convert("RGB")
    if max(img.size) < 1000:
        f = 1000 / max(img.size)
        img = img.resize((round(img.width * f), round(img.height * f)), Image.Resampling.LANCZOS)
    import numpy as np
    t0 = time.time()
    with rag._OCR_LOCK:
        res, _ = rag.ocr_engine()(np.array(img))
    lines: list[dict[str, Any]] = []
    if res:
        items = sorted(res, key=lambda r: (round(r[0][0][1] / 18), r[0][0][0]))
        cur, buf, conf = None, [], []
        for box, text, score in items:
            y = round(box[0][1] / 18)
            if cur is not None and y != cur:
                lines.append({"text": "  ".join(buf), "conf": round(sum(conf) / len(conf), 2)})
                buf, conf = [], []
            buf.append(str(text))
            conf.append(float(score))
            cur = y
        if buf:
            lines.append({"text": "  ".join(buf), "conf": round(sum(conf) / len(conf), 2)})
    return {"lines": lines, "ocr_ms": round((time.time() - t0) * 1000)}


def analyse(s: Subject, user_id: str, aid: str) -> dict[str, Any]:
    """OCR (cached per photo) + equipment tags matched to the asset register within the person's scope."""
    r = get(user_id, aid)
    ocr = uj(r.get("ocr_json"), None)
    if not ocr:
        ocr = _ocr(aid)
        ex("UPDATE attachments SET ocr_json=? WHERE id=?", (j(ocr), aid))
    text = "\n".join(line["text"] for line in ocr["lines"])
    tags: list[dict[str, Any]] = []
    seen: set[str] = set()
    for tag in rag.detect_tags(text):  # known tags and their aliases
        a = q1("SELECT * FROM assets WHERE tag=?", (tag,))
        if a and asset_visible(s, a) and tag not in seen:
            tags.append({"tag": tag, "asset_name": a["name"]})
            seen.add(tag)
    for m in TAG_RX.finditer(text.upper()):  # tag-like text that is not in the register (or not visible to this person)
        tag = m.group(0)
        known = q1("SELECT * FROM assets WHERE tag=?", (tag,))
        # an unknown code needs 2+ digits to count as a tag (skips piping classes such as "A1A" in 6"-AM-1023-A1A)
        if tag in seen or (not known and len(re.findall(r"\d", tag)) < 2) or (known and not asset_visible(s, known)):
            continue
        if not known and looks_like_rating(tag):  # IP65, DN100, ISO9001 …: a rating or a standard, not equipment
            continue
        tags.append({"tag": tag, "asset_name": None})
        seen.add(tag)
    return {"id": aid, "text": text, "lines": ocr["lines"], "tags": tags[:12]}
