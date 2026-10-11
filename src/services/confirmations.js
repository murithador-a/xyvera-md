/**
 * Short-lived pending-confirmation state for destructive actions.
 * Bound to (chat, user) — user B cannot confirm user A's action — with a
 * one-time token and TTL. Used by .revoke, .leavegc, .clearsession, and
 * configured warning-escalation kicks.
 */

import { randomBytes } from 'node:crypto';
import { DEFAULTS } from '../config/defaults.js';
import { normalizeJid } from '../utils/validators.js';

export class ConfirmationService {
  constructor({ ttlMs = DEFAULTS.confirmationTtlMs, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    /** @type {Map<string, { token: string, action: string, meta: any, expiresAt: number }>} */
    this.pending = new Map();
  }

  _key(chatJid, userJid) {
    return `${normalizeJid(chatJid)}|${normalizeJid(userJid)}`;
  }

  /**
   * Create (or replace) a pending action for (chat, user).
   * @returns {{ token: string, action: string, expiresAt: number }}
   */
  create({ chatJid, userJid, action, meta = {} }) {
    const token = randomBytes(3).toString('hex');
    const expiresAt = this.now() + this.ttlMs;
    const record = { token, action, meta, expiresAt };
    this.pending.set(this._key(chatJid, userJid), record);
    this.prune();
    return { token, action, expiresAt };
  }

  /** Look at the pending action without consuming it. */
  peek({ chatJid, userJid }) {
    const rec = this.pending.get(this._key(chatJid, userJid));
    if (!rec) return null;
    if (rec.expiresAt <= this.now()) {
      this.pending.delete(this._key(chatJid, userJid));
      return null;
    }
    return rec;
  }

  /**
   * Consume the pending action for (chat, user) if it matches `action`
   * (or when action is null, whatever is pending).
   * @returns {null | { action: string, meta: any }}
   */
  consume({ chatJid, userJid, action = null }) {
    const rec = this.peek({ chatJid, userJid });
    if (!rec) return null;
    if (action !== null && rec.action !== action) return null;
    this.pending.delete(this._key(chatJid, userJid));
    return { action: rec.action, meta: rec.meta, token: rec.token };
  }

  cancel({ chatJid, userJid }) {
    return this.pending.delete(this._key(chatJid, userJid));
  }

  prune() {
    const t = this.now();
    for (const [k, rec] of this.pending) {
      if (rec.expiresAt <= t) this.pending.delete(k);
    }
  }

  get size() {
    return this.pending.size;
  }
}
