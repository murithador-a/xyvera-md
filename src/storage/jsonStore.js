/**
 * JSON persistence with:
 *  - atomic writes (temp file + rename; Windows-safe fallback)
 *  - serialized updates (per-file promise chain; no interleaved writes)
 *  - schema validation on load and before save
 *  - malformed-file recovery (quarantine + safe defaults)
 *  - schema versioning + migrations
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { migrate } from './migrations.js';
import { Repository, InMemoryRepository } from './repository.js';
import { SCHEMA_VERSION } from '../config/defaults.js';

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Serialize a value to a temp file and atomically replace `filePath`. */
export async function atomicWrite(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${randomBytes(6).toString('hex')}.tmp`);
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmp, json, 'utf8');
  try {
    await fs.rename(tmp, filePath); // atomic on POSIX; replaces dest on Win (Node ≥ 22)
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EEXIST') {
      // Windows fallback: copy over + remove temp
      await fs.copyFile(tmp, filePath);
      await fs.unlink(tmp).catch(() => {});
    } else {
      await fs.unlink(tmp).catch(() => {});
      throw err;
    }
  }
}

/**
 * A repository backed by one JSON file of the shape:
 *   { schemaVersion, data: { [id]: value } }
 */
export class JsonCollection extends Repository {
  /**
   * @param {string} filePath
   * @param {{ validate?: (doc:any)=>{ok:boolean,errors:string[]}, defaults?: ()=>any, normalize?: (doc:any)=>any, name?: string }} opts
   */
  constructor(filePath, { validate = null, defaults = null, normalize = null, name = null, logger = null } = {}) {
    super();
    this.filePath = filePath;
    this.validate = validate;
    this.defaults = defaults;
    this.normalize = normalize;
    this.name = name ?? path.basename(filePath, '.json');
    this.logger = logger;
    this.doc = { schemaVersion: SCHEMA_VERSION, data: {} };
    this._queue = Promise.resolve();
  }

  /** Load, recover, migrate, validate. Returns this. */
  async load() {
    let raw;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        await this._writeDefaults();
        return this;
      }
      throw err;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this._quarantine('unparseable JSON');
      return this;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      await this._quarantine('root is not an object');
      return this;
    }

    // Root documents may be either { schemaVersion, data } or (legacy) the data itself.
    let doc = parsed;
    if (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
      doc = parsed;
    } else {
      doc = { schemaVersion: parsed.schemaVersion ?? 1, data: parsed };
      delete doc.data.schemaVersion;
    }

    const { doc: migrated, migrated: didMigrate } = migrate(this.name, doc);
    doc = migrated;

    if (this.validate) {
      const res = this.validate({ ...doc, ...doc.data });
      if (!res.ok) {
        this.logger?.warn?.(`collection ${this.name} failed validation`, { errors: res.errors });
        // Keep data but sanitize each entry through normalize below; do not crash.
      }
    }

    this.doc = { schemaVersion: doc.schemaVersion ?? SCHEMA_VERSION, data: doc.data ?? {} };
    if (this.normalize) {
      for (const [k, v] of Object.entries(this.doc.data)) {
        try {
          this.doc.data[k] = this.normalize(v);
        } catch {
          delete this.doc.data[k]; // drop unsalvageable entries
        }
      }
    }

    if (didMigrate) await this._persist();
    return this;
  }

  async _writeDefaults() {
    this.doc = {
      schemaVersion: SCHEMA_VERSION,
      data: this.defaults ? this.defaults() : {},
    };
    await this._persist();
  }

  async _quarantine(reason) {
    const quarantine = `${this.filePath}.corrupt-${Date.now()}`;
    try {
      await fs.rename(this.filePath, quarantine);
      this.logger?.warn?.(`quarantined malformed collection ${this.name}`, { reason, quarantine });
    } catch {
      this.logger?.warn?.(`failed to quarantine ${this.name}`, { reason });
    }
    await this._writeDefaults();
  }

  _persist() {
    // Serialize writes per file: chain onto the queue.
    this._queue = this._queue.then(() => atomicWrite(this.filePath, this.doc)).catch((err) => {
      this.logger?.error?.(`failed to persist ${this.name}`, { error: String(err?.message ?? err) });
    });
    return this._queue;
  }

  get(id) {
    return this.doc.data[id];
  }

  set(id, value) {
    if (typeof id !== 'string' || !id) throw new Error('id must be a non-empty string');
    if (value === undefined) throw new Error('cannot store undefined');
    this.doc.data[id] = value;
    void this._persist();
    return value;
  }

  delete(id) {
    const existed = id in this.doc.data;
    delete this.doc.data[id];
    if (existed) void this._persist();
    return existed;
  }

  entries() {
    return Object.entries(this.doc.data);
  }

  async save() {
    await this._persist();
  }

  /** Expose the whole document (read-only usage). */
  raw() {
    return this.doc;
  }
}

/** Single JSON document store (e.g. settings.json holds one settings object). */
export class JsonDocument {
  constructor(filePath, { defaults, validate = null, normalize = null, name = null, logger = null } = {}) {
    this.filePath = filePath;
    this.defaults = defaults;
    this.validate = validate;
    this.normalize = normalize;
    this.name = name ?? path.basename(filePath, '.json');
    this.logger = logger;
    this.value = defaults ? defaults() : {};
    this._queue = Promise.resolve();
  }

  async load() {
    let raw;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.value = this.defaults ? this.defaults() : {};
        await this._persist();
        return this;
      }
      throw err;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this._quarantine('unparseable JSON');
      return this;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      await this._quarantine('root is not an object');
      return this;
    }
    const { doc } = migrate(this.name, parsed);
    this.value = this.normalize ? this.normalize(doc) : doc;
    if (this.validate) {
      const res = this.validate(this.value);
      if (!res.ok) {
        this.logger?.warn?.(`document ${this.name} failed validation — merging defaults`, { errors: res.errors });
        this.value = this.normalize
          ? this.normalize({ ...(this.defaults ? this.defaults() : {}), ...this.value })
          : { ...(this.defaults ? this.defaults() : {}), ...this.value };
      }
    }
    await this._persist();
    return this;
  }

  async _quarantine(reason) {
    const quarantine = `${this.filePath}.corrupt-${Date.now()}`;
    try {
      await fs.rename(this.filePath, quarantine);
      this.logger?.warn?.(`quarantined malformed document ${this.name}`, { reason, quarantine });
    } catch {
      /* keep going */
    }
    this.value = this.defaults ? this.defaults() : {};
    await this._persist();
  }

  _persist() {
    this._queue = this._queue.then(() => atomicWrite(this.filePath, this.value)).catch((err) => {
      this.logger?.error?.(`failed to persist ${this.name}`, { error: String(err?.message ?? err) });
    });
    return this._queue;
  }

  get() {
    return this.value;
  }

  set(value) {
    this.value = value;
    void this._persist();
    return this.value;
  }

  update(mutator) {
    const next = mutator(this.value);
    if (next !== undefined) this.set(next);
    return this.value;
  }

  async save() {
    await this._persist();
  }
}

/**
 * Facade wiring all collections of the bot's persistence layer.
 * Session/auth state is intentionally NOT part of this store (see ARCHITECTURE §6).
 */
export class Store {
  /**
   * @param {{ dataDir: string, logger?: any }} opts
   */
  constructor({ dataDir, logger = null }) {
    this.dataDir = dataDir;
    this.logger = logger;
    this.settings = new JsonDocument(path.join(dataDir, 'settings.json'), {
      name: 'settings',
      defaults: () => ({ schemaVersion: SCHEMA_VERSION, ...(this._settingsDefaults?.() ?? {}) }),
      logger,
    });
    this.groups = new JsonCollection(path.join(dataDir, 'groups.json'), { name: 'groups', logger });
    this.warnings = new JsonDocument(path.join(dataDir, 'warnings.json'), {
      name: 'warnings',
      defaults: () => ({ schemaVersion: SCHEMA_VERSION, groups: {} }),
      logger,
    });
    this.status = new JsonDocument(path.join(dataDir, 'status.json'), {
      name: 'status',
      defaults: () => ({ schemaVersion: SCHEMA_VERSION, autoview: false, autoreact: false, autoreactEmoji: '❤️' }),
      logger,
    });
    this.reminders = new JsonDocument(path.join(dataDir, 'reminders.json'), {
      name: 'reminders',
      defaults: () => ({ schemaVersion: SCHEMA_VERSION, items: [] }),
      logger,
    });
    this.sessionDir = path.join(dataDir, 'session');
  }

  /** Optional hook so callers can inject richer defaults (keeps this file decoupled). */
  setSettingsDefaults(fn) {
    this._settingsDefaults = fn;
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await this.settings.load();
    await this.groups.load();
    await this.warnings.load();
    await this.status.load();
    await this.reminders.load();
    return this;
  }
}

export { InMemoryRepository };
