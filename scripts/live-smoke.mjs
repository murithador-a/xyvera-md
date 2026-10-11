#!/usr/bin/env node
/**
 * Live smoke test — the gate named in docs/LIMITATIONS.md.
 *
 * Connects to WhatsApp with a REAL session (yours) and verifies the adapter
 * end to end: QR emission (when unpaired), connection open, inbound message
 * normalization, a command → reply round trip, and optionally an outbound
 * self-send and a group metadata fetch.
 *
 * Every result is observed, never assumed. The report is written to
 * data/live-smoke-report.json (gitignored) and printed to the terminal.
 *
 * Usage:
 *   npm run smoke:live                       # QR (if needed) + inbound + reply
 *   npm run smoke:live -- --to 15551234567   # also prove the outbound socket
 *   npm run smoke:live -- --group 120363…@g.us
 *   node scripts/live-smoke.mjs --json > report.json
 *
 * Exit code: 0 only when every required step was observed passing.
 *
 * What it cannot prove: message *delivery* to another device, WhatsApp's
 * internal handling of group actions, or status-broadcast behavior with no
 * incoming status. Those stay "not-observed" on purpose.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';

import { bootstrap } from '../src/index.js';
import { loadEnv } from '../src/config/env.js';
import { normalizeMessage } from '../src/whatsapp/normalize.js';
import {
  createSmokeRun,
  runLiveSmoke,
  renderSmokeReport,
  smokeExitCode,
} from '../src/diagnostics/liveSmoke.js';

// ── tiny flag parser ───────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    to: null,
    group: null,
    timeoutSec: 90,
    qrTimeoutSec: 120,
    report: 'data/live-smoke-report.json',
    json: false,
    keepOpen: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--to') out.to = argv[++i] ?? null;
    else if (a === '--group') out.group = argv[++i] ?? null;
    else if (a === '--timeout') out.timeoutSec = Number(argv[++i] ?? 90);
    else if (a === '--qr-timeout') out.qrTimeoutSec = Number(argv[++i] ?? 120);
    else if (a === '--report') out.report = argv[++i] ?? out.report;
    else if (a === '--json') out.json = true;
    else if (a === '--keep-open') out.keepOpen = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(
    [
      'Xyvera MD — live smoke test',
      '',
      'Options:',
      '  --to <number>      also send one message to this number (proves outbound socket)',
      '  --group <jid>      also fetch metadata for this group JID (proves group APIs)',
      '  --timeout <sec>    wait budget per interactive step (default 90, minimum 10)',
      '  --qr-timeout <sec> wait budget for the QR/pairing step (default 120, minimum 5)',
      '  --report <path>    report file (default data/live-smoke-report.json)',
      '  --json             print the report as JSON (stdout stays machine-readable)',
      '  --keep-open        do not close the socket at the end (debugging)',
      '',
      'Run it on the machine that owns the WhatsApp session. Nothing here is',
      'simulated: steps that are not exercised are reported as skipped.',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

// In --json mode stdout must carry ONLY the JSON report: while the run is in
// progress, route whatever the logger/app writes to stderr (restored below).
const stdoutWrite = process.stdout.write.bind(process.stdout);
if (args.json) process.stdout.write = (...a) => process.stderr.write(...a);

const rootDir = process.cwd();
const env = loadEnv({ rootDir, env: process.env });
const dataDir = path.resolve(rootDir, env.DATA_DIR ?? 'data');
const credsFile = path.join(dataDir, 'session', 'creds.json');
const qrFile = path.join(dataDir, 'qr.png');
const reportPath = path.resolve(rootDir, args.report);
const timeoutMs = Math.max(10, args.timeoutSec || 90) * 1000;
const qrTimeoutMs = Math.max(5, args.qrTimeoutSec || 120) * 1000;
const toJid = args.to ? `${String(args.to).replace(/[^\d]/g, '')}@s.whatsapp.net` : null;

const wasPaired = await fs
  .access(credsFile)
  .then(() => true)
  .catch(() => false);

const run = createSmokeRun();
const hooks = {}; // filled by runLiveSmoke's attach()
const buffered = []; // events that arrive before attach() wires the hooks

/** Forward an observed event to the smoke run (or buffer it until attach). */
function emit(kind, payload) {
  const fn = hooks[kind];
  if (typeof fn === 'function') fn(payload);
  else buffered.push([kind, payload]);
}

