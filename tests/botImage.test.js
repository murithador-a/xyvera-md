import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import { createHarness } from './helpers/harness.js';

const OWNER = '15550000000@s.whatsapp.net';

async function writeLogo(rootDir, size = 300) {
  const dir = path.join(rootDir, 'assets');
  await fs.mkdir(dir, { recursive: true });
  const buf = await sharp({
    create: { width: size, height: size, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  const file = path.join(dir, 'bot-logo.png');
  await fs.writeFile(file, buf);
  return file;
}

test('.setbotpp with no image applies the bundled logo', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  await writeLogo(h.rootDir);
  await h.dispatch('.setbotpp', { senderJid: OWNER });
  assert.ok(h.client.calls.find((c) => c.name === 'setProfilePictureFromBuffer'));
  assert.match(h.lastSent().text, /bundled logo/i);
  await h.cleanup();
});

test('.setbotpp without any image explains how to add one', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  await h.dispatch('.setbotpp', { senderJid: OWNER });
  assert.equal(h.client.calls.find((c) => c.name === 'setProfilePictureFromBuffer'), undefined);
  assert.match(h.lastSent().text, /assets\/bot-logo\.png|BOT_IMAGE_PATH/);
  await h.cleanup();
});

test('auto-apply runs once, then skips unless forced', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  await writeLogo(h.rootDir);

  const first = await h.app.applyBotProfilePicture();
  assert.equal(first.ok, true);
  assert.equal(h.client.calls.filter((c) => c.name === 'setProfilePictureFromBuffer').length, 1);

  const second = await h.app.applyBotProfilePicture();
  assert.equal(second.skipped, 'already applied before');
  assert.equal(h.client.calls.filter((c) => c.name === 'setProfilePictureFromBuffer').length, 1);

  const forced = await h.app.applyBotProfilePicture({ force: true });
  assert.equal(forced.ok, true);
  assert.equal(h.client.calls.filter((c) => c.name === 'setProfilePictureFromBuffer').length, 2);

  // flag persisted in settings
  assert.equal(h.app.store.settings.get().profilePictureApplied, true);
  await h.cleanup();
});

test('missing logo file is reported honestly', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  const res = await h.app.applyBotProfilePicture({ force: true });
  assert.equal(res.ok, false);
  assert.match(res.reason, /not found/);
  await h.cleanup();
});

test('.logo sends the bundled image when present', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  await writeLogo(h.rootDir);
  await h.dispatch('.logo', { senderJid: OWNER });
  assert.ok(h.client.sent.find((s) => s.text === '[image]'));
  await h.cleanup();
});

test('.logo explains when no image is configured', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000000' } });
  await h.dispatch('.logo', { senderJid: OWNER });
  assert.match(h.lastSent().text, /No bot image found/);
  await h.cleanup();
});
