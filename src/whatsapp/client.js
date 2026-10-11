/**
 * WhatsAppClient — the interface the rest of the app codes against.
 * Implemented for real by `createClientAdapter` (Baileys) and in tests by an
 * in-memory fake. Command handlers NEVER import Baileys.
 *
 * Methods (all safe to mock):
 *   sendText(jid, text, { mentions?, quoted? })             -> void (throws on failure)
 *   sendImage(jid, buffer, { caption? })                    -> { ok, reason? }
 *   deleteMessage(jid, key)                                 -> void (throws on failure)
 *   kickParticipant(g, user)                                -> boolean
 *   promoteParticipant(g, user)                             -> boolean
 *   demoteParticipant(g, user)                              -> boolean
 *   addParticipant(g, user)                                 -> { ok, reason? }
 *   groupMetadata(g)                                        -> { subject, desc, size, participants:[{jid,admin}] }
 *   isGroupAdmin(g, user)                                   -> boolean
 *   setGroupSubject(g, text) / setGroupDescription(g, text)  -> { ok, reason? }
 *   setGroupAnnounce(g, bool)                               -> { ok, reason? }
 *   setGroupSlowMode(g, seconds)                            -> { ok, reason? }
 *   getInviteLink(g) / revokeInvite(g)                      -> string | throws
 *   leaveGroup(g)                                           -> { ok, reason? }
 *   updateProfileStatus(text) / updateProfilePicture(jid, m)-> { ok, reason? }
 *   markStatusRead(statusEv) / sendReaction(statusEv, emoji)-> void
 *   saveMediaFile(msg, name)                                -> { ok, path?, reason? }
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { WhatsAppActionError } from '../utils/errors.js';
import { normalizeJid } from '../utils/validators.js';

/**
 * Wrap a live Baileys socket in the WhatsAppClient interface.
 * Every method reports the real outcome; upstream errors surface as throws or
 * { ok:false, reason } — never a fake success.
 */
