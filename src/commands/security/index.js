/**
 * Security configuration commands: anti-link, anti-tag, anti-bad-word.
 *
 * Anti-link actions are stored as NAMED values. Numeric aliases (1–4) map to
 * the approved names (docs/REQUIREMENTS.md §2.1) and are only convenience —
 * group config never stores numeric meanings.
 */

import {
  CAPABILITIES,
  ANTI_LINK_ACTION_LIST,
  PROPOSED_NUMERIC_ACTION_ALIASES,
  NUMERIC_ACTION_ALIASES_APPROVED,
} from '../../config/defaults.js';
import { ValidationError } from '../../utils/errors.js';
import { extractDomain, normalizeJid } from './helpers.js';
import { ensureGroupConfig, updateGroupConfig, displayJid } from '../common.js';

export default function registerSecurityCommands(registry, deps) {
  registry.registerAll([
    {
      name: 'antilink',
      category: 'security',
      description: 'Anti-link: on|off|action <name> — per-group',
      args: '<on|off|action <name>>',
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      handler: async (ctx) => {
        const sub = (ctx.args[0] ?? '').toLowerCase();
        if (sub === 'on' || sub === 'off') {
          updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
            c.antiLink.enabled = sub === 'on';
            return c;
          });
          const gc = ensureGroupConfig(ctx.services.groupsRepo, ctx.chatJid);
          await ctx.reply(
            `🔗 Anti-link *${sub === 'on' ? 'ON' : 'OFF'}* for this group.\n` +
              `Action on violation: \`${gc.antiLink.action}\`\n` +
              `Admins exempt: ${gc.antiLink.exemptAdmins ? 'yes' : 'no'} | Allowed domains: ${gc.antiLink.allowDomains.join(', ') || '(none)'}`,
          );
          return;
        }
        if (sub === 'action') {
          const value = (ctx.args[1] ?? '').toLowerCase();
          if (!value) {
            await ctx.reply(actionHelp(ctx));
            return;
          }
          if (/^\d+$/.test(value)) {
            if (!NUMERIC_ACTION_ALIASES_APPROVED) {
              await ctx.reply(
                [
                  '⏳ *Numeric action aliases are pending owner approval.*',
                  '',
                  'Proposed mapping (not yet in effect):',
                  '1 → delete   2 → delete-warn   3 → delete-kick   4 → escalate',
                  '',
                  'Until approved, use named actions:',
                  `• ${ANTI_LINK_ACTION_LIST.join('\n• ')}`,
                ].join('\n'),
              );
              return;
            }
            const named = PROPOSED_NUMERIC_ACTION_ALIASES[value];
            if (!named) throw new ValidationError('Unknown numeric alias — valid: 1, 2, 3, 4.');
            setAntiLinkAction(ctx, named);
            return;
          }
          if (!ANTI_LINK_ACTION_LIST.includes(value)) {
            throw new ValidationError(`Unknown action. Valid: ${ANTI_LINK_ACTION_LIST.join(', ')}.`);
          }
          setAntiLinkAction(ctx, value);
          return;
        }
        await ctx.reply(actionHelp(ctx));
      },
    },
    {
      name: 'allowlink',
      category: 'security',
      description: 'Allow a domain in this group’s anti-link filter',
      args: '<domain>',
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      handler: async (ctx) => {
        const domain = extractDomain(ctx.args[0] ?? '');
        if (!domain) throw new ValidationError('Provide a domain, e.g. .allowlink example.com');
        updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
          c.antiLink.allowDomains = [...new Set([...c.antiLink.allowDomains, domain])];
          return c;
        });
        await ctx.reply(`✅ ${domain} is now allowed in this group.`);
      },
    },
    {
      name: 'dellink',
      aliases: ['disallowlink'],
      category: 'security',
      description: 'Remove a domain from this group’s allowlist',
      args: '<domain>',
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      handler: async (ctx) => {
        const domain = extractDomain(ctx.args[0] ?? '');
        if (!domain) throw new ValidationError('Provide a domain, e.g. .dellink example.com');
        updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
          c.antiLink.allowDomains = c.antiLink.allowDomains.filter((d) => d !== domain);
          return c;
        });
        await ctx.reply(`✅ ${domain} removed from this group's allowlist.`);
      },
    },
    {
      name: 'exempt',
      aliases: ['exemptuser'],
      category: 'security',
      description: 'Exempt a user from anti-link enforcement',
      args: '@user',
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      handler: async (ctx) => {
        const target = firstTarget(ctx);
        updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
          c.antiLink.exemptUsers = [...new Set([...c.antiLink.exemptUsers, target])];
          return c;
        });
        await ctx.reply(`✅ ${displayJid(target)} is now exempt from anti-link.`);
      },
    },
    {
      name: 'unexempt',
      category: 'security',
      description: 'Remove a user’s anti-link exemption',
      args: '@user',
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      handler: async (ctx) => {
        const target = firstTarget(ctx);
        updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
          c.antiLink.exemptUsers = c.antiLink.exemptUsers.filter((j) => j !== target);
          return c;
        });
        await ctx.reply(`✅ Removed anti-link exemption for ${displayJid(target)}.`);
      },
    },
    {
      name: 'antitag',
      category: 'security',
      description: 'Anti-tag: on|off|limit <n> — per-group',
      args: '<on|off|limit <n>>',
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      handler: async (ctx) => {
        const sub = (ctx.args[0] ?? '').toLowerCase();
        if (sub === 'on' || sub === 'off') {
          updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
            c.antiTag.enabled = sub === 'on';
            return c;
          });
          const gc = ensureGroupConfig(ctx.services.groupsRepo, ctx.chatJid);
          await ctx.reply(
            `🏷️ Anti-tag *${sub === 'on' ? 'ON' : 'OFF'}* for this group.\nLimit: ${gc.antiTag.limit} mentions/message | Response: ${gc.antiTag.response} | Admins exempt: ${gc.antiTag.exemptAdmins ? 'yes' : 'no'}`,
          );
          return;
        }
        if (sub === 'limit') {
          const n = Number(ctx.args[1]);
          if (!Number.isInteger(n) || n < 1 || n > 200) {
            throw new ValidationError('Limit must be an integer between 1 and 200.');
          }
          updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
            c.antiTag.limit = n;
            return c;
          });
          await ctx.reply(`✅ Anti-tag limit set to ${n} unique mentions per message.`);
          return;
        }
        await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}antitag <on|off|limit <n>>`);
      },
    },
    {
      name: 'antibadword',
      category: 'security',
      description: 'Anti-bad-word: on|off — per-group word list',
      args: '<on|off>',
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      handler: async (ctx) => {
        const sub = (ctx.args[0] ?? '').toLowerCase();
        if (!['on', 'off'].includes(sub)) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}antibadword <on|off>`);
          return;
        }
        updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
          c.antiBadWord.enabled = sub === 'on';
          return c;
        });
        const gc = ensureGroupConfig(ctx.services.groupsRepo, ctx.chatJid);
        await ctx.reply(
          `🚫 Anti-bad-word *${sub === 'on' ? 'ON' : 'OFF'}* for this group.\nWords: ${gc.antiBadWord.words.length} | Response: ${gc.antiBadWord.response}\nManage with .addbadword / .delbadword.`,
        );
      },
    },
    {
      name: 'addbadword',
      category: 'security',
      description: 'Add a word to this group’s bad-word list',
      args: '<word>',
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      handler: async (ctx) => {
        const word = (ctx.rest ?? '').toLowerCase().trim();
        if (!word || word.length > 40) throw new ValidationError('Provide one word/phrase (max 40 chars).');
        updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
          c.antiBadWord.words = [...new Set([...c.antiBadWord.words, word])];
          return c;
        });
        await ctx.reply(`✅ Added "${word}" to this group's bad-word list.`);
      },
    },
    {
      name: 'delbadword',
      category: 'security',
      description: 'Remove a word from this group’s bad-word list',
      args: '<word>',
      access: 'group-admin',
      capability: CAPABILITIES.SECURITY_MANAGE,
      groupOnly: true,
      handler: async (ctx) => {
        const word = (ctx.rest ?? '').toLowerCase().trim();
        if (!word) throw new ValidationError('Provide the word to remove.');
        updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
          c.antiBadWord.words = c.antiBadWord.words.filter((w) => w !== word);
          return c;
        });
        await ctx.reply(`✅ Removed "${word}" from this group's bad-word list.`);
      },
    },
    {
      name: 'antilink-actions',
      category: 'security',
      description: 'Explain the anti-link action values (incl. pending numeric aliases)',
      access: 'everyone',
      handler: async (ctx) => {
        await ctx.reply(actionHelp(ctx));
      },
    },
  ]);
}

