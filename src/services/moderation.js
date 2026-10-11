/**
 * Moderation logic: anti-link, anti-tag, anti-bad-word, warnings/escalation,
 * duplicate-enforcement prevention, and per-group moderation logs.
 * Pure decision functions are exported separately so they can be unit-tested
 * without any WhatsApp client; ModerationService executes decisions through a
 * mockable client and reports the REAL outcome of every action.
 */

import { DEFAULTS, MODERATION_RESPONSES, ANTI_LINK_ACTIONS } from '../config/defaults.js';
import { extractLinks, domainAllowed, normalizeJid, escapeRegex } from '../utils/validators.js';
import { WhatsAppActionError } from '../utils/errors.js';

// ── pure evaluators ─────────────────────────────────────────────────────

/**
 * Decide what to do about a message under the group's anti-link config.
 * @param {{ text: string, senderJid: string, senderIsAdmin: boolean,
 *          groupCfg: object }} input
 * @returns {{ violation: boolean, exempt: boolean, reason: string,
 *            links: Array<{raw:string,domain:string}>, blocked: Array, action: string|null }}
 */
export function evaluateAntiLink({ text, senderIsAdmin, groupCfg }) {
  const cfg = groupCfg?.antiLink;
  if (!cfg?.enabled) return { violation: false, exempt: false, reason: 'disabled', links: [], blocked: [], action: null };

  const links = extractLinks(text);
  if (links.length === 0) return { violation: false, exempt: false, reason: 'no-links', links: [], blocked: [], action: null };

  const blocked = links.filter((l) => !domainAllowed(l.domain, cfg.allowDomains ?? []));
  if (blocked.length === 0) {
    return { violation: false, exempt: false, reason: 'allowed-domains', links, blocked: [], action: null };
  }

  if (cfg.exemptAdmins !== false && senderIsAdmin) {
    return { violation: true, exempt: true, reason: 'admin-exempt', links, blocked, action: null };
  }

  return {
    violation: true,
    exempt: false,
    reason: 'link-detected',
    links,
    blocked,
    action: cfg.action ?? ANTI_LINK_ACTIONS.DELETE,
  };
}

/** Per-user anti-link exemption check (explicit user exemptions). */
export function isAntiLinkUserExempt(groupCfg, senderJid) {
  const list = groupCfg?.antiLink?.exemptUsers ?? [];
  return list.map(normalizeJid).includes(normalizeJid(senderJid));
}

/**
 * Anti-tag: excessive mentions in a single message. Ordinary mentions are not
 * mass mentions — only messages exceeding `limit` trigger action.
 * Mentions of the sender themselves count too (spam tagging self+everyone).
 */
export function evaluateAntiTag({ mentionedJids = [], senderJid, senderIsAdmin, groupCfg }) {
  const cfg = groupCfg?.antiTag;
  if (!cfg?.enabled) return { violation: false, exempt: false, count: 0, limit: null, action: null };

  const count = new Set(mentionedJids.map(normalizeJid).filter(Boolean)).size;
  const limit = Number.isInteger(cfg.limit) && cfg.limit > 0 ? cfg.limit : 5;

  if (count <= limit) return { violation: false, exempt: false, count, limit, action: null };

  if (cfg.exemptAdmins !== false && senderIsAdmin) {
    return { violation: true, exempt: true, count, limit, action: null };
  }
  return { violation: true, exempt: false, count, limit, action: cfg.response ?? MODERATION_RESPONSES.WARN };
}

/**
 * Anti-bad-word: case-insensitive whole-word matching to avoid accidental
 * partial-word hits ("assistant" should not match "ass").
 */
