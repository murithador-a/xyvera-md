/**
 * Bot information commands: menu, help, owner, ping, alive, uptime, github,
 * commands (registry status). All runtime values are measured, never hardcoded.
 */

import { buildMenu, buildCommandStatusList, formatUptime } from '../menu.js';
import { COMMAND_STATUS } from '../../config/defaults.js';
import { requireOwnerConfigured } from '../common.js';

const startedAt = Date.now();

export default function registerInfoCommands(registry, deps) {
  const { getConfig } = deps;

  registry.registerAll([
    {
      name: 'menu',
      aliases: ['help', 'list'],
      category: 'info',
      description: 'Show the full command menu',
      access: 'everyone',
      handler: async (ctx) => {
        const cfg = getConfig();
        // Response latency measured from the user's message timestamp to reply
        // construction (honest approximation of end-to-end response time).
        const latency = ctx.msg.timestamp ? Date.now() - Number(ctx.msg.timestamp) : null;
        const menu = buildMenu({
          registry: ctx.services.registry,
          botName: cfg.botName,
          version: cfg.version,
          ownerName: cfg.ownerName,
          mode: ctx.permissions.getMode(),
          prefix: cfg.prefix,
          uptimeMs: Date.now() - startedAt,
          latencyMs: latency !== null && latency >= 0 ? latency : null,
        });
        await ctx.reply(menu);
      },
    },
    {
      name: 'commands',
      category: 'info',
      description: 'List every command with its real implementation status',
      access: 'everyone',
      handler: async (ctx) => {
        await ctx.reply(buildCommandStatusList(ctx.services.registry, getConfig().prefix));
      },
    },
    {
      name: 'ping',
      aliases: ['p'],
      category: 'info',
      description: 'Measure bot response latency',
      access: 'everyone',
      handler: async (ctx) => {
        const t0 = Date.now();
        await ctx.reply(`🏓 Pong! ${Date.now() - t0}ms`);
      },
    },
    {
      name: 'alive',
      category: 'info',
      description: 'Check that the bot is running',
      access: 'everyone',
      handler: async (ctx) => {
        const cfg = getConfig();
        await ctx.reply(
          `*${cfg.botName}* is alive ✅\nVersion: v${cfg.version}\nUptime: ${formatUptime(Date.now() - startedAt)}`,
        );
      },
    },
    {
      name: 'uptime',
      category: 'info',
      description: 'Show how long the bot has been running',
      access: 'everyone',
      handler: async (ctx) => {
        await ctx.reply(`⏱ Uptime: ${formatUptime(Date.now() - startedAt)}`);
      },
    },
    {
      name: 'owner',
      category: 'info',
      description: 'Show bot owner contact information',
      access: 'everyone',
      handler: async (ctx) => {
        const cfg = getConfig();
        const owners = ctx.permissions.ownerJids();
        const lines = [`*${cfg.botName}* — owner information`];
        if (owners.length === 0) {
          lines.push('No owner configured yet. The operator must set OWNER_NUMBERS in .env.');
        } else {
          lines.push(`👤 ${cfg.ownerName}`);
          for (const jid of owners) lines.push(`📞 wa.me/${jid.split('@')[0]}`);
        }
        if (cfg.githubUrl) lines.push(`🐙 ${cfg.githubUrl}`);
        if (cfg.projectUrl) lines.push(`🔗 ${cfg.projectUrl}`);
        await ctx.reply(lines.join('\n'));
      },
    },
    {
      name: 'github',
      category: 'info',
      description: 'Show the project GitHub link',
      access: 'everyone',
      handler: async (ctx) => {
        const cfg = getConfig();
        await ctx.reply(
          cfg.githubUrl
            ? `🐙 ${cfg.githubUrl}`
            : 'No GitHub URL configured yet. Set GITHUB_URL in .env.',
        );
      },
    },
    {
      name: 'setbotname',
      category: 'info',
      description: 'Set the bot display name',
      args: '<text>',
      access: 'sudo',
      capability: 'bot.settings',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        const text = ctx.rest.trim();
        if (!text) {
          await ctx.reply('Usage: .setbotname <text>');
          return;
        }
        ctx.services.updateSettings((s) => ({ ...s, botName: text }));
        await ctx.reply(`✅ Bot name set to *${text}*.`);
      },
    },
    {
      name: 'vv',
      aliases: ['vv2'],
      category: 'media',
      description: 'Why view-once media cannot be revealed (privacy policy)',
      access: 'everyone',
      handler: async (ctx) => {
        await ctx.reply(
          [
            '*View-once media — privacy policy* 🔒',
            '',
            'Xyvera MD will *not* bypass WhatsApp view-once protections. That is a privacy boundary, not a missing feature.',
            '',
            'What you can do instead:',
            '• Ask the sender to share the media normally (not view-once).',
            '• If you are in the chat when it is sent, view it in WhatsApp directly.',
            '',
            'Commands .vv / .vv2 exist only to explain this policy.',
          ].join('\n'),
        );
      },
    },
    {
      name: 'ghost',
      category: 'utilities',
      description: 'Reserved — behavior not defined yet',
      access: 'everyone',
      status: COMMAND_STATUS.PENDING,
      handler: async () => {},
    },
    {
      name: 'ownerconfig',
      category: 'info',
      description: 'Check whether owner identity is configured',
      access: 'everyone',
      handler: async (ctx) => {
        requireOwnerConfigured(ctx);
        await ctx.reply('✅ Owner is configured. Owner-only commands are available.');
      },
    },
  ]);
}
