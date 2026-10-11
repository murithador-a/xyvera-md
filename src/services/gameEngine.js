/**
 * Game engine — pure logic, no gambling/wagers anywhere.
 * Tic-tac-toe is the fully specified game (turns, win/draw, challenges,
 * timeouts); other games are small self-contained modules.
 */

// ── Tic-Tac-Toe ─────────────────────────────────────────────────────────

export const TTT_WIN_LINES = Object.freeze([
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6], // diagonals
]);

/** @returns {'X'|'O'|'draw'|null} */
export function tttResult(board) {
  for (const [a, b, c] of TTT_WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every((cell) => cell !== null) ? 'draw' : null;
}

export class TicTacToe {
  /**
   * @param {{ playerX: string, playerO: string|null, now?: () => number }} opts
   * playerO === null means "play against the bot".
   */
  constructor({ playerX, playerO = null, now = () => Date.now() }) {
    if (!playerX) throw new Error('playerX is required');
    this.playerX = playerX;
    this.playerO = playerO; // null => bot
    this.board = Array(9).fill(null);
    this.turn = 'X';
    this.winner = null; // 'X' | 'O' | 'draw' | null
    this.createdAt = now();
    this.lastMoveAt = now();
    this.now = now;
    this.moveCount = 0;
  }

  isParticipant(jid) {
    return jid === this.playerX || (this.playerO !== null && jid === this.playerO);
  }

  symbolOf(jid) {
    if (jid === this.playerX) return 'X';
    if (this.playerO === null) return jid === 'bot' ? 'O' : null;
    return jid === this.playerO ? 'O' : null;
  }

  /** Whose turn: returns the JID, or 'bot' when it is the bot's turn. */
  currentTurnJid() {
    if (this.turn === 'X') return this.playerX;
    return this.playerO ?? 'bot';
  }

  /**
   * @param {string} jid  player making the move
   * @param {number} cell 0..8
   * @returns {{ ok: boolean, error?: string, board?: any[], winner?: string|null }}
   */
  move(jid, cell) {
    if (this.winner) return { ok: false, error: 'Game is already finished.' };
    const symbol = this.symbolOf(jid);
    if (!symbol) return { ok: false, error: 'You are not part of this game.' };
    if (this.turn !== symbol) return { ok: false, error: 'It is not your turn.' };
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { ok: false, error: 'Cell must be 0-8.' };
    if (this.board[cell] !== null) return { ok: false, error: 'That cell is taken.' };

    this.board[cell] = symbol;
    this.moveCount += 1;
    this.lastMoveAt = this.now();
    const result = tttResult(this.board);
    if (result) this.winner = result;
    else this.turn = symbol === 'X' ? 'O' : 'X';
    return { ok: true, board: [...this.board], winner: this.winner };
  }

  /** Simple bot move: win if possible, block if needed, else first free cell. */
  botMove() {
    if (this.winner || this.playerO !== null || this.turn !== 'O') return { ok: false, error: 'Not the bot turn.' };
    const pick = (symbol) => {
      for (let i = 0; i < 9; i += 1) {
        if (this.board[i] !== null) continue;
        this.board[i] = symbol;
        const win = tttResult(this.board) === symbol;
        this.board[i] = null;
        if (win) return i;
      }
      return null;
    };
    const win = pick('O');
    const block = pick('X');
    const center = this.board[4] === null ? 4 : null;
    const firstFree = this.board.findIndex((c) => c === null);
    const cell = win ?? block ?? center ?? firstFree;
    return this.move('bot', cell >= 0 ? cell : 0);
  }

  /** Render for WhatsApp (single message, mobile friendly). */
  render() {
    const sym = (i) => (this.board[i] === 'X' ? '❌' : this.board[i] === 'O' ? '⭕' : String(i + 1));
    const rows = [0, 3, 6].map((r) => `${sym(r)} │ ${sym(r + 1)} │ ${sym(r + 2)}`);
    const sep = '──┼───┼──';
    const status = this.winner
      ? this.winner === 'draw'
        ? "It's a draw! 🤝"
        : `Winner: ${this.winner === 'X' ? '❌' : '⭕'} ${this.winner === 'X' ? this.playerX : this.playerO ?? 'Bot'}`
      : `Turn: ${this.turn === 'X' ? '❌' : '⭕'} ${this.currentTurnJid()}`;
    return `*Tic-Tac-Toe*\n${rows.join(`\n${sep}\n`)}\n\n${status}`;
  }

  isExpired(ttlMs, nowMs = this.now()) {
    return nowMs - this.lastMoveAt > ttlMs;
  }
}

/** In-memory registry of active games, isolated per (chat, players). */
export class GameRegistry {
  constructor({ ttlMs = 5 * 60_000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    /** @type {Map<string, any>} */
    this.games = new Map();
    /** @type {Map<string, { from: string, to: string, game: string, expiresAt: number }>} */
    this.challenges = new Map();
  }

  _key(chatJid, a, b) {
    return [chatJid, ...[a, b].sort()].join('|');
  }

  createGame(chatJid, playerA, playerB, game) {
    this.prune();
    const key = this._key(chatJid, playerA, playerB);
    if (this.games.has(key)) return { ok: false, error: 'A game between these players is already in progress.' };
    this.games.set(key, game);
    return { ok: true, key, game };
  }

  getGame(chatJid, playerA, playerB) {
    this.prune();
    return this.games.get(this._key(chatJid, playerA, playerB)) ?? null;
  }

  findGameFor(chatJid, jid) {
    this.prune();
    for (const [key, game] of this.games) {
      if (key.startsWith(`${chatJid}|`) && game.isParticipant?.(jid)) return game;
    }
    return null;
  }

  endGame(chatJid, playerA, playerB) {
    return this.games.delete(this._key(chatJid, playerA, playerB));
  }

  createChallenge(chatJid, from, to, game = 'ttt') {
    this.prune();
    this.challenges.set(this._key(chatJid, from, to), { from, to, game, expiresAt: this.now() + this.ttlMs });
    return { ok: true };
  }

  getChallenge(chatJid, a, b) {
    this.prune();
    return this.challenges.get(this._key(chatJid, a, b)) ?? null;
  }

  consumeChallenge(chatJid, a, b) {
    const key = this._key(chatJid, a, b);
    const rec = this.challenges.get(key) ?? null;
    if (rec) this.challenges.delete(key);
    return rec;
  }

  /** Consume any pending challenge addressed TO `toJid` in this chat. */
  consumeChallengeTo(chatJid, toJid) {
    this.prune();
    for (const [key, rec] of this.challenges) {
      if (key.startsWith(`${chatJid}|`) && rec.to === toJid) {
        this.challenges.delete(key);
        return rec;
      }
    }
    return null;
  }

  prune() {
    const t = this.now();
    for (const [k, g] of this.games) {
      if (g.isExpired?.(this.ttlMs, t)) this.games.delete(k);
    }
    for (const [k, c] of this.challenges) {
      if (c.expiresAt <= t) this.challenges.delete(k);
    }
  }
}

// ── Rock-Paper-Scissors ─────────────────────────────────────────────────

export const RPS_MOVES = Object.freeze(['rock', 'paper', 'scissors']);
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const RPS_EMOJI = { rock: '🪨', paper: '📄', scissors: '✂️' };

export function rpsPlay(playerMove, opponentMove) {
  const a = String(playerMove).toLowerCase();
  const b = String(opponentMove).toLowerCase();
  if (!RPS_MOVES.includes(a) || !RPS_MOVES.includes(b)) {
    return { ok: false, error: `Move must be one of: ${RPS_MOVES.join(', ')}.` };
  }
  if (a === b) return { ok: true, result: 'draw', you: RPS_EMOJI[a], opponent: RPS_EMOJI[b] };
  const win = RPS_BEATS[a] === b;
  return { ok: true, result: win ? 'win' : 'lose', you: RPS_EMOJI[a], opponent: RPS_EMOJI[b] };
}

// ── Dice / coin / 8ball ─────────────────────────────────────────────────

export function rollDice(sides = 6, count = 1) {
  const s = Math.min(Math.max(Number(sides) || 6, 2), 1000);
  const n = Math.min(Math.max(Number(count) || 1, 1), 10);
  const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * s));
  return { rolls, total: rolls.reduce((x, y) => x + y, 0), sides: s };
}

