# Xyvera MD — Phase Reports

Truthful record of each phase, as required by `docs/REQUIREMENTS.md` §1.16:
**implemented / tested / passed / failed / functional commands / external
services needed / limitations / next phase**. Nothing here is aspirational —
unverified things are labelled unverified.

---

## Phase 0–1 — requirements, architecture, foundation + tested core

Delivered in PR #1 (merged 2026-10-11).

- **Implemented**: requirements/architecture docs; layered app (config → storage
  → services → registry/router → WhatsApp adapter); centralized permission
  enforcement (owner → granular sudo capabilities → live group-admin →
  everyone) with JID-only identity; public/private modes; bot command bans;
  per-group config isolated by group JID with all security features **off** by
  default; moderation (anti-link, anti-tag, anti-bad-word, warnings +
  escalation, anti-delete snapshots); confirmations for destructive actions;
  games; utilities; local media pipeline (sharp); JSON persistence with atomic
  writes, quarantine recovery and schema migrations; registry-generated menu.
- **Tested**: offline `node:test` suite with a fake WhatsApp client.
- **Passed at merge**: `npm run check` — 132/132 tests; `--check` boot.
- **Failed / not done**: nothing known broken; media *download* commands and
  `.ghost`/Dazzle intentionally not implemented (documented as such).
- **Live status**: the Baileys adapter was **not** exercised against a real
  WhatsApp account.
- **Next phase**: live smoke test → media pipeline → provider adapters.

## Phase 2 — live-validation readiness & operations hardening

Delivered in this branch (PR #2).

- **Implemented**
  - `src/config/providerCatalog.js` — single requirements matrix for all 9
    external providers; `.configcheck` and `--doctor` read the same source, so
    they can no longer disagree.
  - `src/diagnostics/doctor.js` + `node src/index.js --doctor [--json]` —
    preflight checks (Node version, `.env`, owner, prefix, mode, data/tmp
    writability, corrupt-file quarantine, storage schema, session state,
    branding image, provider readiness, registry) with real evidence and exact
    fixes; exit code 1 only on hard failures.
  - `src/diagnostics/liveSmoke.js` + `scripts/live-smoke.mjs` — live smoke
    harness: QR, connection, inbound normalization, command → reply round trip,
    optional outbound self-send and group metadata; reports only observed
    events, writes `data/live-smoke-report.json`, never upgrades "not observed"
    to "passed".
  - `bootstrap()` hooks (`onNewSocket(sock, client)`, `onEvent`) so tools can
    observe the exact live socket; `connection.js` now reports QR emission
    (`{ savedToFile }` — the QR payload itself is never exposed).
  - CI (`.github/workflows/ci.yml`, Node 20 + 22): lint → docs sync → tests →
    `--check` → `--doctor`.
  - Docs-sync gate: `scripts/verify-commands-doc.mjs`, `npm run verify:docs`,
    and a test that fails when `docs/COMMANDS.md` drifts from the registry.
  - Deployment artifacts: `deploy/xyvera-md.service`, `deploy/Dockerfile`,
    `deploy/docker-compose.yml`, `.dockerignore` (PM2 config already existed).
  - Truthfulness cleanup: numeric aliases 1–4 are now documented as **approved
    and in effect** everywhere (constant renamed to `NUMERIC_ACTION_ALIASES`,
    dead "pending approval" branch removed, generator table updated).
- **Tested**: new suites `tests/doctor.test.js`, `tests/liveSmoke.test.js`,
  `tests/commandsDoc.test.js`; existing suites unchanged and green.
- **Passed (this branch)**: `npm run check` — **213/213 tests, 0 failures**
  (lint + docs-sync gate + suite); `node src/index.js --check` (121 commands);
  `node src/index.js --doctor` → READY with 3 expected warnings on an
  unconfigured checkout.
- **Failed**: nothing.
- **External services needed**: none for the above (all offline).
- **Limitations — verified vs. unverified**
  - Verified here: everything unit/integration tested offline, the preflight,
    the docs gate, the boot path, storage, routing, providers (mocked HTTP).
  - **Still unverified**: real WhatsApp behavior (QR pairing, message events,
    group actions, status events) and the container image / systemd unit
    (no Docker/systemd in the development sandbox — the files are provided, the
    commands in `docs/DEPLOYMENT.md` are the operator's test).
  - Sandbox attempt at the live harness (development container, 2026-10-11,
    outbound WhatsApp blocked): `node scripts/live-smoke.mjs --json` exited **1**
    with `connect: failed — no connection within 15s (socket closed first:
    {"code":408,…})`, `qr: failed`, `inbound`/`reply`/`outbound`/
    `group-metadata` **skipped**, `shutdown: passed`. That run validates the
    *failure* path (nothing was claimed that was not observed); it does **not**
    validate live WhatsApp behavior.
  - Run `npm run smoke:live` on the machine that owns the session to close the
    live-validation gap; the report states exactly which steps were observed.
- **Next phase gate**: run the live smoke test and record the outcome here;
  then media-download provider policy (`REQUIREMENTS.md` §3.8) and the remaining
  open design questions (§3).
