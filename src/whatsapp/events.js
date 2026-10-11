/**
 * Event wiring: messages → security pipeline + command router; group
 * participants → welcome/goodbye; protocol revokes → anti-delete; statuses →
 * status automation. All per-group behavior reads the group's own config.
 */

import { normalizeMessage, extractRevokeTarget, contentType } from './normalize.js';
import { normalizeJid, displayJid as dj } from './common-min.js';
import { renderTemplate } from '../utils/templates.js';
import { defaultGroupConfig } from '../config/defaults.js';

export function attachEventHandlers(sock, { router, moderation, statusAutomation, groupsRepo, logger, client }) {
  const botJid = () => normalizeJid(sock.user?.id ? String(sock.user.id).split(':')[0] + '@s.whatsapp.net' : null);

  const adminCache = new Map(); // `${group}|${user}` -> { isAdmin, expires }
  const isAdmin = async (groupJid, userJid) => {
    const key = `${groupJid}|${userJid}`;
    const hit = adminCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.isAdmin;
    const res = await client.isGroupAdmin(groupJid, userJid);
    adminCache.set(key, { isAdmin: res, expires: Date.now() + 30_000 });
    return res;
  };

  // ── messages ─────────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const raw of messages ?? []) {
      try {
        const msg = normalizeMessage(raw, { botJid: botJid() });
        if (!msg) continue;

        // Statuses → status automation
        if (msg.isStatus) {
          await statusAutomation.process(
            {
              messageId: msg.messageId,
              authorJid: msg.senderJid ?? msg.chatJid,
              botJid: botJid(),
              type: contentType(raw.message),
              key: raw.key,
            },
            client,
          );
          continue;
        }

        if (msg.isGroup) {
          msg.senderIsAdmin = msg.fromMe ? true : await isAdmin(msg.chatJid, msg.senderJid);
        }

        // Ignore the bot's own messages for enforcement/commands
        if (msg.fromMe) continue;

        // 1. security pipeline (independent of commands)
        try {
          await moderation.handleMessage(msg, client);
        } catch (err) {
          logger.error?.('security pipeline error', { error: String(err?.message ?? err) });
        }

        // 2. command router
        try {
          await router.dispatch(msg, client, {});
        } catch (err) {
          logger.error?.('router dispatch error', { error: String(err?.message ?? err) });
        }
      } catch (err) {
        logger.error?.('message handling error', { error: String(err?.message ?? err) });
      }
    }
  });

  // ── anti-delete (observe revokes only for messages we saw) ────────────
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const raw of messages ?? []) {
      try {
        const revoked = extractRevokeTarget(raw);
        if (!revoked?.chatJid) continue;
        const gc = groupsRepo.get(revoked.chatJid);
        if (!gc?.antiDelete?.enabled) continue;
        const snapshot = moderation.getMessageSnapshot?.(revoked.messageId);
        if (!snapshot) {
          // Honest: the bot never received this message, so nothing can be recovered.
          logger.debug?.('anti-delete: no snapshot for revoked message', { id: revoked.messageId });
          continue;
        }
        await client.sendText(
          revoked.chatJid,
          `♻️ *Anti-delete* — a message from @${dj(revoked.senderJid)} was deleted.\nRecovered content:\n${snapshot.text ?? '(media message — content not retained)'}`,
          { mentions: [revoked.senderJid] },
        );
      } catch (err) {
        logger.warn?.('anti-delete handler error', { error: String(err?.message ?? err) });
      }
    }
  });

  // ── welcome / goodbye ────────────────────────────────────────────────
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    try {
      const chatJid = normalizeJid(id);
      const gc = groupsRepo.get(chatJid) ?? defaultGroupConfig();
      let meta = { subject: null };
      try {
        meta = await client.groupMetadata(chatJid);
      } catch {
        /* keep going with unknown subject */
      }

      for (const p of participants ?? []) {
        const userJid = normalizeJid(p);
        if (!userJid) continue;

        if ((action === 'add' || action === 'joined') && gc.welcome?.enabled) {
          const { text, missing } = renderTemplate(gc.welcome.text, {
            user: `@${dj(userJid)}`,
            group: meta.subject ?? 'this group',
          });
          void missing;
          await sendGreeting(client, chatJid, text, [userJid], gc.welcome.mediaPath, logger);
        }

        if ((action === 'remove' || action === 'leave') && gc.goodbye?.enabled) {
          const { text } = renderTemplate(gc.goodbye.text, {
            user: `@${dj(userJid)}`,
            group: meta.subject ?? 'this group',
          });
          // NOTE: the event does not reliably distinguish voluntary leave vs
          // removal — the goodbye text must not claim either.
          await sendGreeting(client, chatJid, text, [userJid], gc.goodbye.mediaPath, logger);
        }
      }
    } catch (err) {
      logger.warn?.('group participants handler error', { error: String(err?.message ?? err) });
    }
  });
}

/** Send a greeting as image-with-caption when media is configured, else plain text. */
async function sendGreeting(client, chatJid, text, mentions, mediaPath, logger) {
  try {
    if (mediaPath) {
      const { promises: fsp } = await import('node:fs');
      const buf = await fsp.readFile(mediaPath).catch(() => null);
      if (buf && client.sendImageBuffer) {
        const ok = await client.sendImageBuffer(chatJid, buf, { caption: text }).catch(() => null);
        if (ok?.ok !== false) return;
      }
      logger?.warn?.('greeting media could not be sent; falling back to text', { mediaPath });
    }
  } catch (err) {
    logger?.warn?.('greeting media error', { error: String(err?.message ?? err) });
  }
  await client.sendText(chatJid, text, { mentions }).catch(() => {});
}
