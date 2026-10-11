import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSmokeRun,
  runLiveSmoke,
  renderSmokeReport,
  smokeExitCode,
  STEP_STATES,
} from '../src/diagnostics/liveSmoke.js';


function stepById(report, id) {
  return report.steps.find((s) => s.id === id);
}

test('engine: a step cannot pass without evidence (harness invariant)', () => {
  const run = createSmokeRun();
  run.declareStep('demo', { title: 'Demo' });
  run.pass('demo', 'looks fine', null);
  assert.equal(run.build().steps[0].state, STEP_STATES.FAILED);
  assert.match(run.build().steps[0].detail, /cannot pass without evidence/);
});

test('engine: declared-but-unresolved steps report not-observed, never passed', () => {
  const run = createSmokeRun();
  run.declareStep('a', { title: 'A' });
  run.declareStep('b', { title: 'B' });
  run.pass('a', 'saw it', { at: 1 });
  const report = run.build();
  assert.equal(report.steps[0].state, STEP_STATES.PASSED);
  assert.equal(report.steps[1].state, STEP_STATES.NOT_OBSERVED);
  assert.equal(report.summary.notObserved, 1);
  assert.equal(report.summary.ok, false, 'an unobserved required step blocks the run');
  assert.equal(smokeExitCode(report), 1);
});

test('engine: waitFor resolves on observation and times out to null', async () => {
  const run = createSmokeRun();
  const pending = run.waitFor('later', { timeoutMs: 500 });
  run.mark('later', { hit: true });
  const got = await pending;
  assert.equal(got.payload.hit, true);

  const none = await run.waitFor('never', { timeoutMs: 20 });
  assert.equal(none, null);
});

test('engine: waitForAfter ignores observations that precede the trigger', async () => {
  const run = createSmokeRun();
  run.mark('outbound', { textLength: 3 }); // unrelated earlier event
  const before = run.firstObservation('outbound').at;
  const pending = run.waitForAfter('outbound', before + 5, { timeoutMs: 500, pollMs: 5 });
  setTimeout(() => run.mark('outbound', { textLength: 9 }), 20);
  const hit = await pending;
  assert.ok(hit, 'the later observation must match');
  assert.equal(hit.payload.textLength, 9);

  const miss = await run.waitForAfter('outbound', Date.now() + 60_000, { timeoutMs: 30, pollMs: 5 });
  assert.equal(miss, null);
});

test('runLiveSmoke: paired session with a full command round trip passes', async () => {
  const report = await runLiveSmoke({
    timeoutMs: 1_000,
    qrTimeoutMs: 200,
    attach: async (hooks) => {
      setTimeout(() => hooks.onConnected({ botJid: '15550000000@s.whatsapp.net' }), 5);
      setTimeout(
        () => hooks.onInbound({ chatJid: 'g@g.us', isGroup: true, hasText: true, textLength: 5, hadPrefix: true }),
        15,
      );
      setTimeout(() => hooks.onOutbound({ jid: 'g@g.us', textLength: 12 }), 30);
      return {
        wasPaired: true,
        botJid: '15550000000@s.whatsapp.net',
        sendText: async () => {},
        groupMetadata: async () => null,
        stop: async () => {},
      };
    },
  });

  assert.equal(stepById(report, 'connect').state, STEP_STATES.PASSED);
  assert.match(stepById(report, 'connect').detail, /stored session/);
  assert.equal(stepById(report, 'qr').state, STEP_STATES.SKIPPED, 'a paired session must not claim a QR step');
  assert.equal(stepById(report, 'inbound').state, STEP_STATES.PASSED);
  assert.equal(stepById(report, 'reply').state, STEP_STATES.PASSED);
  assert.equal(stepById(report, 'outbound').state, STEP_STATES.SKIPPED);
  assert.equal(stepById(report, 'group-metadata').state, STEP_STATES.SKIPPED);
  assert.equal(stepById(report, 'shutdown').state, STEP_STATES.PASSED);

  assert.equal(report.summary.ok, true);
  assert.equal(smokeExitCode(report), 0);
  assert.match(renderSmokeReport(report), /Result: PASSED/);
});

