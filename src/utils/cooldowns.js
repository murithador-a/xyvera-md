/**
 * Cooldown tracking. Pure in-memory store with expiry pruning.
 * Never present these as WhatsApp-native rate limits — they limit bot command
 * handling only (see docs/LIMITATIONS.md).
 */

export class CooldownStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    /** @type {Map<string, number>} key -> expiry timestamp (ms) */
    this.entries = new Map();
  }

  /** Remaining cooldown in ms (0 if ready). */
  remaining(key) {
    const exp = this.entries.get(key);
    if (exp === undefined) return 0;
    const left = exp - this.now();
    if (left <= 0) {
      this.entries.delete(key);
      return 0;
    }
    return left;
  }

  /** @returns {{ ok: boolean, retryAfterMs: number }} */
  check(key, durationMs) {
    const left = this.remaining(key);
    if (left > 0) return { ok: false, retryAfterMs: left };
    if (durationMs > 0) this.entries.set(key, this.now() + durationMs);
    return { ok: true, retryAfterMs: 0 };
  }

  clear(key) {
    this.entries.delete(key);
  }

  clearPrefix(prefix) {
    for (const k of this.entries.keys()) {
      if (k.startsWith(prefix)) this.entries.delete(k);
    }
  }

  prune() {
    const t = this.now();
    for (const [k, exp] of this.entries) {
      if (exp <= t) this.entries.delete(k);
    }
  }

  get size() {
    return this.entries.size;
  }
}
