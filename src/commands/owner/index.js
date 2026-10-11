/**
 * Owner & sudo administration: mode, settings, prefix, sudo grants, bans,
 * maintenance. `.ban`/`.unban` control BOT COMMAND ACCESS only — they never
 * kick anyone from a group and never use WhatsApp's block list.
 */

import { COMMAND_STATUS, CAPABILITIES, ALL_CAPABILITIES, MODES } from '../../config/defaults.js';
import { validatePrefix, normalizeJid, phoneToJid, normalizePhone, validateText, validateEmoji } from '../../utils/validators.js';
import { ValidationError, ConfirmationRequiredError } from '../../utils/errors.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { targetJidFromCtx, displayJid, requireGroupConfigSafe } from './helpers.js';

export default function registerOwnerCommands(registry, deps) {
  const { getConfig, updateSettings, tmpDir } = deps;

  registry.registerAll([
    {
      name: 'mode',
      category: 'owner',
      description: 'Switch bot between public and private',
      args: '<public|private>',
      access: 'owner',
      handler: async (ctx) => {
        const arg = (ctx.args[0] ?? '').toLowerCase();
        if (!arg) {
          await ctx.reply(`Current mode: *${ctx.permissions.getMode()}*\nUsage: .mode public | .mode private`);
          return;
        }
        if (!Object.values(MODES).includes(arg)) {
          throw new ValidationError('Usage: .mode public | .mode private');
        }
        ctx.permissions.setMode(arg);
        await ctx.reply(
          `✅ Mode set to *${arg}*.\n` +
            (arg === MODES.PRIVATE
              ? 'Only the owner and sudo users can use commands. Owner commands remain owner-only.'
              : 'General commands are open to everyone; admin commands keep their own checks.'),
        );
      },
    },
    {
      name: 'settings',
      category: 'owner',
      description: 'Show global vs group settings',
      access: 'everyone',
      handler: async (ctx) => {
        const cfg = getConfig();
        const lines = [
          `*⚙️ Settings — ${cfg.botName}*`,
          '',
          '*Global (bot-wide)*',
          `• Prefix: ${cfg.prefix}`,
          `• Mode: ${ctx.permissions.getMode()}`,
          `• Owner: ${cfg.ownerName} ${ctx.permissions.ownerJids().length ? `(${ctx.permissions.ownerJids().length} number(s))` : '(not configured)'}`,
          `• Sudo users: ${ctx.permissions.listSudo().length}`,
          `• Banned from commands: ${ctx.permissions.listBans().length}`,
        ];
        if (ctx.isGroup) {
          const gc = requireGroupConfigSafe(ctx.services.groupsRepo, ctx.chatJid);
          lines.push(
            '',
            `*Group settings — this chat only* (${displayJid(ctx.chatJid)})`,
            `• Welcome: ${gc.welcome.enabled ? 'on' : 'off'}  |  Goodbye: ${gc.goodbye.enabled ? 'on' : 'off'}`,
            `• Anti-link: ${gc.antiLink.enabled ? `on (${gc.antiLink.action})` : 'off'}`,
            `• Anti-tag: ${gc.antiTag.enabled ? `on (limit ${gc.antiTag.limit})` : 'off'}`,
            `• Anti-bad-word: ${gc.antiBadWord.enabled ? `on (${gc.antiBadWord.words.length} words)` : 'off'}`,
            `• Anti-delete: ${gc.antiDelete.enabled ? 'on' : 'off'}`,
            `• Warnings threshold: ${gc.warnings.threshold} → action: ${gc.warnings.actionOnThreshold}`,
            '',
            `_These apply to THIS group only. Use .gcstatus for the full report._`,
          );
        } else {
          lines.push('', '_Group settings appear here when you use .settings in a group._');
        }
        await ctx.reply(lines.join('\n'));
      },
    },
    {
      name: 'setprefix',
      category: 'owner',
      description: 'Change the command prefix',
      args: '<symbol>',
      access: 'sudo',
      capability: CAPABILITIES.BOT_SETTINGS,
      handler: async (ctx) => {
        const value = validatePrefix(ctx.args[0] ?? '');
        updateSettings((s) => ({ ...s, prefix: value }));
        await ctx.reply(`✅ Prefix set to \`${value}\` — try ${value}menu`);
      },
    },
    {
      name: 'setbotbio',
      category: 'owner',
      description: 'Set the WhatsApp profile about text',
      args: '<text>',
      access: 'owner',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        const text = validateText(ctx.rest, { max: 139, label: 'Bio' });
        const result = await ctx.client.updateProfileStatus?.(text);
        if (result?.ok === false) {
          await ctx.reply(`⚠️ WhatsApp rejected the bio change: ${result.reason ?? 'unknown reason'}`);
          return;
        }
        await ctx.reply(`✅ Profile about updated to: ${text}`);
      },
    },
    {
      name: 'setbotpp',
      category: 'owner',
      description: 'Set the bot profile picture (reply to an image)',
      access: 'owner',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        const quoted = ctx.msg.quoted;
        const hasImage = !!quoted?.hasMedia || !!ctx.msg.hasMedia;
        if (!hasImage) {
          await ctx.reply('Reply to an image with .setbotpp (or send an image captioned .setbotpp).');
          return;
        }
        const raw = await ctx.client.downloadMedia(quoted ?? ctx.msg);
        if (!raw) {
          await ctx.reply('⚠️ Could not download that image — reply directly to an image message.');
          return;
        }
        const { toProfilePicture } = await import('../../services/mediaPipeline.js');
        const buf = await toProfilePicture(raw);
        const result = await ctx.client.setProfilePictureFromBuffer?.(ctx.botJid, buf);
        if (result?.ok === false) {
          await ctx.reply(`⚠️ WhatsApp rejected the profile picture change: ${result.reason ?? 'unsupported'}`);
          return;
        }
        await ctx.reply('✅ Profile picture updated.');
      },
    },
    {
      name: 'addsudo',
      category: 'owner',
      description: 'Grant sudo capabilities to a user',
      args: '<number|@user> [capability|all]',
      access: 'owner',
      handler: async (ctx) => {
        const target = targetJidFromCtx(ctx);
        // Capability args: everything that is not the target mention/number.
        const capArgs = ctx.args.filter((a) => !a.startsWith('@') && !/^\+?\d[\d\s-]{3,}$/.test(a));
        const capArg = (capArgs[0] ?? 'all').toLowerCase();
        const caps = capArg === 'all' ? [...ALL_CAPABILITIES] : capArg.split(',').map((c) => c.trim().toLowerCase());
        const entry = ctx.permissions.grantSudo(target, caps, { grantedBy: ctx.senderJid });
        await ctx.reply(
          `✅ Granted *${entry.capabilities.length}* capability(ies) to ${displayJid(target)}:\n${entry.capabilities.map((c) => `• ${c}`).join('\n')}\n\nUse .delsudo to revoke.`,
        );
      },
    },
    {
      name: 'delsudo',
      category: 'owner',
      description: 'Revoke sudo capabilities (or all) from a user',
      args: '<number|@user> [capability|all]',
      access: 'owner',
      handler: async (ctx) => {
        const target = targetJidFromCtx(ctx);
        const capArg = (ctx.args[1] ?? 'all').toLowerCase();
        const remaining = capArg === 'all'
          ? ctx.permissions.removeSudo(target)
          : ctx.permissions.revokeSudo(target, capArg.split(',').map((c) => c.trim()));
        if (remaining === null) {
          await ctx.reply(`✅ Removed all sudo access from ${displayJid(target)}.`);
        } else {
          await ctx.reply(
            `✅ Revoked capabilities from ${displayJid(target)}. Remaining:\n${remaining.capabilities.map((c) => `• ${c}`).join('\n') || '(none)'}`,
          );
        }
      },
    },
    {
      name: 'sudolist',
      category: 'owner',
      description: 'List sudo users and their capabilities',
      access: 'owner',
      handler: async (ctx) => {
        const list = ctx.permissions.listSudo();
        if (list.length === 0) {
          await ctx.reply('No sudo users configured. Use .addsudo <number> [capability|all].');
          return;
        }
        const lines = ['*🔑 Sudo users*'];
        for (const { jid, capabilities, grantedAt } of list) {
          lines.push(`• ${displayJid(jid)} (${capabilities.length} caps)${grantedAt ? ` — since ${grantedAt.slice(0, 10)}` : ''}`);
          lines.push(`  ${capabilities.join(', ')}`);
        }
        await ctx.reply(lines.join('\n'));
      },
    },
    {
      name: 'ban',
      category: 'owner',
      description: 'Ban a user from using bot commands (does NOT kick them)',
      args: '<number|@user>',
      access: 'sudo',
      capability: CAPABILITIES.BOT_SETTINGS,
      handler: async (ctx) => {
        const target = targetJidFromCtx(ctx);
        if (ctx.permissions.isOwnerOrSelf(target, ctx.botJid)) {
          throw new ValidationError('You cannot ban the owner or the bot itself.');
        }
        ctx.permissions.ban(target);
        await ctx.reply(
          `🚫 Banned ${displayJid(target)} from using bot commands.\nThis does *not* remove them from any group.`,
        );
      },
    },
    {
      name: 'unban',
      category: 'owner',
      description: 'Allow a banned user to use bot commands again',
      args: '<number|@user>',
      access: 'sudo',
      capability: CAPABILITIES.BOT_SETTINGS,
      handler: async (ctx) => {
        const target = targetJidFromCtx(ctx);
        ctx.permissions.unban(target);
        await ctx.reply(`✅ Unbanned ${displayJid(target)}.`);
      },
    },
    {
      name: 'cleartmp',
      category: 'owner',
      description: 'Delete files from the bot temp directory only',
      access: 'sudo',
      capability: CAPABILITIES.MAINTENANCE,
      handler: async (ctx) => {
        const dir = tmpDir;
        let removed = 0;
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isFile()) {
              await fs.unlink(p);
              removed += 1;
            }
          }
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
        await ctx.reply(`🧹 Temp directory cleaned — ${removed} file(s) removed.\n(Only files inside ${path.basename(dir)}/ were touched.)`);
      },
    },
    {
      name: 'clearsession',
      category: 'owner',
      description: '⚠️ Delete the WhatsApp session (disconnects the bot!)',
      access: 'owner',
      handler: async (ctx) => {
        ctx.requireConfirmation(
          'clearsession',
          [
            '⚠️ *DANGER* — this will delete the WhatsApp session and *disconnect the bot*.',
            'You will need to re-scan the QR / re-pair.',
            '',
            'Type `.confirm` within 60 seconds to proceed, or `.cancel`.',
          ].join('\n'),
          { target: 'session' },
        );
      },
    },
    {
      name: 'restart',
      category: 'owner',
      description: 'Restart the bot process (owner only)',
      access: 'owner',
      handler: async (ctx) => {
        ctx.requireConfirmation(
          'restart',
          '🔄 Restart the bot process?\nType `.confirm` within 60 seconds to proceed, or `.cancel`.',
          {},
        );
      },
    },
    {
      name: 'confirm',
      category: 'utilities',
      description: 'Confirm your pending destructive action',
      access: 'everyone',
      handler: async (ctx) => {
        const rec = ctx.confirmations.consume({ chatJid: ctx.chatJid, userJid: ctx.senderJid });
        if (!rec) {
          await ctx.reply('There is no pending action to confirm (they expire after 60 seconds).');
          return;
        }
        await runConfirmedAction(ctx, rec, deps);
      },
    },
    {
      name: 'cancel',
      category: 'utilities',
      description: 'Cancel your pending destructive action',
      access: 'everyone',
      handler: async (ctx) => {
        const cancelled = ctx.confirmations.cancel({ chatJid: ctx.chatJid, userJid: ctx.senderJid });
        await ctx.reply(cancelled ? '✅ Pending action cancelled.' : 'There is no pending action.');
      },
    },
  ]);
}

