import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ConfirmationService } from '../src/services/confirmations.js';

const CHAT = '120363000000000000@g.us';
const USER = '15550000001@s.whatsapp.net';
const OTHER = '15550000002@s.whatsapp.net';

test('confirmation is bound to (chat, user) — others cannot confirm it', () => {
  let now = 0;
  const svc = new ConfirmationService({ ttlMs: 60_000, now: () => now });
  svc.create({ chatJid: CHAT, userJid: USER, action: 'revoke-link', meta: { x: 1 } });

  assert.equal(svc.consume({ chatJid: CHAT, userJid: OTHER }), null);
  const rec = svc.consume({ chatJid: CHAT, userJid: USER, action: 'revoke-link' });
  assert.deepEqual(rec.meta, { x: 1 });
});

test('confirmation is one-time (consumed atomically)', () => {
  const svc = new ConfirmationService();
  svc.create({ chatJid: CHAT, userJid: USER, action: 'restart' });
  assert.ok(svc.consume({ chatJid: CHAT, userJid: USER }));
  assert.equal(svc.consume({ chatJid: CHAT, userJid: USER }), null);
});

test('confirmations expire after TTL', () => {
  let now = 0;
  const svc = new ConfirmationService({ ttlMs: 1000, now: () => now });
  svc.create({ chatJid: CHAT, userJid: USER, action: 'clearsession' });
  now = 1500;
  assert.equal(svc.consume({ chatJid: CHAT, userJid: USER }), null);
});

test('wrong action name does not consume the pending action', () => {
  const svc = new ConfirmationService();
  svc.create({ chatJid: CHAT, userJid: USER, action: 'revoke-link' });
  assert.equal(svc.consume({ chatJid: CHAT, userJid: USER, action: 'leave-group' }), null);
  assert.ok(svc.consume({ chatJid: CHAT, userJid: USER, action: 'revoke-link' }));
});

test('creating a new action replaces the previous pending one', () => {
  const svc = new ConfirmationService();
  svc.create({ chatJid: CHAT, userJid: USER, action: 'a' });
  svc.create({ chatJid: CHAT, userJid: USER, action: 'b' });
  assert.equal(svc.consume({ chatJid: CHAT, userJid: USER, action: 'a' }), null);
  assert.equal(svc.consume({ chatJid: CHAT, userJid: USER, action: 'b' }).action, 'b');
});

test('cancel removes the pending action', () => {
  const svc = new ConfirmationService();
  svc.create({ chatJid: CHAT, userJid: USER, action: 'a' });
  assert.equal(svc.cancel({ chatJid: CHAT, userJid: USER }), true);
  assert.equal(svc.consume({ chatJid: CHAT, userJid: USER }), null);
});

test('peek does not consume', () => {
  const svc = new ConfirmationService();
  svc.create({ chatJid: CHAT, userJid: USER, action: 'a' });
  assert.ok(svc.peek({ chatJid: CHAT, userJid: USER }));
  assert.ok(svc.peek({ chatJid: CHAT, userJid: USER }));
});
