import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { JsonCollection } from '../src/storage/jsonStore.js';
import { defaultGroupConfig, normalizeGroupConfigNoop } from './helpers/noop.js';
import { normalizeGroupConfig, validateGroupConfig, mergeDefaults } from '../src/storage/schemas.js';

const GROUP_A = '120363000000000001@g.us';
const GROUP_B = '120363000000000002@g.us';

async function makeGroups() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xyvera-groups-'));
  const repo = new JsonCollection(path.join(dir, 'groups.json'), {
    normalize: normalizeGroupConfig,
    validate: validateGroupConfig,
  });
  await repo.load();
  return { repo, dir };
}

test('safe defaults: every security feature is OFF', () => {
  const cfg = defaultGroupConfig();
  assert.equal(cfg.welcome.enabled, false);
  assert.equal(cfg.goodbye.enabled, false);
  assert.equal(cfg.antiLink.enabled, false);
  assert.equal(cfg.antiTag.enabled, false);
  assert.equal(cfg.antiBadWord.enabled, false);
  assert.equal(cfg.antiDelete.enabled, false);
  assert.equal(cfg.warnings.actionOnThreshold, 'none');
});

test('group configurations are fully isolated', async () => {
  const { repo } = await makeGroups();
  repo.set(GROUP_A, normalizeGroupConfig({ ...defaultGroupConfig(), antiLink: { enabled: true, action: 'delete-warn' } }));
  repo.set(GROUP_B, normalizeGroupConfig(defaultGroupConfig()));

  assert.equal(repo.get(GROUP_A).antiLink.enabled, true);
  assert.equal(repo.get(GROUP_B).antiLink.enabled, false);

  // Turning B on does not affect A
  repo.set(GROUP_B, normalizeGroupConfig({ ...repo.get(GROUP_B), antiLink: { ...repo.get(GROUP_B).antiLink, enabled: true, action: 'delete' } }));
  assert.equal(repo.get(GROUP_A).antiLink.action, 'delete-warn');
  assert.equal(repo.get(GROUP_B).antiLink.action, 'delete');
});

test('normalizeGroupConfig fills missing fields with safe defaults', () => {
  const cfg = normalizeGroupConfig({ welcome: { enabled: true } });
  assert.equal(cfg.welcome.enabled, true);
  assert.equal(cfg.goodbye.enabled, false);
  assert.equal(cfg.antiLink.enabled, false);
  assert.equal(typeof cfg.antiLink.action, 'string');
});

test('normalizeGroupConfig sanitizes collections', () => {
  const cfg = normalizeGroupConfig({
    antiLink: { allowDomains: ['Example.COM', 'example.com', ''], exemptUsers: ['15550000001@s.whatsapp.net'] },
    antiBadWord: { words: ['Bad', 'bad', ' word ', ''] },
  });
  assert.deepEqual(cfg.antiLink.allowDomains, ['example.com']);
  assert.deepEqual(cfg.antiBadWord.words, ['bad', 'word']);
});

test('invalid antiLink action is corrected to delete', () => {
  const cfg = normalizeGroupConfig({ antiLink: { action: 'nonsense' } });
  assert.equal(cfg.antiLink.action, 'delete');
});

test('validateGroupConfig flags wrong types', () => {
  const bad = defaultGroupConfig();
  bad.antiLink.enabled = 'yes';
  const res = validateGroupConfig(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('antiLink')));
});

test('mergeDefaults preserves unknown fields (forward compatibility)', () => {
  const merged = mergeDefaults(defaultGroupConfig(), { futureFeature: { x: 1 }, welcome: { enabled: true } });
  assert.equal(merged.futureFeature.x, 1);
  assert.equal(merged.welcome.enabled, true);
  assert.equal(merged.goodbye.enabled, false);
});

test('missing group config reads as null (no accidental enablement)', async () => {
  const { repo } = await makeGroups();
  assert.equal(repo.get(GROUP_A), undefined);
  void normalizeGroupConfigNoop;
});