process.stderr.write(
  [
    '',
    'Xyvera MD — live smoke test',
    `root: ${rootDir}`,
    `session: ${wasPaired ? 'stored credentials found (no QR expected)' : 'none yet — a QR will be printed below'}`,
    '',
    'Steps that need you at the keyboard:',
    '  1. If a QR appears, scan it with WhatsApp → Linked devices.',
    '  2. From ANOTHER phone/account, send the bot any normal message.',
    `  3. Then send a command, e.g. "${env.BOT_PREFIX ?? '.'}ping".`,
    '',
  ].join('\n') + '\n',
);

let app = null; // event handlers only read it after bootstrap resolves
let bootError = null;

try {
  app = await bootstrap({
    rootDir,
    connect: true,
    onNewSocket: (sock, adapter) => {
      // Passive observers: they never modify behavior, they only record.
      sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const raw of messages ?? []) {
          try {
            const msg = normalizeMessage(raw, { botJid: app?.botJid ?? null });
            if (!msg || msg.isStatus || msg.fromMe) continue;
            const prefix = app?.store?.settings?.get?.().prefix ?? '.';
            emit('onInbound', {
              chatJid: msg.chatJid ?? null,
              isGroup: !!msg.isGroup,
              hasText: !!msg.text,
              textLength: msg.text ? String(msg.text).length : 0,
              fromMe: false,
              hadPrefix: String(msg.text ?? '').startsWith(prefix),
            });
          } catch {
            /* observation only — never break the app's own handling */
          }
        }
      });

      // Wrap the live adapter's sendText so replies are observed, not assumed.
      if (adapter && !adapter.__smokeWrapped) {
        const original = adapter.sendText.bind(adapter);
        adapter.sendText = async (jid, text, opts) => {
          emit('onOutbound', { jid, textLength: String(text ?? '').length });
          return original(jid, text, opts);
        };
        adapter.__smokeWrapped = true;
      }
    },
    onEvent: {
      qr: ({ savedToFile }) => emit('onQr', { savedToFile: savedToFile ?? null }),
      connectionOpen: (jid) => emit('onConnected', { botJid: jid }),
      connectionClose: (info) => emit('onClosed', info),
    },
  });
} catch (err) {
  bootError = err; // reported as a failed connect step; nothing is skipped silently
}

const api = {
  wasPaired,
  get botJid() {
    return app?.botJid ?? null;
  },
  sendText: (jid, text) => app.client.sendText(jid, text),
  groupMetadata: (jid) => app.client.groupMetadata(jid),
  stop: async () => {
    try {
      app?.client?.sock?.end?.(new Error('live smoke test finished'));
    } catch {
      /* closing best-effort; the process exits below anyway */
    }
  },
};

const report = await runLiveSmoke({
  run,
  attach: async (liveHooks) => {
    Object.assign(hooks, liveHooks);
    // Flush anything observed between connect and attach (e.g. a fast QR).
    while (buffered.length) {
      const [kind, payload] = buffered.shift();
      hooks[kind]?.(payload);
    }
    if (bootError) throw bootError; // reported as a failed connect step
    return api;
  },
  timeoutMs,
  qrTimeoutMs,
  toJid,
  groupJid: args.group,
  qrFile,
});

report.root = rootDir;
report.env = {
  node: process.version,
  prefix: env.BOT_PREFIX,
  ownersConfigured: env.OWNER_NUMBERS.length,
};

if (!args.keepOpen) {
  try {
    app?.client?.sock?.end?.(new Error('live smoke test finished'));
  } catch {
    /* ignore */
  }
}

await fs.mkdir(path.dirname(reportPath), { recursive: true }).catch(() => {});
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {});

process.stdout.write = stdoutWrite; // stdout is the report channel again
if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else process.stdout.write(`${renderSmokeReport(report)}\nreport written to ${reportPath}\n`);

process.exit(smokeExitCode(report));
