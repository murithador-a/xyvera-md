import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as realFs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runDoctor, renderDoctorReport, exitCodeFor, CHECK_STATES } from '../src/diagnostics/doctor.js';
import { providerStatus, unconfiguredProviders, PROVIDERS } from '../src/config/providerCatalog.js';

async function tempRoot(prefix = 'xyvera-doctor-') {
  return realFs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function envFixture(over = {}) {
  return {
    DATA_DIR: 'data',
    TMP_DIR: 'tmp',
    BOT_PREFIX: '.',
    BOT_MODE: 'public',
    BOT_IMAGE_PATH: 'assets/bot-logo.png',
    OWNER_NUMBERS: [],
    ...over,
  };
}

function byId(report, id) {
  return report.checks.find((c) => c.id === id);
}

test('doctor reports a fresh, unconfigured checkout as usable (warnings only)', async () => {
  const rootDir = await tempRoot();
  const report = await runDoctor({ rootDir, env: envFixture() });

  assert.equal(byId(report, 'env-file').state, CHECK_STATES.WARN, '.env is absent on a fresh clone');
  assert.equal(byId(report, 'owner').state, CHECK_STATES.WARN, 'no owner configured yet');
  assert.equal(byId(report, 'prefix').state, CHECK_STATES.PASS);
  assert.equal(byId(report, 'mode').state, CHECK_STATES.PASS);
  assert.equal(byId(report, 'data-dir').state, CHECK_STATES.PASS);
  assert.equal(byId(report, 'tmp-dir').state, CHECK_STATES.PASS);
  assert.equal(byId(report, 'session').state, CHECK_STATES.WARN, 'not paired yet');
  assert.equal(byId(report, 'storage').state, CHECK_STATES.SKIPPED, 'no store was booted');
  assert.equal(byId(report, 'registry').state, CHECK_STATES.SKIPPED, 'no app was booted');

  assert.equal(report.summary.fail, 0);
  assert.equal(report.summary.ok, true);
  assert.equal(exitCodeFor(report), 0);
  assert.match(renderDoctorReport(report), /Result: READY/);

  await realFs.rm(rootDir, { recursive: true, force: true });
});

test('doctor fails on an invalid prefix/mode and exits non-zero', async () => {
  const rootDir = await tempRoot();
  const report = await runDoctor({ rootDir, env: envFixture({ BOT_PREFIX: 'abc', BOT_MODE: 'turbo' }) });

  assert.equal(byId(report, 'prefix').state, CHECK_STATES.FAIL);
  assert.equal(byId(report, 'mode').state, CHECK_STATES.FAIL);
  assert.ok(report.summary.fail >= 2);
  assert.equal(report.summary.ok, false);
  assert.equal(exitCodeFor(report), 1);
  assert.match(renderDoctorReport(report), /Result: NOT READY/);

  await realFs.rm(rootDir, { recursive: true, force: true });
});

test('doctor fails when the Node runtime is too old', async () => {
  const rootDir = await tempRoot();
  const report = await runDoctor({ rootDir, env: envFixture(), nodeVersion: '18.20.4' });
  assert.equal(byId(report, 'node').state, CHECK_STATES.FAIL);
  assert.equal(exitCodeFor(report), 1);
  await realFs.rm(rootDir, { recursive: true, force: true });
});

test('doctor fails when data/ or tmp/ cannot be written', async () => {
  const rootDir = await tempRoot();
  const blocked = path.join(rootDir, 'data');
  const failingFs = {
    mkdir: (...args) => realFs.mkdir(...args),
    readdir: (...args) => realFs.readdir(...args),
    access: (...args) => realFs.access(...args),
    unlink: (...args) => realFs.unlink(...args),
    writeFile: (file, ...rest) => {
      if (String(file).startsWith(blocked)) {
        const err = new Error('read-only file system');
        err.code = 'EROFS';
        return Promise.reject(err);
      }
      return realFs.writeFile(file, ...rest);
    },
  };

  const report = await runDoctor({ rootDir, env: envFixture(), fs: failingFs });
  assert.equal(byId(report, 'data-dir').state, CHECK_STATES.FAIL);
  assert.match(byId(report, 'data-dir').detail, /EROFS|not writable/);
  assert.equal(exitCodeFor(report), 1);

  await realFs.rm(rootDir, { recursive: true, force: true });
});

test('doctor warns about quarantined storage files instead of hiding them', async () => {
  const rootDir = await tempRoot();
  await realFs.mkdir(path.join(rootDir, 'data'), { recursive: true });
  await realFs.writeFile(path.join(rootDir, 'data', 'groups.json.corrupt-1700000000000'), '{}', 'utf8');

  const report = await runDoctor({ rootDir, env: envFixture() });
  const q = byId(report, 'quarantine');
  assert.equal(q.state, CHECK_STATES.WARN);
  assert.match(q.detail, /groups\.json\.corrupt-1700000000000/);

  await realFs.rm(rootDir, { recursive: true, force: true });
});

test('doctor verifies storage and registry when the app was booted', async () => {
  const { createHarness } = await import('./helpers/harness.js');
  const h = await createHarness();
  try {
    const report = await runDoctor({
      rootDir: h.rootDir,
      env: { ...h.app.env, OWNER_NUMBERS: ['15550000000'] },
      store: h.app.store,
      app: h.app,
    });
    assert.equal(byId(report, 'storage').state, CHECK_STATES.PASS);
    assert.match(byId(report, 'storage').detail, /group config/);
    assert.equal(byId(report, 'registry').state, CHECK_STATES.PASS);
    assert.match(byId(report, 'registry').detail, /commands registered/);
    assert.equal(report.summary.fail, 0);

    // A paired session is recognised from creds.json.
    await realFs.mkdir(path.join(h.rootDir, 'data', 'session'), { recursive: true });
    await realFs.writeFile(path.join(h.rootDir, 'data', 'session', 'creds.json'), '{}', 'utf8');
    const report2 = await runDoctor({ rootDir: h.rootDir, env: h.app.env, store: h.app.store, app: h.app });
    assert.equal(byId(report2, 'session').state, CHECK_STATES.PASS);
  } finally {
    await h.cleanup();
  }
});

test('doctor output never contains secret values', async () => {
  const rootDir = await tempRoot();
  const secret = 'sk-live-do-not-print-me-1234567890';
  const report = await runDoctor({
    rootDir,
    env: envFixture({ AI_API_KEY: secret, AI_API_URL: 'https://ai.example/v1' }),
  });
  const text = renderDoctorReport(report);
  assert.ok(!text.includes(secret), 'the rendered report must not leak the key');
  assert.ok(!JSON.stringify(report).includes(secret), 'the JSON report must not leak the key');

  const ai = report.providers.find((p) => p.id === 'ai');
  assert.equal(ai.configured, true, 'AI shows as configured without echoing the key');

  await realFs.rm(rootDir, { recursive: true, force: true });
});

test('provider catalog is the single source of truth and flags unconfigured providers', () => {
  assert.ok(PROVIDERS.length >= 9);
  const states = providerStatus({});
  assert.equal(states.length, PROVIDERS.length);

  const ids = unconfiguredProviders({}).map((p) => p.id);
  assert.deepEqual(ids.sort(), ['ai', 'imagine', 'media', 'screenshot']);

  const keyless = states.filter((p) => p.keyless).map((p) => p.id).sort();
  assert.deepEqual(keyless, ['currency', 'lyrics', 'shorturl', 'translate', 'weather']);

  const ai = providerStatus({ AI_API_KEY: 'x', AI_API_URL: 'https://ai.example/v1' }).find((p) => p.id === 'ai');
  assert.equal(ai.configured, true);
  assert.deepEqual(ai.missing, []);
  assert.match(ai.hint, /configured/);

  const media = providerStatus({ MEDIA_API_URL: 'https://m.example/?q={query}' }).find((p) => p.id === 'media');
  assert.equal(media.configured, true);
});