export function flipCoin() {
  return Math.random() < 0.5 ? 'heads' : 'tails';
}

export const EIGHT_BALL_RESPONSES = Object.freeze([
  'It is certain.', 'It is decidedly so.', 'Without a doubt.', 'Yes — definitely.',
  'You may rely on it.', 'As I see it, yes.', 'Most likely.', 'Outlook good.',
  'Yes.', 'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.',
  'Better not tell you now.', 'Cannot predict now.', 'Concentrate and ask again.',
  "Don't count on it.", 'My reply is no.', 'My sources say no.',
  'Outlook not so good.', 'Very doubtful.',
]);

export function eightBall() {
  return EIGHT_BALL_RESPONSES[Math.floor(Math.random() * EIGHT_BALL_RESPONSES.length)];
}

// ── Hangman ─────────────────────────────────────────────────────────────

export const HANGMAN_WORDS = Object.freeze([
  'whatsapp', 'javascript', 'keyboard', 'elephant', 'mountain', 'butterfly', 'adventure',
  'computer', 'python', 'giraffe', 'puzzle', 'rainbow', 'universe', 'chocolate',
  'dolphin', 'volcano', 'library', 'xyvera', 'hangman', 'sticker', 'message', 'network',
]);

export class Hangman {
  constructor({ word = null, maxWrong = 6, now = () => Date.now() } = {}) {
    this.word = (word ?? HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)]).toLowerCase();
    this.maxWrong = maxWrong;
    this.guessed = new Set();
    this.wrong = 0;
    this.finished = false;
    this.won = false;
    this.createdAt = now();
    this.now = now;
  }

  display() {
    return [...this.word].map((c) => (this.guessed.has(c) ? c : '_')).join(' ');
  }

  /** @param {string} letterOrWord */
  guess(letterOrWord) {
    if (this.finished) return { ok: false, error: 'Game is over.' };
    const g = String(letterOrWord ?? '').toLowerCase().trim();
    if (!g) return { ok: false, error: 'Provide a letter or a word.' };

    if (g.length > 1) {
      if (g === this.word) {
        this.finished = true;
        this.won = true;
        for (const c of this.word) this.guessed.add(c);
        return { ok: true, won: true, display: this.display(), word: this.word };
      }
      this.wrong += 1;
      if (this.wrong >= this.maxWrong) {
        this.finished = true;
        return { ok: true, lost: true, display: this.display(), word: this.word, wrong: this.wrong };
      }
      return { ok: true, wrongGuess: true, display: this.display(), wrong: this.wrong, maxWrong: this.maxWrong };
    }

    if (!/[a-z0-9]/.test(g)) return { ok: false, error: 'Letters and digits only.' };
    if (this.guessed.has(g)) return { ok: false, error: 'Already guessed.' };
    this.guessed.add(g);

    if (!this.word.includes(g)) {
      this.wrong += 1;
      if (this.wrong >= this.maxWrong) {
        this.finished = true;
        return { ok: true, lost: true, display: this.display(), word: this.word, wrong: this.wrong };
      }
      return { ok: true, wrongGuess: true, display: this.display(), wrong: this.wrong, maxWrong: this.maxWrong };
    }

    const won = [...this.word].every((c) => this.guessed.has(c));
    if (won) {
      this.finished = true;
      this.won = true;
    }
    return { ok: true, won, display: this.display(), wrong: this.wrong };
  }

  isExpired(ttlMs, nowMs = this.now()) {
    return nowMs - this.createdAt > ttlMs;
  }
}

