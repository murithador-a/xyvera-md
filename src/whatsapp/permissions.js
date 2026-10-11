/**
 * Centralized permission enforcement. Pure logic — no Baileys import.
 *
 * Identity is ALWAYS derived from canonical JIDs supplied by the transport
 * layer. Display names, push names, and mentions are never trusted.
 */

import { CAPABILITIES, ALL_CAPABILITIES, MODES } from '../config/defaults.js';
import { normalizeJid, phoneToJid, normalizePhone, isGroupJid } from '../utils/validators.js';
import { PermissionDeniedError, ValidationError } from '../utils/errors.js';

export class PermissionService {
  /**
   * @param {{ settings: import('../storage/jsonStore.js').JsonDocument,
   *          isGroupAdminFn?: (chatJid: string, userJid: string) => Promise<boolean>|boolean }} deps
   */
  constructor({ settings, isGroupAdminFn = null }) {
    this.settingsDoc = settings;
    this.isGroupAdminFn = isGroupAdminFn;
  }

  _settings() {
    return this.settingsDoc.get();
  }

  // ── identity ──────────────────────────────────────────────────────────

  /** Owner numbers are normalized to JIDs; empty config = no owner yet. */
  ownerJids() {
    return (this._settings().ownerNumbers ?? []).map(normalizeJid).filter(Boolean);
  }

  isOwner(jid) {
    const n = normalizeJid(jid);
    return !!n && this.ownerJids().includes(n);
  }

  /**
   * The authenticated bot account is owner-equivalent (it is the device owner
   * session). Documented in docs/LIMITATIONS.md.
   */
  isSelf(jid, botJid = null) {
    const n = normalizeJid(jid);
    const b = normalizeJid(botJid);
    return !!n && !!b && n === b;
  }

  isOwnerOrSelf(jid, botJid = null) {
    return this.isOwner(jid) || this.isSelf(jid, botJid);
  }

  // ── sudo ──────────────────────────────────────────────────────────────

  sudoEntry(jid) {
    const n = normalizeJid(jid);
    return n ? this._settings().sudo?.[n] : undefined;
  }

  isSudo(jid) {
    return !!this.sudoEntry(jid);
  }

  getCapabilities(jid) {
    return [...(this.sudoEntry(jid)?.capabilities ?? [])];
  }

  hasCapability(jid, capability) {
    return this.getCapabilities(jid).includes(capability);
  }

  /**
   * Grant capabilities to a user. Accepts a phone number or JID.
   * @param {string} target  phone number or JID
   * @param {string[]} capabilities  subset of ALL_CAPABILITIES
   */
  grantSudo(target, capabilities, { grantedBy = null } = {}) {
    const jid = this._resolveTargetJid(target);
    const caps = this._validateCaps(capabilities);
    this.settingsDoc.update((s) => {
      const next = { ...s, sudo: { ...(s.sudo ?? {}) } };
      const existing = next.sudo[jid];
      next.sudo[jid] = {
        capabilities: [...new Set([...(existing?.capabilities ?? []), ...caps])],
        grantedAt: existing?.grantedAt ?? new Date().toISOString(),
        grantedBy: grantedBy ?? existing?.grantedBy ?? null,
      };
      return next;
    });
    return this.sudoEntry(jid);
  }

  /** Revoke capabilities; pass null/undefined to revoke ALL (user stays sudo-less entry removed). */
  revokeSudo(target, capabilities = null) {
    const jid = this._resolveTargetJid(target);
    const entry = this.sudoEntry(jid);
    if (!entry) return null;
    if (!capabilities) {
      this.settingsDoc.update((s) => {
        const sudo = { ...(s.sudo ?? {}) };
        delete sudo[jid];
        return { ...s, sudo };
      });
      return null;
    }
    const caps = this._validateCaps(capabilities);
    const remaining = entry.capabilities.filter((c) => !caps.includes(c));
    if (remaining.length === 0) {
      this.settingsDoc.update((s) => {
        const sudo = { ...(s.sudo ?? {}) };
        delete sudo[jid];
        return { ...s, sudo };
      });
      return null;
    }
    this.settingsDoc.update((s) => ({
      ...s,
      sudo: { ...(s.sudo ?? {}), [jid]: { ...entry, capabilities: remaining } },
    }));
    return this.sudoEntry(jid);
  }

  removeSudo(target) {
    return this.revokeSudo(target, null);
  }

  listSudo() {
    return Object.entries(this._settings().sudo ?? {}).map(([jid, entry]) => ({ jid, ...entry }));
  }

  // ── bans (bot command access only — never kicks/blocks) ───────────────

  isBanned(jid) {
    const n = normalizeJid(jid);
    return !!n && (this._settings().bans ?? []).includes(n);
  }

