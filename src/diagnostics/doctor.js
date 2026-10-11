/**
 * Preflight diagnostics (`node src/index.js --doctor`).
 *
 * Purpose: answer "is this install ready to run, and what is missing?" with
 * observed evidence instead of assumptions. Every check reports what it
 * actually measured and, when it fails, the exact fix.
 *
 * States:
 *   pass    — verified working
 *   warn    — usable, but something should be configured (never blocks start)
 *   fail    — the bot cannot run correctly until this is fixed (exit code 1)
 *   skipped — the check could not be run in this context (reported as-is)
 *
 * No network I/O, no WhatsApp connection, no secret values in the output.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { loadEnv } from '../config/env.js';
import { validatePrefix } from '../utils/validators.js';
import { SCHEMA_VERSION, MODES } from '../config/defaults.js';
import { providerStatus } from '../config/providerCatalog.js';

export const CHECK_STATES = Object.freeze({
  PASS: 'pass',
  WARN: 'warn',
  FAIL: 'fail',
  SKIPPED: 'skipped',
});

const STATE_ICON = { pass: '✅', warn: '⚠️', fail: '❌', skipped: '⏭️' };

const MIN_NODE_MAJOR = 20;

function majorOf(version) {
  return Number(String(version ?? '').split('.')[0]);
}

function check(id, label, state, detail, fix = null) {
  return { id, label, state, detail, fix };
}

/** Does the directory exist and accept a write? */
async function probeWritable(fsImpl, dir) {
  const file = path.join(dir, `.doctor-probe-${process.pid}-${Date.now()}`);
  try {
    await fsImpl.mkdir(dir, { recursive: true });
    await fsImpl.writeFile(file, 'probe', 'utf8');
    await fsImpl.unlink(file).catch(() => {});
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.code ?? err?.message ?? err) };
  }
}

async function listQuarantineFiles(fsImpl, dataDir) {
  try {
    const entries = await fsImpl.readdir(dataDir);
    return entries.filter((n) => /\.corrupt-\d+$/.test(n));
  } catch {
    return [];
  }
}