test('runLiveSmoke: unpaired session that never connects fails honestly', async () => {
  const report = await runLiveSmoke({
    timeoutMs: 30,
    qrTimeoutMs: 30,
    attach: async () => ({
      wasPaired: false,
      botJid: null,
      sendText: async () => {},
      groupMetadata: async () => null,
      stop: async () => {},
    }),
  });

  assert.equal(stepById(report, 'connect').state, STEP_STATES.FAILED);
  assert.equal(stepById(report, 'qr').state, STEP_STATES.FAILED);
  assert.equal(stepById(report, 'inbound').state, STEP_STATES.SKIPPED);
  assert.equal(report.summary.ok, false);
  assert.equal(smokeExitCode(report), 1);
  assert.match(renderSmokeReport(report), /NOT PASSED/);
  assert.match(renderSmokeReport(report), /do not treat as verified/i);
});

test('runLiveSmoke: QR pairing is recorded from the saved file, not assumed', async () => {
  const report = await runLiveSmoke({
    timeoutMs: 500,
    qrTimeoutMs: 500,
    qrFile: '/tmp/does-not-matter.png',
    attach: async (hooks) => {
      setTimeout(() => hooks.onQr({ savedToFile: '/data/qr.png' }), 5);
      setTimeout(() => hooks.onConnected({ botJid: '15550000000@s.whatsapp.net' }), 15);
      setTimeout(
        () => hooks.onInbound({ chatJid: 'c@s.whatsapp.net', isGroup: false, hasText: true, textLength: 5, hadPrefix: true }),
        25,
      );
      setTimeout(() => hooks.onOutbound({ jid: 'c@s.whatsapp.net', textLength: 20 }), 35);
      return {
        wasPaired: false,
        botJid: null,
        sendText: async () => {},
        groupMetadata: async () => null,
        stop: async () => {},
      };
    },
  });

  const qr = stepById(report, 'qr');
  assert.equal(qr.state, STEP_STATES.PASSED);
  assert.equal(qr.evidence.savedToFile, '/data/qr.png');
  assert.equal(stepById(report, 'connect').state, STEP_STATES.PASSED);
  assert.equal(report.summary.ok, true);
});

test('runLiveSmoke: a message without the command prefix fails the reply step', async () => {
  const report = await runLiveSmoke({
    timeoutMs: 100,
    qrTimeoutMs: 100,
    attach: async (hooks) => {
      setTimeout(() => hooks.onConnected({ botJid: '15550000000@s.whatsapp.net' }), 5);
      setTimeout(
        () => hooks.onInbound({ chatJid: 'g@g.us', isGroup: true, hasText: true, textLength: 9, hadPrefix: false }),
        10,
      );
      return {
        wasPaired: true,
        botJid: '15550000000@s.whatsapp.net',
        sendText: async () => {},
        groupMetadata: async () => null,
        stop: async () => {},
      };
    },
  });

  assert.equal(stepById(report, 'inbound').state, STEP_STATES.PASSED);
  assert.equal(stepById(report, 'reply').state, STEP_STATES.FAILED);
  assert.match(stepById(report, 'reply').detail, /prefix/);
  assert.equal(report.summary.ok, false);
});

