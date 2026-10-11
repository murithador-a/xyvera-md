import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nextBackoffMs } from '../src/whatsapp/connection.js';

test('reconnect backoff grows exponentially and caps at 30s', () => {
  const mid = () => 0.5; // jitter factor 1.0
  assert.equal(nextBackoffMs(1, mid), 3000);
  assert.equal(nextBackoffMs(2, mid), 6000);
  assert.equal(nextBackoffMs(3, mid), 12000);
  assert.equal(nextBackoffMs(4, mid), 24000);
  assert.equal(nextBackoffMs(5, mid), 30000);
  assert.equal(nextBackoffMs(25, mid), 30000);
});

test('reconnect backoff jitter stays within ±20%', () => {
  assert.equal(nextBackoffMs(1, () => 0), 2400); // 3000 * 0.8
  assert.equal(nextBackoffMs(1, () => 1), 3600); // 3000 * 1.2
  assert.equal(nextBackoffMs(0, () => 0.5), 3000); // attempts guard
});
