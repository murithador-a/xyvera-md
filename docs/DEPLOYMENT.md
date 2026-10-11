# Xyvera MD — Cloud Deployment

Target: a **persistent** server (the bot is a long-running process holding a
WhatsApp session). The final platform (VPS + PM2/systemd, Docker, or PaaS) is
an open decision (`docs/REQUIREMENTS.md` §3.9) — this guide covers the VPS path
and the constraints any target must satisfy.

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

# 3. First run to pair WhatsApp (QR in terminal over SSH)
npm start
# scan the QR, confirm "connected as …", then Ctrl+C
# Headless alternative: the QR is also written to data/qr.png — copy it off
# the server (scp) and scan that image with WhatsApp → Linked devices.

# 4. Supervisor — systemd
sudo tee /etc/systemd/system/xyvera-md.service <<'UNIT'
[Unit]
Description=Xyvera MD WhatsApp bot
After=network-online.target

[Service]
WorkingDirectory=/opt/xyvera-md
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
EnvironmentFile=/opt/xyvera-md/.env
# exit code 75 is our "restart requested" signal — still restarts
User=xyvera

[Install]
WantedBy=multi-user.target
UNIT
sudo useradd -r xyvera && sudo chown -R xyvera /opt/xyvera-md
sudo systemctl enable --now xyvera-md
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

## Docker (outline)

- Image: `node:22-alpine`, `npm ci --omit=dev`, `CMD ["node","src/index.js"]`.
- Mount `/app/data` as a volume (session + settings persistence).
- Pass config with `--env-file .env`.
- Do **not** bake credentials into the image.

## Upgrades

1. `systemctl stop xyvera-md` (or `pm2 stop`)
2. `git pull && npm ci --omit=dev`
3. `npm run check` (offline gate)
4. `systemctl start xyvera-md`

JSON schema migrations run automatically on load; old files are backed up if
they cannot be parsed (`.corrupt-<ts>`).

## Security checklist

- [ ] `data/session/` permissions restricted (it is a full WhatsApp login)
- [ ] `.env` not readable by other users; never in the repo
- [ ] `OWNER_NUMBERS` set to your number only
- [ ] Bot account is not your primary WhatsApp account (recommended)
- [ ] Log files (if enabled) are treated as sensitive — the logger redacts
      token/key/session-like fields, but chat content may still appear
