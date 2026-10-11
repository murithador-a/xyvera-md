import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TicTacToe,
  GameRegistry,
  tttResult,
  rpsPlay,
  Hangman,
  triviaQuestion,
  triviaCheck,
  shipPercent,
  rollDice,
  flipCoin,
} from '../src/services/gameEngine.js';

const P1 = '15550000001@s.whatsapp.net';
const P2 = '15550000002@s.whatsapp.net';

function moveSequence(game, cells, jids) {
  const results = [];
  for (let i = 0; i < cells.length; i += 1) {
    results.push(game.move(jids[i % jids.length], cells[i]));
  }
  return results;
}

test('ttt: win detection on rows, cols, diagonals', () => {
  assert.equal(tttResult(['X', 'X', 'X', null, null, null, null, null, null]), 'X');
  assert.equal(tttResult(['O', null, null, 'O', null, null, 'O', null, null]), 'O');
  assert.equal(tttResult(['X', null, null, null, 'X', null, null, null, 'X']), 'X');
  assert.equal(tttResult(['X', 'O', 'X', 'O', 'X', 'O', 'O', 'X', 'O']), 'draw');
  assert.equal(tttResult(['X', 'O', null, null, null, null, null, null, null]), null);
});

test('ttt: turn order enforced', () => {
  const g = new TicTacToe({ playerX: P1, playerO: P2 });
  const wrong = g.move(P2, 0);
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /not your turn/i);
  assert.equal(g.move(P1, 0).ok, true);
});

test('ttt: cannot overwrite cells or play after finish', () => {
  const g = new TicTacToe({ playerX: P1, playerO: P2 });
  g.move(P1, 0);
  assert.equal(g.move(P2, 0).ok, false);
  // P1 wins down the left column
  g.move(P2, 3);
  g.move(P1, 1);
  g.move(P2, 4);
  const win = g.move(P1, 2);
  assert.equal(win.winner, 'X');
  assert.equal(g.move(P2, 5).ok, false);
  assert.match(g.move(P1, 5).error, /finished/i);
});

test('ttt: draw detection', () => {
  const g = new TicTacToe({ playerX: P1, playerO: P2 });
  // X O X
  // X O O
  // O X X
  moveSequence(g, [0, 1, 2, 4, 3, 5, 7, 6, 8], [P1, P2]);
  assert.equal(g.winner, 'draw');
});

test('ttt: outsiders cannot play', () => {
  const g = new TicTacToe({ playerX: P1, playerO: P2 });
  const res = g.move('15559999999@s.whatsapp.net', 0);
  assert.equal(res.ok, false);
  assert.match(res.error, /not part/i);
});

test('ttt: cell validation', () => {
  const g = new TicTacToe({ playerX: P1, playerO: P2 });
  assert.equal(g.move(P1, 9).ok, false);
  assert.equal(g.move(P1, -1).ok, false);
  assert.equal(g.move(P1, 1.5).ok, false);
});

test('ttt: bot blocks an immediate threat and takes wins', () => {
  // X . .
  // O O .
  // X . .
  const g = new TicTacToe({ playerX: P1, playerO: null });
  g.move(P1, 0); // X top-left
  g.botMove(); // bot takes something (center likely)
  g.move(P1, 6); // X bottom-left — threatens col 0 win if it gets 3
  // It's bot's turn; bot should not blindly play.
  const res = g.botMove();
  assert.equal(res.ok, true);
  // Bot should never leave a winning line for X on next move when it can block;
  // verify no immediate X win available after bot's move
  const board = g.board;
  for (let i = 0; i < 9; i += 1) {
    if (board[i] !== null) continue;
    board[i] = 'X';
    if (tttResult(board) === 'X') assert.fail(`bot left a winning cell ${i} open`);
    board[i] = null;
  }
});

test('ttt: game registry isolates games per chat and players', () => {
  const reg = new GameRegistry();
  const g1 = reg.createGame('c1@g.us', P1, P2, new TicTacToe({ playerX: P1, playerO: P2 }));
  assert.equal(g1.ok, true);
  const dup = reg.createGame('c1@g.us', P2, P1, new TicTacToe({ playerX: P1, playerO: P2 }));
  assert.equal(dup.ok, false);
  const other = reg.createGame('c2@g.us', P1, P2, new TicTacToe({ playerX: P1, playerO: P2 }));
  assert.equal(other.ok, true);
  assert.ok(reg.findGameFor('c1@g.us', P1));
  assert.equal(reg.findGameFor('c2@g.us', P1), other.game);
});

test('ttt: challenges can be accepted/declined and expire', () => {
  let now = 0;
  const reg = new GameRegistry({ ttlMs: 1000, now: () => now });
  reg.createChallenge('c@g.us', P1, P2);
  const rec = reg.consumeChallengeTo('c@g.us', P2);
  assert.equal(rec.from, P1);
  assert.equal(reg.consumeChallengeTo('c@g.us', P2), null);

  reg.createChallenge('c@g.us', P1, P2);
  now = 2000;
  assert.equal(reg.consumeChallengeTo('c@g.us', P2), null); // expired
});

test('ttt: render includes board and turn state', () => {
  const g = new TicTacToe({ playerX: P1, playerO: P2 });
  g.move(P1, 4);
  const text = g.render();
  assert.match(text, /Tic-Tac-Toe/);
  assert.match(text, /⭕/); // O's turn
});

test('rps: win/lose/draw logic', () => {
  assert.equal(rpsPlay('rock', 'scissors').result, 'win');
  assert.equal(rpsPlay('rock', 'paper').result, 'lose');
  assert.equal(rpsPlay('rock', 'rock').result, 'draw');
  assert.equal(rpsPlay('laser', 'rock').ok, false);
});

test('hangman: whole-word win, wrong guesses lose, case-insensitive', () => {
  const h = new Hangman({ word: 'cat' });
  assert.equal(h.guess('a').ok, true);
  assert.equal(h.guess('c').ok, true);
  const win = h.guess('t');
  assert.equal(win.won, true);

  const h2 = new Hangman({ word: 'dog', maxWrong: 2 });
  h2.guess('x');
  const lose = h2.guess('y');
  assert.equal(lose.lost, true);
  assert.equal(lose.word, 'dog');

  const h3 = new Hangman({ word: 'hi' });
  assert.equal(h3.guess('HI').won, true);
});

test('trivia: answer checking is case-insensitive and trimmed', () => {
  const q = triviaQuestion(0);
  assert.equal(triviaCheck(q, '  PARIS  '), true);
  assert.equal(triviaCheck(q, 'london'), false);
});

test('ship: deterministic per pair/day, in range', () => {
  const p1 = shipPercent(P1, P2, '2026-10-11');
  const p2 = shipPercent(P2, P1, '2026-10-11');
  assert.equal(p1, p2);
  assert.ok(p1 >= 1 && p1 <= 100);
});

test('dice: bounds respected', () => {
  const { rolls, total, sides } = rollDice(6, 3);
  assert.equal(rolls.length, 3);
  assert.equal(sides, 6);
  assert.ok(rolls.every((r) => r >= 1 && r <= 6));
  assert.equal(total, rolls.reduce((a, b) => a + b, 0));
  assert.ok(['heads', 'tails'].includes(flipCoin()));
});
