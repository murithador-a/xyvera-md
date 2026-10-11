/**
 * Games — all fun, no gambling/wagers. Tic-tac-toe has full turn logic,
 * win/draw detection, challenge acceptance, cancellation, and timeouts.
 */

import {
  TicTacToe,
  GameRegistry,
  rpsPlay,
  rollDice,
  flipCoin,
  eightBall,
  Hangman,
  triviaQuestion,
  triviaCheck,
  TRUTHS,
  DARES,
  RIDDLES,
  COMPLIMENTS,
  ROASTS,
  pickRandom,
  shipPercent,
  shipBar,
  RPS_MOVES,
} from '../../services/gameEngine.js';
import { ValidationError } from '../../utils/errors.js';
import { normalizeJid, displayJid as dj } from '../common.js';

export default function registerGameCommands(registry, deps) {
  // One shared registry for all game state.
  const games = deps.gameRegistry ?? new GameRegistry();
  const tictactoe = makeTicTacToeCommands(games);
  const triviaSessions = new Map();

  registry.registerAll([
    ...tictactoe,
    {
      name: 'rps',
      category: 'games',
      description: 'Rock-paper-scissors vs the bot',
      args: '<rock|paper|scissors>',
      access: 'everyone',
      handler: async (ctx) => {
        const move = (ctx.args[0] ?? '').toLowerCase();
        const botMove = pickRandom(RPS_MOVES);
        const res = rpsPlay(move, botMove);
        if (!res.ok) {
          await ctx.reply(`Usage: ${ctx.services.config?.prefix ?? '.'}rps <rock|paper|scissors>`);
          return;
        }
        const msg =
          res.result === 'win' ? '🎉 You win!' : res.result === 'lose' ? '😈 I win!' : '🤝 Draw!';
        await ctx.reply(`You: ${res.you}  vs  Bot: ${res.opponent}\n${msg}`);
      },
    },
    {
      name: 'dice',
      category: 'games',
      description: 'Roll dice (no wagers)',
      args: '[sides] [count]',
      access: 'everyone',
      handler: async (ctx) => {
        const { rolls, total, sides } = rollDice(ctx.args[0], ctx.args[1]);
        await ctx.reply(`🎲 Rolled ${rolls.length}d${sides}: ${rolls.join(', ')}\nTotal: ${total}`);
      },
    },
    {
      name: 'coin',
      category: 'games',
      description: 'Flip a coin',
      access: 'everyone',
      handler: async (ctx) => {
        await ctx.reply(`🪙 ${flipCoin().toUpperCase()}!`);
      },
    },
    {
      name: '8ball',
      aliases: ['eightball'],
      category: 'games',
      description: 'Ask the magic 8-ball a question',
      args: '<question>',
      access: 'everyone',
      handler: async (ctx) => {
        if (!ctx.rest) throw new ValidationError('Ask a question first: .8ball <question>');
        await ctx.reply(`🎱 ${eightBall()}`);
      },
    },
    {
      name: 'truth',
      category: 'games',
      description: 'Get a truth question',
      access: 'everyone',
      handler: async (ctx) => {
        await ctx.reply(`🗣️ *Truth:*\n${pickRandom(TRUTHS)}`);
      },
    },
    {
      name: 'dare',
      category: 'games',
      description: 'Get a dare',
      access: 'everyone',
      handler: async (ctx) => {
        await ctx.reply(`😈 *Dare:*\n${pickRandom(DARES)}`);
      },
    },
    {
      name: 'riddle',
      category: 'games',
      description: 'Get a riddle (answer with .riddle answer <text>)',
      args: '[answer <text>]',
      access: 'everyone',
      handler: async (ctx) => {
        const key = `riddle|${ctx.chatJid}`;
        if ((ctx.args[0] ?? '').toLowerCase() === 'answer') {
          const r = triviaSessions.get(key);
          if (!r) {
            await ctx.reply('No active riddle. Use .riddle to get one.');
            return;
          }
          const guess = ctx.rest.replace(/^answer\s+/i, '').toLowerCase().trim();
          if (guess === r.a) {
            triviaSessions.delete(key);
            await ctx.reply(`✅ Correct! The answer was: *${r.a}*`);
          } else {
            await ctx.reply('❌ Not quite — try again!');
          }
          return;
        }
        const riddle = pickRandom(RIDDLES);
        triviaSessions.set(key, riddle);
        await ctx.reply(`🧩 *Riddle:*\n${riddle.r}\n\n_Answer with .riddle answer <text>_`);
      },
    },
    {
      name: 'trivia',
      category: 'games',
      description: 'Answer a trivia question (.trivia answer <text>)',
      args: '[answer <text>]',
      access: 'everyone',
      handler: async (ctx) => {
        const key = `trivia|${ctx.chatJid}`;
        if ((ctx.args[0] ?? '').toLowerCase() === 'answer') {
          const q = triviaSessions.get(key);
          if (!q) {
            await ctx.reply('No active trivia question. Use .trivia to get one.');
            return;
          }
          const guess = ctx.rest.replace(/^answer\s+/i, '');
          if (triviaCheck(q, guess)) {
            triviaSessions.delete(key);
            await ctx.reply(`✅ Correct! The answer was: *${q.a}*`);
          } else {
            await ctx.reply('❌ Wrong — try again!');
          }
          return;
        }
        const q = triviaQuestion();
        triviaSessions.set(key, q);
        await ctx.reply(
          `❓ *Trivia:*\n${q.q}\n\n${q.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\n_Answer with .trivia answer <text>_`,
        );
      },
    },
    {
      name: 'hangman',
      category: 'games',
      description: 'Play hangman (.hangman start | guess <letter|word>)',
      args: '[start|guess <letter|word>]',
      access: 'everyone',
      handler: async (ctx) => {
        const key = `hangman|${ctx.chatJid}`;
        const sub = (ctx.args[0] ?? '').toLowerCase();
        if (sub === 'start' || !sub) {
          const game = new Hangman();
          triviaSessions.set(key, game);
          await ctx.reply(
            `🎯 *Hangman started!*\nWord: \`${game.display()}\`\nWrong guesses left: ${game.maxWrong}\n\nGuess with .hangman guess <letter|word>`,
          );
          return;
        }
        const game = triviaSessions.get(key);
        if (!game) {
          await ctx.reply('No hangman game in progress. Start one with .hangman start');
          return;
        }
        const guess = ctx.rest.replace(/^guess\s+/i, '').trim();
        const res = game.guess(guess);
        if (!res.ok) {
          await ctx.reply(`⚠️ ${res.error}`);
          return;
        }
        if (res.won) {
          triviaSessions.delete(key);
          await ctx.reply(`🎉 You won! The word was *${res.word}*.`);
          return;
        }
        if (res.lost) {
          triviaSessions.delete(key);
          await ctx.reply(`💀 Game over — the word was *${res.word}*.`);
          return;
        }
        await ctx.reply(
          `\`${res.display}\`\nWrong guesses: ${res.wrong}/${game.maxWrong}` +
            (res.wrongGuess ? ' ❌' : ' ✅'),
        );
      },
    },
    {
      name: 'poll',
      category: 'games',
      description: 'Create a simple poll: question | option1 | option2 …',
      args: '<question> | <opt1> | <opt2> …',
      access: 'everyone',
      handler: async (ctx) => {
        const parts = ctx.rest.split('|').map((p) => p.trim()).filter(Boolean);
        if (parts.length < 3) {
          throw new ValidationError('Usage: .poll <question> | <option1> | <option2> …');
        }
        const [question, ...options] = parts;
        const nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        await ctx.reply(
          `📊 *Poll: ${question}*\n\n${options.map((o, i) => `${nums[i] ?? `${i + 1}.`} ${o}`).join('\n')}\n\n_React with the number you choose._`,
        );
      },
    },
    {
      name: 'ship',
      category: 'games',
      description: 'Ship two people (fun percentage)',
      args: '@user1 [@user2]',
      access: 'everyone',
      handler: async (ctx) => {
        const mentions = (ctx.msg.mentions ?? []).map(normalizeJid);
        const a = mentions[0] ?? ctx.senderJid;
        const b = mentions[1] ?? mentions[0] ?? null;
        if (!b) throw new ValidationError('Mention someone to ship with (optionally two people).');
        const percent = shipPercent(a, b);
        await ctx.reply(`💘 *Ship report*\n${dj(a)} ❤️ ${dj(b)}\n${shipBar(percent)} ${percent}%`);
      },
    },
    {
      name: 'compliment',
      category: 'games',
      description: 'Give (or receive) a compliment',
      access: 'everyone',
      handler: async (ctx) => {
        const mentions = (ctx.msg.mentions ?? []).map(normalizeJid);
        const target = mentions[0] ?? ctx.senderJid;
        await ctx.reply(`💐 @${dj(target)} — ${pickRandom(COMPLIMENTS)}`, { mentions: [target] });
      },
    },
    {
      name: 'roast',
      category: 'games',
      description: 'Playful roast (keep it friendly!)',
      access: 'everyone',
      handler: async (ctx) => {
        const mentions = (ctx.msg.mentions ?? []).map(normalizeJid);
        const target = mentions[0] ?? ctx.senderJid;
        await ctx.reply(`🔥 @${dj(target)} — ${pickRandom(ROASTS)}`, { mentions: [target] });
      },
    },
    {
      name: 'ttt',
      aliases: ['tictactoe'],
      category: 'games',
      description: 'Tic-tac-toe: vs bot, or challenge with .ttt @user',
      args: '[@user | move <1-9> | cancel]',
      access: 'everyone',
      groupOnly: false,
      handler: tictactoeHandler(games),
    },
  ]);
}

