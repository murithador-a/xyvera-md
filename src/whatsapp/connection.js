/**
 * Baileys connection bootstrap. The ONLY module that dynamically imports
 * `baileys` (plus events.js for event wiring). Auth state lives in
 * data/session/ (gitignored) and is never logged.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';

export async function connectWhatsApp({ env, logger, onEvent = {} }) {
  const baileys = await import('baileys');
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    Browsers,
  } = baileys;

  const sessionDir = path.resolve(env.DATA_DIR ?? 'data', 'session');
  await fs.mkdir(sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.windows('Desktop'),
    logger: {
      level: 'silent',
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: (...args) => logger.warn?.('baileys', { detail: String(args?.[0] ?? '') }),
      error: (...args) => logger.error?.('baileys', { detail: String(args?.[0] ?? '') }),
      fatal: () => {},
      child: () => sock.config.logger,
    },
    // Never mark long-running ops as pending forever
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  let botJid = null;

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      try {
        const QRCode = (await import('qrcode')).default;
        const rendered = await QRCode.toString(qr, { type: 'terminal', small: true });
        // QR is a transient login code — acceptable to print to the operator terminal,
        // but it is never written to log files.
        process.stdout.write(`\nScan this QR with WhatsApp → Linked devices:\n${rendered}\n`);
      } catch {
        logger.info?.('QR received — enable terminal output or use pairing-code login.');
      }
    }
    if (connection === 'open') {
      botJid = sock.user?.id ? String(sock.user.id).split(':')[0] + '@s.whatsapp.net' : null;
      logger.info?.('WhatsApp connection open', { botJid });
      onEvent.connectionOpen?.(botJid);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      logger.warn?.('WhatsApp connection closed', { code, loggedOut });
      onEvent.connectionClose?.({ code, loggedOut });
      if (!loggedOut) {
        logger.info?.('Reconnecting in 3s…');
        setTimeout(() => {
          connectWhatsApp({ env, logger, onEvent }).catch((err) => {
            logger.error?.('reconnect failed', { error: String(err?.message ?? err) });
          });
        }, 3000);
      }
    }
  });

  return { sock, getSessionDir: () => sessionDir, getBotJid: () => botJid };
}
