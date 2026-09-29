# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.3.x | Yes |
| < 0.3 | No (demo builds) |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Email **juhilprogramming@gmail.com** with the subject `[Yukti security]`. Please include:

- the affected version and component (server, web UI, desktop app, installer, release tooling)
- steps to reproduce, or a proof of concept
- the impact you observed (for example: policy bypass, data seen by the wrong role, authentication or session issue, audit-chain tampering,
  outbound network access despite the offline guard)
- whether the issue is already public

What to expect from us:

- acknowledgement within **3 working days**
- an initial assessment within **10 working days**
- a fix or mitigation plan agreed with you, and credit in the changelog if you want it

Please test only on your own installation. Do not access data that belongs to others, and give us reasonable time to fix the issue before you disclose it.

## Scope and known limitations

The design, threat model and known limitations are documented in [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md). The following are known and
documented, so they need no report:

- installers and the server executable are not code-signed
- the `demo` tier shows demo accounts and passwords on the login screen (use `YUKTI_TIER=prod`)
- there is no built-in TLS
