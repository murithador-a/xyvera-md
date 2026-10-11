/**
 * AI commands. Every provider-backed feature reports "not configured" with
 * the exact env var to set — never a fake success. See docs/REQUIREMENTS.md §1.13
 * and docs/LIMITATIONS.md for provider policy.
 */

import { COMMAND_STATUS } from '../../config/defaults.js';
import { NotConfiguredError } from '../../utils/errors.js';

export default function registerAiCommands(registry, deps) {
  const { getEnv } = deps;

  registry.registerAll([
    {
      name: 'ai',
      aliases: ['chat', 'ask'],
      category: 'ai',
      description: 'Talk to an AI assistant (requires AI_API_KEY)',
      args: '<prompt>',
      access: 'everyone',
      status: COMMAND_STATUS.STUB,
      handler: async (ctx) => {
        const env = getEnv();
        if (!env.AI_API_KEY || !env.AI_API_URL) {
          throw new NotConfiguredError('.ai', 'AI_API_KEY (and AI_API_URL)');
        }
        if (!ctx.rest) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}ai <prompt>`);
          return;
        }
        // Provider adapter call goes here (services/aiProvider.js) once a
        // provider is selected and documented. Not implemented yet — reported
        // honestly rather than returning a fabricated answer.
        await ctx.reply(
          '🔧 An AI provider is configured, but the provider adapter is not implemented in this phase yet.',
        );
      },
    },
    {
      name: 'imagine',
      category: 'ai',
      description: 'Generate an image from a prompt (requires IMAGINE_API_KEY)',
      args: '<prompt>',
      access: 'everyone',
      status: COMMAND_STATUS.STUB,
      handler: async (ctx) => {
        const env = getEnv();
        if (!env.IMAGINE_API_KEY || !env.IMAGINE_API_URL) {
          throw new NotConfiguredError('.imagine', 'IMAGINE_API_KEY (and IMAGINE_API_URL)');
        }
        await ctx.reply('🔧 The image-generation adapter is not implemented in this phase yet.');
      },
    },
    {
      name: 'translate',
      category: 'ai',
      description: 'Translate text (requires TRANSLATE_API_KEY)',
      args: '[lang] <text>',
      access: 'everyone',
      status: COMMAND_STATUS.STUB,
      handler: async (ctx) => {
        const env = getEnv();
        if (!env.TRANSLATE_API_KEY) {
          throw new NotConfiguredError('.translate', 'TRANSLATE_API_KEY');
        }
        await ctx.reply('🔧 The translation adapter is not implemented in this phase yet.');
      },
    },
    {
      name: 'weather',
      category: 'utilities',
      description: 'Weather for a city (requires WEATHER_API_KEY)',
      args: '<city>',
      access: 'everyone',
      status: COMMAND_STATUS.STUB,
      handler: async (ctx) => {
        const env = getEnv();
        if (!env.WEATHER_API_KEY) {
          throw new NotConfiguredError('.weather', 'WEATHER_API_KEY');
        }
        await ctx.reply('🔧 The weather adapter is not implemented in this phase yet.');
      },
    },
    {
      name: 'currency',
      category: 'utilities',
      description: 'Convert currency (requires CURRENCY_API_KEY)',
      args: '<amount> <from> <to>',
      access: 'everyone',
      status: COMMAND_STATUS.STUB,
      handler: async (ctx) => {
        const env = getEnv();
        if (!env.CURRENCY_API_KEY) {
          throw new NotConfiguredError('.currency', 'CURRENCY_API_KEY');
        }
        await ctx.reply('🔧 The currency adapter is not implemented in this phase yet.');
      },
    },
    {
      name: 'lyrics',
      category: 'media',
      description: 'Look up song lyrics (requires LYRICS_API_KEY)',
      args: '<song - artist>',
      access: 'everyone',
      status: COMMAND_STATUS.STUB,
      handler: async (ctx) => {
        const env = getEnv();
        if (!env.LYRICS_API_KEY) {
          throw new NotConfiguredError('.lyrics', 'LYRICS_API_KEY');
        }
        await ctx.reply('🔧 The lyrics adapter is not implemented in this phase yet.');
      },
    },
    {
      name: 'shorturl',
      category: 'utilities',
      description: 'Shorten a URL via your configured provider',
      args: '<url>',
      access: 'everyone',
      status: COMMAND_STATUS.STUB,
      handler: async (ctx) => {
        const env = getEnv();
        if (!env.SHORTURL_API_URL) {
          throw new NotConfiguredError('.shorturl', 'SHORTURL_API_URL');
        }
        await ctx.reply(
          '🔧 Short URL provider adapter is not implemented in this phase yet.\n(no shortened URL is ever invented)',
        );
      },
    },
    {
      name: 'screenshot',
      category: 'utilities',
      description: 'Screenshot a public web page (requires SCREENSHOT_API_URL)',
      args: '<url>',
      access: 'everyone',
      status: COMMAND_STATUS.STUB,
      handler: async (ctx) => {
        const env = getEnv();
        if (!env.SCREENSHOT_API_URL) {
          throw new NotConfiguredError('.screenshot', 'SCREENSHOT_API_URL');
        }
        await ctx.reply(
          '🔧 The screenshot adapter is not implemented in this phase yet.\n(private IPs and local addresses will always be blocked)',
        );
      },
    },
    {
      name: 'play',
      category: 'media',
      description: 'Find/play a song (requires MEDIA_API_URL)',
      args: '<query>',
      access: 'everyone',
      status: COMMAND_STATUS.STUB,
      handler: async (ctx) => {
        const env = getEnv();
        if (!env.MEDIA_API_URL) {
          throw new NotConfiguredError('.play', 'MEDIA_API_URL');
        }
        await ctx.reply('🔧 The media-download adapter is not implemented in this phase yet.');
      },
    },
    {
      name: 'song',
      category: 'media',
      description: 'Download audio for a query (requires MEDIA_API_URL)',
      args: '<query>',
      access: 'everyone',
      status: COMMAND_STATUS.STUB,
      handler: async (ctx) => {
        const env = getEnv();
        if (!env.MEDIA_API_URL) {
          throw new NotConfiguredError('.song', 'MEDIA_API_URL');
        }
        await ctx.reply('🔧 The media-download adapter is not implemented in this phase yet.');
      },
    },
    {
      name: 'video',
      category: 'media',
      description: 'Download video for a query (requires MEDIA_API_URL)',
      args: '<query>',
      access: 'everyone',
      status: COMMAND_STATUS.STUB,
      handler: async (ctx) => {
        const env = getEnv();
        if (!env.MEDIA_API_URL) {
          throw new NotConfiguredError('.video', 'MEDIA_API_URL');
        }
        await ctx.reply('🔧 The media-download adapter is not implemented in this phase yet.');
      },
    },
    {
      name: 'tiktok',
      category: 'media',
      description: 'Download a TikTok link (requires MEDIA_API_URL)',
      args: '<url>',
      access: 'everyone',
      status: COMMAND_STATUS.STUB,
      handler: async (ctx) => {
        const env = getEnv();
        if (!env.MEDIA_API_URL) {
          throw new NotConfiguredError('.tiktok', 'MEDIA_API_URL');
        }
        await ctx.reply('🔧 The media-download adapter is not implemented in this phase yet.');
      },
    },
    {
      name: 'instagram',
      category: 'media',
      description: 'Download an Instagram link (requires MEDIA_API_URL)',
      args: '<url>',
      access: 'everyone',
      status: COMMAND_STATUS.STUB,
      handler: async (ctx) => {
        const env = getEnv();
        if (!env.MEDIA_API_URL) {
          throw new NotConfiguredError('.instagram', 'MEDIA_API_URL');
        }
        await ctx.reply('🔧 The media-download adapter is not implemented in this phase yet.');
      },
    },
    {
      name: 'sticker',
      aliases: ['s'],
      category: 'media',
      description: 'Turn an image into a sticker',
      access: 'everyone',
      status: COMMAND_STATUS.PARTIAL,
      handler: async (ctx) => {
        const hasMedia = !!ctx.msg.quoted?.hasMedia || !!ctx.msg.hasMedia;
        if (!hasMedia) {
          await ctx.reply(`Reply to an image with ${ctx.services.config?.prefix ?? '.'}sticker`);
          return;
        }
        await ctx.reply(
          '🔧 Sticker conversion (image → webp) needs the local media pipeline, which is not enabled in this phase yet.',
        );
      },
    },
    {
      name: 'toimg',
      category: 'media',
      description: 'Convert a sticker back to an image',
      access: 'everyone',
      status: COMMAND_STATUS.PARTIAL,
      handler: async (ctx) => {
        const hasMedia = !!ctx.msg.quoted?.hasMedia || !!ctx.msg.hasMedia;
        if (!hasMedia) {
          await ctx.reply(`Reply to a sticker with ${ctx.services.config?.prefix ?? '.'}toimg`);
          return;
        }
        await ctx.reply('🔧 Sticker → image conversion needs the local media pipeline, not enabled in this phase yet.');
      },
    },
    {
      name: 'blur',
      category: 'media',
      description: 'Blur an image',
      access: 'everyone',
      status: COMMAND_STATUS.PARTIAL,
      handler: async (ctx) => {
        await ctx.reply('🔧 Image processing pipeline not enabled in this phase yet.');
      },
    },
    {
      name: 'meme',
      category: 'media',
      description: 'Caption an image as a meme',
      args: '<top text> | <bottom text>',
      access: 'everyone',
      status: COMMAND_STATUS.PARTIAL,
      handler: async (ctx) => {
        await ctx.reply('🔧 Meme rendering needs the local media pipeline, not enabled in this phase yet.');
      },
    },
    {
      name: 'reminder',
      category: 'utilities',
      description: 'Set a reminder (in-memory; lost on restart)',
      args: '<time> <text>',
      access: 'everyone',
      status: COMMAND_STATUS.PARTIAL,
      handler: async (ctx) => {
        const m = /^(\d+)(s|m|h)\s+(.+)$/i.exec(ctx.rest ?? '');
        if (!m) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}reminder <time> <text>\nExample: .reminder 10m check the oven`);
          return;
        }
        const mult = { s: 1000, m: 60000, h: 3600000 }[m[2].toLowerCase()];
        const delayMs = Math.min(Number(m[1]) * mult, 24 * 3600000);
        const text = m[3];
        await ctx.reply(`⏰ Reminder set for ${m[1]}${m[2]} from now.\nNote: reminders are in-memory — they do not survive a restart.`);
        setTimeout(() => {
          ctx.client
            .sendText(ctx.chatJid, `⏰ Reminder for @${String(ctx.senderJid).split('@')[0]}: ${text}`, {
              mentions: [ctx.senderJid],
            })
            .catch(() => {});
        }, delayMs);
      },
    },
    {
      name: 'configcheck',
      category: 'info',
      description: 'List external providers and whether they are configured',
      access: 'owner',
      handler: async (ctx) => {
        const env = getEnv();
        const rows = [
          ['AI', env.AI_API_KEY && env.AI_API_URL],
          ['Imagine', env.IMAGINE_API_KEY && env.IMAGINE_API_URL],
          ['Translate', env.TRANSLATE_API_KEY],
          ['Weather', env.WEATHER_API_KEY],
          ['Currency', env.CURRENCY_API_KEY],
          ['Short URL', env.SHORTURL_API_URL],
          ['Screenshot', env.SCREENSHOT_API_URL],
          ['Lyrics', env.LYRICS_API_KEY],
          ['Media download', env.MEDIA_API_URL],
        ];
        await ctx.reply(
          '*External provider configuration*\n' +
            rows.map(([k, v]) => `${v ? '✅' : '⬜'} ${k}`).join('\n') +
            '\n\nConfigured = the env vars are set. Adapters may still be pending (see .commands).',
        );
      },
    },
  ]);
}
