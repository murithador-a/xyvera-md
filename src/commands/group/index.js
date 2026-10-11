/**
 * Group management: member management, tagging, group info and settings.
 * All WhatsApp actions report their REAL outcome — failures are never shown
 * as successes. Destructive actions (.revoke, .leavegc) require confirmation.
 */

import { COMMAND_STATUS, CAPABILITIES, defaultGroupConfig } from '../../config/defaults.js';
import { ValidationError, WhatsAppActionError } from '../../utils/errors.js';
import { normalizeJid, phoneToJid, normalizePhone, validateText, isGroupJid } from '../../utils/validators.js';
import { targetJidFromCtx, displayJid, ensureGroupConfig, updateGroupConfig, requireGroup, requireGroupAdmin } from '../common.js';

export default function registerGroupCommands(registry, deps) {
  registry.registerAll([
    // ── member management ───────────────────────────────────────────────
    {
      name: 'kick',
      aliases: ['remove'],
      category: 'group',
      description: 'Remove a member from the group',
      args: '@user',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_KICK,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_KICK);
        const target = targetJidFromCtx(ctx);
        await guardSelfTarget(ctx, target);
        const res = await ctx.client.kickParticipant(ctx.chatJid, target);
        if (!res) throw new WhatsAppActionError('WhatsApp rejected the removal (bot may lack admin rights).');
        await ctx.reply(`✅ Removed ${displayJid(target)} from the group.`);
      },
    },
    {
      name: 'promote',
      category: 'group',
      description: 'Promote a member to group admin',
      args: '@user',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_PROMOTE,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_PROMOTE);
        const target = targetJidFromCtx(ctx);
        const res = await ctx.client.promoteParticipant(ctx.chatJid, target);
        if (!res) throw new WhatsAppActionError('WhatsApp rejected the promotion (bot may lack admin rights).');
        await ctx.reply(`✅ Promoted ${displayJid(target)} to admin.`);
      },
    },
    {
      name: 'demote',
      category: 'group',
      description: 'Demote a group admin to member',
      args: '@user',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_PROMOTE,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_PROMOTE);
        const target = targetJidFromCtx(ctx);
        const res = await ctx.client.demoteParticipant(ctx.chatJid, target);
        if (!res) throw new WhatsAppActionError('WhatsApp rejected the demotion (bot may lack admin rights).');
        await ctx.reply(`✅ Demoted ${displayJid(target)} to member.`);
      },
    },
    {
      name: 'add',
      category: 'group',
      description: 'Try to add a number to the group (invitation fallback)',
      args: '<number>',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_KICK,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_KICK);
        const number = normalizePhone(ctx.args[0] ?? '');
        const jid = phoneToJid(number);
        const res = await ctx.client.addParticipant(ctx.chatJid, jid);
        if (res?.ok) {
          await ctx.reply(`✅ Added ${number} to the group.`);
          return;
        }
        // Accurate explanation + invitation workflow where possible.
        const reason = res?.reason ?? 'WhatsApp refused the direct add (privacy settings or group policy).';
        let link;
        try {
          link = await ctx.client.getInviteLink?.(ctx.chatJid);
        } catch {
          link = null;
        }
        await ctx.reply(
          `⚠️ Could not add ${number} directly: ${reason}\n\n` +
            (link
              ? `📩 Invitation workflow: send them this group link:\n${link}`
              : `📩 Invitation workflow: ask a group admin to share the group invite link with them.`),
        );
      },
    },
    {
      name: 'mute',
      category: 'group',
      description: 'Lock the group (admins only can send)',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_MODERATE,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_MODERATE);
        const ok = await ctx.client.setGroupAnnounce?.(ctx.chatJid, true);
        if (ok?.ok === false) {
          await ctx.reply(`⚠️ WhatsApp rejected the change: ${ok.reason ?? 'unknown'}`);
          return;
        }
        await ctx.reply('🔒 Group muted — only admins can send messages now.');
      },
    },
    {
      name: 'unmute',
      category: 'group',
      description: 'Unlock the group (everyone can send)',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_MODERATE,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_MODERATE);
        const ok = await ctx.client.setGroupAnnounce?.(ctx.chatJid, false);
        if (ok?.ok === false) {
          await ctx.reply(`⚠️ WhatsApp rejected the change: ${ok.reason ?? 'unknown'}`);
          return;
        }
        await ctx.reply('🔓 Group unmuted — everyone can send messages now.');
      },
    },

    // ── tagging & info ──────────────────────────────────────────────────
    {
      name: 'tagall',
      category: 'group',
      description: 'Mention every group member',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_TAG,
      groupOnly: true,
      cooldownMs: 60_000,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_TAG);
        const meta = await mustGroupMeta(ctx);
        const participants = meta.participants ?? [];
        const text = ctx.rest || '📢 Attention everyone!';
        const mentions = participants.map((p) => p.jid);
        const names = participants.map((p) => `@${displayJid(p.jid)}`).join(' ');
        await ctx.client.sendText(ctx.chatJid, `${text}\n\n${names}`, { mentions });
      },
    },
    {
      name: 'hidetag',
      category: 'group',
      description: 'Send a message that silently mentions everyone',
      args: '<message>',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_TAG,
      groupOnly: true,
      cooldownMs: 60_000,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_TAG);
        const meta = await mustGroupMeta(ctx);
        const mentions = (meta.participants ?? []).map((p) => p.jid);
        await ctx.client.sendText(ctx.chatJid, ctx.rest || '…', { mentions });
      },
    },
    {
      name: 'tagadmins',
      category: 'group',
      description: 'Mention the group admins',
      access: 'everyone',
      groupOnly: true,
      cooldownMs: 30_000,
      handler: async (ctx) => {
        const meta = await mustGroupMeta(ctx);
        const admins = (meta.participants ?? []).filter((p) => p.admin);
        if (admins.length === 0) {
          await ctx.reply('No admins found in this group (or the metadata is unavailable).');
          return;
        }
        const mentions = admins.map((p) => p.jid);
        await ctx.client.sendText(
          ctx.chatJid,
          `👑 Group admins:\n${admins.map((p) => `@${displayJid(p.jid)}`).join(' ')}`,
          { mentions },
        );
      },
    },
    {
      name: 'staff',
      category: 'group',
      description: 'List the group administrators',
      access: 'everyone',
      groupOnly: true,
      handler: async (ctx) => {
        const meta = await mustGroupMeta(ctx);
        const admins = (meta.participants ?? []).filter((p) => p.admin);
        const lines = [`*👑 Staff — ${meta.subject ?? 'this group'}*`];
        if (admins.length === 0) lines.push('(no admins visible)');
        for (const p of admins) {
          lines.push(`• ${displayJid(p.jid)}${p.admin === 'superadmin' ? ' (creator)' : ''}`);
        }
        await ctx.reply(lines.join('\n'));
      },
    },
    {
      name: 'groupinfo',
      aliases: ['gcinfo'],
      category: 'group',
      description: 'Show group name, description and member count',
      access: 'everyone',
      groupOnly: true,
      handler: async (ctx) => {
        const meta = await mustGroupMeta(ctx);
        const admins = (meta.participants ?? []).filter((p) => p.admin).length;
        await ctx.reply(
          [
            `*👥 Group info*`,
            `• Name: ${meta.subject ?? '(unknown)'}`,
            `• Members: ${meta.size ?? meta.participants?.length ?? '(unknown)'}`,
            `• Admins: ${admins}`,
            `• ID: ${ctx.chatJid}`,
            `• Description:`,
            meta.desc ?? '(no description)',
          ].join('\n'),
        );
      },
    },
    {
      name: 'gcstatus',
      category: 'group',
      description: "Report this group's configuration and enabled features",
      access: 'everyone',
      groupOnly: true,
      handler: async (ctx) => {
        const gc = ensureGroupConfig(ctx.services.groupsRepo, ctx.chatJid);
        const onoff = (b) => (b ? '✅ on' : '⬜ off');
        await ctx.reply(
          [
            `*📋 Group status — this chat only*`,
            `ID: ${ctx.chatJid}`,
            '',
            `*Features (per-group)*`,
            `• Welcome: ${onoff(gc.welcome.enabled)}`,
            `• Goodbye: ${onoff(gc.goodbye.enabled)}`,
            `• Anti-link: ${onoff(gc.antiLink.enabled)}${gc.antiLink.enabled ? ` — action: ${gc.antiLink.action}` : ''}`,
            `   allowlist: ${gc.antiLink.allowDomains.join(', ') || '(none)'} | admin-exempt: ${gc.antiLink.exemptAdmins ? 'yes' : 'no'} | user-exempt: ${gc.antiLink.exemptUsers.length}`,
            `• Anti-tag: ${onoff(gc.antiTag.enabled)}${gc.antiTag.enabled ? ` — limit ${gc.antiTag.limit}, response: ${gc.antiTag.response}` : ''}`,
            `• Anti-bad-word: ${onoff(gc.antiBadWord.enabled)}${gc.antiBadWord.enabled ? ` — ${gc.antiBadWord.words.length} word(s), response: ${gc.antiBadWord.response}` : ''}`,
            `• Anti-delete: ${onoff(gc.antiDelete.enabled)}`,
            `• Slowmode: ${onoff(gc.slowmode.enabled)}${gc.slowmode.enabled ? ` — ${gc.slowmode.seconds}s` : ''}`,
            `• Warnings: threshold ${gc.warnings.threshold}, action on threshold: ${gc.warnings.actionOnThreshold}`,
            `• Moderation log entries: ${gc.moderationLog.length}`,
            '',
            `_Everything above belongs to THIS group only. Global settings (prefix, mode) are shown in .settings._`,
          ].join('\n'),
        );
      },
    },
    {
      name: 'jid',
      category: 'group',
      description: 'Show the relevant chat / participant identifier',
      access: 'everyone',
      handler: async (ctx) => {
        const target = targetJidFromCtx(ctx, { required: false });
        if (target) {
          await ctx.reply(`👤 User JID: ${target}`);
          return;
        }
        await ctx.reply(`💬 Chat JID: ${ctx.chatJid}`);
      },
    },

    // ── group settings ──────────────────────────────────────────────────
    {
      name: 'setname',
      category: 'group',
      description: 'Change the group name',
      args: '<text>',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_CONFIG,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_CONFIG);
        const text = validateText(ctx.rest, { min: 1, max: 100, label: 'Group name' });
        const ok = await ctx.client.setGroupSubject?.(ctx.chatJid, text);
        if (ok?.ok === false) {
          await ctx.reply(`⚠️ WhatsApp rejected the change: ${ok.reason ?? 'unknown'}`);
          return;
        }
        await ctx.reply(`✅ Group name set to *${text}*.`);
      },
    },
    {
      name: 'setdesc',
      category: 'group',
      description: 'Change the group description',
      args: '<text>',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_CONFIG,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_CONFIG);
        const text = validateText(ctx.rest, { min: 1, max: 512, label: 'Description' });
        const ok = await ctx.client.setGroupDescription?.(ctx.chatJid, text);
        if (ok?.ok === false) {
          await ctx.reply(`⚠️ WhatsApp rejected the change: ${ok.reason ?? 'unknown'}`);
          return;
        }
        await ctx.reply('✅ Group description updated.');
      },
    },
    {
      name: 'revoke',
      aliases: ['revokeinvite'],
      category: 'group',
      description: 'Reset the group invite link (requires .confirm)',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_CONFIG,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_CONFIG);
        ctx.requireConfirmation(
          'revoke-link',
          '🔗 Reset the group invite link? The current link will stop working.\nType `.confirm` within 60 seconds to proceed, or `.cancel`.',
          { chatJid: ctx.chatJid },
        );
      },
    },
    {
      name: 'leavegc',
      aliases: ['leave'],
      category: 'group',
      description: 'Bot leaves this group (owner only, requires .confirm)',
      access: 'owner',
      groupOnly: true,
      handler: async (ctx) => {
        ctx.requireConfirmation(
          'leave-group',
          `👋 Make the bot leave *this* group?\nType \`.confirm\` within 60 seconds to proceed, or \`.cancel\`.`,
          { chatJid: ctx.chatJid },
        );
      },
    },
    {
      name: 'warn',
      category: 'security',
      description: 'Warn a member (counted toward the group threshold)',
      args: '@user [reason]',
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.SECURITY_MANAGE);
        const target = targetJidFromCtx(ctx);
        const reason = ctx.rest.replace(/^\S+\s*/, '').trim() || null;
        const gc = ensureGroupConfig(ctx.services.groupsRepo, ctx.chatJid);
        const state = ctx.services.warnings.add(ctx.chatJid, target, { reason, by: ctx.senderJid });
        const { reached, action, threshold } = ctx.services.warnings.thresholdReached(gc, state);
        await ctx.reply(
          `⚠️ Warned @${displayJid(target)} — active warnings: ${state.active}/${threshold}` +
            (reason ? `\nReason: ${reason}` : '') +
            (reached
              ? action === 'kick'
                ? `\n🚨 Threshold reached — configured action: removal.`
                : `\n⚠️ Threshold reached (no automatic action configured).`
              : ''),
        );
        if (reached && action === 'kick') {
          ctx.requireConfirmation(
            'escalation-kick',
            `🚨 @${displayJid(target)} reached the warning threshold and this group is configured to remove on threshold.\nType \`.confirm\` within 60 seconds to remove them, or \`.cancel\`.`,
            { target, chatJid: ctx.chatJid },
          );
        }
      },
    },
    {
      name: 'warnings',
      category: 'security',
      description: "Show a member's warnings",
      args: '@user',
      access: 'everyone',
      groupOnly: true,
      handler: async (ctx) => {
        const target = targetJidFromCtx(ctx);
        const state = ctx.services.warnings.state(ctx.chatJid, target);
        const gc = ensureGroupConfig(ctx.services.groupsRepo, ctx.chatJid);
        const lines = [`*⚠️ Warnings for ${displayJid(target)}*`, `Active: ${state.active}/${gc.warnings.threshold}`];
        const activeHist = state.history.slice(-5);
        if (activeHist.length) {
          lines.push('Recent history:');
          for (const h of activeHist) {
            lines.push(`• ${new Date(h.ts).toISOString().slice(0, 10)}${h.reason ? ` — ${h.reason}` : ''}${h.active ? ' [active]' : ''}`);
          }
        }
        await ctx.reply(lines.join('\n'));
      },
    },
    {
      name: 'delwarn',
      category: 'security',
      description: 'Remove one active warning (history is kept)',
      args: '@user',
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.SECURITY_MANAGE);
        const target = targetJidFromCtx(ctx);
        const removed = ctx.services.warnings.removeOne(ctx.chatJid, target);
        const state = ctx.services.warnings.state(ctx.chatJid, target);
        await ctx.reply(
          removed
            ? `✅ Removed one warning from ${displayJid(target)}. Active: ${state.active} (history retained).`
            : `${displayJid(target)} has no active warnings.`,
        );
      },
    },
    {
      name: 'resetwarn',
      category: 'security',
      description: 'Reset active warnings to 0 (history is kept)',
      args: '@user',
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.SECURITY_MANAGE);
        const target = targetJidFromCtx(ctx);
        ctx.services.warnings.reset(ctx.chatJid, target);
        await ctx.reply(`✅ Reset active warnings for ${displayJid(target)} to 0. History has been retained.`);
      },
    },
    {
      name: 'slowmode',
      category: 'group',
      description: 'Set group slow mode (WhatsApp native where available)',
      args: '<seconds|off>',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_MODERATE,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_MODERATE);
        const arg = (ctx.args[0] ?? '').toLowerCase();
        const gc = ensureGroupConfig(ctx.services.groupsRepo, ctx.chatJid);
        if (arg === 'off' || arg === '0') {
          const ok = await ctx.client.setGroupSlowMode?.(ctx.chatJid, 0);
          if (ok?.ok === false) {
            await ctx.reply(`⚠️ WhatsApp rejected the change: ${ok.reason ?? 'unsupported on this group'}`);
            return;
          }
          updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
            c.slowmode = { enabled: false, seconds: 0 };
            return c;
          });
          await ctx.reply('🐢 Slowmode disabled.');
          return;
        }
        const seconds = Number(arg);
        if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}slowmode <seconds|off>\nSupported values depend on WhatsApp (e.g. 10s, 30s, 60s, 5m, 15m, 30m, 1h, 4h, 24h).`);
          return;
        }
        const ok = await ctx.client.setGroupSlowMode?.(ctx.chatJid, seconds);
        if (ok?.ok === false) {
          await ctx.reply(
            `⚠️ WhatsApp rejected slowmode: ${ok.reason ?? 'unsupported'}\n` +
              'Note: bot-side command cooldowns are *not* native WhatsApp slowmode.',
          );
          return;
        }
        updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
          c.slowmode = { enabled: seconds > 0, seconds };
          return c;
        });
        await ctx.reply(`🐢 Slowmode set to ${seconds}s (WhatsApp native).`);
      },
    },
    {
      name: 'lock',
      category: 'group',
      description: 'Alias of .mute — lock group to admins only',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_MODERATE,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_MODERATE);
        const ok = await ctx.client.setGroupAnnounce?.(ctx.chatJid, true);
        if (ok?.ok === false) {
          await ctx.reply(`⚠️ WhatsApp rejected the change: ${ok.reason ?? 'unknown'}`);
          return;
        }
        await ctx.reply('🔒 Group locked — admins only.');
      },
    },
    {
      name: 'unlock',
      category: 'group',
      description: 'Alias of .unmute — open group to everyone',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_MODERATE,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_MODERATE);
        const ok = await ctx.client.setGroupAnnounce?.(ctx.chatJid, false);
        if (ok?.ok === false) {
          await ctx.reply(`⚠️ WhatsApp rejected the change: ${ok.reason ?? 'unknown'}`);
          return;
        }
        await ctx.reply('🔓 Group unlocked.');
      },
    },
    {
      name: 'modlog',
      category: 'security',
      description: "Show this group's recent moderation log",
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      handler: async (ctx) => {
        const gc = ensureGroupConfig(ctx.services.groupsRepo, ctx.chatJid);
        const entries = gc.moderationLog.slice(-10);
        if (entries.length === 0) {
          await ctx.reply('Moderation log is empty for this group.');
          return;
        }
        const lines = ['*🧾 Moderation log (last 10)*'];
        for (const e of entries) {
          lines.push(
            `• ${new Date(e.ts).toISOString().slice(0, 19).replace('T', ' ')} — ${e.type} → ${e.action} (${e.outcome})${e.user ? ` @${displayJid(e.user)}` : ''}`,
          );
        }
        await ctx.reply(lines.join('\n'));
      },
    },
    {
      name: 'testwelcome',
      category: 'automation',
      description: 'Preview this group’s welcome message',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_WELCOME,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_WELCOME);
        const gc = ensureGroupConfig(ctx.services.groupsRepo, ctx.chatJid);
        const meta = await mustGroupMeta(ctx);
        const { text, missing } = ctx.services.renderTemplate(gc.welcome.text, {
          user: `@${displayJid(ctx.senderJid)}`,
          group: meta.subject ?? 'this group',
        });
        await ctx.reply(`*Welcome preview* (currently ${gc.welcome.enabled ? 'ON' : 'OFF'}):\n\n${text}` +
          (missing.length ? `\n\n⚠️ Unfilled placeholders: ${missing.map((m) => `{${m}}`).join(', ')}` : ''),
        { mentions: [ctx.senderJid] });
      },
    },
    {
      name: 'testgoodbye',
      category: 'automation',
      description: 'Preview this group’s goodbye message',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_WELCOME,
      groupOnly: true,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.GROUP_WELCOME);
        const gc = ensureGroupConfig(ctx.services.groupsRepo, ctx.chatJid);
        const meta = await mustGroupMeta(ctx);
        const { text, missing } = ctx.services.renderTemplate(gc.goodbye.text, {
          user: `@${displayJid(ctx.senderJid)}`,
          group: meta.subject ?? 'this group',
        });
        await ctx.reply(`*Goodbye preview* (currently ${gc.goodbye.enabled ? 'ON' : 'OFF'}):\n\n${text}` +
          (missing.length ? `\n\n⚠️ Unfilled placeholders: ${missing.map((m) => `{${m}}`).join(', ')}` : ''),
        { mentions: [ctx.senderJid] });
      },
    },
    {
      name: 'antidelete',
      category: 'security',
      description: 'Toggle anti-delete for this group (observed messages only)',
      args: '<on|off>',
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      status: COMMAND_STATUS.PARTIAL,
      handler: async (ctx) => {
        await requireGroupAdminOrCapability(ctx, CAPABILITIES.SECURITY_MANAGE);
        const arg = (ctx.args[0] ?? '').toLowerCase();
        if (!['on', 'off'].includes(arg)) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}antidelete <on|off>\nLimit: only messages the bot actually received can be reposted.`);
          return;
        }
        updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
          c.antiDelete.enabled = arg === 'on';
          return c;
        });
        await ctx.reply(
          arg === 'on'
            ? '🛡️ Anti-delete *on* for this group.\nNote: only messages the bot received can be recovered, and recovered content stays in this chat.'
            : 'Anti-delete *off* for this group.',
        );
      },
    },
  ]);
}

// ── helpers ─────────────────────────────────────────────────────────────

async function requireGroupAdminOrCapability(ctx, capability) {
  // Router already enforced access; this is defense-in-depth for group actions.
  const isAdmin = await ctx.client.isGroupAdmin(ctx.chatJid, ctx.senderJid);
  if (isAdmin) return true;
  if (ctx.permissions.isOwnerOrSelf(ctx.senderJid, ctx.botJid)) return true;
  if (ctx.permissions.hasCapability(ctx.senderJid, capability)) return true;
  throw new ValidationError('This command requires group admin rights or the matching sudo capability.');
}

async function mustGroupMeta(ctx) {
  const meta = await ctx.client.groupMetadata(ctx.chatJid);
  if (!meta) throw new WhatsAppActionError('Could not fetch group metadata from WhatsApp.');
  return meta;
}

async function guardSelfTarget(ctx, target) {
  if (target === ctx.botJid) throw new ValidationError('I cannot target myself.');
  if (target === ctx.senderJid) throw new ValidationError('You cannot target yourself with this command.');
}
