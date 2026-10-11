import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CooldownStore } from '../src/utils/cooldowns.js';

test('cooldown blocks within window and allows after expiry', () => {
  let now = 1000;
  const cd = new CooldownStore({ now: () => now });

  const first = cd.check('k', 5000);
  assert.equal(first.ok, true);

  const second = cd.check('k', 5000);
  assert.equal(second.ok, false);
  assert.equal(second.retryAfterMs, 5000);

  now = 6001;
  const third = cd.check('k', 5000);
  assert.equal(third.ok, true);
});

test('zero duration does not lock the key', () => {
  const cd = new CooldownStore({ now: () => 0 });
  assert.equal(cd.check('a', 0).ok, true);
  assert.equal(cd.check('a', 0).ok, true);
});

test('keys are independent and clearable', () => {
  const cd = new CooldownStore({ now: () => 0 });
  cd.check('cmd|chat|user1', 1000);
  assert.equal(cd.check('cmd|chat|user2', 1000).ok, true);
  assert.equal(cd.check('cmd|chat|user1', 1000).ok, false);
  cd.clear('cmd|chat|user1');
  assert.equal(cd.check('cmd|chat|user1', 1000).ok, true);
});

test('prune removes expired entries', () => {
  let now = 0;
  const cd = new CooldownStore({ now: () => now });
  cd.check('a', 100);
  cd.check('b', 10000);
  now = 200;
  cd.prune();
  assert.equal(cd.size, 1);
});
