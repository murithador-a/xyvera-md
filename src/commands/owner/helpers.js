/** Small helpers shared by owner commands (kept separate to avoid cycles). */

import { normalizeJid, phoneToJid, normalizePhone } from '../../utils/validators.js';
import { ValidationError } from '../../utils/errors.js';
import { defaultGroupConfig } from '../../config/defaults.js';

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

export function displayJid(jid) {
  return String(jid ?? '').split('@')[0];
}

/** Non-throwing group config fetch (returns null outside groups). */
export function requireGroupConfigSafe(groupsRepo, chatJid) {
  const g = normalizeJid(chatJid);
  if (!g?.endsWith('@g.us')) return null;
  let cfg = groupsRepo.get(g);
  if (!cfg) {
    cfg = { ...defaultGroupConfig(), createdAt: new Date().toISOString() };
    groupsRepo.set(g, cfg);
  }
  return cfg;
}
