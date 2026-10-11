import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateAntiLink,
  isAntiLinkUserExempt,
  evaluateAntiTag,
  evaluateAntiBadWord,
  WarningService,
  ModerationService,
} from '../src/services/moderation.js';
import { defaultGroupConfig, ANTI_LINK_ACTIONS, MODERATION_RESPONSES } from '../src/config/defaults.js';
import { InMemoryRepository } from '../src/storage/repository.js';
import { JsonDocument } from '../src/storage/jsonStore.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeWhatsAppClient, makeMsg } from './helpers/fakeClient.js';

function cfgWith(overrides = {}) {
  return {
    ...defaultGroupConfig(),
    antiLink: { ...defaultGroupConfig().antiLink, enabled: true, ...overrides },
  };
}

test('anti-link disabled → no violation', () => {
  const r = evaluateAntiLink({ text: 'see https://spam.com', senderIsAdmin: false, groupCfg: defaultGroupConfig() });
  assert.equal(r.violation, false);
});

test('anti-link detects links and reports blocked domains', () => {
  const r = evaluateAntiLink({
    text: 'join https://scam.com and chat.whatsapp.com/ABC',
    senderIsAdmin: false,
    groupCfg: cfgWith(),
  });
  assert.equal(r.violation, true);
  assert.equal(r.action, ANTI_LINK_ACTIONS.DELETE);
  assert.ok(r.blocked.length >= 2);
});

test('allowlisted domains are not violations', () => {
  const r = evaluateAntiLink({
    text: 'docs at https://example.com/x',
    senderIsAdmin: false,
    groupCfg: cfgWith({ allowDomains: ['example.com'] }),
  });
  assert.equal(r.violation, false);
});

test('subdomains of allowlisted domains pass', () => {
  const r = evaluateAntiLink({
    text: 'see chat.whatsapp.com/xyz',
    senderIsAdmin: false,
    groupCfg: cfgWith({ allowDomains: ['whatsapp.com'] }),
  });
  assert.equal(r.violation, false);
});

test('admins are exempt when configured (default)', () => {
  const r = evaluateAntiLink({ text: 'https://spam.com', senderIsAdmin: true, groupCfg: cfgWith() });
  assert.equal(r.violation, true);
  assert.equal(r.exempt, true);
  assert.equal(r.action, null);
});

test('admins are NOT exempt when exemptAdmins is off', () => {
  const r = evaluateAntiLink({
    text: 'https://spam.com',
    senderIsAdmin: true,
    groupCfg: cfgWith({ exemptAdmins: false }),
  });
  assert.equal(r.exempt, false);
  assert.equal(r.action, ANTI_LINK_ACTIONS.DELETE);
});

test('explicit user exemptions are honored', () => {
  const gc = cfgWith({ exemptUsers: ['15550000009@s.whatsapp.net'] });
  assert.equal(isAntiLinkUserExempt(gc, '15550000009@s.whatsapp.net'), true);
  assert.equal(isAntiLinkUserExempt(gc, '15550000008@s.whatsapp.net'), false);
});

test('configured action value is what the evaluator returns', () => {
  for (const action of Object.values(ANTI_LINK_ACTIONS)) {
    const r = evaluateAntiLink({ text: 'https://spam.com', senderIsAdmin: false, groupCfg: cfgWith({ action }) });
    assert.equal(r.action, action);
  }
});

test('scheme-less domains detected; ordinary dotted words are not links', () => {
  const hit = evaluateAntiLink({ text: 'visit example.com now', senderIsAdmin: false, groupCfg: cfgWith() });
  assert.equal(hit.violation, true);
  const miss = evaluateAntiLink({ text: 'see notes.txt and version 1.2.3', senderIsAdmin: false, groupCfg: cfgWith() });
  assert.equal(miss.violation, false);
});

// ── anti-tag ────────────────────────────────────────────────────────────