function setAntiLinkAction(ctx, action) {
  updateGroupConfig(ctx.services.groupsRepo, ctx.chatJid, (c) => {
    c.antiLink.action = action;
    return c;
  });
  ctx.reply(`✅ Anti-link action set to \`${action}\` for this group.`);
}

function actionHelp(ctx) {
  const prefix = ctx.services.config?.prefix ?? '.';
  return [
    '*Anti-link actions* (named values are final; numbers are aliases):',
    '• `delete` (1) — delete the violating message',
    '• `delete-warn` (2) — delete + warn (counts toward warning threshold)',
    '• `delete-kick` (3) — delete + remove the sender',
    '• `escalate` (4) — delete + warn; remove only when this group configured warning escalation',
    '',
    `Set with: ${prefix}antilink action <name|1-4>`,
  ].join('\n');
}

function firstTarget(ctx) {
  const mentions = ctx.msg.mentions ?? [];
  if (mentions.length > 0) return normalizeJid(mentions[0]);
  if (ctx.msg.quoted?.senderJid) return normalizeJid(ctx.msg.quoted.senderJid);
  const arg = ctx.args[0];
  if (arg && /^\d{5,20}$/.test(arg.replace(/[^\d]/g, ''))) {
    return `${arg.replace(/[^\d]/g, '')}@s.whatsapp.net`;
  }
  throw new ValidationError('Provide a user by mention, reply, or number.');
}