  ban(target) {
    const jid = this._resolveTargetJid(target);
    this.settingsDoc.update((s) => ({ ...s, bans: [...new Set([...(s.bans ?? []), jid])] }));
    return jid;
  }

  unban(target) {
    const jid = this._resolveTargetJid(target);
    this.settingsDoc.update((s) => ({ ...s, bans: (s.bans ?? []).filter((b) => b !== jid) }));
    return jid;
  }

  listBans() {
    return [...(this._settings().bans ?? [])];
  }

  // ── mode ──────────────────────────────────────────────────────────────

  getMode() {
    return this._settings().mode ?? MODES.PUBLIC;
  }

  setMode(mode) {
    if (!Object.values(MODES).includes(mode)) {
      throw new ValidationError(`Mode must be one of: ${Object.values(MODES).join(', ')}.`);
    }
    this.settingsDoc.update((s) => ({ ...s, mode }));
    return mode;
  }

  // ── group admin ───────────────────────────────────────────────────────

  async isGroupAdmin(chatJid, userJid) {
    if (!this.isGroupAdminFn) return false;
    return !!(await this.isGroupAdminFn(normalizeJid(chatJid), normalizeJid(userJid)));
  }

  // ── central gate ──────────────────────────────────────────────────────

  /**
   * Central access decision used by the router before any handler runs.
   *
   * @param {{ senderJid: string, chatJid: string, botJid?: string|null,
   *          access?: 'everyone'|'group-admin'|'sudo'|'owner',
   *          capability?: string|null, groupOnly?: boolean }} req
   * @returns {Promise<{ allowed: boolean, reason?: string, silent?: boolean }>}
   */
  async checkAccess(req) {
    const {
      senderJid,
      chatJid,
      botJid = null,
      access = 'everyone',
      capability = null,
      groupOnly = false,
    } = req;

    const sender = normalizeJid(senderJid);
    if (!sender) return { allowed: false, reason: 'Unrecognized sender identity.' };

    const isGroup = isGroupJid(chatJid);
    if (groupOnly && !isGroup) {
      return { allowed: false, reason: 'This command can only be used in groups.' };
    }

    // 1. Bot bans (deny silently for command usage)
    if (this.isBanned(sender)) {
      return { allowed: false, reason: 'You are banned from using this bot.', silent: true };
    }

    const ownerLike = this.isOwnerOrSelf(sender, botJid);
    const sudo = this.isSudo(sender);

    // 2. Mode gate — private: owner/self/sudo only.
    if (this.getMode() === MODES.PRIVATE && !ownerLike && !sudo) {
      return { allowed: false, reason: 'This bot is in private mode.', silent: true };
    }

    // 3. Command access level. Owner bypasses everything except explicit 'owner'.
    if (access === 'owner') {
      return ownerLike
        ? { allowed: true }
        : { allowed: false, reason: 'This command is restricted to the bot owner.' };
    }

    if (ownerLike) return { allowed: true };

    if (access === 'sudo') {
      if (capability && this.hasCapability(sender, capability)) return { allowed: true };
      if (sudo && !capability) return { allowed: true };
      return {
        allowed: false,
        reason: capability
          ? `This command requires the "${capability}" sudo capability.`
          : 'This command requires sudo access.',
      };
    }

    if (access === 'group-admin') {
      if (isGroup && (await this.isGroupAdmin(chatJid, sender))) return { allowed: true };
      // Sudo with the matching capability may act as group staff where configured.
      if (capability && this.hasCapability(sender, capability)) return { allowed: true };
      // Also allow any sudo with the capability family name passed via `capability`.
      return {
        allowed: false,
        reason: 'This command requires group admin rights or the matching sudo capability.',
      };
    }

    // access === 'everyone'
    return { allowed: true };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  _resolveTargetJid(target) {
    const t = String(target ?? '').trim();
    if (t.includes('@')) {
      const n = normalizeJid(t);
      if (!n) throw new ValidationError('Invalid JID.');
      return n;
    }
    return phoneToJid(normalizePhone(t));
  }

  _validateCaps(capabilities) {
    const caps = Array.isArray(capabilities) ? capabilities : [capabilities];
    const out = caps.map((c) => String(c).trim().toLowerCase());
    for (const c of out) {
      if (!ALL_CAPABILITIES.includes(c)) {
        throw new ValidationError(
          `Unknown capability "${c}". Valid capabilities: ${ALL_CAPABILITIES.join(', ')}.`,
        );
      }
    }
    if (out.length === 0) throw new ValidationError('Provide at least one capability.');
    return out;
  }
}

export { CAPABILITIES, ALL_CAPABILITIES };

/** Factory for a denial error with a consistent message. */
export function deny(reason) {
  return new PermissionDeniedError(reason);
}
