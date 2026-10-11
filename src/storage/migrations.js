/**
 * Schema migrations. Every persisted root document carries `schemaVersion`.
 * Migrations run in order on load. v1 is the baseline (current).
 */

import { SCHEMA_VERSION } from '../config/defaults.js';

/**
 * Ordered migrations: entry n migrates a doc FROM version n TO version n+1.
 * Example for the future:
 *   1: (doc) => { doc.something = transform(doc.something); return doc; }
 */
export const MIGRATIONS = {
  // 1: (doc) => doc,
};

/**
 * @param {string} collection  logical collection name (for logging)
 * @param {object} doc         loaded document (mutated copy returned)
 * @returns {{ doc: object, migrated: boolean, from: number, to: number }}
 */
export function migrate(collection, doc) {
  let version = Number.isInteger(doc?.schemaVersion) ? doc.schemaVersion : 1;
  const from = version;
  let out = { ...doc };
  let migrated = false;

  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      // No explicit step: stamp the current version (forward-compatible docs).
      version += 1;
      migrated = true;
      continue;
    }
    out = step(out, collection) ?? out;
    version += 1;
    migrated = true;
  }

  if (version !== from) out.schemaVersion = version;
  if (out.schemaVersion === undefined) {
    out.schemaVersion = SCHEMA_VERSION;
    migrated = true;
  }
  return { doc: out, migrated, from, to: out.schemaVersion };
}
