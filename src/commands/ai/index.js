/**
 * AI + provider-backed utilities and media commands.
 *
 * Every provider call goes through services/providers.js (documented adapters,
 * injectable fetch, setup errors when unconfigured — never fake success).
 * Media commands use the local sharp pipeline (services/mediaPipeline.js).
 */

import { COMMAND_STATUS } from '../../config/defaults.js';
import { NotConfiguredError, ExternalServiceError } from '../../utils/errors.js';
import { isSafePublicUrl } from '../../utils/validators.js';
import {
  toStickerWebp,
  webpToPng,
  blurImage,
  memeCaption,
} from '../../services/mediaPipeline.js';

/** Fetch image/video/sticker bytes for the replied (or current) media message. */
async function getMedia(ctx) {
  const target = ctx.msg.quoted ?? ctx.msg;
  if (!target?.hasMedia && !ctx.msg.quoted) {
    return null;
  }
  return ctx.client.downloadMedia(target);
}

export default function registerAiCommands(registry, deps) {
  const { getProviders } = deps;
  const providers = () => getProviders();

  registry.registerAll([
    {
      name: 'ai',
      aliases: ['chat', 'ask'],
      category: 'ai',
      description: 'Talk to an AI assistant (requires AI_API_KEY + AI_API_URL)',
      args: '<prompt>',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        if (!ctx.rest) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}ai <prompt>`);
          return;
        }
        await ctx.reply('🧠 Thinking…');
        const answer = await providers().chat(ctx.rest, {
          system: `You are ${ctx.services.config?.botName ?? 'Xyvera MD'}, a helpful WhatsApp assistant. Keep answers concise and chat-friendly.`,
        });
        await ctx.reply(answer.slice(0, 4000));
      },
    },
    {
      name: 'imagine',
      category: 'ai',
      description: 'Generate an image (requires IMAGINE_API_KEY + IMAGINE_API_URL)',
      args: '<prompt>',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        if (!ctx.rest) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}imagine <prompt>`);
          return;
        }
        await ctx.reply('🎨 Generating…');
        const img = await providers().imagine(ctx.rest);
        if (img.buffer) {
          await ctx.client.sendImageBuffer?.(ctx.chatJid, img.buffer, { caption: ctx.rest.slice(0, 100) });
          return;
        }
        await ctx.reply(`🖼️ ${img.url}`);
      },
    },
    {
      name: 'translate',
      category: 'ai',
      description: 'Translate text (MyMemory engine)',
      args: '[lang] <text>',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        let to = 'en';
        let text = ctx.rest;
        const m = /^([a-z]{2})\s+(.+)$/is.exec(ctx.rest ?? '');
        if (m) {
          to = m[1].toLowerCase();
          text = m[2];
        }
        if (!text) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}translate [lang] <text>\nExample: .translate fr hello there`);
          return;
        }
        const res = await providers().translate(text, to);
        await ctx.reply(`🌐 (${res.engine} → ${to})\n${res.translated}`);
      },
    },
    {
      name: 'weather',
      category: 'utilities',
      description: 'Current weather for a city (Open-Meteo)',
      args: '<city>',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        if (!ctx.rest) throw new ExternalServiceError('Provide a city: .weather Lagos');
        const w = await providers().weather(ctx.rest);
        await ctx.reply(
          [
            `🌤️ *Weather — ${w.place}*`,
            `• ${w.description}`,
            `• Temperature: ${w.tempC}°C (feels like ${w.feelsLikeC}°C)`,
            `• Humidity: ${w.humidity}%`,
            `• Wind: ${w.windKmh} km/h`,
            `_Source: ${w.engine}_`,
          ].join('\n'),
        );
      },
    },
    {
      name: 'currency',
      category: 'utilities',
      description: 'Convert currency (Frankfurter/ECB daily rates)',
      args: '<amount> <from> <to>',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        const [amountS, from, to] = ctx.args;
        const amount = Number(amountS);
        if (!Number.isFinite(amount) || !from || !to) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}currency <amount> <from> <to>\nExample: .currency 10 USD NGN`);
          return;
        }
        const res = await providers().currency(amount, from, to);
        await ctx.reply(
          `💱 ${res.amount} ${res.from} = *${res.converted} ${res.to}*\n_Rate date: ${res.date} (${res.engine})_`,
        );
      },
    },
    {
      name: 'lyrics',
      category: 'media',
      description: 'Look up song lyrics (lyrics.ovh)',
      args: '<artist> - <title>',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        const parts = (ctx.rest ?? '').split(' - ');
        if (parts.length < 2 || !parts[0].trim() || !parts[1].trim()) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}lyrics <artist> - <title>`);
          return;
        }
        const text = await providers().lyrics(parts[0].trim(), parts.slice(1).join(' - ').trim());
        // WhatsApp messages cap at ~4096 chars; send the tail as a follow-up if needed
        const chunks = text.match(/[\s\S]{1,3800}/g) ?? [text];
        for (const chunk of chunks.slice(0, 3)) await ctx.reply(`🎵\n${chunk}`);
      },
    },
    {
      name: 'shorturl',
      category: 'utilities',
      description: 'Shorten a public URL via the configured provider (is.gd by default)',
      args: '<url>',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        const url = (ctx.rest ?? '').trim();
        const check = isSafePublicUrl(url);
        if (!check.ok) {
          await ctx.reply(`⚠️ ${check.reason}`);
          return;
        }
        const short = await providers().shorten(url);
        await ctx.reply(`🔗 ${short}`);
      },
    },
    {
      name: 'screenshot',
      category: 'utilities',
      description: 'Screenshot a public web page (requires SCREENSHOT_API_URL)',
      args: '<url>',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        const url = (ctx.rest ?? '').trim();
        const check = isSafePublicUrl(url);
        if (!check.ok) {
          await ctx.reply(`⚠️ ${check.reason}`);
          return;
        }
        const buf = await providers().screenshot(url);
        const ok = await ctx.client.sendImageBuffer?.(ctx.chatJid, buf, { caption: `📷 ${url}` });
        if (!ok?.ok) await ctx.reply('⚠️ Could not send the screenshot image in this environment.');
      },
    },
    {
      name: 'configcheck',
      category: 'info',
      description: 'List external providers and whether they are configured',
      access: 'owner',
      handler: async (ctx) => {
        const env = ctx.services.env ?? {};
        const rows = [
          ['AI (.ai)', env.AI_API_KEY && env.AI_API_URL],
          ['Imagine (.imagine)', env.IMAGINE_API_KEY && env.IMAGINE_API_URL],
          ['Translate (.translate)', true],
          ['Weather (.weather)', true],
          ['Currency (.currency)', true],
          ['Lyrics (.lyrics)', true],
          ['Short URL (.shorturl)', env.SHORTURL_API_URL || 'is.gd default'],
          ['Screenshot (.screenshot)', !!env.SCREENSHOT_API_URL],
          ['Media downloads (.play etc.)', false],
        ];
        await ctx.reply(
          '*Provider configuration*\n' +
            rows.map(([k, v]) => `${v ? '✅' : '⬜'} ${k}${v === 'is.gd default' ? ' (keyless default)' : ''}`).join('\n') +
            '\n\n✅ = available now. ⬜ = set the env var (see .env.example) to enable.',
        );
      },
    },

    // ── media pipeline (local sharp) ────────────────────────────────────
    {
      name: 'sticker',
      aliases: ['s'],
      category: 'media',
      description: 'Turn a replied image into a sticker',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        const buf = await getMedia(ctx);
        if (!buf) {
          await ctx.reply(`Reply to an image with ${ctx.services.config?.prefix ?? '.'}sticker`);
          return;
        }
        const webp = await toStickerWebp(buf);
        await ctx.client.sendSticker?.(ctx.chatJid, webp);
      },
    },
    {
      name: 'toimg',
      category: 'media',
      description: 'Convert a replied sticker back to an image',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        const buf = await getMedia(ctx);
        if (!buf) {
          await ctx.reply(`Reply to a sticker with ${ctx.services.config?.prefix ?? '.'}toimg`);
          return;
        }
        const png = await webpToPng(buf);
        await ctx.client.sendImageBuffer?.(ctx.chatJid, png, { caption: '🖼️ sticker → image' });
      },
    },
    {
      name: 'blur',
      category: 'media',
      description: 'Blur a replied image (optional radius 1-100)',
      args: '[radius]',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        const buf = await getMedia(ctx);
        if (!buf) {
          await ctx.reply(`Reply to an image with ${ctx.services.config?.prefix ?? '.'}blur [radius]`);
          return;
        }
        const out = await blurImage(buf, Number(ctx.args[0]) || 5);
        await ctx.client.sendImageBuffer?.(ctx.chatJid, out, { caption: '🌫️ blurred' });
      },
    },
    {
      name: 'meme',
      category: 'media',
      description: 'Caption a replied image: <top> | <bottom>',
      args: '<top> | <bottom>',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        const buf = await getMedia(ctx);
        if (!buf) {
          await ctx.reply(`Reply to an image with ${ctx.services.config?.prefix ?? '.'}meme <top> | <bottom>`);
          return;
        }
        const parts = (ctx.rest ?? '').split('|').map((s) => s.trim());
        const out = await memeCaption(buf, { top: parts[0] ?? '', bottom: parts[1] ?? '' });
        await ctx.client.sendImageBuffer?.(ctx.chatJid, out, { caption: '😎 meme' });
      },
    },

    // ── media downloads: real once MEDIA_API_URL is configured ─────────
    ...['play', 'song', 'video', 'tiktok', 'instagram'].map((name) => {
      const isAudio = name === 'play' || name === 'song';
      return {
        name,
        category: 'media',
        description: `Download media via a licensed provider (${name}${isAudio ? ', audio' : ', video'})`,
        args: '<query|url>',
        access: 'everyone',
        status: COMMAND_STATUS.IMPLEMENTED,
        handler: async (ctx) => {
          const env = ctx.services.env ?? {};
          const input = (ctx.rest ?? '').trim();
          if (!input) {
            await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}${name} <query|url>`);
            return;
          }
          if (!env.MEDIA_API_URL) {
            await ctx.reply(
              `🔧 *${name}* needs a licensed media provider (API + terms that permit downloading).\n` +
                'No provider is bundled, so this command will not pretend to work.\n' +
                'Set MEDIA_API_URL/MEDIA_API_KEY once a provider is chosen (docs/REQUIREMENTS.md §3.8).',
            );
            return;
          }
          const isUrl = /^https?:\/\//i.test(input);
          await ctx.reply(`⏳ Looking up *${name}*…`).catch(() => {});
          try {
            const out = await ctx.services.providers.downloadMedia({
              query: isUrl ? null : input,
              url: isUrl ? input : null,
            });
            const content = isAudio
              ? { audio: { url: out.url }, mimetype: out.mimetype ?? 'audio/mpeg' }
              : { video: { url: out.url }, caption: out.title ? `🎬 ${out.title}` : '🎬' };
            const sent = await ctx.client.sendMediaFromMessage?.(ctx.chatJid, content);
            if (!sent) await ctx.reply('⚠️ Could not send the media in this environment.');
          } catch (err) {
            const { NotConfiguredError } = await import('../../utils/errors.js');
            if (err instanceof NotConfiguredError) {
              await ctx.reply(`🔧 ${err.message}`);
            } else {
              await ctx.reply(`⚠️ ${name} failed: ${String(err?.message ?? err)}`);
            }
          }
        },
      };
    }),
    {
      name: 'reminder',
      category: 'utilities',
      description: 'Set a reminder (persisted across restarts)',
      args: '<time> <text>',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        const m = /^(\d+)(s|m|h)\s+(.+)$/i.exec(ctx.rest ?? '');
        if (!m) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}reminder <time> <text>\nExample: .reminder 10m check the oven`);
          return;
        }
        const mult = { s: 1000, m: 60_000, h: 3_600_000 }[m[2].toLowerCase()];
        const delayMs = Math.min(Number(m[1]) * mult, 24 * 3_600_000);
        await ctx.services.reminders.add({
          chatJid: ctx.chatJid,
          userJid: ctx.senderJid,
          text: m[3],
          fireAt: Date.now() + delayMs,
        });
        await ctx.reply(`⏰ Reminder set for ${m[1]}${m[2]} from now — it survives restarts.`);
      },
    },
    {
      name: 'reminders',
      category: 'utilities',
      description: 'List your pending reminders',
      access: 'everyone',
      handler: async (ctx) => {
        const list = ctx.services.reminders.listFor(ctx.chatJid, ctx.senderJid);
        if (list.length === 0) {
          await ctx.reply('You have no pending reminders in this chat.');
          return;
        }
        await ctx.reply(
          '⏰ *Your reminders here:*\n' +
            list
              .map((r) => `• in ${Math.max(0, Math.round((r.fireAt - Date.now()) / 60_000))}m — ${r.text}`)
              .join('\n'),
        );
      },
    },
    {
      name: 'delreminder',
      category: 'utilities',
      description: 'Cancel one of your pending reminders by number',
      args: '<number>',
      access: 'everyone',
      handler: async (ctx) => {
        const idx = Number(ctx.args[0]) - 1;
        const ok = ctx.services.reminders.cancelAt(ctx.chatJid, ctx.senderJid, idx);
        await ctx.reply(ok ? '✅ Reminder cancelled.' : 'No reminder at that number (see .reminders).');
      },
    },
  ]);
}

export { getMedia };
