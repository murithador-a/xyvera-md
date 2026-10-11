import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { JsonDocument } from '../src/storage/jsonStore.js';
import { ReminderService } from '../src/services/reminders.js';

async function makeDoc() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xyvera-rem-'));
  const doc = new JsonDocument(path.join(dir, 'reminders.json'), {
    defaults: () => ({ schemaVersion: 1, items: [] }),
  });
  await doc.load();
  return { doc, dir };
}

const CHAT = '120363000000000000@g.us';
const USER = '15550000001@s.whatsapp.net';

test('reminders persist and fire via the injected sender', async () => {
  const { doc } = await makeDoc();
  const sent = [];
  let now = 0;
  const svc = new ReminderService({
    doc,
    sendFn: async (chatJid, userJid, text) => sent.push({ chatJid, userJid, text }),
    now: () => now,
  });

  await svc.add({ chatJid: CHAT, userJid: USER, text: 'drink water', fireAt: 50 });
  assert.equal(svc.pendingCount, 1);
  assert.equal(sent.length, 0);

  // fire early reminder by restoring with a later clock
  now = 100;
  svc.restore();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, 'drink water');
  assert.equal(svc.pendingCount, 0);
});

test('reminders survive a restart (restore from the document)', async () => {
  const { doc, dir } = await makeDoc();
  const sent = [];
  const svc1 = new ReminderService({
    doc,
    sendFn: async (c, u, t) => sent.push(t),
    now: () => 0,
  });
  await svc1.add({ chatJid: CHAT, userJid: USER, text: 'persisted', fireAt: Date.now() + 60_000 });

  // simulate restart: fresh service on the same document
  const doc2 = new JsonDocument(path.join(dir, 'reminders.json'), {
    defaults: () => ({ schemaVersion: 1, items: [] }),
  });
  await doc2.load();
  const svc2 = new ReminderService({ doc: doc2, sendFn: async (c, u, t) => sent.push(t) });
  assert.equal(svc2.pendingCount, 1);
  svc2.restore(); // re-arms future reminder
  assert.equal(sent.length, 0);
});

test('reminders are per (chat, user) and cancel by number', async () => {
  const { doc } = await makeDoc();
  const svc = new ReminderService({ doc, sendFn: async () => {} , now: () => 0 });
  await svc.add({ chatJid: CHAT, userJid: USER, text: 'a', fireAt: 10_000 });
  await svc.add({ chatJid: CHAT, userJid: USER, text: 'b', fireAt: 20_000 });
  await svc.add({ chatJid: CHAT, userJid: '15550000002@s.whatsapp.net', text: 'c', fireAt: 30_000 });

  assert.equal(svc.listFor(CHAT, USER).length, 2);
  assert.equal(svc.listFor(CHAT, '15550000002@s.whatsapp.net').length, 1);

  assert.equal(svc.cancelAt(CHAT, USER, 0), true); // cancels 'a'
  const remaining = svc.listFor(CHAT, USER);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].text, 'b');
  assert.equal(svc.cancelAt(CHAT, USER, 5), false);
});

test('fired reminders are removed even if sending fails', async () => {
  const { doc } = await makeDoc();
  let now = 0;
  const svc = new ReminderService({
    doc,
    sendFn: async () => {
      throw new Error('offline');
    },
    now: () => now,
  });
  await svc.add({ chatJid: CHAT, userJid: USER, text: 'x', fireAt: 10 });
  now = 20;
  svc.restore();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(svc.pendingCount, 0);
});

test('reminder text is capped and validated', async () => {
  const { doc } = await makeDoc();
  const svc = new ReminderService({ doc, sendFn: async () => {} });
  const item = await svc.add({ chatJid: CHAT, userJid: USER, text: 'z'.repeat(900), fireAt: Date.now() + 1000 });
  assert.ok(item.text.length <= 500);
  await assert.rejects(() => svc.add({ chatJid: CHAT, userJid: USER, text: '', fireAt: 1 }), /needs text/);
});