test('runLiveSmoke: optional outbound self-send and group metadata are verified when requested', async () => {
  const sent = [];
  const report = await runLiveSmoke({
    timeoutMs: 300,
    qrTimeoutMs: 100,
    toJid: '15551112222@s.whatsapp.net',
    groupJid: '120363000000000000@g.us',
    attach: async (hooks) => {
      setTimeout(() => hooks.onConnected({ botJid: '15550000000@s.whatsapp.net' }), 5);
      setTimeout(
        () => hooks.onInbound({ chatJid: 'g@g.us', isGroup: true, hasText: true, textLength: 5, hadPrefix: true }),
        10,
      );
      setTimeout(() => hooks.onOutbound({ jid: 'g@g.us', textLength: 7 }), 20);
      return {
        wasPaired: true,
        botJid: '15550000000@s.whatsapp.net',
        sendText: async (jid, text) => {
          sent.push({ jid, text });
        },
        groupMetadata: async () => ({ subject: 'Smoke Group', participants: [{ jid: 'a' }, { jid: 'b' }] }),
        stop: async () => {},
      };
    },
  });

  const outbound = stepById(report, 'outbound');
  assert.equal(outbound.state, STEP_STATES.PASSED);
  assert.equal(outbound.evidence.to, '15551112222@s.whatsapp.net');
  assert.match(outbound.detail, /delivery itself is not asserted/);
  assert.equal(sent.length, 1);

  const meta = stepById(report, 'group-metadata');
  assert.equal(meta.state, STEP_STATES.PASSED);
  assert.equal(meta.evidence.participants, 2);
  assert.equal(report.summary.ok, true);
});

test('runLiveSmoke: a group metadata failure is reported as failed, not skipped', async () => {
  const report = await runLiveSmoke({
    timeoutMs: 200,
    qrTimeoutMs: 100,
    groupJid: '120363000000000000@g.us',
    attach: async (hooks) => {
      setTimeout(() => hooks.onConnected({ botJid: '15550000000@s.whatsapp.net' }), 5);
      setTimeout(
        () => hooks.onInbound({ chatJid: 'g@g.us', isGroup: true, hasText: true, textLength: 5, hadPrefix: true }),
        10,
      );
      setTimeout(() => hooks.onOutbound({ jid: 'g@g.us', textLength: 7 }), 20);
      return {
        wasPaired: true,
        botJid: '15550000000@s.whatsapp.net',
        sendText: async () => {},
        groupMetadata: async () => {
          throw new Error('not a participant');
        },
        stop: async () => {},
      };
    },
  });

  const meta = stepById(report, 'group-metadata');
  assert.equal(meta.state, STEP_STATES.FAILED);
  assert.match(meta.detail, /not a participant/);
  assert.equal(report.summary.ok, false);
});

test('runLiveSmoke: a connection failure skips every downstream step', async () => {
  const report = await runLiveSmoke({
    timeoutMs: 50,
    qrTimeoutMs: 50,
    toJid: '15551112222@s.whatsapp.net',
    groupJid: '120363000000000000@g.us',
    attach: async () => {
      throw new Error('network unreachable');
    },
  });

  assert.equal(stepById(report, 'connect').state, STEP_STATES.FAILED);
  assert.match(stepById(report, 'connect').detail, /network unreachable/);
  assert.equal(stepById(report, 'inbound').state, STEP_STATES.SKIPPED);
  assert.equal(stepById(report, 'outbound').state, STEP_STATES.SKIPPED);
  assert.equal(stepById(report, 'group-metadata').state, STEP_STATES.SKIPPED);
  assert.equal(smokeExitCode(report), 1);
  assert.equal(report.summary.skipped >= 4, true);
});

test('runLiveSmoke requires an attach function', async () => {
  await assert.rejects(() => runLiveSmoke({ attach: null }), /attach/);
});

test('runLiveSmoke: unrequested optional steps are skipped (never not-observed)', async () => {
  const report = await runLiveSmoke({
    timeoutMs: 30,
    qrTimeoutMs: 30,
    attach: async () => {
      throw new Error('connect refused');
    },
  });

  assert.equal(stepById(report, 'outbound').state, STEP_STATES.SKIPPED);
  assert.equal(stepById(report, 'group-metadata').state, STEP_STATES.SKIPPED);
  assert.equal(report.summary.notObserved, 0, 'nothing should be left unresolved');
  assert.equal(report.summary.ok, false, 'the failed connect still blocks the run');
  assert.equal(smokeExitCode(report), 1);
});
