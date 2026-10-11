/**
 * Shared helpers for command handlers.
 */

import { normalizeJid, phoneToJid, normalizePhone, isGroupJid } from '../utils/validators.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { defaultGroupConfig, SCHEMA_VERSION } from '../config/defaults.js';

/**
 * Resolve a target user JID from ctx: prefers a mention, then quoted message
 * author, then a numeric argument. Never trusts display names.
 */
export function targetJidFromCtx(ctx, { required = true } = {}) {
  const mentions = ctx.msg.mentions ?? [];
  if (mentions.length > 0) return normalizeJid(mentions[0]);
  if (ctx.msg.quoted?.senderJid) return normalizeJid(ctx.msg.quoted.senderJid);
  const arg = ctx.args[0];
  if (arg) {
    try {
      return phoneToJid(normalizePhone(arg));
    } catch {
      if (required) throw new ValidationError('Provide a user by mention, reply, or number.');
      return null;
    }
  }
  if (required) throw new ValidationError('Provide a user by mention, reply, or number.');
  return null;
}

/** Ensure a group config exists with safe defaults (all security OFF). */
export function ensureGroupConfig(groupsRepo, groupJid) {
  const g = normalizeJid(groupJid);
  if (!isGroupJid(g)) throw new ValidationError('This command only works in groups.');
  let cfg = groupsRepo.get(g);
  if (!cfg) {
    cfg = { ...defaultGroupConfig(), createdAt: new Date().toISOString() };
    groupsRepo.set(g, cfg);
  }
  return cfg;
}

export function updateGroupConfig(groupsRepo, groupJid, mutator) {
  const cfg = ensureGroupConfig(groupsRepo, groupJid);
  const next = mutator({ ...cfg }) ?? cfg;
  groupsRepo.set(normalizeJid(groupJid), next);
  return next;
}

/** Confirm the sender is a group admin (via client metadata) or throw. */
export async function requireGroupAdmin(ctx) {
  const isAdmin = await ctx.client.isGroupAdmin(ctx.chatJid, ctx.senderJid);
  if (!isAdmin) throw new ValidationError('This command requires group admin rights.');
  return true;
}

export function requireGroup(ctx) {
  if (!ctx.isGroup) throw new ValidationError('This command can only be used in groups.');
}

export function displayJid(jid) {
  return String(jid ?? '').split('@')[0];
}

export { normalizeJid, phoneToJid, normalizePhone, isGroupJid };

export function requireOwnerConfigured(ctx) {
  const owners = ctx.permissions.ownerJids();
  if (owners.length === 0) {
    throw new ValidationError(
      'No owner is configured yet. Set OWNER_NUMBERS in your .env (see .env.example) and restart.',
    );
  }
  return owners;
}

export { SCHEMA_VERSION, NotFoundError };
