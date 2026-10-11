# Xyvera MD — Local Setup (Windows-first)

## Prerequisites

- **Node.js ≥ 20** (nodejs.org LTS installer; verify in PowerShell: `node -v`)
- **npm** (bundled with Node)
- **Git** (optional, for cloning)
- A WhatsApp account on a phone (for linking the bot as a companion device)

## 1. Install

```powershell
cd xyvera-md
npm install
```

Dependencies are small: `baileys` (WhatsApp transport) and `qrcode` (terminal
QR + `.qr` utility). Everything else is standard library.

## 2. Configure

```powershell
copy .env.example .env
notepad .env
```

Minimum to set:

- `OWNER_NUMBERS` — your number in international format, digits only
  (e.g. `15551234567`). **Leave empty and owner commands stay disabled** — the
  bot never guesses an owner.
- `OWNER_NAME` — display name shown in `.menu` / `.owner`
- Optional: `BOT_NAME`, `BOT_PREFIX`, `GITHUB_URL`, provider API keys

Never commit `.env`. Never share `data/session/` — it is the WhatsApp login.

## 3. Verify without connecting

```powershell
npm run check          # syntax check + docs sync + full test suite (offline)
node src/index.js --check
npm run doctor         # preflight report: what is configured / still missing
```

`--check` initializes storage, registers all commands, and exits — no network.
`--doctor` prints each check with observed evidence and an exact fix for
anything wrong (`⚠️` warnings are fine on a fresh checkout; `❌` failures exit 1).
Add `--json` for machine-readable output.

## 4. Start and link WhatsApp (QR)

```powershell
npm start
```

A QR code renders in the terminal. On your phone: **WhatsApp → Settings →
Linked devices → Link a device** and scan it. The session is saved under
`data/session/` (gitignored). Subsequent starts reuse it silently.

**Pairing-code alternative** (if QR rendering misbehaves in your terminal):
connect the phone and the computer to the same network, and use the pairing
code flow from the Baileys docs (`requestPairingCode`) — or run Windows
Terminal/PowerShell with a font that supports block characters for QR output.

## 5. Smoke test

Send the bot (or a group it is in) `.ping` → expect `Pong!`. Then `.menu`.
In a group: `.gcstatus` shows the group's (default, all-off) config.

To exercise group-admin commands, add the bot account to a group and make it
an admin.

### Instrumented live smoke test (`npm run smoke:live`)

This is the only way to verify the Baileys adapter against a real account, and
it reports only what it actually observed:

```powershell
npm run smoke:live                        # QR (if needed) + inbound + command reply
npm run smoke:live -- --to 15551234567    # also prove the outbound socket
npm run smoke:live -- --group 120363…@g.us  # also prove group metadata fetching
```

What to expect: the script connects, tells you to scan the QR (if unpaired) and
to send a normal message followed by a command such as `.ping` from another
phone. It prints a per-step report, writes `data/live-smoke-report.json`, and
exits 0 **only** when every required step was observed. Steps that did not
happen are labelled `skipped`/`not-observed` — an incomplete run is an
incomplete run, not a pass.

## 6. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `OWNER_NUMBERS` commands say "not configured" | Set it in `.env` and restart |
| QR not scannable | Maximize the terminal; avoid font scaling artifacts; or use pairing codes |
| Bot restarts loop with 408/428 closes | WhatsApp rejected the handshake — update `baileys` (`npm i baileys@latest`), retry; see the Baileys Discord/README for server-side changes |
| `loggedOut` in logs | The device was unlinked from the phone. Delete `data/session/` and re-scan |
| Commands do nothing in private mode | By design: only owner + sudo. Use `.mode public` as owner |
| Tests fail after edits | `npm test` shows the failing suite; tests need no network/credentials |

## 7. Project layout

See `docs/ARCHITECTURE.md` §3. Commands live under `src/commands/*`, WhatsApp
transport under `src/whatsapp/*` (the only place Baileys is imported), business
logic under `src/services/*`, persistence under `src/storage/*`.

## 8. Regenerating docs

```powershell
node scripts/gen-commands.mjs   # rewrites docs/COMMANDS.md from the registry
npm run verify:docs             # fails if the committed doc is stale
```

`npm run check` runs the docs-sync gate too, so a command change that is not
regenerated into `docs/COMMANDS.md` fails the build.
