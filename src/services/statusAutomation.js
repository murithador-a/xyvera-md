/**
 * Status automation: auto-view and auto-react to WhatsApp statuses.
 * - persisted settings (global; per-chat overrides possible later)
 * - rate limiting and duplicate-processing prevention
 * - disable immediately (settings checked per event)
 * - never fabricates confirmations: the real outcome of view/react calls is logged
 */

import { DEFAULTS } from '../config/defaults.js';
import { normalizeJid } from '../utils/validators.js';

export class StatusAutomationService {
  /**
   * @param {{ statusDoc, logger?, now?: () => number }} deps
   */
  constructor({ statusDoc, logger = null, now = () => Date.now() }) {
    this.doc = statusDoc;
    this.logger = logger;
    this.now = now;
    /** @type {Map<string, number>} messageId -> processed-at */
    this.seen = new Map();
    this.lastActionAt = 0;
  }

  get settings() {
    return this.doc.get();
  }

  setAutoview(on) {
    this.doc.update((s) => ({ ...s, autoview: !!on }));
    return this.settings.autoview;
  }

  setAutoreact(on, emoji = null) {
    this.doc.update((s) => ({
      ...s,
      autoreact: !!on,
      ...(emoji ? { autoreactEmoji: emoji } : {}),
    }));
    return { autoreact: this.settings.autoreact, emoji: this.settings.autoreactEmoji };
  }

  /** Supported status media types for honest reporting. */
  static supportedTypes() {
    return ['text', 'image', 'video', 'audio', 'sticker'];
  }

  /**
   * Process one status event. Idempotent per messageId; globally rate limited.
   * @param {{ messageId: string, authorJid: string, type: string }} ev
   * @param {{ markStatusRead?: Function, sendReaction?: Function }} client
   * @returns {Promise<{ viewed: boolean, reacted: boolean, skipped?: string }>}
   */
  async process(ev, client) {
    const s = this.settings;
    const result = { viewed: false, reacted: false };

    if (!s.autoview && !s.autoreact) return { ...result, skipped: 'disabled' };

    // duplicate prevention
    const key = ev.messageId ? normalizeJid(ev.authorJid) + '|' + ev.messageId : null;
    if (key) {
      const prev = this.seen.get(key);
      if (prev && this.now() - prev < DEFAULTS.statusDedupeTtlMs) {
        return { ...result, skipped: 'duplicate' };
      }
      this.seen.set(key, this.now());
      this._prune();
    }

    // global rate limit (protect the account from burst behavior)
    const elapsed = this.now() - this.lastActionAt;
    if (elapsed < DEFAULTS.statusRateLimitMs) {
      return { ...result, skipped: 'rate-limited' };
    }

    // Never react to our own status
    const isSelf = ev.authorJid && ev.authorJid === ev.botJid;

    if (s.autoview && client.markStatusRead) {
      try {
        await client.markStatusRead(ev);
        result.viewed = true;
        this.lastActionAt = this.now();
      } catch (err) {
        this.logger?.warn?.('status autoview failed', { error: String(err?.message ?? err) });
        result.viewError = String(err?.message ?? err);
      }
    }

    if (s.autoreact && !isSelf && client.sendReaction) {
      try {
        await client.sendReaction(ev, s.autoreactEmoji ?? '❤️');
        result.reacted = true;
        this.lastActionAt = this.now();
      } catch (err) {
        this.logger?.warn?.('status autoreact failed', { error: String(err?.message ?? err) });
        result.reactError = String(err?.message ?? err);
      }
    }

    return result;
  }

  _prune() {
    const cutoff = this.now() - DEFAULTS.statusDedupeTtlMs;
    for (const [k, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(k);
    }
  }
}