test('anti-tag: under limit is fine, over limit violates', () => {
  const gc = { ...defaultGroupConfig(), antiTag: { enabled: true, limit: 3, response: 'warn', exemptAdmins: true } };
  const j = (n) => `1555000000${n}@s.whatsapp.net`;
  const under = evaluateAntiTag({ mentionedJids: [j(1), j(2)], senderJid: 'u@s.whatsapp.net', senderIsAdmin: false, groupCfg: gc });
  assert.equal(under.violation, false);
  const over = evaluateAntiTag({
    mentionedJids: [j(1), j(2), j(3), j(4)],
    senderJid: 'u@s.whatsapp.net', senderIsAdmin: false, groupCfg: gc,
  });
  assert.equal(over.violation, true);
  assert.equal(over.action, MODERATION_RESPONSES.WARN);
});

test('anti-tag: duplicate mentions count once; admins exempt', () => {
  const gc = { ...defaultGroupConfig(), antiTag: { enabled: true, limit: 2, response: 'delete', exemptAdmins: true } };
  const j = (n) => `1555000000${n}@s.whatsapp.net`;
  const dup = evaluateAntiTag({ mentionedJids: [j(1), j(1), j(1)], senderJid: 'u@s.whatsapp.net', senderIsAdmin: false, groupCfg: gc });
  assert.equal(dup.violation, false);
  const adm = evaluateAntiTag({
    mentionedJids: [j(1), j(2), j(3)],
    senderJid: 'u@s.whatsapp.net', senderIsAdmin: true, groupCfg: gc,
  });
  assert.equal(adm.exempt, true);
});

// ── anti-bad-word ───────────────────────────────────────────────────────

test('anti-bad-word: case-insensitive whole-word matching only', () => {
  const gc = {
    ...defaultGroupConfig(),
    antiBadWord: { enabled: true, words: ['badword'], response: 'delete', exemptAdmins: true },
  };
  assert.equal(evaluateAntiBadWord({ text: 'this is BADWORD here', senderIsAdmin: false, groupCfg: gc }).violation, true);
  assert.equal(evaluateAntiBadWord({ text: 'this is a badwordy suffix', senderIsAdmin: false, groupCfg: gc }).violation, false);
  assert.equal(evaluateAntiBadWord({ text: 'perfectly fine', senderIsAdmin: false, groupCfg: gc }).violation, false);
});

test('anti-bad-word: admin exemption', () => {
  const gc = {
    ...defaultGroupConfig(),
    antiBadWord: { enabled: true, words: ['x'], response: 'warn', exemptAdmins: true },
  };
  const r = evaluateAntiBadWord({ text: 'x', senderIsAdmin: true, groupCfg: gc });
  assert.equal(r.violation, true);
  assert.equal(r.exempt, true);
});

// ── warnings ────────────────────────────────────────────────────────────

async function makeWarnings() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xyvera-warn-'));
  const doc = new JsonDocument(path.join(dir, 'warnings.json'), {
    defaults: () => ({ schemaVersion: 1, groups: {} }),
  });
  await doc.load();
  return { svc: new WarningService({ warningsDoc: doc }), doc, dir };
}

test('warnings: add increments active and keeps history', async () => {
  const { svc } = await makeWarnings();
  svc.add('g@g.us', 'u@s.whatsapp.net', { reason: 'spam', by: 'admin@s.whatsapp.net' });
  const state = svc.add('g@g.us', 'u@s.whatsapp.net', { reason: 'again' });
  assert.equal(state.active, 2);
  assert.equal(state.history.length, 2);
  assert.equal(state.history[0].reason, 'spam');
});