async function runConfirmedAction(ctx, rec, deps) {
  const { tmpDir, sessionDir, restartFn } = deps;
  switch (rec.action) {
    case 'clearsession': {
      try {
        await fs.rm(sessionDir, { recursive: true, force: true });
        await ctx.reply('🗑️ Session deleted. The bot will now disconnect. Re-pair after restart.');
        setTimeout(() => process.exit(75), 500); // 75 = "restart requested" exit code for supervisors
      } catch (err) {
        await ctx.reply(`⚠️ Failed to clear session: ${String(err?.message ?? err)}`);
      }
      break;
    }
    case 'restart': {
      await ctx.reply('🔄 Restarting…');
      if (typeof restartFn === 'function') await restartFn();
      else setTimeout(() => process.exit(75), 300);
      break;
    }
    case 'revoke-link': {
      try {
        const link = await ctx.client.revokeInvite(rec.meta.chatJid ?? ctx.chatJid);
        await ctx.reply(`🔗 Invite link reset.\nNew link: ${link ?? '(WhatsApp did not return a new link)'}`);
      } catch (err) {
        await ctx.reply(`⚠️ WhatsApp rejected the invite reset: ${String(err?.message ?? err)}`);
      }
      break;
    }
    case 'leave-group': {
      try {
        const ok = await ctx.client.leaveGroup?.(rec.meta.chatJid ?? ctx.chatJid);
        if (ok?.ok === false) {
          await ctx.reply(`⚠️ WhatsApp rejected leaving the group: ${ok.reason ?? 'unknown'}`);
        }
      } catch (err) {
        await ctx.reply(`⚠️ Failed to leave group: ${String(err?.message ?? err)}`);
      }
      break;
    }
    case 'escalation-kick': {
      const target = rec.meta.target;
      if (!target) {
        await ctx.reply('⚠️ Missing escalation target.');
        break;
      }
      const removed = await ctx.client.kickParticipant(rec.meta.chatJid ?? ctx.chatJid, target);
      if (removed) {
        await ctx.reply(`🚨 Removed ${displayJid(target)} — warning threshold reached (confirmed).`);
      } else {
        await ctx.reply(
          `⚠️ WhatsApp rejected the removal of ${displayJid(target)} (bot may lack admin rights).`,
        );
      }
      break;
    }
    default:
      await ctx.reply(`Unknown confirmation action: ${rec.action}`);
  }
}