export function evaluateAntiBadWord({ text, senderIsAdmin, groupCfg }) {
  const cfg = groupCfg?.antiBadWord;
  if (!cfg?.enabled) return { violation: false, exempt: false, matched: [], action: null };

  const words = (cfg.words ?? []).map((w) => String(w).toLowerCase().trim()).filter(Boolean);
  if (words.length === 0 || !text) return { violation: false, exempt: false, matched: [], action: null };

  const lower = String(text).toLowerCase();
  const matched = [];
  for (const w of words) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(w)}(?![\\p{L}\\p{N}_])`, 'iu');
    if (re.test(lower)) matched.push(w);
  }
  if (matched.length === 0) return { violation: false, exempt: false, matched: [], action: null };

  if (cfg.exemptAdmins !== false && senderIsAdmin) {
    return { violation: true, exempt: true, matched, action: null };
  }
  return { violation: true, exempt: false, matched, action: cfg.response ?? MODERATION_RESPONSES.DELETE_WARN };
}

// ── warnings ────────────────────────────────────────────────────────────

export class WarningService {
  /**
   * @param {import('../storage/jsonStore.js').JsonDocument} warningsDoc
   */
  constructor({ warningsDoc, logMax = DEFAULTS.warningHistoryMax, now = () => Date.now() }) {
    this.doc = warningsDoc;
    this.logMax = logMax;
    this.now = now;
  }

  _group(groupJid) {
    const g = normalizeJid(groupJid);
    const doc = this.doc.get();
    if (!doc.groups[g]) doc.groups[g] = {};
    return doc.groups[g];
  }

  state(groupJid, userJid) {
    const u = normalizeJid(userJid);
    const entry = this._group(groupJid)[u];
    if (!entry) return { active: 0, history: [] };
    return {
      active: entry.active ?? 0,
      history: entry.history ?? [],
    };
  }

  /**
   * Add a warning. Returns the new state plus whether the configured threshold
   * was reached (caller decides escalation — never automatic without config).
   */
  add(groupJid, userJid, { reason = null, by = null } = {}) {
    const g = normalizeJid(groupJid);
    const u = normalizeJid(userJid);
    const groups = this._group(g);
    const entry = groups[u] ?? { active: 0, history: [] };
    const record = {
      ts: this.now(),
      reason: reason ?? null,
      by: by ? normalizeJid(by) : null,
      active: true,
    };
    entry.history = [...(entry.history ?? []), record].slice(-this.logMax);
    entry.active = (entry.active ?? 0) + 1;
    groups[u] = entry;
    this.doc.update((d) => ({ ...d, groups: { ...d.groups, [g]: groups } }));
    return this.state(g, u);
  }

  /**
   * `.delwarn` — deactivate one active warning (oldest first). History retained.
   * @returns {boolean} whether an active warning was removed
   */
  removeOne(groupJid, userJid) {
    const g = normalizeJid(groupJid);
    const u = normalizeJid(userJid);
    const groups = this._group(g);
    const entry = groups[u];
    if (!entry || (entry.active ?? 0) <= 0) return false;
    const history = [...(entry.history ?? [])];
    const idx = history.findIndex((h) => h.active);
    if (idx === -1) {
      entry.active = Math.max(0, entry.active - 1);
    } else {
      history[idx] = { ...history[idx], active: false };
      entry.history = history;
      entry.active = Math.max(0, entry.active - 1);
    }
    groups[u] = entry;
    this.doc.update((d) => ({ ...d, groups: { ...d.groups, [g]: groups } }));
    return true;
  }

  /**
   * `.resetwarn` — reset the ACTIVE count to 0 but retain history
   * (records stay, still marked active=false for auditing).
   */
  reset(groupJid, userJid) {
    const g = normalizeJid(groupJid);
    const u = normalizeJid(userJid);
    const groups = this._group(g);
    const entry = groups[u];
    if (!entry) return this.state(g, u);
    entry.history = (entry.history ?? []).map((h) => (h.active ? { ...h, active: false } : h));
    entry.active = 0;
    groups[u] = entry;
    this.doc.update((d) => ({ ...d, groups: { ...d.groups, [g]: groups } }));
    return this.state(g, u);
  }

  /**
   * What to do when the group's warning threshold is hit.
   * Only 'kick' when the group EXPLICITLY configured actionOnThreshold='kick'.
   */
  thresholdReached(groupCfg, state) {
    const threshold = groupCfg?.warnings?.threshold ?? 3;
    const action = groupCfg?.warnings?.actionOnThreshold ?? 'none';
    if (state.active >= threshold && action === 'kick') return { reached: true, action: 'kick', threshold };
    return { reached: state.active >= threshold, action: 'none', threshold };
  }
}

// ── execution service ───────────────────────────────────────────────────

export class ModerationService {
  /**
   * @param {{ groupsRepo, warnings: WarningService, logger?,
   *          now?: () => number }} deps
   */
  constructor({ groupsRepo, warnings, logger = null, now = () => Date.now() }) {
    this.groups = groupsRepo;
    this.warnings = warnings;
    this.logger = logger;
    this.now = now;
    /** messageId -> expiry, duplicate enforcement prevention */
    this.processed = new Map();
    /** messageId -> { text, senderJid, chatJid, ts } — anti-delete snapshots (memory only) */
    this.snapshots = new Map();
  }

  /**
   * Anti-delete support: retain a lightweight snapshot of messages the bot
   * actually received (text + metadata only, memory-only, capped per group).
   * Only these can ever be "recovered" — never anything the bot did not see.
   */
  storeMessageSnapshot(msg) {
    if (!msg?.messageId || msg.fromMe) return;
    const cfg = this.groupConfig(msg.chatJid);
    const cap = cfg?.antiDelete?.retentionCount ?? 200;
    this.snapshots.set(msg.messageId, {
      text: msg.text?.slice(0, 2000) ?? null,
      hasMedia: !!msg.hasMedia,
      senderJid: msg.senderJid,
      chatJid: msg.chatJid,
      ts: this.now(),
    });
    // Cap total snapshots
    if (this.snapshots.size > cap * 2) {
      const oldest = [...this.snapshots.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, this.snapshots.size - cap);
      for (const [k] of oldest) this.snapshots.delete(k);
    }
  }

  getMessageSnapshot(messageId) {
    return this.snapshots.get(messageId) ?? null;
  }

  groupConfig(groupJid) {
    return this.groups.get(normalizeJid(groupJid)) ?? null;
  }

  appendModerationLog(groupJid, entry) {
    const g = normalizeJid(groupJid);
    const cfg = this.groups.get(g);
    if (!cfg) return;
    const log = [...(cfg.moderationLog ?? []), { ts: this.now(), ...entry }].slice(-DEFAULTS.moderationLogMax);
    this.groups.set(g, { ...cfg, moderationLog: log });
  }

  /** @returns {boolean} true if this is the first processing of the message */
  firstTime(messageId) {
    if (!messageId) return true;
    const exp = this.processed.get(messageId);
    const t = this.now();
    if (exp && exp > t) return false;
    this.processed.set(messageId, t + DEFAULTS.processedMessageTtlMs);
    this.prune();
    return true;
  }

  prune() {
    const t = this.now();
    for (const [k, exp] of this.processed) {
      if (exp <= t) this.processed.delete(k);
    }
  }

  /**
   * Run the security pipeline for one incoming group message.
   * Returns the list of decisions taken (for tests and honest reporting).
   *
   * @param {object} msg   normalized message context
   * @param {object} client  WhatsAppClient interface (mockable)
   */
  async handleMessage(msg, client) {
    const decisions = [];
    if (!msg?.isGroup) return decisions;
    const groupCfg = this.groupConfig(msg.chatJid);
    if (!groupCfg) return decisions;
    if (!this.firstTime(msg.messageId)) return decisions;

    const sender = normalizeJid(msg.senderJid);
    const senderIsAdmin = msg.senderIsAdmin ?? false;

    // Retain a snapshot for anti-delete (only messages we actually received).
    this.storeMessageSnapshot(msg);

    // 1. anti-link (core)
    const link = evaluateAntiLink({ text: msg.text ?? '', senderIsAdmin, groupCfg });
    if (link.violation && !link.exempt && !isAntiLinkUserExempt(groupCfg, sender)) {
      const outcome = await this._enforceAntiLink(msg, link.action, client, groupCfg);
      decisions.push({ type: 'anti-link', action: link.action, outcome, links: link.blocked.map((b) => b.domain) });
      this.appendModerationLog(msg.chatJid, {
        type: 'anti-link',
        user: sender,
        action: link.action,
        outcome: outcome.ok ? 'success' : outcome.error,
        links: link.blocked.map((b) => b.domain),
      });
    }

    // 2. anti-tag
    const tag = evaluateAntiTag({
      mentionedJids: msg.mentions ?? [],
      senderJid: sender,
      senderIsAdmin,
      groupCfg,
    });
    if (tag.violation && !tag.exempt) {
      const outcome = await this._enforceResponse(msg, tag.action, client, groupCfg, `Tag limit exceeded (${tag.count}>${tag.limit})`);
      decisions.push({ type: 'anti-tag', action: tag.action, outcome });
      this.appendModerationLog(msg.chatJid, {
        type: 'anti-tag',
        user: sender,
        action: tag.action,
        outcome: outcome.ok ? 'success' : outcome.error,
      });
    }

    // 3. anti-bad-word
    const bad = evaluateAntiBadWord({ text: msg.text ?? '', senderIsAdmin, groupCfg });
    if (bad.violation && !bad.exempt) {
      const outcome = await this._enforceResponse(msg, bad.action, client, groupCfg, `Bad word(s): ${bad.matched.join(', ')}`);
      decisions.push({ type: 'anti-badword', action: bad.action, outcome, matched: bad.matched });
      this.appendModerationLog(msg.chatJid, {
        type: 'anti-badword',
        user: sender,
        action: bad.action,
        outcome: outcome.ok ? 'success' : outcome.error,
        matched: bad.matched,
      });
    }

    return decisions;
  }

  /**
   * Anti-link enforcement with escalation semantics:
   *  delete           → delete only
   *  delete-warn      → delete + warn
   *  delete-kick      → delete + kick (only when action explicitly says so)
   *  escalate         → delete + warn + kick IFF warnings threshold configured to kick
   * Every step reports its real outcome; failures are never reported as success.
   */
  async _enforceAntiLink(msg, action, client, groupCfg) {
    const results = { ok: true, steps: [] };
    const record = async (step, fn) => {
      try {
        await fn();
        results.steps.push({ step, ok: true });
        return true;
      } catch (err) {
        results.ok = false;
        results.steps.push({ step, ok: false, error: String(err?.message ?? err) });
        this.logger?.warn?.(`moderation step failed: ${step}`, { error: String(err?.message ?? err) });
        return false;
      }
    };

    if (action === ANTI_LINK_ACTIONS.DELETE || action === ANTI_LINK_ACTIONS.DELETE_WARN ||
        action === ANTI_LINK_ACTIONS.DELETE_KICK || action === ANTI_LINK_ACTIONS.ESCALATE) {
      await record('delete', () => this._deleteMessage(msg, client));
    }

    let state = null;
    if (action === ANTI_LINK_ACTIONS.DELETE_WARN || action === ANTI_LINK_ACTIONS.ESCALATE) {
      state = this.warnings.add(msg.chatJid, msg.senderJid, {
        reason: 'anti-link violation',
        by: msg.botJid ?? null,
      });
      await record('warn', async () => {
        await client.sendText(
          msg.chatJid,
          `⚠️ @${jidDisplay(msg.senderJid)} warning ${state.active}/${groupCfg.warnings?.threshold ?? 3}: links are not allowed here.`,
          { mentions: [msg.senderJid] },
        );
      });
    }

    if (action === ANTI_LINK_ACTIONS.DELETE_KICK) {
      await record('kick', () => this._kick(msg, client));
    }

    if (action === ANTI_LINK_ACTIONS.ESCALATE && state) {
      const { reached, action: thAction } = this.warnings.thresholdReached(groupCfg, state);
      if (reached && thAction === 'kick') {
        await record('escalation-kick', () => this._kick(msg, client));
      }
    }

    return results;
  }

  /** Generic moderation response for anti-tag / anti-bad-word. */
  async _enforceResponse(msg, action, client, groupCfg, explanation) {
    const results = { ok: true, steps: [] };
    const record = async (step, fn) => {
      try {
        await fn();
        results.steps.push({ step, ok: true });
      } catch (err) {
        results.ok = false;
        results.steps.push({ step, ok: false, error: String(err?.message ?? err) });
      }
    };

    switch (action) {
      case MODERATION_RESPONSES.DELETE:
        await record('delete', () => this._deleteMessage(msg, client));
        break;
      case MODERATION_RESPONSES.WARN: {
        const state = this.warnings.add(msg.chatJid, msg.senderJid, {
          reason: explanation,
          by: msg.botJid ?? null,
        });
        await record('warn', () =>
          client.sendText(msg.chatJid, `⚠️ @${jidDisplay(msg.senderJid)} ${explanation}. Warning ${state.active}/${groupCfg.warnings?.threshold ?? 3}.`, {
            mentions: [msg.senderJid],
          }),
        );
        break;
      }
      case MODERATION_RESPONSES.DELETE_WARN: {
        await record('delete', () => this._deleteMessage(msg, client));
        const state = this.warnings.add(msg.chatJid, msg.senderJid, {
          reason: explanation,
          by: msg.botJid ?? null,
        });
        await record('warn', () =>
          client.sendText(msg.chatJid, `⚠️ @${jidDisplay(msg.senderJid)} ${explanation}. Warning ${state.active}/${groupCfg.warnings?.threshold ?? 3}.`, {
            mentions: [msg.senderJid],
          }),
        );
        break;
      }
      case MODERATION_RESPONSES.KICK:
        await record('kick', () => this._kick(msg, client));
        break;
      case MODERATION_RESPONSES.DELETE_KICK:
        await record('delete', () => this._deleteMessage(msg, client));
        await record('kick', () => this._kick(msg, client));
        break;
      default:
        break;
    }
    return results;
  }

  async _deleteMessage(msg, client) {
    if (!msg.messageId) throw new WhatsAppActionError('No message id available to delete.');
    await client.deleteMessage(msg.chatJid, {
      id: msg.messageId,
      remoteJid: msg.chatJid,
      fromMe: false,
      participant: msg.senderJid,
    });
  }

  async _kick(msg, client) {
    // Only ever called when the configured action explicitly authorizes removal.
    const ok = await client.kickParticipant(msg.chatJid, msg.senderJid);
    if (!ok) throw new WhatsAppActionError('WhatsApp rejected the removal (missing admin rights or server refusal).');
  }
}

function jidDisplay(jid) {
  return String(jid ?? '').split('@')[0];
}
