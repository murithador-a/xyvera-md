# Xyvera MD — Architecture

## 1. Workspace inspection findings (Phase 0)

Inspected before any code was written:

- Repository `murithador-a/xyvera-md` at commit `860d9bee` ("Initial commit") contained only
  `README.md` (a title line) and `.git`. **No source code, no package files, and no Anita V5
  reference archive were present** anywhere in the workspace.
- Runtime available: Node.js v22.x, npm 10.x (project targets Node >= 20 so it also runs on
  the owner's Windows machine and typical cloud servers).
- Consequence: the project is built from scratch. When an Anita V5 / EMMYHENZ V4 archive is
  added later, it will be inspected **read-only** for feature/menu organization only;
  authentication credentials, session files, keys, and other secrets inside it will never be
  exposed, logged, or reused.

## 2. WhatsApp library evaluation

Requirement: a maintained WhatsApp Web multi-device library, verified for documentation,
licensing, and real feature support (checked against npm registry and the official
repository on 2026-10-11).

| Candidate | Version / tags | License | Maintenance signal | Verdict |
|-----------|----------------|---------|--------------------|---------|
| `baileys` (npm; WhiskeySockets/Baileys) | `latest` 7.0.0-rc14, `legacy` 6.7.24 | MIT | Active (commits through Aug 2026, automated WhatsApp version updates, community Discord) | **Selected** |
| `@whiskeysockets/baileys` (npm) | 7.0.0-rc14 (mirror of the same source) | MIT | Same project | Not used; `baileys` is the package name the official README points to |
| Ad-hoc forks (`@ostyado/baileys`, `ourin-baileys`, etc.) | various | various | Third-party forks | Rejected — supply-chain and maintenance risk |

**Decision: use `baileys` (npm package), MIT-licensed, Node >= 20.**

Facts taken from the official sources (github.com/WhiskeySockets/Baileys, baileys.wiki):

- It is a WebSockets-based library for the WhatsApp Web API (multi-device & web). No
  Selenium/browser required.
- 7.0.0 introduced **breaking changes** (migration guide: `whiskey.so/migrate-latest`), and
  7.x is currently a release candidate line; `legacy` (6.7.x) is still tagged. Risk is
  contained by isolating every Baileys import behind `src/whatsapp/` (see §3).
- Confirmed available operations (official guide): connect via QR or pairing code; persist
  and restore auth state; send text/media/mentions/quotes; **delete messages for everyone**
  (revoke); group metadata + participants (add/kick/promote/demote), group subject/description,
  invite link revoke, ephemeral timer, add-mode; ephemeral/slowmode-related settings where
  exposed; send statuses; read messages / read receipts; presence; privacy settings incl.
  block/unblock; view-once messages (receive as view-once — **we do not bypass them**).
- Confirmed limits: unofficial API — WhatsApp may restrict/ban automation; event payloads
  for some actions (e.g. why a participant left) do not always distinguish voluntary leave
  vs removal; broadcast-list creation is not supported by WA Web; some profile operations
  may fail depending on account state. Every uncertain capability is wrapped with
  "attempt → report the real outcome", never a fabricated success.
- License obligations: MIT — permissive; copyright notice retained in docs.

## 3. Layered architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  WhatsApp transport (src/whatsapp/)                                │
│  connection.js events.js groups.js statuses.js media.js            │
│  • ONLY place that imports `baileys` (dynamic import)              │
│  • Normalizes raw events → MessageContext / GroupContext           │
│  • Executes group actions via a mockable WhatsAppClient interface  │
├────────────────────────────────────────────────────────────────────┤
│  Application core                                                 │
│  commands/registry.js  commands/router.js  commands/menu.js        │
│  whatsapp/permissions.js  services/moderation.js                   │
│  services/gameEngine.js  services/statusAutomation.js              │
│  services/confirmations.js                                         │
│  • Pure logic, unit-tested without network or credentials          │
├────────────────────────────────────────────────────────────────────┤
│  Storage (src/storage/)                                           │
│  repository.js (interface)  jsonStore.js  schemas.js  migrations.js│
│  • JSON now, SQLite later — handlers depend on the interface only  │
├────────────────────────────────────────────────────────────────────┤
│  Foundation (src/config/, src/utils/)                             │
│  env.js defaults.js  logger.js errors.js validators.js             │
│  cooldowns.js templates.js  providerCatalog.js                     │
├────────────────────────────────────────────────────────────────────┤
│  Verification & operations (src/diagnostics/, scripts/, deploy/)   │
│  doctor.js (offline preflight)  liveSmoke.js (observed live report)│
│  verify-commands-doc.mjs  live-smoke.mjs  CI  systemd/PM2/Docker    │
└────────────────────────────────────────────────────────────────────┘
```

Principles:

- **Dependency direction**: transport → application → storage → foundation. Never upward.
- **Single Baileys boundary**: `src/index.js` and command handlers never import `baileys`;
  they receive a `WhatsAppClient` interface (`sendText`, `sendMedia`, `deleteMessage`,
  `kickParticipant`, `promoteParticipant`, `demoteParticipant`, `groupMetadata`,
  `isGroupAdmin`, `setGroupName`, `setGroupDescription`, `revokeInvite`, `updateProfile*`,
  `blockUser`, …). The real adapter wraps Baileys; tests use an in-memory fake.
- **Central enforcement**: the router is the single choke point for mode/ban/permission/
  cooldown checks *before* any handler runs. Handlers may re-check fine-grained rules but
  never replace central checks.
- **Structured logging** with automatic redaction of session/auth/token-like fields.
  Authentication state is stored under `data/session/` (gitignored) and is never logged or
  exposed through commands.

## 4. Message data flow

```
Baileys event (messages.upsert, group-participants.update, messages.delete, …)
   │
   ▼
events.js → normalize → MessageContext
   { chatJid, senderJid, isGroup, text, mentions, quoted, messageId, timestamp, … }
   │
   ├──► security pipeline (per-group config; independent of commands)
   │      anti-delete snapshot  →  anti-link  →  anti-tag  →  anti-bad-word
   │      (each: exemption check → decision → action via WhatsAppClient → mod log)
   │
   └──► command router (if text starts with configured prefix)
          1. parse command + args (registry lookup incl. aliases)
          2. bot-ban check → 3. mode check (public/private)
          4. permission check (owner / sudo capability / group-admin, from REAL JIDs)
          5. cooldown check → 6. confirmation-required gate
          7. run handler(ctx) → reply via WhatsAppClient
          8. errors → centralized handler → accurate user-facing message + structured log
```

Group events (join/leave) go through `events.js` → welcome/goodbye templates (per-group,
only when enabled) using only event-provided facts.

Status events (status@broadcast) go through `statuses.js` → `statusAutomation.js`
(autoview/autoreact, rate-limited, deduplicated, instantly disableable).

## 5. Permission model

### 5.1 Identities

- Canonical identity = **normalized WhatsApp JID** (`123456789@s.whatsapp.net`) derived
  from the transport layer. Display names, push names, quoted authors, and mentions are
  **never** accepted as proof of identity.
- **Owner**: JIDs listed in `OWNER_NUMBERS` (env) / settings. If none configured, owner
  commands respond with a setup message instead of guessing.
- **Bot self**: the connected account's own JID is treated as owner-equivalent (it is the
  authenticated device). Documented in `docs/LIMITATIONS.md`.
- **Sudo**: stored map `jid → { capabilities: Set, grantedAt, grantedBy }`.
- **Group admin**: queried live from group metadata at enforcement time (cached briefly),
  never stored as the sole long-term source of truth.
- **Bot-banned**: stored set of JIDs denied command usage (not kicked from groups).

### 5.2 Access levels (checked in this order)

1. Command disabled / unknown → ignored or "unknown command".
2. Sender bot-banned → silent ignore for commands (moderation still applies).
3. Mode gate: `private` → sender must be owner or sudo (or bot self). `public` → open.
4. Command access level:
   - `everyone` — any sender passing 2–3.
   - `group-admin` — plus actual group-admin status **or** the matching sudo capability.
   - `sudo:<capability>` — plus the granted capability (owner always passes).
   - `owner` — owner only (sudo never passes these: `.addsudo .delsudo .clearsession
     .restart .leavegc`, and revocation of sudo).
5. Cooldown (global / per-command / per-group as configured).
6. Destructive commands additionally require a live **confirmation** (see §5.3).

Capability families (`docs/REQUIREMENTS.md` §1.5): `group.moderate`, `group.kick`,
`group.promote`, `group.config`, `group.tag`, `group.welcome`, `security.manage`,
`bot.settings`, `status.automation`, `maintenance`.

Mode and sudo are orthogonal: `private` mode restricts *who may use the bot at all*; sudo
capabilities restrict *what an authorized user may do*. The owner can always restore
`public` mode (mode is checked after owner identity, and `.mode` is owner-only).

### 5.3 Destructive-action confirmations

`services/confirmations.js` keeps short-lived (default 60s) pending actions keyed by
`(chatJid, userJid, action)` with a one-time nonce. Required for `.revoke`, `.leavegc`,
`.clearsession`, and any configured warning-escalation that kicks. Confirmations expire,
are user-scoped (user B cannot confirm user A's action), and are consumed atomically.

## 6. Storage design

### 6.1 Layout (runtime)

```
data/
  session/          # Baileys auth state — gitignored, never logged
  settings.json     # global bot settings (prefix, mode, branding, sudo map, bans)
  groups.json       # { [groupJid]: GroupConfig }
  warnings.json     # per-group warning state + retained history
  status.json       # status automation settings + processed-id cache bounds
  logs/             # optional file logs (gitignored)
tmp/                # media scratch (cleared by .cleartmp)
```

### 6.2 Abstraction

`storage/repository.js` defines collection-oriented repositories
(`get(id)`, `set(id, value)`, `update(id, fn)`, `delete(id)`, `all()`, `save()`).
`jsonStore.js` implements them with:

- **Atomic writes**: serialize → write `file.tmp` → `rename()` over the target (POSIX-atomic;
  on Windows `fs.rename` replaces the destination as of Node 22 behavior via `fs.rename`
  fallback to copy+unlink if `EPERM`).
- **Serialized updates**: per-file promise chain so concurrent updates never interleave.
- **Validation**: schemas.js validators on load and before save; invalid data is rejected
  with a structured error rather than crashing the process.
- **Malformed-file recovery**: unreadable/invalid JSON is moved to `*.corrupt-<timestamp>`
  and replaced with safe defaults (logged loudly), so the bot survives bad files.
- **Schema versioning**: every root document carries `schemaVersion`; `migrations.js`
  applies ordered migration steps on load (v1 is the baseline).

Session/auth state (Baileys `useMultiFileAuthState`) lives **outside** these documents.

A future SQLite backend only has to implement the same repository interface; no command
handler changes.

## 7. Command system

- `commands/registry.js` — each command is a declarative object: name, aliases, category,
  description, `args` (for the menu), access level, required capabilities, `groupOnly`,
  cooldown, `status` (`implemented` / `partial` / `stub-config-required` /
  `pending-definition`), and `handler(ctx)`.
- `commands/router.js` — parsing + the enforcement pipeline (§4) + error mapping.
- `commands/menu.js` — menu text **generated from the registry** (a command that does not
  exist cannot appear; a command that exists but is a stub is labeled).
- Command modules are split per category (`commands/owner`, `commands/group`,
  `commands/security`, `commands/automation`, `commands/games`, `commands/ai`,
  `commands/media`, `commands/utilities`, `commands/info`) — no giant handler files.

## 8. Error handling & logging

- Typed errors (`utils/errors.js`): `ValidationError`, `PermissionDeniedError`,
  `ConfirmationRequiredError`, `ExternalServiceError`, `NotConfiguredError`,
  `WhatsAppActionError` (carries the real upstream failure). The router maps each to an
  honest user-facing message ("WhatsApp rejected the action: …" when the platform refused).
- `utils/logger.js`: leveled structured logs (JSON lines or pretty), with key redaction
  (`token|key|secret|session|creds|password|auth`) so credentials cannot leak into logs.

## 9. Testing strategy

- `node:test` + `node:assert` (zero extra dev dependencies; runs offline).
- Pure-logic suites: permissions/modes/bans, per-group isolation, templates, anti-link
  decisions & exemptions & dedupe, anti-tag, anti-bad-word, warnings/escalation,
  confirmations, tic-tac-toe engine, JSON store (atomicity, malformed recovery,
  migrations), router pipeline with a fake `WhatsAppClient`, menu generation,
  preflight doctor, live-smoke engine (observed-evidence invariants), and the
  registry ↔ `docs/COMMANDS.md` sync gate.
- No test requires a live WhatsApp account, network, or API keys.
- `npm run lint` = syntax/static sanity across all modules (`node --check`);
  `npm run verify:docs` fails when the generated command reference is stale;
  `npm test`; `npm run check` runs all three. CI
  (`.github/workflows/ci.yml`) does the same on Node 20 and 22, plus a
  `--check` boot and `--doctor` preflight.

## 10. Windows → cloud path

- No native code in *our* modules; path handling via `node:path`; atomic writes handled
  portably (§6.2). Works on Windows dev machines as-is.
- Cloud: long-running Node process (PM2/systemd/Docker — final target TBD in
  `docs/REQUIREMENTS.md` §3.9). `.restart` goes through a restart adapter (default: exit
  with a documented code the supervisor treats as restart).
- Session portability: `data/session/` can be copied between environments (treat as a
  secret). QR/pairing-code auth is done once; `docs/LOCAL_SETUP.md` covers both.

## 11. External service integration policy

Every external API (AI, weather, currency, short URL, screenshot, lyrics, media download)
is: (1) documented with provider, pricing implications, rate limits; (2) configured via
env; (3) behind `services/*Provider.js` adapters; (4) reported as
"not configured — add X to .env" when unset. None is faked. SSRF-safe URL handling for
`.screenshot` (private IP / localhost / file scheme blocked in `utils/validators.js`).

The requirements matrix lives in **`src/config/providerCatalog.js`** — one source of
truth consumed by `.configcheck`, the `--doctor` preflight and the docs, so the operator
can never be told two different things about whether a feature is ready.

## 12. Verification & operations tooling

Two different questions, two different tools — neither one fakes the other:

- **`node src/index.js --doctor [--json]`** (`src/diagnostics/doctor.js`) — *is this
  install ready?* Offline preflight: runtime version, `.env`, owner identity, prefix,
  mode, writable `data/`+`tmp/`, quarantined files, storage schema, session presence,
  branding asset, provider readiness, registry size. Each check prints the evidence it
  observed and the exact fix; exit code 1 only for hard failures. Used by CI and by
  operators before/after deploys.
- **`npm run smoke:live`** (`src/diagnostics/liveSmoke.js` + `scripts/live-smoke.mjs`) —
  *does the real WhatsApp adapter work?* Connects with the operator's session and records
  only observed events: QR emitted, connection open, inbound message normalized, command
  → reply round trip, optional outbound send and group metadata. The engine enforces the
  invariant that a step cannot be marked `passed` without evidence; unexercised steps are
  `skipped`/`not-observed`. Reports land in `data/live-smoke-report.json`.
- **Docs-sync gate** (`scripts/verify-commands-doc.mjs`) — regenerates
  `docs/COMMANDS.md` from the live registry in memory and fails when the committed file
  is stale; wired into `npm run check`, CI, and a unit test.
- **Deploy artifacts** (`deploy/`) — systemd unit, PM2 config, Dockerfile,
  docker-compose; single-instance by design, `data/` as the persistent volume, exit
  codes 2 (logged out) and 75 (restart requested) as the restart contract.
