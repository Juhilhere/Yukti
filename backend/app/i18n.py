"""Server-side translation of user-visible messages (English / हिंदी / ಕನ್ನಡ).

The web app sends the chosen language in the `X-Lang` header; a middleware stores it for the request. Messages are
written in English in the code and translated on the way out with `tr()`:
- exact messages come from MESSAGES,
- messages with variable parts (names, numbers, file names) come from PATTERNS (regex with named groups -> template).
Unknown messages stay in English (never an error). Dictionaries live in i18n_messages.py.
"""
from __future__ import annotations

import contextvars
import re
from typing import Any

LANGS = ("en", "hi", "kn")
LANG_NAMES = {"en": "English", "hi": "Hindi (हिंदी)", "kn": "Kannada (ಕನ್ನಡ)"}
_LANG: contextvars.ContextVar[str] = contextvars.ContextVar("yukti_lang", default="en")


def set_lang(value: str | None) -> None:
    v = (value or "en").strip().lower()[:2]
    _LANG.set(v if v in LANGS else "en")


def get_lang() -> str:
    return _LANG.get()


def _dicts() -> tuple[dict[str, dict[str, str]], list[tuple[re.Pattern[str], dict[str, str]]]]:
    try:
        from .i18n_messages import MESSAGES, PATTERNS
    except Exception:  # noqa: BLE001 - translations are optional
        return {}, []
    return MESSAGES, PATTERNS


def tr(text: Any, lang: str | None = None) -> Any:
    """Translate one user-visible English message into the request's language (unchanged if unknown)."""
    lang = lang or get_lang()
    if lang == "en" or not isinstance(text, str) or not text:
        return text
    messages, patterns = _dicts()
    hit = messages.get(text)
    if hit and hit.get(lang):
        return hit[lang]
    for rx, tpl in patterns:
        m = rx.fullmatch(text)
        if m and tpl.get(lang):
            try:  # groups named t_* hold a nested English message that is itself translated
                return tpl[lang].format(**{k: (tr(v, lang) if k.startswith("t_") and v else (v or ""))
                                           for k, v in m.groupdict().items()})
            except (KeyError, IndexError):
                return text
    return text


def tr_list(items: Any, lang: str | None = None) -> Any:
    """Translate each message of a list (e.g. production 'missing' items)."""
    if not isinstance(items, list):
        return items
    return [tr(x, lang) for x in items]


def tr_fields(obj: Any, fields: tuple[str, ...], lang: str | None = None) -> Any:
    """Copy of a dict with the given string fields translated (other fields untouched)."""
    if not isinstance(obj, dict):
        return obj
    return {**obj, **{k: tr(obj[k], lang) for k in fields if k in obj}}


def tr_facts(facts: Any, lang: str | None = None) -> Any:
    """Dossier/public facts as shown to the user: notes and code-generated source labels translated (values untouched)."""
    if not isinstance(facts, list):
        return facts
    out = []
    for f in facts:
        if isinstance(f, dict):
            f = tr_fields(f, ("note",), lang)
            if isinstance(f.get("candidates"), list):
                f["candidates"] = [tr_fields(c, ("source_label",), lang) for c in f["candidates"]]
        out.append(f)
    return out


def answer_language_instruction(lang: str | None = None) -> str:
    """System-prompt line that makes the assistant answer in the user's language."""
    lang = lang or get_lang()
    if lang == "en":
        return ""
    return (f"Write your whole answer in {LANG_NAMES[lang]}. Keep equipment tags, document numbers, revision labels, units, "
            "numbers and standard plant terms (SOP, LOTO, P&ID, MCC, PTW, HOD) exactly as in the sources, and keep citation "
            "markers such as [S1] and [F2] unchanged.")
