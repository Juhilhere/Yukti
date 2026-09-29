## Summary

<!-- What does this change and why? Link issues: Closes #123 -->

## Type

- [ ] Feature
- [ ] Fix
- [ ] Docs
- [ ] Refactor / chore
- [ ] Release tooling / packaging

## How was it tested?

- [ ] `cd backend; uv run pytest`
- [ ] `cd web; npm run build`
- [ ] `cd desktop; npm test` (installer self-test) and `node --check`
- [ ] `tests/live/e2e_live.py` against a running server
- [ ] `tests/live/stress_live.py` (engine, concurrency or upload changes)
- [ ] Manual check in the UI (screenshots below if the UI changed)

## Security and data checklist

- [ ] Access decisions stay in host code (`pdp.decide`). Nothing new reaches the model or the UI without a policy check.
- [ ] Role boundaries are unchanged: only HODs manage documents (own department), only admins change LLM settings. Or the change is explained above.
- [ ] New security-relevant actions write an audit event.
- [ ] No outbound network calls at runtime.
- [ ] No invented numbers. Example data is marked EXAMPLE, and public facts carry source URLs.
- [ ] No secrets, real plant documents or `data/store/` contents are committed.

## Docs

- [ ] README / docs updated if behaviour, commands or settings changed
- [ ] CHANGELOG.md entry under **Unreleased**
