import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { JsonCollection, JsonDocument, atomicWrite } from '../src/storage/jsonStore.js';
import { migrate } from '../src/storage/migrations.js';
import { SCHEMA_VERSION } from '../src/config/defaults.js';

async function tmpdir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'xyvera-store-'));
}

test('JsonCollection persists and reloads entries', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'groups.json');
  const a = new JsonCollection(file);
  await a.load();
  a.set('g1', { name: 'one' });
  a.set('g2', { name: 'two' });
  await a.save();

  const b = new JsonCollection(file);
  await b.load();
  assert.deepEqual(b.get('g1'), { name: 'one' });
  assert.deepEqual(b.get('g2'), { name: 'two' });
  assert.equal(b.entries().length, 2);
});

test('malformed JSON is quarantined and replaced with safe defaults', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'groups.json');
  await fs.writeFile(file, '{ this is not json !!!', 'utf8');

  const c = new JsonCollection(file);
  await c.load();
  assert.deepEqual(c.entries(), []);

  const files = await fs.readdir(dir);
  assert.ok(files.some((f) => f.includes('corrupt')), `expected quarantine file, got ${files}`);
  // fresh defaults written
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(raw.schemaVersion, SCHEMA_VERSION);
});

test('non-object root is quarantined', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'groups.json');
  await fs.writeFile(file, '[1,2,3]', 'utf8');
  const c = new JsonCollection(file);
  await c.load();
  assert.deepEqual(c.entries(), []);
});

test('atomicWrite replaces content and leaves no tmp files', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'x.json');
  await atomicWrite(file, { v: 1 });
  await atomicWrite(file, { v: 2 });
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(raw, { v: 2 });
  const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'));
  assert.equal(leftovers.length, 0);
});

test('rapid serialized updates never lose writes', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'counter.json');
  const doc = new JsonDocument(file, { defaults: () => ({ n: 0 }) });
  await doc.load();
  for (let i = 0; i < 25; i += 1) {
    doc.update((d) => ({ n: d.n + 1 }));
  }
  await doc.save();
  const reloaded = new JsonDocument(file, { defaults: () => ({ n: 0 }) });
  await reloaded.load();
  assert.equal(reloaded.get().n, 25);
});

test('migrations stamp schemaVersion and run in order', () => {
  const { doc, migrated, from, to } = migrate('test', { schemaVersion: 1, foo: 'bar' });
  assert.equal(doc.schemaVersion, SCHEMA_VERSION);
  assert.equal(from, 1);
  assert.equal(to, SCHEMA_VERSION);
  assert.equal(doc.foo, 'bar');
  void migrated;

  // missing schemaVersion treated as v1
  const r2 = migrate('test', { foo: 1 });
  assert.equal(r2.doc.schemaVersion, SCHEMA_VERSION);
});

test('JsonDocument merges defaults on validation failure', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'settings.json');
  await atomicWrite(file, { schemaVersion: SCHEMA_VERSION, mode: 'private', sudo: {}, bans: [], prefix: '.', botName: 'X', version: '1', ownerName: 'O', ownerNumbers: [] });
  const doc = new JsonDocument(file, {
    defaults: () => ({ schemaVersion: SCHEMA_VERSION, mode: 'public', extra: true }),
    validate: () => ({ ok: false, errors: ['forced failure for merge test'] }),
  });
  await doc.load();
  assert.equal(doc.get().mode, 'private'); // existing values kept
  assert.equal(doc.get().extra, true); // defaults merged in
});

test('collection normalize() sanitizes entries and drops broken ones', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'items.json');
  await atomicWrite(file, {
    schemaVersion: SCHEMA_VERSION,
    data: {
      good: { v: 1 },
      bad: 'not-an-object-but-will-crash-normalize',
    },
  });
  const c = new JsonCollection(file, {
    normalize: (v) => {
      if (typeof v !== 'object' || v === null) throw new Error('bad entry');
      return v;
    },
  });
  await c.load();
  assert.deepEqual(c.get('good'), { v: 1 });
  assert.equal(c.get('bad'), undefined);
});
