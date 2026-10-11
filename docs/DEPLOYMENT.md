# Xyvera MD — Cloud Deployment

Target: a **persistent** server (the bot is a long-running process holding a
WhatsApp session). The final platform (VPS + PM2/systemd, Docker, or PaaS) is
an open decision (`docs/REQUIREMENTS.md` §3.9) — this guide covers the VPS and
container paths and the constraints any target must satisfy. Ready-to-use
artifacts live in `deploy/`: `xyvera-md.service` (systemd),
`ecosystem.config.cjs` (PM2), `Dockerfile` + `docker-compose.yml` (containers).

> These artifacts were written against each platform's documented behavior but
> were **not built or executed in the development sandbox** (no Docker/systemd
> there). Treat the first run as the test, and report failures honestly.
> `node src/index.js --doctor` on the host is the fastest way to catch
> environment problems before blaming the supervisor.

## Requirements any host must meet

1. **Persistent disk** for `data/` (settings + `data/session/` auth state). Lose
   the session dir ⇒ re-pair via QR.
2. **Long-running process** with automatic restart on crash/exit.
3. **Node.js ≥ 20**, outbound HTTPS (WhatsApp Websockets + any configured APIs).
4. **Single instance** per `data/` directory (JSON store is not multi-writer).
5. **Secrets via environment** — never bake `.env` into images; never commit it.

## Deploying to a VPS (Ubuntu example)

```bash
# 1. Node 20+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 2. App
git clone <your-repo> /opt/xyvera-md
cd /opt/xyvera-md
npm ci --omit=dev
cp .env.example .env && nano .env      # set OWNER_NUMBERS etc.
node src/index.js --doctor             # preflight: fix ❌ items before starting

# 3. First run to pair WhatsApp (QR in terminal over SSH)
npm start
# scan the QR, confirm "connected as …", then Ctrl+C
# Headless alternative: the QR is also written to data/qr.png — copy it off
# the server (scp) and scan that image with WhatsApp → Linked devices.

# 4. Supervisor — systemd (unit file ships in the repo; edit User/paths)
sudo useradd -r xyvera && sudo chown -R xyvera /opt/xyvera-md
sudo cp deploy/xyvera-md.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now xyvera-md

# 5. Prove the live adapter actually works, then stop the unit briefly
npm run smoke:live        # observed report → data/live-smoke-report.json
```

PM2 alternative: `pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup`.

## Process exit codes

| Code | Meaning | Operator action |
|------|---------|-----------------|
| 0 | Clean shutdown (SIGINT/SIGTERM) | none |
| 2 | Session logged out / revoked by WhatsApp | delete `data/session/`, restart, scan the new QR in `data/qr.png` |
| 75 | Restart requested (`.restart` / after `.clearsession`) | none — supervisor restarts automatically |

## `.restart` and `.clearsession`

- `.restart` (owner-only, confirm-gated) exits with code **75** ("restart
  requested"). systemd/PM2 restart policies bring the process back.
- `.clearsession` (owner-only, confirm-gated) deletes `data/session/` and exits
  75 — after restart you must re-scan the QR.

## Docker

`deploy/Dockerfile` + `deploy/docker-compose.yml` are provided:

```bash
cp .env.example .env            # set OWNER_NUMBERS etc.
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml logs -f   # scan the QR here
```

- Base image `node:22-slim` (glibc) — chosen deliberately over alpine so the
  `sharp` media pipeline uses its prebuilt glibc binaries.
- `data/` (settings + session) and `tmp/` are mounted volumes; without them a
  container replacement loses the WhatsApp session.
- `restart: unless-stopped` covers exit code 75 ("restart requested"); the
  container is single-instance on purpose (the JSON store is single-writer).
- Config comes from `--env-file .env`; credentials are **never** baked into the
  image (`.dockerignore` excludes `.env`, `data/`, `tmp/`).
- Health check: `node src/index.js --doctor --json` inside the container.

## Upgrades

1. `systemctl stop xyvera-md` (or `pm2 stop` / `docker compose stop`)
2. `git pull && npm ci --omit=dev`
3. `npm run check` (offline gate: lint + docs sync + 213 tests)
4. `node src/index.js --doctor` (preflight against your data/session)
5. `systemctl start xyvera-md`

JSON schema migrations run automatically on load; old files are backed up if
they cannot be parsed (`.corrupt-<ts>`).

## Security checklist

- [ ] `data/session/` permissions restricted (it is a full WhatsApp login)
- [ ] `.env` not readable by other users; never in the repo
- [ ] `OWNER_NUMBERS` set to your number only
- [ ] Bot account is not your primary WhatsApp account (recommended)
- [ ] Log files (if enabled) are treated as sensitive — the logger redacts
      token/key/session-like fields, but chat content may still appear
