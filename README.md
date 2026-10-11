# Xyvera MD

A modular, multi-device **WhatsApp bot** built on [Baileys](https://github.com/WhiskeySockets/Baileys)
(MIT). Owner controls with granular sudo capabilities, per-group configuration,
group management, security/moderation (anti-link, anti-tag, anti-bad-word,
warnings, anti-delete), status automation, games, AI/media utilities (provider-
gated), and a registry-generated menu.

> Built as a maintainable software project: typed error handling, centralized
> permission enforcement, atomic JSON persistence behind a swappable repository
> interface, and an offline test suite that never needs WhatsApp credentials.

## Status

**Deploy-ready** — foundation, permission system, per-group config, moderation
logic, games, utilities, the local media pipeline (stickers, toimg, blur, memes,
profile picture, greeting images), persisted reminders, documented provider
adapters (AI/imagine via OpenAI-compatible APIs; translate, weather, currency,
lyrics, short URL, screenshot) and licensed media downloads (via `MEDIA_API_URL`)
are implemented and covered by **213 passing tests**. Anti-link numeric aliases
1–4 are approved and active. The connection layer survives outages (exponential
reconnect backoff, live-socket re-binding, headless QR at `data/qr.png`, clean
SIGINT/SIGTERM shutdown).

Operations tooling: `node src/index.js --doctor` (preflight diagnostics),
`npm run smoke:live` (observed live WhatsApp smoke test — the only way to
verify the Baileys adapter against a real account), `npm run verify:docs`
(registry ↔ docs sync gate) and CI (`.github/workflows/ci.yml`, Node 20 + 22)
running lint, docs sync, tests and the preflight on every push. Deployment:
`deploy/xyvera-md.service` (systemd), `deploy/ecosystem.config.cjs` (PM2),
`deploy/Dockerfile` + `deploy/docker-compose.yml`.

Run `npm ci && npm start` and scan the QR to go live. Media *downloads*
(`.play` etc.) stay provider-gated until a licensed provider is chosen. See
`docs/COMMANDS.md` for the per-command truth table, `docs/LIMITATIONS.md` for
platform limits, and `docs/PHASE-REPORTS.md` for what has been verified so far
(and what has not).

## Quick start (Windows / local)

```powershell
npm install
copy .env.example .env        # set OWNER_NUMBERS at minimum
npm run check                 # offline: lint + docs sync + tests
npm run doctor                # preflight: what is configured / missing
npm start                     # scan the QR with WhatsApp → Linked devices
```

Full walkthrough (QR auth, troubleshooting): `docs/LOCAL_SETUP.md`.
Cloud deployment: `docs/DEPLOYMENT.md`.

## Development

```bash
npm test                      # node:test suite — no network, no credentials
npm run lint                  # syntax/static sanity over all modules
npm run check                 # lint + docs-sync gate + tests
npm run verify:docs           # fail if docs/COMMANDS.md is stale
node src/index.js --check     # initialize everything without connecting
node src/index.js --doctor    # preflight diagnostics (--json for machines)
node scripts/gen-commands.mjs # regenerate docs/COMMANDS.md from the registry
npm run smoke:live            # live WhatsApp smoke test (needs a real session)
```

## Project layout

```
docs/            REQUIREMENTS, ARCHITECTURE, COMMANDS, LIMITATIONS, PHASE-REPORTS, setup, deploy
src/
  index.js       bootstrap + CLI entry (--check, --doctor)
  config/        defaults, env loader, provider requirements catalog
  commands/      registry, router, menu + per-category command modules
  diagnostics/   preflight doctor, live smoke engine
  whatsapp/      Baileys adapter (ONLY place that imports baileys), permissions
  services/      moderation, games, status automation, confirmations, providers
  storage/       repository interface, JSON store (atomic writes), migrations
  utils/         logger (redacting), errors, validators, templates, cooldowns
scripts/         lint, docs generator + sync gate, live smoke runner
deploy/          systemd unit, PM2 config, Dockerfile, docker-compose
.github/         CI (lint, docs sync, tests, preflight on Node 20 + 22)
tests/           offline unit + integration suites (fake WhatsApp client)
data/            runtime JSON + session/ (gitignored)
tmp/             media scratch (gitignored)
```

## Key design points

- **Permissions**: identity comes from canonical JIDs only (never display
  names). Owner → granular sudo capabilities (`group.kick`, `group.tag`,
  `security.manage`, …) → group-admin (validated live) → everyone. Public /
  private mode is orthogonal and owner-controlled. `.ban` gates bot command
  access only — it never kicks anyone.
- **Per-group config**: every group has an independent configuration keyed by
  group JID. All security features are **off** until that group opts in.
- **Honest actions**: every WhatsApp operation reports its real outcome;
  unconfigured external providers return setup messages; the menu is generated
  from the live command registry and labels partial/stub/pending commands.
- **Destructive actions** (`.revoke`, `.leavegc`, `.clearsession`) require a
  short-lived, user-scoped `.confirm`.

## Documentation

| Document | Contents |
|----------|----------|
| `docs/REQUIREMENTS.md` | Confirmed decisions, resolved questions, open questions |
| `docs/ARCHITECTURE.md` | Library evaluation, layers, data flow, permission & storage design |
| `docs/COMMANDS.md` | Generated command reference with statuses (sync-gated) |
| `docs/LIMITATIONS.md` | What the bot cannot/should not do |
| `docs/PHASE-REPORTS.md` | What each phase shipped, what was actually verified, next gate |
| `docs/LOCAL_SETUP.md` / `docs/DEPLOYMENT.md` | Windows dev → cloud server |

## License

MIT. WhatsApp is a trademark of WhatsApp LLC; this project is not affiliated
with WhatsApp. Use automation responsibly and within WhatsApp's Terms of
Service.
