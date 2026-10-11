/**
 * Persistent reminders. Survive restarts: scheduled items live in
 * data/reminders.json and are re-armed on boot. Firing uses the injected
 * send function (WhatsAppClient in production, fake in tests).
 */

import { normalizeJid } from '../utils/validators.js';
import { ValidationError } from '../utils/errors.js';

export class ReminderService {
  /**
   * @param {{ doc, sendFn: (chatJid, userJid, text) => Promise<void>,
   *          logger?, now?: () => number }} deps
   */
  constructor({ doc, sendFn, logger = null, now = () => Date.now() }) {
    this.doc = doc;
    this.sendFn = sendFn;
    this.logger = logger;
    this.now = now;
    /** @type {Map<string, NodeJS.Timeout>} */
    this.timers = new Map();
  }

  _items() {
    const d = this.doc.get();
    if (!Array.isArray(d.items)) d.items = [];
    return d.items;
  }

  async add({ chatJid, userJid, text, fireAt }) {
    if (!text || !Number.isFinite(fireAt)) throw new ValidationError('Reminder needs text and a time.');
    const item = {
      id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      chatJid: normalizeJid(chatJid),
      userJid: normalizeJid(userJid),
      text: String(text).slice(0, 500),
      fireAt,
      createdAt: this.now(),
    };
    this.doc.update((d) => ({ ...d, items: [...(Array.isArray(d.items) ? d.items : []), item] }));
    // Durability: "add returned" must mean "written to disk" (survives crash/restart).
    if (typeof this.doc.save === 'function') await this.doc.save();
    this._arm(item);
    return item;
  }

  listFor(chatJid, userJid) {
    const c = normalizeJid(chatJid);
    const u = normalizeJid(userJid);
    return this._items()
      .filter((r) => r.chatJid === c && r.userJid === u)
      .sort((a, b) => a.fireAt - b.fireAt);
  }

  cancelAt(chatJid, userJid, index) {
    const list = this.listFor(chatJid, userJid);
    const item = list[index];
    if (!item) return false;
    this._remove(item.id);
    return true;
  }

  /** Re-arm all future reminders (call once at boot). */
  restore() {
    const now = this.now();
    for (const item of this._items()) {
      if (item.fireAt > now) this._arm(item);
      else this._fire(item).catch(() => {});
    }
  }

  _arm(item) {
    const MAX_TIMEOUT = 2_147_483_647; // setTimeout 32-bit limit
    const delay = Math.max(0, item.fireAt - this.now());
    if (this.timers.has(item.id)) clearTimeout(this.timers.get(item.id));
    // setTimeout overflows (>2^31-1 ms) and fires almost immediately — never pass
    // an oversized delay; re-check when the target is far away.
    const wait = Math.min(delay, MAX_TIMEOUT);
    const t = setTimeout(() => {
      if (this.now() < item.fireAt) {
        this._arm(item);
        return;
      }
      this._fire(item).catch((err) => {
        this.logger?.warn?.('reminder fire failed', { error: String(err?.message ?? err) });
      });
    }, wait);
    if (typeof t.unref === 'function') t.unref();
    this.timers.set(item.id, t);
  }

  async _fire(item) {
    try {
      await this.sendFn(item.chatJid, item.userJid, item.text);
    } finally {
      this._remove(item.id);
    }
  }

  _remove(id) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    this.doc.update((d) => ({
      ...d,
      items: (Array.isArray(d.items) ? d.items : []).filter((r) => r.id !== id),
    }));
  }

  get pendingCount() {
    return this._items().length;
  }
}