test('warnings: delwarn removes one active warning but keeps history', async () => {
  const { svc } = await makeWarnings();
  svc.add('g@g.us', 'u@s.whatsapp.net', { reason: 'a' });
  svc.add('g@g.us', 'u@s.whatsapp.net', { reason: 'b' });
  const removed = svc.removeOne('g@g.us', 'u@s.whatsapp.net');
  assert.equal(removed, true);
  const state = svc.state('g@g.us', 'u@s.whatsapp.net');
  assert.equal(state.active, 1);
  assert.equal(state.history.length, 2);
  assert.equal(state.history.filter((h) => h.active).length, 1);
});

test('warnings: resetwarn resets active count but retains history', async () => {
  const { svc } = await makeWarnings();
  svc.add('g@g.us', 'u@s.whatsapp.net', { reason: 'a' });
  svc.add('g@g.us', 'u@s.whatsapp.net', { reason: 'b' });
  const state = svc.reset('g@g.us', 'u@s.whatsapp.net');
  assert.equal(state.active, 0);
  assert.equal(state.history.length, 2);
  assert.equal(state.history.every((h) => h.active === false), true);
});

test('warnings: threshold reached reports action only when configured', async () => {
  const { svc } = await makeWarnings();
  const gc = defaultGroupConfig(); // actionOnThreshold: 'none'
  svc.add('g@g.us', 'u@s.whatsapp.net', {});
  svc.add('g@g.us', 'u@s.whatsapp.net', {});
  const state = svc.add('g@g.us', 'u@s.whatsapp.net', {});
  const res = svc.thresholdReached(gc, state);
  assert.equal(res.reached, true);
  assert.equal(res.action, 'none');

  const gcKick = { ...gc, warnings: { threshold: 3, actionOnThreshold: 'kick' } };
  const res2 = svc.thresholdReached(gcKick, state);
  assert.equal(res2.action, 'kick');
});

test('warnings: per-group isolation', async () => {
  const { svc } = await makeWarnings();
  svc.add('g1@g.us', 'u@s.whatsapp.net', {});
  assert.equal(svc.state('g2@g.us', 'u@s.whatsapp.net').active, 0);
});

// ── moderation execution (via fake client) ──────────────────────────────

async function makeModeration() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xyvera-mod-'));
  const groups = new InMemoryRepository();
  const warnDoc = new JsonDocument(path.join(dir, 'warnings.json'), {
    defaults: () => ({ schemaVersion: 1, groups: {} }),
  });
  await warnDoc.load();
  const warnings = new WarningService({ warningsDoc: warnDoc });
  const moderation = new ModerationService({ groupsRepo: groups, warnings });
  return { moderation, groups, warnings, dir };
}

const G = '120363000000000000@g.us';
const U = '15550000001@s.whatsapp.net';

test('moderation: delete action deletes the exact message', async () => {
  const { moderation, groups } = await makeModeration();
  groups.set(G, cfgWith({ action: ANTI_LINK_ACTIONS.DELETE }));
  const client = new FakeWhatsAppClient();
  const msg = makeMsg({ text: 'https://spam.com', senderJid: U, chatJid: G, senderIsAdmin: false });
  const decisions = await moderation.handleMessage(msg, client);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].type, 'anti-link');
  const del = client.calls.find((c) => c.name === 'deleteMessage');
  assert.ok(del);
  assert.equal(del.args[1].id, msg.messageId); // exact message only
});

test('moderation: delete-warn deletes and warns (counts warnings)', async () => {
  const { moderation, groups, warnings } = await makeModeration();
  groups.set(G, cfgWith({ action: ANTI_LINK_ACTIONS.DELETE_WARN }));
  const client = new FakeWhatsAppClient();
  await moderation.handleMessage(makeMsg({ text: 'https://spam.com', senderJid: U, chatJid: G }), client);
  assert.ok(client.calls.find((c) => c.name === 'deleteMessage'));
  assert.ok(client.calls.find((c) => c.name === 'sendText'));
  assert.equal(warnings.state(G, U).active, 1);
});

