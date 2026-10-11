/**
 * Normalize raw Baileys messages into the MessageContext used by the app.
 * No behavior decisions here — just faithful extraction.
 */

import { normalizeJid, isGroupJid, isStatusJid } from '../utils/validators.js';

const IGNORED_PREFIXES = ['protocolMessage', 'reactionMessage', 'pollUpdateMessage', 'voteMessage'];

/** Extract plain text from any common message content shape. */
export function extractText(message) {
  if (!message || typeof message !== 'object') return '';
  if (typeof message.conversation === 'string') return message.conversation;
  const ext = message.extendedTextMessage;
  if (ext?.text) return ext.text;
  for (const key of ['imageMessage', 'videoMessage', 'documentMessage']) {
    if (message[key]?.caption) return message[key].caption;
  }
  if (message.ephemeralMessage?.message) return extractText(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return extractText(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return extractText(message.viewOnceMessageV2.message);
  if (message.documentWithCaptionMessage?.message) {
    return extractText(message.documentWithCaptionMessage.message);
  }
  return '';
}

/** Extract mentioned JIDs. */
export function extractMentions(message) {
  const out = [];
  const walk = (m) => {
    if (!m || typeof m !== 'object') return;
    if (Array.isArray(m.mentionedJid)) out.push(...m.mentionedJid);
    for (const key of Object.keys(m)) {
      const v = m[key];
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(message);
  return out.map(normalizeJid).filter(Boolean);
}

/** Which content kind is this (for status type reporting / anti-delete)? */
export function contentType(message) {
  if (!message) return 'unknown';
  if (message.conversation) return 'text';
  if (message.extendedTextMessage) return 'text';
  if (message.imageMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.audioMessage) return 'audio';
  if (message.stickerMessage) return 'sticker';
  if (message.documentMessage) return 'document';
  return 'other';
}

/**
 * @param {any} raw  Baileys WAMessage
 * @returns {object|null} normalized context (null for ignorable messages)
 */
export function normalizeMessage(raw, { botJid = null } = {}) {
  if (!raw?.message || !raw?.key) return null;

  // Unwrap view-once / ephemeral wrappers for text extraction only.
  let message = raw.message;
  while (message?.ephemeralMessage?.message || message?.viewOnceMessage?.message || message?.viewOnceMessageV2?.message) {
    message =
      message.ephemeralMessage?.message ??
      message.viewOnceMessage?.message ??
      message.viewOnceMessageV2?.message;
  }

  const firstKey = Object.keys(message)[0];
  if (firstKey && IGNORED_PREFIXES.includes(firstKey) && firstKey !== 'protocolMessage') return null;

  const chatJid = normalizeJid(raw.key.remoteJid);
  if (!chatJid) return null;
  const isGroup = isGroupJid(chatJid);
  const isStatus = isStatusJid(chatJid);

  const senderJid = normalizeJid(
    raw.key.participant ?? (isGroup ? null : raw.key.remoteJid),
  );

  return {
    messageId: raw.key.id ?? null,
    chatJid,
    senderJid,
    botJid: normalizeJid(botJid),
    fromMe: !!raw.key.fromMe,
    isGroup,
    isStatus,
    text: extractText(message),
    mentions: extractMentions(message),
    hasMedia: ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'].some(
      (k) => !!message[k],
    ),
    quoted: extractQuoted(raw),
    timestamp: Number(raw.messageTimestamp ?? Date.now()) * (Number(raw.messageTimestamp) < 1e12 ? 1000 : 1),
    rawMessage: message,
    raw,
  };
}

function extractQuoted(raw) {
  const ctxInfo =
    raw.message?.extendedTextMessage?.contextInfo ??
    raw.message?.imageMessage?.contextInfo ??
    raw.message?.videoMessage?.contextInfo ??
    raw.message?.conversation?.contextInfo ??
    null;
  if (!ctxInfo?.quotedMessage) return null;
  return {
    senderJid: normalizeJid(ctxInfo.participant),
    messageId: ctxInfo.stanzaId ?? null,
    hasMedia: ['imageMessage', 'videoMessage', 'stickerMessage', 'documentMessage', 'audioMessage'].some(
      (k) => !!ctxInfo.quotedMessage[k],
    ),
  };
}

/** Extract a revoke (delete-for-everyone) target from a protocol message. */
export function extractRevokeTarget(raw) {
  const proto = raw?.message?.protocolMessage;
  if (!proto) return null;
  // REVOKE type = 0 in the proto enum
  if (proto.type !== undefined && proto.type !== 0 && String(proto.type) !== 'REVOKE') return null;
  const key = proto.key;
  if (!key) return null;
  return {
    chatJid: normalizeJid(key.remoteJid ?? raw.key?.remoteJid),
    messageId: key.id ?? null,
    senderJid: normalizeJid(key.participant ?? key.remoteJid),
  };
}
