import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHarness } from './helpers/harness.js';

const OWNER = '15550000099@s.whatsapp.net';

test('.owner shows each configured number exactly once', async () => {
  const h = await createHarness({ env: { OWNER_NUMBERS: '15550000099', OWNER_NAME: 'Test Owner' } });
  await h.dispatch('.owner', { senderJid: OWNER });
  const text = h.lastSent().text;
  assert.match(text, /Test Owner/);
  assert.match(text, /wa\.me\/15550000099/);
  // regression: env merge used to store raw digits + JID forms → shown twice
  assert.equal(text.split('wa.me/15550000099').length - 1, 1);
  await h.cleanup();
});