test('moderation: delete-kick deletes and kicks', async () => {
  const { moderation, groups } = await makeModeration();
  groups.set(G, cfgWith({ action: ANTI_LINK_ACTIONS.DELETE_KICK }));
  const client = new FakeWhatsAppClient();
  await moderation.handleMessage(makeMsg({ text: 'https://spam.com', senderJid: U, chatJid: G }), client);
  assert.ok(client.calls.find((c) => c.name === 'kickParticipant'));
});

test('moderation: escalate only kicks when threshold action is configured', async () => {
  const { moderation, groups, warnings } = await makeModeration();
  const gc = cfgWith({ action: ANTI_LINK_ACTIONS.ESCALATE });
  gc.warnings = { threshold: 1, actionOnThreshold: 'kick' };
  groups.set(G, gc);
  const client = new FakeWhatsAppClient();
  await moderation.handleMessage(makeMsg({ text: 'https://spam.com', senderJid: U, chatJid: G }), client);
  assert.ok(client.calls.find((c) => c.name === 'kickParticipant'));
  void warnings;
});

test('moderation: escalate with actionOnThreshold none never kicks', async () => {
  const { moderation, groups } = await makeModeration();
  const gc = cfgWith({ action: ANTI_LINK_ACTIONS.ESCALATE });
  gc.warnings = { threshold: 1, actionOnThreshold: 'none' };
  groups.set(G, gc);
  const client = new FakeWhatsAppClient();
  await moderation.handleMessage(makeMsg({ text: 'https://spam.com', senderJid: U, chatJid: G }), client);
  assert.equal(client.calls.find((c) => c.name === 'kickParticipant'), undefined);
  assert.ok(client.calls.find((c) => c.name === 'deleteMessage'));
});

test('moderation: failed WhatsApp actions are reported as failures, not success', async () => {
  const { moderation, groups } = await makeModeration();
  groups.set(G, cfgWith({ action: ANTI_LINK_ACTIONS.DELETE }));
  const client = new FakeWhatsAppClient({ fail: { deleteMessage: true } });
  const decisions = await moderation.handleMessage(makeMsg({ text: 'https://spam.com', senderJid: U, chatJid: G }), client);
  assert.equal(decisions[0].outcome.ok, false);
  assert.equal(decisions[0].outcome.steps[0].ok, false);
});

test('moderation: duplicate message never enforced twice', async () => {
  const { moderation, groups } = await makeModeration();
  groups.set(G, cfgWith({ action: ANTI_LINK_ACTIONS.DELETE }));
  const client = new FakeWhatsAppClient();
  const msg = makeMsg({ text: 'https://spam.com', senderJid: U, chatJid: G, messageId: 'SAME_ID' });
  await moderation.handleMessage(msg, client);
  await moderation.handleMessage(msg, client);
  assert.equal(client.calls.filter((c) => c.name === 'deleteMessage').length, 1);
});

test('moderation: exempt users are never penalized', async () => {
  const { moderation, groups } = await makeModeration();
  groups.set(G, cfgWith({ action: ANTI_LINK_ACTIONS.DELETE_KICK, exemptUsers: [U] }));
  const client = new FakeWhatsAppClient();
  const decisions = await moderation.handleMessage(makeMsg({ text: 'https://spam.com', senderJid: U, chatJid: G }), client);
  assert.equal(decisions.length, 0);
  assert.equal(client.calls.length, 0);
});

test('moderation: every decision lands in the group moderation log', async () => {
  const { moderation, groups } = await makeModeration();
  groups.set(G, cfgWith({ action: ANTI_LINK_ACTIONS.DELETE_WARN }));
  const client = new FakeWhatsAppClient();
  await moderation.handleMessage(makeMsg({ text: 'https://spam.com', senderJid: U, chatJid: G }), client);
  const log = groups.get(G).moderationLog;
  assert.equal(log.length, 1);
  assert.equal(log[0].type, 'anti-link');
  assert.equal(log[0].user, U);
});