export function createClientAdapter(sock, { logger = null, tmpDir = null } = {}) {
  const wrap = async (fn, label) => {
    try {
      return await fn();
    } catch (err) {
      logger?.warn?.(`whatsapp action failed: ${label}`, { error: String(err?.message ?? err) });
      throw new WhatsAppActionError(`${label}: ${String(err?.message ?? err)}`);
    }
  };

  return {
    sock,

    sendText: (jid, text, { mentions = [], quoted = null } = {}) =>
      wrap(async () => {
        const opts = {};
        if (quoted?.messageId) {
          opts.quoted = {
            key: {
              remoteJid: quoted.chatJid ?? jid,
              id: quoted.messageId,
              fromMe: false,
              participant: quoted.senderJid,
            },
            message: {},
          };
        }
        await sock.sendMessage(jid, { text, mentions }, opts);
      }, 'sendText'),

    sendImage: (jid, buffer, { caption = '' } = {}) =>
      wrap(async () => {
        await sock.sendMessage(jid, { image: buffer, caption });
        return { ok: true };
      }, 'sendImage').catch((err) => ({ ok: false, reason: String(err?.message ?? err) })),

    deleteMessage: (jid, key) =>
      wrap(async () => {
        await sock.sendMessage(jid, { delete: key });
      }, 'deleteMessage'),

    kickParticipant: async (groupJid, userJid) =>
      participantAction(sock, groupJid, userJid, 'remove', logger),
    promoteParticipant: async (groupJid, userJid) =>
      participantAction(sock, groupJid, userJid, 'promote', logger),
    demoteParticipant: async (groupJid, userJid) =>
      participantAction(sock, groupJid, userJid, 'demote', logger),

    addParticipant: async (groupJid, userJid) => {
      try {
        const res = await sock.groupParticipantsUpdate(groupJid, [userJid], 'add');
        const status = res?.status ?? res?.[userJid];
        if (status && status !== '200') {
          return { ok: false, reason: `WhatsApp status ${status} (privacy settings may block direct adds)` };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: String(err?.message ?? err) };
      }
    },

    groupMetadata: async (groupJid) => {
      const meta = await wrap(() => sock.groupMetadata(groupJid), 'groupMetadata');
      return {
        subject: meta?.subject ?? null,
        desc: meta?.desc ?? null,
        size: meta?.size ?? meta?.participants?.length ?? null,
        participants: (meta?.participants ?? []).map((p) => ({
          jid: normalizeJid(p.id),
          admin: p.admin ?? null,
        })),
      };
    },

    isGroupAdmin: async (groupJid, userJid) => {
      try {
        const meta = await sock.groupMetadata(groupJid);
        const p = (meta?.participants ?? []).find((x) => normalizeJid(x.id) === normalizeJid(userJid));
        return !!p?.admin;
      } catch {
        return false;
      }
    },

    setGroupSubject: (groupJid, text) =>
      okWrap(() => sock.groupUpdateSubject(groupJid, text), 'setGroupSubject'),
    setGroupDescription: (groupJid, text) =>
      okWrap(() => sock.groupUpdateDescription(groupJid, text), 'setGroupDescription'),
    setGroupAnnounce: (groupJid, on) =>
      okWrap(() => sock.groupSettingUpdate(groupJid, on ? 'announcement' : 'not_announcement'), 'setGroupAnnounce'),

    // Baileys exposes no native slow-mode API — report that honestly.
    setGroupSlowMode: async () => ({
      ok: false,
      reason: 'native slow mode is not available through the current WhatsApp library API (bot-side cooldowns are not the same thing)',
    }),

    getInviteLink: async (groupJid) => {
      const code = await wrap(() => sock.groupInviteCode(groupJid), 'getInviteLink');
      return code ? `https://chat.whatsapp.com/${code}` : null;
    },

    revokeInvite: async (groupJid) => {
      const code = await wrap(() => sock.groupRevokeInvite(groupJid), 'revokeInvite');
      return code ? `https://chat.whatsapp.com/${code}` : null;
    },

    leaveGroup: (groupJid) => okWrap(() => sock.groupLeave(groupJid), 'leaveGroup'),

    updateProfileStatus: (text) => okWrap(() => sock.updateProfileStatus(text), 'updateProfileStatus'),
    updateProfilePicture: (jid, mediaMsg) =>
      (async () => {
        try {
          const buf = Buffer.isBuffer(mediaMsg) ? mediaMsg : await downloadMessageMedia(sock, mediaMsg);
          if (!buf) return { ok: false, reason: 'no media found on that message' };
          await sock.updateProfilePicture(jid, buf);
          return { ok: true };
        } catch (err) {
          return { ok: false, reason: String(err?.message ?? err) };
        }
      })(),

    markStatusRead: async (statusEv) => {
      if (statusEv?.key) await sock.readMessages([statusEv.key]);
    },

    sendReaction: async (statusEv, emoji) => {
      if (!statusEv?.key) return;
      await sock.sendMessage(statusEv.key.remoteJid, {
        react: { text: emoji, key: statusEv.key },
      });
    },

    saveMediaFile: async (msg, name) => {
      try {
        const buf = await downloadMessageMedia(sock, msg);
        if (!buf) return { ok: false, reason: 'no downloadable media on that message' };
        const mediaDir = path.resolve(tmpDir ?? 'data', 'media');
        await fs.mkdir(mediaDir, { recursive: true });
        const file = path.join(mediaDir, `${sanitizeName(name)}-${Date.now()}.bin`);
        await fs.writeFile(file, buf);
        return { ok: true, path: file, size: buf.length };
      } catch (err) {
        return { ok: false, reason: String(err?.message ?? err) };
      }
    },

    /** Download media bytes from a normalized message or its quoted reply. */
    downloadMedia: async (msg) => downloadMessageMedia(sock, msg),

    /** Set a profile picture from raw image bytes (media pipeline output). */
    setProfilePictureFromBuffer: async (jid, buffer) =>
      okWrap(() => sock.updateProfilePicture(jid, buffer), 'updateProfilePicture'),

    // helper used by events.js
    sendMediaFromMessage: async (jid, content, opts) => sock.sendMessage(jid, content, opts),
    sendSticker: (jid, webpBuffer) =>
      wrap(async () => {
        await sock.sendMessage(jid, { sticker: webpBuffer });
      }, 'sendSticker'),
    sendImageBuffer: async (jid, buffer, { caption = '' } = {}) =>
      okWrap(() => sock.sendMessage(jid, { image: buffer, caption }), 'sendImageBuffer'),
  };
}

function sanitizeName(name) {
  return String(name ?? 'media').replace(/[^\w.-]/g, '_').slice(0, 60);
}

/** Download media from a normalized ctx (msg.raw) or quoted (msg.rawMessage). */
async function downloadMessageMedia(sock, msg) {
  const baileys = await import('baileys');
  const target = msg?.raw ?? msg?.rawMessage ?? msg;
  if (!target?.message) throw new WhatsAppActionError('No media message found (reply to an image/video/sticker).');
  return baileys.downloadMediaMessage(target, 'buffer', {}, {
    logger: { level: 'silent', trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {}, child: () => ({}) },
    reuploadRequest: sock.updateMediaMessage,
  });
}

async function participantAction(sock, groupJid, userJid, action, logger) {
  try {
    const res = await sock.groupParticipantsUpdate(groupJid, [userJid], action);
    const status = res?.status ?? res?.[userJid];
    if (status && status !== '200') {
      logger?.warn?.('participant action rejected', { action, status });
      return false;
    }
    return true;
  } catch (err) {
    logger?.warn?.('participant action failed', { action, error: String(err?.message ?? err) });
    return false;
  }
}

async function okWrap(fn, label) {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `${label}: ${String(err?.message ?? err)}` };
  }
}
