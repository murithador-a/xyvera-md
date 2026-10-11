/**
 * Automation: per-group welcome/goodbye + global status auto-view/auto-react.
 * Welcome and goodbye are independently switchable per group; goodbye defaults
 * OFF and welcome defaults OFF (safe documented default, REQUIREMENTS §2.2).
 */

import { CAPABILITIES, COMMAND_STATUS } from '../../config/defaults.js';
import { ValidationError } from '../../utils/errors.js';
import { validateText, validateEmoji } from '../../utils/validators.js';
import { ensureGroupConfig, updateGroupConfig } from '../common.js';
import { renderTemplate, KNOWN_PLACEHOLDERS } from '../../utils/templates.js';

export default function registerAutomationCommands(registry, deps) {
  registry.registerAll([
    {
      name: 'welcome',
      category: 'automation',
      description: 'Toggle welcome messages for this group',
      args: '<on|off>',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_WELCOME,
      groupOnly: true,
      handler: async (ctx) => toggleGreeting(ctx, 'welcome'),
    },
    {
      name: 'goodbye',
      category: 'automation',
      description: 'Toggle goodbye messages for this group',
      args: '<on|off>',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_WELCOME,
      groupOnly: true,
      handler: async (ctx) => toggleGreeting(ctx, 'goodbye'),
    },
    {
      name: 'setwelcome',
      category: 'automation',
      description: 'Set this group’s welcome text (placeholders: {user} {group})',
      args: '<text>',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_WELCOME,
      groupOnly: true,
      handler: async (ctx) => setGreetingText(ctx, 'welcome'),
    },
    {
      name: 'setgoodbye',
      category: 'automation',
      description: 'Set this group’s goodbye text (placeholders: {user} {group})',
      args: '<text>',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_WELCOME,
      groupOnly: true,
      handler: async (ctx) => setGreetingText(ctx, 'goodbye'),
    },
    {
      name: 'setwelcomepp',
      category: 'automation',
      description: 'Attach an image to welcome messages (reply to an image)',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_WELCOME,
      groupOnly: true,
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => setGreetingMedia(ctx, 'welcome'),
    },
    {
      name: 'setgoodbyepp',
      category: 'automation',
      description: 'Attach an image to goodbye messages (reply to an image)',
      access: 'group-admin',
      capability: CAPABILITIES.GROUP_WELCOME,
      groupOnly: true,
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => setGreetingMedia(ctx, 'goodbye'),
    },
    {
      name: 'autoview',
      category: 'automation',
      description: 'Auto-view WhatsApp statuses (global)',
      args: '<on|off>',
      access: 'sudo',
      capability: CAPABILITIES.STATUS_AUTOMATION,
      handler: async (ctx) => {
        const sub = (ctx.args[0] ?? '').toLowerCase();
        if (!['on', 'off'].includes(sub)) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}autoview <on|off>\nThis is a global automation setting.`);
          return;
        }
        const on = sub === 'on';
        ctx.services.statusAutomation.setAutoview(on);
        await ctx.reply(
          `👀 Status auto-view *${on ? 'ON' : 'OFF'}* (global).\n` +
            'Note: viewing is processed with rate limits; library/WhatsApp limits apply.',
        );
      },
    },
    {
      name: 'autoreact',
      category: 'automation',
      description: 'Auto-react to WhatsApp statuses (global)',
      args: '<on|off> [emoji]',
      access: 'sudo',
      capability: CAPABILITIES.STATUS_AUTOMATION,
      handler: async (ctx) => {
        const sub = (ctx.args[0] ?? '').toLowerCase();
        if (!['on', 'off'].includes(sub)) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}autoreact <on|off> [emoji]`);
          return;
        }
        let emoji = null;
        if (ctx.args[1]) emoji = validateEmoji(ctx.args[1]);
        const res = ctx.services.statusAutomation.setAutoreact(sub === 'on', emoji);
        await ctx.reply(
          `💬 Status auto-react *${res.autoreact ? 'ON' : 'OFF'}* (global) — emoji: ${res.emoji}\n` +
            'Note: reactions are rate-limited and sent only for statuses the bot receives.',
        );
      },
    },
    {
      name: 'greetingvars',
      category: 'automation',
      description: 'List placeholders available in welcome/goodbye texts',
      access: 'everyone',
      handler: async (ctx) => {
        await ctx.reply(
          `Available placeholders: ${KNOWN_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}\n` +
            '• {user} — mentions the joining/leaving member\n• {group} — the group name\n' +
            'Use {{ and }} for literal braces.',
        );
      },
    },
  ]);
}

function toggleGreeting(ctx, kind) {
  const sub = (ctx.args[0] ?? '').toLowerCase();
  if (!['on', 'off'].includes(sub)) {
    throw new ValidationError(`Usage: ${ctx.services.config?.prefix ?? '.'}${kind} <on|off>`);
  }
  updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
    c[kind].enabled = sub === 'on';
    return c;
  });
  const gc = ensureGroupConfig(ctx.services.groupsRepo, ctx.chatJid);
  ctx.reply(
    `${kind === 'welcome' ? '👋 Welcome' : '👋 Goodbye'} messages *${sub === 'on' ? 'ON' : 'OFF'}* for this group only.\n` +
      `Text: “${gc[kind].text}”`,
  );
}

function setGreetingText(ctx, kind) {
  const text = validateText(ctx.rest, { min: 1, max: 1000, label: `${kind} text` });
  updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
    c[kind].text = text;
    return c;
  });
  const preview = renderTemplate(text, { user: '@user', group: 'Group' });
  ctx.reply(
    `✅ ${kind === 'welcome' ? 'Welcome' : 'Goodbye'} text saved for this group:\n\n${preview.text}` +
      (preview.missing.length ? `\n\n⚠️ Unknown placeholders: ${preview.missing.join(', ')}` : ''),
  );
}

async function setGreetingMedia(ctx, kind) {
  const quoted = ctx.msg.quoted;
  if (!quoted?.hasMedia && !ctx.msg.hasMedia) {
    await ctx.reply(`Reply to an image with ${ctx.services.config?.prefix ?? '.'}set${kind}pp.`);
    return;
  }
  const saved = await ctx.client.saveMediaFile?.(quoted ?? ctx.msg, `${kind}-${ctx.chatJid}`);
  if (!saved?.ok) {
    await ctx.reply(`⚠️ Could not save the media: ${saved?.reason ?? 'unsupported in this environment'}`);
    return;
  }
  updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
    c[kind].mediaPath = saved.path;
    return c;
  });
  await ctx.reply(`✅ ${kind === 'welcome' ? 'Welcome' : 'Goodbye'} image saved for this group.`);
}
