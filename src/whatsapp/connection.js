/**
 * Baileys connection bootstrap. The ONLY module that dynamically imports
 * `baileys` (plus events.js for event wiring). Auth state lives in
 * data/session/ (gitignored) and is never logged.
 *
 * Deploy-grade behavior:
 *  - `onNewSocket(sock)` fires for EVERY socket (first connect and every
 *    reconnect) so the app can re-bind senders/handlers to the live socket
 *    instead of silently keeping a dead one.
 *  - Reconnects use exponential backoff (3s → 30s cap, jittered), infinite —
 *    a bot should survive network outages without hammering WhatsApp.
 *  - The WA web version check is best-effort: offline/cold boots fall back to
 *    Baileys' built-in default instead of crashing at startup.
 *  - QR is rendered to the terminal AND written to data/qr.png so headless /
 *    remote (VPS) deploys can scan it.
 *  - loggedOut (session revoked) exits with code 2 after telling the operator
 *    exactly what to do — no zombie process.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';

/** Reconnect backoff: 3s, 6s, 12s, 24s, 30s, 30s… with ±20% jitter. */
export function nextBackoffMs(attempt, rand = Math.random) {
  const base = Math.min(3000 * 2 ** Math.max(0, attempt - 1), 30_000);
  return Math.round(base * (0.8 + 0.4 * rand()));
}

export async function connectWhatsApp({ env, logger, onEvent = {}, onNewSocket = null, attempt = 0 }) {
  const baileys = await import('baileys');
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    Browsers,
  } = baileys;

  const dataDir = env.DATA_DIR ?? 'data';
  const sessionDir = path.resolve(dataDir, 'session');
  await fs.mkdir(sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  // Version check needs network — best effort only.
  let versionCfg = {};
  try {
    const { version } = await fetchLatestBaileysVersion();
    versionCfg = { version };
    logger.debug?.('using latest WA web version', { version: version?.join?.('.') });
  } catch (err) {
    logger.warn?.('could not fetch latest WA web version — using Baileys built-in default', {
      error: String(err?.message ?? err),
    });
  }

  // NOTE: self-referential logger — Baileys calls logger.child() DURING
  // makeWASocket(), so it must not close over `sock` (TDZ crash).
  const baileysLogger = {
    level: 'silent',
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: (...args) => logger.warn?.('baileys', { detail: String(args?.[0] ?? '') }),
    error: (...args) => logger.error?.('baileys', { detail: String(args?.[0] ?? '') }),
    fatal: () => {},
    child: () => baileysLogger,
  };

  const sock = makeWASocket({
    ...versionCfg,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.windows('Desktop'),
    logger: baileysLogger,
    // Never mark long-running ops as pending forever
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  // Bind the app to THIS socket (called again with the fresh socket on every
  // reconnect — the previous socket is dead at that point).
  onNewSocket?.(sock);

  let botJid = null;
  let attempts = attempt; // carried across the reconnect chain so backoff grows

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      // QR is a transient login code — printed to the operator terminal and
      // written to data/qr.png for headless deploys; never written to log files.
      try {
        const QRCode = (await import('qrcode')).default;
        const rendered = await QRCode.toString(qr, { type: 'terminal', small: true });
        process.stdout.write(`\nScan this QR with WhatsApp → Linked devices:\n${rendered}\n`);
      } catch {
        logger.info?.('QR received — terminal rendering unavailable.');
      }
      let qrSavedTo = null;
      try {
        const QRCode = (await import('qrcode')).default;
        const qrFile = path.resolve(dataDir, 'qr.png');
        await QRCode.toFile(qrFile, qr, { margin: 1, width: 400 });
        qrSavedTo = qrFile;
        process.stdout.write(`QR image also saved to ${qrFile} (for headless/remote deploys)\n`);
      } catch {
        /* non-fatal */
      }
      // Never pass the QR payload itself: it is a live login code. Only the
      // fact that pairing was requested and where the image was written.
      onEvent.qr?.({ savedToFile: qrSavedTo });
    }
    if (connection === 'open') {
      attempts = 0;
      botJid = sock.user?.id ? String(sock.user.id).split(':')[0] + '@s.whatsapp.net' : null;
      logger.info?.('WhatsApp connection open', { botJid });
      onEvent.connectionOpen?.(botJid);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      logger.warn?.('WhatsApp connection closed', { code, loggedOut });
      onEvent.connectionClose?.({ code, loggedOut });
      if (loggedOut) {
        logger.error?.(
          'Session was logged out by WhatsApp (revoked or too old). ' +
            'Delete the data/session/ folder and restart to pair again with a fresh QR.',
        );
        // No reconnect is possible; exit so a supervisor surfaces the failure.
        setTimeout(() => process.exit(2), 500);
        return;
      }
      attempts += 1;
      const wait = nextBackoffMs(attempts);
      logger.info?.(`Reconnecting in ${Math.round(wait / 1000)}s (attempt ${attempts})…`);
      const tryReconnect = () => {
        connectWhatsApp({ env, logger, onEvent, onNewSocket, attempt: attempts }).catch((err) => {
          logger.error?.('reconnect attempt failed', { error: String(err?.message ?? err) });
          attempts += 1;
          const retryWait = nextBackoffMs(attempts);
          logger.info?.(`Retrying in ${Math.round(retryWait / 1000)}s (attempt ${attempts})…`);
          setTimeout(() => tryReconnect(), retryWait);
        });
      };
      setTimeout(tryReconnect, wait);
    }
  });

  return { sock, getSessionDir: () => sessionDir, getBotJid: () => botJid };
}