async function fileExists(fsImpl, p) {
  try {
    await fsImpl.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run every preflight check.
 *
 * @param {object} opts
 * @param {string} opts.rootDir            project root (where .env lives)
 * @param {object} opts.env                loaded env (see config/env.js loadEnv)
 * @param {object} [opts.store]            booted storage (enables storage checks)
 * @param {object} [opts.app]              booted app (enables registry/config checks)
 * @param {object} [opts.fs]               injectable fs (tests)
 * @param {string} [opts.nodeVersion]      injectable Node version (tests)
 * @param {number} [opts.now]              injectable clock (tests)
 * @returns {Promise<object>} report
 */
export async function runDoctor({
  rootDir = process.cwd(),
  env = null,
  store = null,
  app = null,
  fs = fsp,
  nodeVersion = process.versions.node,
  now = Date.now(),
} = {}) {
  const resolvedEnv = env ?? loadEnv({ rootDir, env: {} });
  const dataDir = path.resolve(rootDir, resolvedEnv.DATA_DIR ?? 'data');
  const tmpDir = path.resolve(rootDir, resolvedEnv.TMP_DIR ?? 'tmp');
  const checks = [];

  // ── runtime ──────────────────────────────────────────────────────────
  const major = majorOf(nodeVersion);
  checks.push(
    check(
      'node',
      'Node.js version',
      major >= MIN_NODE_MAJOR ? CHECK_STATES.PASS : CHECK_STATES.FAIL,
      `v${nodeVersion} (requires >= ${MIN_NODE_MAJOR})`,
      major >= MIN_NODE_MAJOR ? null : `Install Node.js ${MIN_NODE_MAJOR} or newer (nvm, nodesource, or the official installer).`,
    ),
  );

  // ── configuration file ───────────────────────────────────────────────
  const envFile = path.join(rootDir, '.env');
  const hasEnvFile = await fileExists(fs, envFile);
  checks.push(
    check(
      'env-file',
      '.env configuration file',
      hasEnvFile ? CHECK_STATES.PASS : CHECK_STATES.WARN,
      hasEnvFile
        ? 'present (values are never printed here)'
        : 'not found — defaults are in use',
      hasEnvFile ? null : `Copy the template: cp .env.example .env, then set OWNER_NUMBERS.`,
    ),
  );

  const owners = Array.isArray(resolvedEnv.OWNER_NUMBERS) ? resolvedEnv.OWNER_NUMBERS : [];
  checks.push(
    check(
      'owner',
      'Owner identity',
      owners.length > 0 ? CHECK_STATES.PASS : CHECK_STATES.WARN,
      owners.length > 0
        ? `${owners.length} owner number(s) configured`
        : 'OWNER_NUMBERS is empty — owner-only commands stay disabled (never guessed)',
      owners.length > 0 ? null : 'Set OWNER_NUMBERS in .env (digits only, comma-separated, international format).',
    ),
  );

  const prefix = resolvedEnv.BOT_PREFIX ?? '.';
  let prefixOk = true;
  let prefixReason = '';
  try {
    validatePrefix(prefix);
  } catch (err) {
    prefixOk = false;
    prefixReason = String(err?.message ?? err);
  }
  checks.push(
    check(
      'prefix',
      'Command prefix',
      prefixOk ? CHECK_STATES.PASS : CHECK_STATES.FAIL,
      prefixOk ? `"${prefix}" is valid` : `"${prefix}" is invalid: ${prefixReason}`,
      prefixOk ? null : 'Use 1–2 non-alphanumeric characters (e.g. . or !) in BOT_PREFIX.',
    ),
  );

  const mode = String(resolvedEnv.BOT_MODE ?? '').toLowerCase();
  const modeOk = mode === MODES.PUBLIC || mode === MODES.PRIVATE;
  checks.push(
    check(
      'mode',
      'Bot mode (BOT_MODE default)',
      modeOk ? CHECK_STATES.PASS : CHECK_STATES.FAIL,
      modeOk
        ? `${mode} (a persisted .mode setting overrides this after first save)`
        : `"${resolvedEnv.BOT_MODE}" is not a valid mode`,
      modeOk ? null : 'Set BOT_MODE to public or private.',
    ),
  );

  // ── storage ──────────────────────────────────────────────────────────
  const dataProbe = await probeWritable(fs, dataDir);
  checks.push(
    check(
      'data-dir',
      'Data directory writable',
      dataProbe.ok ? CHECK_STATES.PASS : CHECK_STATES.FAIL,
      dataProbe.ok ? `${dataDir} accepts writes` : `${dataDir} is not writable (${dataProbe.reason})`,
      dataProbe.ok ? null : 'Fix ownership/permissions for the user that runs the bot (the session lives here).',
    ),
  );

  const tmpProbe = await probeWritable(fs, tmpDir);
  checks.push(
    check(
      'tmp-dir',
      'Temp directory writable',
      tmpProbe.ok ? CHECK_STATES.PASS : CHECK_STATES.FAIL,
      tmpProbe.ok ? `${tmpDir} accepts writes` : `${tmpDir} is not writable (${tmpProbe.reason})`,
      tmpProbe.ok ? null : 'Fix permissions on TMP_DIR (media commands and .cleartmp use it).',
    ),
  );

  const quarantined = await listQuarantineFiles(fs, dataDir);
  checks.push(
    check(
      'quarantine',
      'Corrupted storage files',
      quarantined.length === 0 ? CHECK_STATES.PASS : CHECK_STATES.WARN,
      quarantined.length === 0
        ? 'none — all JSON documents parsed cleanly'
        : `${quarantined.length} quarantined file(s): ${quarantined.join(', ')}`,
      quarantined.length === 0 ? null : 'Inspect the quarantined copies; the bot replaced them with safe defaults.',
    ),
  );

  if (store) {
    let storageDetail = 'documents loaded';
    let storageState = CHECK_STATES.PASS;
    try {
      const settings = store.settings.get();
      storageDetail =
        `settings schema v${settings.schemaVersion ?? SCHEMA_VERSION} | ` +
        `${store.groups.all().length} group config(s) | prefix "${settings.prefix}"`;
      if ((settings.schemaVersion ?? SCHEMA_VERSION) > SCHEMA_VERSION) {
        storageState = CHECK_STATES.FAIL;
        storageDetail = `settings schema v${settings.schemaVersion} is newer than this build (v${SCHEMA_VERSION}) — refusing to guess`;
      }
    } catch (err) {
      storageState = CHECK_STATES.FAIL;
      storageDetail = `could not read loaded settings: ${String(err?.message ?? err)}`;
    }
    checks.push(
      check('storage', 'Persistent storage', storageState, storageDetail,
        storageState === CHECK_STATES.PASS ? null : 'Back up data/ and run this build against a compatible schema version.'),
    );
  } else {
    checks.push(
      check('storage', 'Persistent storage', CHECK_STATES.SKIPPED, 'storage was not booted in this run', null),
    );
  }

  const credsFile = path.join(dataDir, 'session', 'creds.json');
  const paired = await fileExists(fs, credsFile);
  checks.push(
    check(
      'session',
      'WhatsApp session',
      paired ? CHECK_STATES.PASS : CHECK_STATES.WARN,
      paired
        ? `paired credentials found (${path.relative(rootDir, credsFile)})`
        : 'no session yet — the first start prints a QR to scan',
      paired ? null : 'Run npm start once and scan the QR (also written to data/qr.png for headless hosts).',
    ),
  );

  // ── assets / optional ────────────────────────────────────────────────
  const imagePath = path.resolve(rootDir, resolvedEnv.BOT_IMAGE_PATH ?? 'assets/bot-logo.png');
  const hasImage = await fileExists(fs, imagePath);
  checks.push(
    check(
      'bot-image',
      'Branding image',
      hasImage ? CHECK_STATES.PASS : CHECK_STATES.WARN,
      hasImage ? `${path.relative(rootDir, imagePath)} found` : `${resolvedEnv.BOT_IMAGE_PATH} not found`,
      hasImage ? null : 'Add a PNG/JPG there or point BOT_IMAGE_PATH elsewhere (.setbotpp can re-apply it later).',
    ),
  );

  const providers = providerStatus(resolvedEnv);
  const ready = providers.filter((p) => p.configured);
  checks.push(
    check(
      'providers',
      'External providers',
      CHECK_STATES.PASS,
      `${ready.length}/${providers.length} ready (${providers.length - ready.length} need .env vars)`,
      ready.length === providers.length
        ? null
        : `Optional: ${providers.filter((p) => !p.configured).map((p) => p.label).join(', ')} — see .env.example.`,
    ),
  );

  if (app) {
    const byCat = app.registry.byCategory();
    const counts = [...byCat.entries()].filter(([, v]) => v.length).map(([k, v]) => `${k}:${v.length}`);
    checks.push(
      check(
        'registry',
        'Command registry',
        app.registry.size > 0 ? CHECK_STATES.PASS : CHECK_STATES.FAIL,
        `${app.registry.size} commands registered (${counts.join(' ')})`,
        app.registry.size > 0 ? null : 'No commands registered — the install is broken.',
      ),
    );
  } else {
    checks.push(check('registry', 'Command registry', CHECK_STATES.SKIPPED, 'app was not booted in this run', null));
  }

  const summary = {
    pass: checks.filter((c) => c.state === CHECK_STATES.PASS).length,
    warn: checks.filter((c) => c.state === CHECK_STATES.WARN).length,
    fail: checks.filter((c) => c.state === CHECK_STATES.FAIL).length,
    skipped: checks.filter((c) => c.state === CHECK_STATES.SKIPPED).length,
  };

  return {
    kind: 'doctor',
    rootDir,
    checkedAt: new Date(now).toISOString(),
    nodeVersion,
    schemaVersion: SCHEMA_VERSION,
    providers: providers.map((p) => ({
      id: p.id,
      configured: p.configured,
      keyless: p.keyless,
      hint: p.hint,
    })),
    summary: { ...summary, ok: summary.fail === 0 },
    checks,
  };
}

/** Exit code contract: 1 only when a hard failure was observed. */
export function exitCodeFor(report) {
  return report?.summary?.fail > 0 ? 1 : 0;
}

/** Human-readable rendering (also safe to paste into an issue). */
export function renderDoctorReport(report) {
  const lines = [];
  lines.push('Xyvera MD — preflight diagnostics');
  lines.push(`root: ${report.rootDir}`);
  lines.push(`node: v${report.nodeVersion} | storage schema: v${report.schemaVersion}`);
  lines.push('');
  for (const c of report.checks) {
    lines.push(`${STATE_ICON[c.state] ?? '•'} ${c.label}: ${c.detail}`);
    if (c.fix) lines.push(`     ↳ fix: ${c.fix}`);
  }
  lines.push('');
  const s = report.summary;
  lines.push(
    `Result: ${s.fail === 0 ? 'READY' : 'NOT READY'} — ${s.pass} pass, ${s.warn} warn, ${s.fail} fail, ${s.skipped} skipped`,
  );
  return lines.join('\n');
}