// ── Trivia ──────────────────────────────────────────────────────────────

export const TRIVIA_QUESTIONS = Object.freeze([
  { q: 'What is the capital of France?', a: 'paris', options: ['Paris', 'London', 'Berlin', 'Madrid'] },
  { q: 'Which planet is known as the Red Planet?', a: 'mars', options: ['Venus', 'Mars', 'Jupiter', 'Mercury'] },
  { q: 'What is 2 + 2 × 2?', a: '6', options: ['6', '8', '4', '10'] },
  { q: 'Who wrote "Romeo and Juliet"?', a: 'shakespeare', options: ['Shakespeare', 'Dickens', 'Austen', 'Homer'] },
  { q: 'What is the largest ocean on Earth?', a: 'pacific', options: ['Atlantic', 'Pacific', 'Indian', 'Arctic'] },
  { q: 'How many continents are there?', a: '7', options: ['5', '6', '7', '8'] },
  { q: 'What gas do plants absorb from the atmosphere?', a: 'carbon dioxide', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium'] },
  { q: 'In what year did the first iPhone release?', a: '2007', options: ['2005', '2007', '2009', '2010'] },
  { q: 'What is the chemical symbol for gold?', a: 'au', options: ['Ag', 'Au', 'Gd', 'Go'] },
  { q: 'Which language has the most native speakers?', a: 'mandarin', options: ['English', 'Spanish', 'Mandarin', 'Hindi'] },
]);

export function triviaQuestion(index = null) {
  const i = index === null ? Math.floor(Math.random() * TRIVIA_QUESTIONS.length) : index % TRIVIA_QUESTIONS.length;
  return { index: i, ...TRIVIA_QUESTIONS[i] };
}

export function triviaCheck(question, answer) {
  return String(answer ?? '').toLowerCase().trim() === question.a;
}

// ── Truth / Dare, riddles, fun commands ─────────────────────────────────

export const TRUTHS = Object.freeze([
  'What is the most embarrassing thing you have ever done?',
  'What is a secret talent you have?',
  'Who was your first crush?',
  'What is the longest you have gone without showering?',
  'What is a lie you have told that you regret?',
  'What is your most unusual fear?',
  'What is the strangest food you have ever eaten?',
  'If you could swap lives with anyone for a day, who would it be?',
]);

export const DARES = Object.freeze([
  'Send a voice note singing your favourite song.',
  'Change your WhatsApp about text to something silly for one hour.',
  'Type your last message in ALL CAPS.',
  'Send a selfie making your funniest face.',
  'Compliment the person who sent the last message.',
  'Tell a joke in the group.',
  'Use only emojis for your next three messages.',
  'Let the next person choose your profile picture (where possible).',
]);

export const RIDDLES = Object.freeze([
  { r: 'I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?', a: 'an echo' },
  { r: 'I have cities, but no houses live there. I have mountains, but no trees grow there. I have water, but no fish swim there. What am I?', a: 'a map' },
  { r: 'The more of me you take, the more you leave behind. What am I?', a: 'footsteps' },
  { r: 'I have keys but no locks. I have space but no room. You can enter, but you can’t go outside. What am I?', a: 'a keyboard' },
  { r: 'What can travel around the world while staying in a corner?', a: 'a stamp' },
]);

export const COMPLIMENTS = Object.freeze([
  'You light up this group like a sunrise 🌅',
  'Your vibe is absolutely immaculate ✨',
  'Honestly, this group is better with you in it 💯',
  'You have elite energy today ⚡',
  'If awesome were a person, it would be you 🏆',
  'Your positivity is contagious 😊',
  'You just made my circuits happy 🤖💙',
]);

export const ROASTS = Object.freeze([
  'I would agree with you, but then we would both be wrong 😌',
  'You bring everyone so much joy… when you leave the chat 😜',
  'If laughter is the best medicine, your face must be curing the world 🙃',
  'You are the reason the gene pool needs a lifeguard 🏊',
  'Somewhere out there, a tree is working very hard to replace the oxygen you waste 🌳',
  'Do not worry — even mistakes can be useful. You are proof of that 😇',
]);

export function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** Deterministic "ship" percentage for a pair of names (fun, stable per pair-day). */
export function shipPercent(nameA, nameB, day = new Date().toISOString().slice(0, 10)) {
  const s = `${[nameA, nameB].sort().join('~')}~${day}`;
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return 1 + (h % 100);
}

export function shipBar(percent) {
  const filled = Math.round(percent / 10);
  return '❤️'.repeat(filled) + '🤍'.repeat(10 - filled);
}
