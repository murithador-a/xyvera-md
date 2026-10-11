/**
 * Storage abstraction. Command handlers and services depend on this interface
 * only — a future SQLite backend replaces JsonStore without touching them.
 */

import { NotFoundError, ValidationError } from '../utils/errors.js';

/**
 * Document-oriented collection keyed by string id.
 * All mutating operations should be persisted via save() according to the
 * implementation's policy (JsonStore saves on each mutating call).
 */
export class Repository {
  /** @returns {any|undefined} */
  get(id) {
    throw new Error('not implemented');
  }

  has(id) {
    return this.get(id) !== undefined;
  }

  /** @param {string} id @param {any} value */
  set(id, value) {
    throw new Error('not implemented');
  }

  /**
   * Atomic read-modify-write. `mutator` receives the current value (or undefined)
   * and returns the new value (or undefined to skip the write).
   */
  update(id, mutator) {
    const current = this.get(id);
    const next = mutator(current);
    if (next === undefined) return current;
    this.set(id, next);
    return next;
  }

  delete(id) {
    throw new Error('not implemented');
  }

  /** @returns {[string, any][]} */
  entries() {
    throw new Error('not implemented');
  }

  /** @returns {string[]} */
  keys() {
    return this.entries().map(([k]) => k);
  }

  /** @returns {any[]} */
  all() {
    return this.entries().map(([, v]) => v);
  }

  /** Persist pending changes (no-op for memory stores). */
  async save() {}
}

/** In-memory implementation — used in tests and for ephemeral runtime state. */
export class InMemoryRepository extends Repository {
  constructor(initial = {}) {
    super();
    this.map = new Map(Object.entries(initial));
  }

  get(id) {
    return this.map.get(id);
  }

  set(id, value) {
    if (typeof id !== 'string' || !id) throw new ValidationError('Repository id must be a non-empty string.');
    if (value === undefined) throw new ValidationError('Cannot store undefined.');
    this.map.set(id, value);
    return value;
  }

  delete(id) {
    return this.map.delete(id);
  }

  entries() {
    return [...this.map.entries()];
  }
}

/** Single-document repository facade over a named root key. */
export class DocumentRepository extends Repository {
  /**
   * @param {Repository} backing  repository holding a single doc under `docId`
   * @param {string} docId
   * @param {string} dataKey      key inside the doc that holds { [id]: value }
   */
  constructor(backing, docId = 'root', dataKey = 'data') {
    super();
    this.backing = backing;
    this.docId = docId;
    this.dataKey = dataKey;
    if (!this.backing.get(this.docId)) {
      this.backing.set(this.docId, { schemaVersion: 1, [dataKey]: {} });
    }
  }

  _data() {
    const doc = this.backing.get(this.docId);
    if (!doc || typeof doc !== 'object') throw new NotFoundError('Storage document missing.');
    if (!doc[this.dataKey] || typeof doc[this.dataKey] !== 'object') doc[this.dataKey] = {};
    return doc[this.dataKey];
  }

  get(id) {
    return this._data()[id];
  }

  set(id, value) {
    if (typeof id !== 'string' || !id) throw new ValidationError('Repository id must be a non-empty string.');
    if (value === undefined) throw new ValidationError('Cannot store undefined.');
    this._data()[id] = value;
    return value;
  }

  delete(id) {
    const existed = id in this._data();
    delete this._data()[id];
    return existed;
  }

  entries() {
    return Object.entries(this._data());
  }
}
