"""SQLite (WAL) storage. Plain sqlite3 for the demo build; schema mirrors PLAN.md §7.3 (subset)."""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from .config import DB_PATH

_local = threading.local()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def db() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        c = connect()
        _local.conn = c
    return c


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    c = db()
    c.execute("BEGIN IMMEDIATE")
    try:
        yield c
        c.execute("COMMIT")
    except Exception:
        c.execute("ROLLBACK")
        raise


def q(sql: str, args: tuple | list = ()) -> list[dict[str, Any]]:
    return [dict(r) for r in db().execute(sql, args).fetchall()]


def q1(sql: str, args: tuple | list = ()) -> dict[str, Any] | None:
    r = db().execute(sql, args).fetchone()
    return dict(r) if r else None


def ex(sql: str, args: tuple | list = ()) -> sqlite3.Cursor:
    return db().execute(sql, args)


def j(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False)


def uj(s: str | None, default: Any = None) -> Any:
    if not s:
        return default
    try:
        return json.loads(s)
    except Exception:
        return default


SCHEMA = """
CREATE TABLE IF NOT EXISTS departments(id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT, manager_user_id TEXT);
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT, post TEXT, department TEXT,
  clearance INTEGER DEFAULT 1, roles_json TEXT DEFAULT '[]', asset_scopes_json TEXT DEFAULT '[]',
  reporting_to TEXT, status TEXT DEFAULT 'active', attr_version INTEGER DEFAULT 1,
  password_hash TEXT, demo_password TEXT, failed_count INTEGER DEFAULT 0, locked_until TEXT, created_at TEXT,
  must_change_password INTEGER DEFAULT 0, mfa_enabled INTEGER DEFAULT 0, mfa_secret TEXT, mfa_pending_secret TEXT, mfa_last_step INTEGER,
  recovery_json TEXT, last_login_at TEXT);
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, user_id TEXT REFERENCES users(id), csrf_token TEXT,
  attr_version INTEGER, ip TEXT, user_agent TEXT, created_at TEXT, last_seen_at TEXT,
  idle_expires_at TEXT, abs_expires_at TEXT, revoked_at TEXT, revoke_reason TEXT);
CREATE TABLE IF NOT EXISTS login_attempts(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, ip TEXT, success INTEGER, at TEXT);

CREATE TABLE IF NOT EXISTS documents(
  id TEXT PRIMARY KEY, title TEXT, doc_number TEXT, revision TEXT, status TEXT DEFAULT 'CURRENT',
  doc_type TEXT, department TEXT, classification INTEGER DEFAULT 1, sensitivity_json TEXT DEFAULT '[]',
  effective_date TEXT, supersedes TEXT, asset_tags_json TEXT DEFAULT '[]', file_path TEXT, file_name TEXT,
  mime TEXT, sha256 TEXT, size_bytes INTEGER, pages INTEGER DEFAULT 0, uploaded_by TEXT, created_at TEXT,
  is_example INTEGER DEFAULT 0, is_public INTEGER DEFAULT 0, source_url TEXT);
CREATE TABLE IF NOT EXISTS pages(
  id TEXT PRIMARY KEY, document_id TEXT REFERENCES documents(id) ON DELETE CASCADE, page_no INTEGER,
  mode TEXT, text TEXT, ocr_conf REAL);
CREATE TABLE IF NOT EXISTS chunks(
  id TEXT PRIMARY KEY, document_id TEXT REFERENCES documents(id) ON DELETE CASCADE, page INTEGER,
  ordinal INTEGER, text TEXT, tags TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, tags, chunk_id UNINDEXED, tokenize='porter unicode61');
CREATE TABLE IF NOT EXISTS jobs(
  id TEXT PRIMARY KEY, kind TEXT, status TEXT, stages_json TEXT, document_id TEXT, error TEXT,
  created_by TEXT, created_at TEXT, updated_at TEXT);

CREATE TABLE IF NOT EXISTS assets(
  tag TEXT PRIMARY KEY, name TEXT, unit TEXT, class TEXT, vendor TEXT, model TEXT, serial TEXT, location TEXT,
  owner_department TEXT, criticality TEXT, specs_json TEXT DEFAULT '{}', is_example INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS tag_alias(alias TEXT PRIMARY KEY, tag TEXT);
CREATE TABLE IF NOT EXISTS ledger_items(
  id TEXT PRIMARY KEY, tag TEXT, type TEXT, ref_no TEXT, issued_on TEXT, expires_on TEXT);
CREATE TABLE IF NOT EXISTS work_orders(
  wo_no TEXT PRIMARY KEY, tag TEXT, type TEXT, opened_at TEXT, closed_at TEXT, failure_code TEXT,
  cause TEXT, action TEXT, technician TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY, name TEXT, dept TEXT, role TEXT, ext TEXT, on_call INTEGER);
CREATE TABLE IF NOT EXISTS facts(
  id TEXT PRIMARY KEY, asset_tag TEXT, slot TEXT, attribute TEXT, value TEXT, unit TEXT,
  source_doc_number TEXT, revision TEXT, effective_date TEXT, page INTEGER, source_kind TEXT);

CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, user_id TEXT, name TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS chats(
  id TEXT PRIMARY KEY, user_id TEXT, project_id TEXT, title TEXT, system_prompt TEXT,
  prediction_json TEXT DEFAULT '{}', created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY, chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE, role TEXT, content TEXT,
  reasoning TEXT, meta_json TEXT DEFAULT '{}', created_at TEXT);
CREATE TABLE IF NOT EXISTS presets(
  id TEXT PRIMARY KEY, user_id TEXT, name TEXT, description TEXT, system_prompt TEXT,
  prediction_json TEXT, load_json TEXT, builtin INTEGER DEFAULT 0, created_at TEXT);

CREATE TABLE IF NOT EXISTS access_requests(
  id TEXT PRIMARY KEY, requester_id TEXT, department TEXT, doc_type TEXT, document_id TEXT, justification TEXT,
  hours INTEGER, state TEXT, approver_id TEXT, note TEXT, created_at TEXT, decided_at TEXT);
CREATE TABLE IF NOT EXISTS grants(
  id TEXT PRIMARY KEY, user_id TEXT, department TEXT, doc_type TEXT, document_id TEXT, expires_at TEXT,
  approved_by TEXT, request_id TEXT, revoked_at TEXT, created_at TEXT);

CREATE TABLE IF NOT EXISTS findings(
  id TEXT PRIMARY KEY, title TEXT, tag TEXT, discipline TEXT, severity TEXT, state TEXT, due_date TEXT,
  evidence TEXT, source_document_id TEXT, page INTEGER, approver_id TEXT, history_json TEXT DEFAULT '[]', created_at TEXT, is_example INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS notifications(
  id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, title TEXT, body TEXT, link TEXT, read_at TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS reports(
  id TEXT PRIMARY KEY, kind TEXT, file_name TEXT, file_path TEXT, sha256 TEXT, created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value_json TEXT, updated_by TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, message_id TEXT, user_id TEXT, rating INTEGER, comment TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS answer_stats(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, user_id TEXT, department TEXT, intent TEXT, engine TEXT, model TEXT,
  tokens_in INTEGER, tokens_out INTEGER, tok_per_s REAL, ttft_ms REAL, total_ms REAL, error TEXT, denied INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS engines(id TEXT PRIMARY KEY, base_url TEXT, api_key TEXT);
CREATE TABLE IF NOT EXISTS laya_log(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, decision_json TEXT, latency_ms REAL, at TEXT);

CREATE TABLE IF NOT EXISTS audit_log(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, actor TEXT, event TEXT, entity TEXT, detail_json TEXT,
  prev_hash TEXT, hash TEXT);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
"""


def init_db() -> None:
    db().executescript(SCHEMA)


def get_setting(key: str, default: Any = None) -> Any:
    r = q1("SELECT value_json FROM settings WHERE key=?", (key,))
    return uj(r["value_json"], default) if r else default


def set_setting(key: str, value: Any, by: str = "system") -> None:
    ex("INSERT OR REPLACE INTO settings(key, value_json, updated_by, updated_at) VALUES(?,?,?,?)", (key, j(value), by, now_iso()))
