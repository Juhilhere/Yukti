"""Test harness: runs the real Yukti app in-process against a temporary data store.

No GPU, model or llama.cpp is needed: model autoload is disabled, so chat requests exercise identity, policy,
Laya, guardrails, retrieval and fact extraction, and then stop with a clean "no model loaded" error.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

_STORE = Path(tempfile.mkdtemp(prefix="yukti-test-store-"))
os.environ["YUKTI_STORE"] = str(_STORE)
os.environ["YUKTI_AUTOLOAD"] = "0"
os.environ["YUKTI_SYNC_STARTUP"] = "1"
os.environ["YUKTI_TIER"] = "demo"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

PASSWORDS = {"admin": "Admin@2026", "ravi.e": "Ravi@2026", "anil.u": "Anil@2026", "kavita.fm": "Kavita@2026",
             "meera.me": "Meera@2026", "suresh.em": "Suresh@2026", "rajesh.mm": "Rajesh@2026", "vikram.op": "Vikram@2026",
             "contractor.x": "Vendor@2026", "arjun.pl": "Arjun@2026", "deepa.au": "Deepa@2026", "priya.hse": "Priya@2026"}


@pytest.fixture(scope="session")
def app_client():
    with TestClient(app) as c:  # runs startup: schema, seeding, OCR ingestion of example documents
        yield c
    shutil.rmtree(_STORE, ignore_errors=True)


class User:
    def __init__(self, client: TestClient, username: str):
        self.c = client
        self.username = username
        self.cookies: dict[str, str] = {}
        self.csrf = ""
        r = self.c.post("/api/auth/login", json={"username": username, "password": PASSWORDS[username]})
        assert r.status_code == 200, r.text
        self.csrf = r.json()["csrf_token"]
        self.cookies = {"yukti_sid": r.cookies.get("yukti_sid") or self.c.cookies.get("yukti_sid")}
        self.me = r.json()

    def _h(self, extra: dict | None = None) -> dict:
        return {"X-CSRF-Token": self.csrf, **(extra or {})}

    def get(self, path: str, **kw):
        self.c.cookies.clear()
        return self.c.get(path, cookies=self.cookies, **kw)

    def post(self, path: str, json=None, **kw):
        self.c.cookies.clear()
        return self.c.post(path, json=json, headers=self._h(kw.pop("headers", None)), cookies=self.cookies, **kw)

    def put(self, path: str, json=None):
        self.c.cookies.clear()
        return self.c.put(path, json=json, headers=self._h(), cookies=self.cookies)

    def patch(self, path: str, json=None):
        self.c.cookies.clear()
        return self.c.patch(path, json=json, headers=self._h(), cookies=self.cookies)

    def delete(self, path: str):
        self.c.cookies.clear()
        return self.c.delete(path, headers=self._h(), cookies=self.cookies)

    def chat(self, text: str) -> dict:
        """Send a chat message and parse the SSE stream into {event: payload}."""
        chat = self.post("/api/chats", json={}).json()
        r = self.post(f"/api/chats/{chat['id']}/messages", json={"content": text, "use_knowledge": True})
        assert r.status_code == 200, r.text
        events: dict = {}
        name = None
        import json as _j
        for line in r.text.splitlines():
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:") and name:
                events.setdefault(name, _j.loads(line[5:]))
        return events


@pytest.fixture(scope="session")
def login(app_client):
    cache: dict[str, User] = {}

    def _login(username: str, fresh: bool = False) -> User:
        if fresh or username not in cache:
            cache[username] = User(app_client, username)
        return cache[username]

    return _login
