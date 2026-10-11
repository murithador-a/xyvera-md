/**
 * Utility commands — pure, local, and actually implemented:
 * qr, calc, hash, base64, binary, count, reverse, case, palindrome,
 * password (generates a random password; NEVER reads saved credentials),
 * timestamp. Provider-backed utilities live in ../ai (honest "not configured").
 */

import { createHash, randomInt, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';

import { ValidationError } from '../../utils/errors.js';
import { validateText } from '../../utils/validators.js';
import { COMMAND_STATUS } from '../../config/defaults.js';

export default function registerUtilityCommands(registry, deps) {
  registry.registerAll([
    {
      name: 'qr',
      category: 'utilities',
      description: 'Generate a QR code image from text',
      args: '<text>',
      access: 'everyone',
      handler: async (ctx) => {
        const text = validateText(ctx.rest, { min: 1, max: 500, label: 'QR text' });
        const dataUrl = await QRCode.toDataURL(text, { width: 512, margin: 2 });
        const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
        const ok = await ctx.client.sendImage?.(ctx.chatJid, buffer, { caption: `QR for: ${text.slice(0, 60)}` });
        if (!ok?.ok) {
          await ctx.reply('⚠️ Could not send the QR image in this environment.');
        }
      },
    },
    {
      name: 'calc',
      aliases: ['calculate'],
      category: 'utilities',
      description: 'Evaluate an arithmetic expression (safe parser)',
      args: '<expression>',
      access: 'everyone',
      handler: async (ctx) => {
        const result = safeCalc(ctx.rest);
        await ctx.reply(`🧮 ${ctx.rest} = *${result}*`);
      },
    },
    {
      name: 'hash',
      category: 'utilities',
      description: 'Hash text with md5/sha1/sha256/sha512',
      args: '[algo] <text>',
      access: 'everyone',
      handler: async (ctx) => {
        const first = (ctx.args[0] ?? '').toLowerCase();
        const algos = ['md5', 'sha1', 'sha256', 'sha512'];
        const algo = algos.includes(first) ? first : 'sha256';
        const text = algos.includes(first) ? ctx.rest.slice(first.length).trim() : ctx.rest;
        if (!text) throw new ValidationError('Provide text to hash. Usage: .hash [algo] <text>');
        const digest = createHash(algo).update(text).digest('hex');
        await ctx.reply(`🔐 ${algo}:\n\`${digest}\``);
      },
    },
    {
      name: 'base64',
      category: 'utilities',
      description: 'Encode/decode base64',
      args: '<encode|decode> <text>',
      access: 'everyone',
      handler: async (ctx) => {
        const mode = (ctx.args[0] ?? '').toLowerCase();
        const text = ctx.rest.slice(mode.length).trim();
        if (!['encode', 'decode'].includes(mode) || !text) {
          throw new ValidationError('Usage: .base64 <encode|decode> <text>');
        }
        const out = mode === 'encode'
          ? Buffer.from(text, 'utf8').toString('base64')
          : Buffer.from(text, 'base64').toString('utf8');
        await ctx.reply(`📎 ${mode}:\n\`${out}\``);
      },
    },
    {
      name: 'binary',
      category: 'utilities',
      description: 'Convert text↔binary',
      args: '<encode|decode> <text>',
      access: 'everyone',
      handler: async (ctx) => {
        const mode = (ctx.args[0] ?? '').toLowerCase();
        const text = ctx.rest.slice(mode.length).trim();
        if (!['encode', 'decode'].includes(mode) || !text) {
          throw new ValidationError('Usage: .binary <encode|decode> <text>');
        }
        if (mode === 'encode') {
          const out = [...Buffer.from(text, 'utf8')].map((b) => b.toString(2).padStart(8, '0')).join(' ');
          await ctx.reply(`🔢 Binary:\n\`${out}\``);
        } else {
          const parts = text.split(/\s+/).filter(Boolean);
          if (parts.some((p) => !/^[01]{1,8}$/.test(p))) {
            throw new ValidationError('Decode expects space-separated 1-8 bit binary groups.');
          }
          const out = Buffer.from(parts.map((p) => parseInt(p, 2))).toString('utf8');
          await ctx.reply(`🔢 Text:\n\`${out}\``);
        }
      },
    },
    {
      name: 'count',
      category: 'utilities',
      description: 'Count characters and words in text',
      args: '<text>',
      access: 'everyone',
      handler: async (ctx) => {
        const text = ctx.rest;
        if (!text) throw new ValidationError('Provide text to count.');
        const words = text.split(/\s+/).filter(Boolean).length;
        await ctx.reply(
          `📊 *Count*\n• Characters (with spaces): ${text.length}\n• Characters (no spaces): ${text.replace(/\s/g, '').length}\n• Words: ${words}\n• Lines: ${text.split('\n').length}`,
        );
      },
    },
    {
      name: 'reverse',
      category: 'utilities',
      description: 'Reverse text',
      args: '<text>',
      access: 'everyone',
      handler: async (ctx) => {
        if (!ctx.rest) throw new ValidationError('Provide text to reverse.');
        await ctx.reply(`↩️ ${[...ctx.rest].reverse().join('')}`);
      },
    },
    {
      name: 'case',
      category: 'utilities',
      description: 'Change text case',
      args: '<upper|lower|title|toggle> <text>',
      access: 'everyone',
      handler: async (ctx) => {
        const mode = (ctx.args[0] ?? '').toLowerCase();
        const text = ctx.rest.slice(mode.length).trim();
        if (!['upper', 'lower', 'title', 'toggle'].includes(mode) || !text) {
          throw new ValidationError('Usage: .case <upper|lower|title|toggle> <text>');
        }
        let out;
        switch (mode) {
          case 'upper': out = text.toUpperCase(); break;
          case 'lower': out = text.toLowerCase(); break;
          case 'title': out = text.replace(/\b\w/g, (c) => c.toUpperCase()); break;
          default:
            out = [...text].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
        }
        await ctx.reply(`🔤 ${out}`);
      },
    },
    {
      name: 'palindrome',
      category: 'utilities',
      description: 'Check whether text is a palindrome',
      args: '<text>',
      access: 'everyone',
      handler: async (ctx) => {
        const text = (ctx.rest ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
        if (!text) throw new ValidationError('Provide text to check.');
        const isPal = text === [...text].reverse().join('');
        await ctx.reply(isPal ? '✅ That is a palindrome!' : '❌ Not a palindrome.');
      },
    },
    {
      name: 'password',
      category: 'utilities',
      description: 'Generate a random password (never reveals saved ones)',
      args: '[length]',
      access: 'everyone',
      handler: async (ctx) => {
        const len = Math.min(Math.max(Number(ctx.args[0]) || 16, 8), 64);
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+';
        const chars = Array.from({ length: len }, () => alphabet[randomInt(alphabet.length)]);
        // Generate from CSPRNG; one-time display only.
        void randomBytes;
        await ctx.reply(
          `🔑 Random password (${len} chars):\n\`${chars.join('')}\`\n\n_Shown once — store it somewhere safe. This command never reads saved credentials._`,
        );
      },
    },
    {
      name: 'timestamp',
      category: 'utilities',
      description: 'Show current Unix/ISO timestamps',
      access: 'everyone',
      handler: async (ctx) => {
        const now = new Date();
        await ctx.reply(
          `🕐 *Timestamps*\n• Unix (s): ${Math.floor(now.getTime() / 1000)}\n• Unix (ms): ${now.getTime()}\n• ISO: ${now.toISOString()}\n• Local: ${now.toString()}`,
        );
      },
    },
    {
      name: 'echo',
      category: 'utilities',
      description: 'Repeat your text back',
      args: '<text>',
      access: 'everyone',
      status: COMMAND_STATUS.IMPLEMENTED,
      handler: async (ctx) => {
        if (!ctx.rest) throw new ValidationError('Provide text to echo.');
        await ctx.reply(ctx.rest);
      },
    },
  ]);
}

// ── safe arithmetic evaluator (no eval) ────────────────────────────────

/**
 * Shunting-yard evaluator supporting + - * / % ^ ( ) and decimals.
 * Returns a formatted number, or throws ValidationError with a clear message.
 */
export function safeCalc(input) {
  const src = String(input ?? '').trim();
  if (!src) throw new ValidationError('Provide an expression. Usage: .calc 2+2*3');
  if (!/^[\d\s+\-*/%^().]+$/.test(src)) {
    throw new ValidationError('Only numbers and + - * / % ^ ( ) are allowed.');
  }
  const tokens = src.match(/\d+\.?\d*|[+\-*/%^()]/g);
  if (!tokens) throw new ValidationError('Could not parse the expression.');

  const output = [];
  const ops = [];
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3, 'u-': 4 };
  const rightAssoc = new Set(['^', 'u-']);
  let prev = null;

  for (const t of tokens) {
    if (/^\d/.test(t)) {
      output.push(Number(t));
    } else if (t === '(') {
      ops.push(t);
    } else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop());
      if (!ops.length) throw new ValidationError('Mismatched parentheses.');
      ops.pop();
    } else {
      let op = t;
      if (op === '-' && (prev === null || prev === '(' || (typeof prev === 'string' && prev in prec))) {
        op = 'u-'; // unary minus
      }
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top === '(') break;
        const topPrec = prec[top];
        const curPrec = prec[op];
        if (topPrec > curPrec || (topPrec === curPrec && !rightAssoc.has(op))) {
          output.push(ops.pop());
        } else break;
      }
      ops.push(op);
    }
    prev = t;
  }
  while (ops.length) {
    const op = ops.pop();
    if (op === '(') throw new ValidationError('Mismatched parentheses.');
    output.push(op);
  }

  const stack = [];
  for (const t of output) {
    if (typeof t === 'number') {
      stack.push(t);
      continue;
    }
    if (t === 'u-') {
      if (!stack.length) throw new ValidationError('Invalid expression.');
      stack.push(-stack.pop());
      continue;
    }
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) throw new ValidationError('Invalid expression.');
    switch (t) {
      case '+': stack.push(a + b); break;
      case '-': stack.push(a - b); break;
      case '*': stack.push(a * b); break;
      case '/':
        if (b === 0) throw new ValidationError('Division by zero.');
        stack.push(a / b);
        break;
      case '%':
        if (b === 0) throw new ValidationError('Modulo by zero.');
        stack.push(a % b);
        break;
      case '^': stack.push(a ** b); break;
      default: throw new ValidationError(`Unknown operator: ${t}`);
    }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) {
    throw new ValidationError('Invalid expression.');
  }
  return Number.isInteger(stack[0]) ? String(stack[0]) : String(Number(stack[0].toFixed(10)));
}