function makeTicTacToeCommands(games) {
  void games;
  return []; // ttt registered once below (avoids duplicate names)
}

function tictactoeHandler(games) {
  return async (ctx) => {
    const sub = (ctx.args[0] ?? '').toLowerCase();
    const prefix = ctx.services.config?.prefix ?? '.';

    if (sub === 'cancel') {
      const g = games.findGameFor(ctx.chatJid, ctx.senderJid);
      if (!g) {
        await ctx.reply('No active game to cancel.');
        return;
      }
      games.endGame(ctx.chatJid, g.playerX, g.playerO ?? ctx.senderJid);
      await ctx.reply('🛑 Tic-tac-toe game cancelled.');
      return;
    }

    if (sub === 'move' || /^\d$/.test(sub)) {
      const game = games.findGameFor(ctx.chatJid, ctx.senderJid);
      if (!game) {
        await ctx.reply(`No active game. Start one with ${prefix}ttt (vs bot) or ${prefix}ttt @user.`);
        return;
      }
      const cell = Number(sub === 'move' ? ctx.args[1] : sub) - 1;
      const res = game.move(ctx.senderJid, cell);
      if (!res.ok) {
        await ctx.reply(`⚠️ ${res.error}`);
        return;
      }
      if (game.playerO === null && game.currentTurnJid() === 'bot' && !game.winner) {
        game.botMove();
      }
      await ctx.reply(game.render());
      if (game.winner) {
        games.endGame(ctx.chatJid, game.playerX, game.playerO ?? ctx.senderJid);
      }
      return;
    }

    // Challenge flow
    const mentions = (ctx.msg.mentions ?? []).map(normalizeJid).filter((j) => j !== ctx.senderJid);
    if (mentions.length > 0) {
      const target = mentions[0];
      games.createChallenge(ctx.chatJid, ctx.senderJid, target, 'ttt');
      await ctx.reply(
        `🎮 @${dj(target)} — you have been challenged to Tic-Tac-Toe by @${dj(ctx.senderJid)}!\n` +
          `Accept with ${prefix}ttt accept  (or ${prefix}ttt decline)`,
        { mentions: [target, ctx.senderJid] },
      );
      return;
    }

    if (sub === 'accept' || sub === 'decline') {
      // find any challenge addressed to me
      const found = games.consumeChallengeTo(ctx.chatJid, ctx.senderJid);
      if (!found) {
        await ctx.reply('There is no pending challenge for you.');
        return;
      }
      if (sub === 'decline') {
        await ctx.reply(`@${dj(found.from)} — the challenge was declined.`, { mentions: [found.from] });
        return;
      }
      const created = games.createGame(ctx.chatJid, found.from, found.to, new TicTacToe({
        playerX: found.from,
        playerO: found.to,
      }));
      if (!created.ok) {
        await ctx.reply(`⚠️ ${created.error}`);
        return;
      }
      await ctx.reply(created.game.render(), { mentions: [found.from, found.to] });
      return;
    }

    // default: new game vs bot
    const created = games.createGame(ctx.chatJid, ctx.senderJid, ctx.senderJid, new TicTacToe({
      playerX: ctx.senderJid,
      playerO: null,
    }));
    // vs-bot games keyed by (sender, sender) — isolate via registry key
    if (!created.ok) {
      await ctx.reply(`⚠️ ${created.error}`);
      return;
    }
    await ctx.reply(`🎮 Tic-Tac-Toe vs the bot! You are ❌.\nMove with ${prefix}ttt move <1-9>\n\n${created.game.render()}`);
  };
}
