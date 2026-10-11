/**
 * Command router — the single enforcement choke point.
 * Pipeline: parse → lookup → ban → mode → permissions → cooldown → handler.
 * Handlers run only after every gate passes; errors map to honest replies.
 */

import {
  ValidationError,
  PermissionDeniedError,
  ConfirmationRequiredError,
  CooldownError,
  AppError,
} from '../utils/errors.js';
import { normalizeJid } from '../utils/validators.js';
import { COMMAND_STATUS } from '../config/defaults.js';

export class CommandRouter {
  /**
   * @param {{ registry, permissions, cooldowns, confirmations, logger,
   *          getPrefix: () => string, botJid?: () => string|null }} deps
   */
  constructor({ registry, permissions, cooldowns, confirmations, logger, getPrefix, botJid = () => null }) {
    this.registry = registry;
    this.permissions = permissions;
    this.cooldowns = cooldowns;
    this.confirmations = confirmations;
    this.logger = logger;
    this.getPrefix = getPrefix;
    this.botJid = botJid;
  }

  /**
   * Parse a message body against the configured prefix.
   * @returns {{ name: string, args: string[], rest: string }|null}
   */
  parse(text) {
    const prefix = this.getPrefix();
    const body = String(text ?? '');
    if (!body.startsWith(prefix)) return null;
    const withoutPrefix = body.slice(prefix.length).trim();
    if (!withoutPrefix) return null;
    const [name, ...restParts] = withoutPrefix.split(/\s+/);
    const rest = withoutPrefix.slice(name.length).trim();
    return { name: name.toLowerCase(), args: restParts, rest };
  }

  /**
   * Dispatch one normalized message. Returns a result object for tests/logs;
   * side effects (replies) go through ctx.reply → client.
   *
   * @param {object} msg  normalized message context
   * @param {object} client  WhatsAppClient interface
   * @param {object} services  { warnings, moderation, games, groupConfigService, ... }
   */
  async dispatch(msg, client, services = {}) {
    const parsed = this.parse(msg.text);
    if (!parsed) return { handled: false, reason: 'not-a-command' };

    const command = this.registry.get(parsed.name);
    if (!command) return { handled: false, reason: 'unknown-command', name: parsed.name };

    const senderJid = normalizeJid(msg.senderJid);
    const chatJid = normalizeJid(msg.chatJid);
    const botJid = normalizeJid(this.botJid() ?? msg.botJid ?? null);

    // Central permission gate (includes ban + mode checks).
    const access = await this.permissions.checkAccess({
      senderJid,
      chatJid,
      botJid,
      access: command.access,
      capability: command.capability,
      groupOnly: command.groupOnly,
    });

    if (!access.allowed) {
      if (access.silent) {
        this.logger.debug?.('command denied (silent)', { command: command.name, senderJid, reason: access.reason });
        return { handled: false, reason: 'denied-silent', detail: access.reason };
      }
      await safeReply(client, chatJid, msg, `⛔ ${access.reason}`);
      return { handled: false, reason: 'denied', detail: access.reason };
    }

    // Cooldown
    if (command.cooldownMs > 0) {
      const key = `${command.name}|${chatJid}|${senderJid}`;
      const res = this.cooldowns.check(key, command.cooldownMs);
      if (!res.ok) {
        const secs = Math.ceil(res.retryAfterMs / 1000);
        await safeReply(client, chatJid, msg, `⏳ Cooldown: try again in ${secs}s.`);
        return { handled: false, reason: 'cooldown' };
      }
    }

    // Build handler context
    const reply = (text, opts = {}) => safeReply(client, chatJid, msg, text, opts);
    const ctx = {
      msg,
      client,
      services,
      command,
      args: parsed.args,
      rest: parsed.rest,
      name: parsed.name,
      senderJid,
      chatJid,
      botJid,
      isGroup: !!msg.isGroup,
      reply,
      permissions: this.permissions,
      confirmations: this.confirmations,
      /** Throw ConfirmationRequiredError to arm a destructive action. */
      requireConfirmation(action, prompt, meta = {}) {
        const { token } = this.confirmations.create({ chatJid, userJid: senderJid, action, meta });
        throw new ConfirmationRequiredError(prompt, { action, token });
      },
      config: services.config ?? {},
    };

    try {
      if (command.status === COMMAND_STATUS.PENDING) {
        await reply(
          `🚧 *${command.name}* is not implemented yet (pending definition). It is listed so you know it is not functional.`,
        );
        return { handled: true, reason: 'pending-definition' };
      }
      await command.handler(ctx);
      return { handled: true, reason: 'ok', name: command.name };
    } catch (err) {
      await this._handleError(err, ctx);
      return { handled: true, reason: 'error', name: command.name, error: String(err?.message ?? err) };
    }
  }

  async _handleError(err, ctx) {
    const log = this.logger ?? console;
    if (err instanceof ConfirmationRequiredError) {
      await ctx.reply(err.userMessage);
      return;
    }
    if (err instanceof CooldownError) {
      await ctx.reply(`⏳ ${err.userMessage}`);
      return;
    }
    if (err instanceof PermissionDeniedError) {
      await ctx.reply(`⛔ ${err.userMessage}`);
      return;
    }
    if (err instanceof ValidationError) {
      await ctx.reply(`⚠️ ${err.userMessage}`);
      return;
    }
    if (err instanceof AppError) {
      await ctx.reply(`⚠️ ${err.userMessage}`);
      log.warn?.('command app error', { command: ctx.command?.name, error: err.message, code: err.code });
      return;
    }
    log.error?.('command crashed', {
      command: ctx.command?.name,
      error: String(err?.message ?? err),
      stack: err?.stack?.split('\n').slice(0, 3).join(' | '),
    });
    await ctx.reply('❌ An unexpected error occurred. It has been logged.');
  }
}

async function safeReply(client, chatJid, msg, text, opts = {}) {
  try {
    await client.sendText(chatJid, text, { quoted: msg, ...opts });
  } catch (err) {
    // Never crash on a failed reply; log without secrets.
    console.error?.('[router] reply failed:', String(err?.message ?? err));
  }
}
