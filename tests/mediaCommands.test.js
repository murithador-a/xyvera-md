import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { createHarness } from './helpers/harness.js';

const OWNER = '15550000000@s.whatsapp.net';
const ALICE = '15550000001@s.whatsapp.net';
const G = '120363000000000000@g.us';

async function jpeg(size = 120) {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

test('.sticker converts a replied image and sends a webp sticker', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  h.client.mediaBuffer = await jpeg();
  await h.dispatch('.sticker', {
    senderJid: ALICE,
    quoted: { senderJid: ALICE, messageId: 'q1', hasMedia: true },
    hasMedia: true,
  });
  const stickerMsg = h.client.sent.find((s) => s.text === '[sticker]');
  assert.ok(stickerMsg, `expected a sticker send, got: ${JSON.stringify(h.client.sent.map((s) => s.text))}`);
  await h.cleanup();
});

test('.sticker without media replies with usage (no crash)', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  await h.dispatch('.sticker', { senderJid: ALICE });
  assert.match(h.lastSent().text, /Reply to an image/);
  await h.cleanup();
});

test('.toimg converts a sticker to a png image', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  h.client.mediaBuffer = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 9, g: 9, b: 9 } },
  })
    .webp()
    .toBuffer();
  await h.dispatch('.toimg', {
    senderJid: ALICE,
    quoted: { senderJid: ALICE, messageId: 'q2', hasMedia: true },
    hasMedia: true,
  });
  assert.ok(h.client.sent.find((s) => s.text === '[image]'));
  await h.cleanup();
});

test('.blur processes a replied image', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  h.client.mediaBuffer = await jpeg(80);
  await h.dispatch('.blur 6', {
    senderJid: ALICE,
    quoted: { senderJid: ALICE, messageId: 'q3', hasMedia: true },
    hasMedia: true,
  });
  assert.ok(h.client.sent.find((s) => s.text === '[image]'));
  await h.cleanup();
});

test('.meme captions a replied image', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  h.client.mediaBuffer = await jpeg(200);
  await h.dispatch('.meme top text | bottom text', {
    senderJid: ALICE,
    quoted: { senderJid: ALICE, messageId: 'q4', hasMedia: true },
    hasMedia: true,
  });
  assert.ok(h.client.sent.find((s) => s.text === '[image]'));
  await h.cleanup();
});

test('corrupt media is reported honestly, not silently ignored', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  h.client.mediaBuffer = Buffer.from('definitely not an image');
  await h.dispatch('.sticker', {
    senderJid: ALICE,
    quoted: { senderJid: ALICE, messageId: 'q5', hasMedia: true },
    hasMedia: true,
  });
  assert.match(h.lastSent().text, /unexpected error|⚠️/i);
  await h.cleanup();
});

test('.setbotpp updates the profile picture via the pipeline', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  h.client.mediaBuffer = await jpeg(300);
  await h.dispatch('.setbotpp', {
    senderJid: OWNER,
    quoted: { senderJid: OWNER, messageId: 'q6', hasMedia: true },
    hasMedia: true,
  });
  assert.ok(h.client.calls.find((c) => c.name === 'setProfilePictureFromBuffer'));
  assert.match(h.lastSent().text, /updated/i);
  await h.cleanup();
});

test('.ai reports provider setup when unconfigured, never a fake answer', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  await h.dispatch('.ai hello there', { senderJid: ALICE });
  assert.match(h.lastSent().text, /not configured/i);
  await h.cleanup();
});

test('.reminder persists across the service and .reminders lists it', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  await h.dispatch('.reminder 10m stretch', { senderJid: ALICE });
  assert.match(h.lastSent().text, /survives restarts/);
  await h.dispatch('.reminders', { senderJid: ALICE });
  assert.match(h.lastSent().text, /stretch/);
  await h.dispatch('.delreminder 1', { senderJid: ALICE });
  assert.match(h.lastSent().text, /cancelled/i);
  await h.cleanup();
});

test('greeting media config saves through the client', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  h.client.mediaBuffer = await jpeg(100);
  await h.dispatch('.setwelcomepp', {
    senderJid: ALICE,
    quoted: { senderJid: ALICE, messageId: 'q7', hasMedia: true },
    hasMedia: true,
  });
  assert.ok(h.client.calls.find((c) => c.name === 'saveMediaFile'));
  const gc = h.app.store.groups.get(G);
  assert.ok(gc.welcome.mediaPath);
  await h.cleanup();
});
