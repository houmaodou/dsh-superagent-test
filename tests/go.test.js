'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { EMPTY, BLACK, WHITE, GoGame } = require('../js/go.js');

// Convenience: build a game and return it.
function newGame(size = 5, komi = 7.5) {
  return new GoGame(size, komi);
}

test('black plays first and turns alternate', () => {
  const g = newGame();
  assert.strictEqual(g.turn, BLACK);
  const r = g.play(2, 2);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(g.board[g.idx(2, 2)], BLACK);
  assert.strictEqual(g.turn, WHITE);
  const r2 = g.play(3, 2);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(g.board[g.idx(3, 2)], WHITE);
  assert.strictEqual(g.turn, BLACK);
});

test('playing on an occupied or out-of-bounds point is rejected', () => {
  const g = newGame();
  g.play(2, 2);
  assert.deepStrictEqual(g.play(2, 2), { ok: false, reason: 'occupied' });
  assert.deepStrictEqual(g.play(-1, 2), { ok: false, reason: 'out-of-bounds' });
  assert.deepStrictEqual(g.play(5, 2), { ok: false, reason: 'out-of-bounds' });
});

test('capture: a surrounded stone is removed and counted', () => {
  const g = newGame();
  // White stone at (2,2), black stones on three of its four liberties.
  g.board[g.idx(2, 2)] = WHITE;
  g.board[g.idx(1, 2)] = BLACK;
  g.board[g.idx(2, 1)] = BLACK;
  g.board[g.idx(3, 2)] = BLACK;
  g.turn = BLACK;
  const r = g.play(2, 3); // fill the last liberty
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.captured, 1);
  assert.strictEqual(g.board[g.idx(2, 2)], EMPTY);
  assert.strictEqual(g.captures[BLACK], 1);
});

test('suicide is rejected and the board is unchanged', () => {
  const g = newGame();
  g.board[g.idx(1, 0)] = WHITE;
  g.board[g.idx(0, 1)] = WHITE;
  g.turn = BLACK;
  const before = Array.from(g.board);
  const r = g.play(0, 0); // (0,0) would have no liberties and capture nothing
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'suicide');
  assert.deepStrictEqual(Array.from(g.board), before);
  assert.strictEqual(g.turn, BLACK); // move consumed -> still black to play
});

test('ko: immediate recapture of a single stone is forbidden, then allowed', () => {
  const g = newGame();
  // Basic ko shape (5x5). White single stone at (1,1) has one liberty at (1,2).
  // Black's capturing stone at (1,2) then has exactly one liberty at (1,1).
  g.board[g.idx(1, 0)] = BLACK;
  g.board[g.idx(0, 1)] = BLACK;
  g.board[g.idx(2, 1)] = BLACK;
  g.board[g.idx(1, 1)] = WHITE;
  g.board[g.idx(0, 2)] = WHITE;
  g.board[g.idx(2, 2)] = WHITE;
  g.board[g.idx(1, 3)] = WHITE;
  g.turn = BLACK;

  const r = g.play(1, 2);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.captured, 1);
  assert.strictEqual(g.board[g.idx(1, 1)], EMPTY);
  assert.strictEqual(g.turn, WHITE);

  // White may not recapture immediately at (1,1).
  const ko = g.play(1, 1);
  assert.strictEqual(ko.ok, false);
  assert.strictEqual(ko.reason, 'ko');
  assert.strictEqual(g.board[g.idx(1, 1)], EMPTY);

  // White plays elsewhere; ko clears.
  const other = g.play(4, 4);
  assert.strictEqual(other.ok, true);
  assert.strictEqual(g.turn, BLACK);

  // Black plays a filler move, then White may recapture the single stone.
  const filler = g.play(0, 0);
  assert.strictEqual(filler.ok, true);
  assert.strictEqual(g.turn, WHITE);
  const recapture = g.play(1, 1);
  assert.strictEqual(recapture.ok, true);
  assert.strictEqual(g.board[g.idx(1, 2)], EMPTY);
});

test('undo (悔棋) restores the previous position', () => {
  const g = newGame();
  assert.strictEqual(g.undo(), false); // nothing to undo
  g.play(2, 2);
  g.play(2, 3);
  assert.strictEqual(g.board[g.idx(2, 2)], BLACK);
  assert.strictEqual(g.board[g.idx(2, 3)], WHITE);
  assert.strictEqual(g.undo(), true);
  assert.strictEqual(g.board[g.idx(2, 3)], EMPTY); // white move undone
  assert.strictEqual(g.turn, WHITE);
  assert.strictEqual(g.undo(), true);
  assert.strictEqual(g.board[g.idx(2, 2)], EMPTY); // black move undone
  assert.strictEqual(g.turn, BLACK);
});

test('two consecutive passes end the game', () => {
  const g = newGame();
  g.pass();
  assert.strictEqual(g.over, false);
  g.pass();
  assert.strictEqual(g.over, true);
  assert.deepStrictEqual(g.play(2, 2), { ok: false, reason: 'game-over' });
});

test('scoring counts territory, captures and komi', () => {
  const g = newGame(5, 7.5);
  // Black encloses (0,0); white encloses (4,4); the rest is neutral (dame).
  g.board[g.idx(1, 0)] = BLACK;
  g.board[g.idx(0, 1)] = BLACK;
  g.board[g.idx(1, 1)] = BLACK;
  g.board[g.idx(3, 4)] = WHITE;
  g.board[g.idx(4, 3)] = WHITE;
  g.board[g.idx(3, 3)] = WHITE;
  g.captures[BLACK] = 2;
  g.captures[WHITE] = 1;
  const s = g.score();
  assert.strictEqual(s.blackTerritory, 1);
  assert.strictEqual(s.whiteTerritory, 1);
  assert.strictEqual(s.blackScore, 1 + 2);         // territory 1 + captures 2
  assert.strictEqual(s.whiteScore, 1 + 1 + 7.5);   // territory 1 + captures 1 + komi
  assert.strictEqual(s.winner, WHITE);
});

test('AI (suggestMove) returns a legal move or null, and never suicide', () => {
  const g = newGame();
  const first = g.suggestMove(BLACK);
  assert.notStrictEqual(first, null);
  const r1 = g.play(first.x, first.y);
  assert.strictEqual(r1.ok, true);

  // A few random AI-vs-AI plies should all be legal.
  for (let i = 0; i < 12; i++) {
    const mv = g.suggestMove(g.turn);
    if (mv === null) { g.pass(); continue; }
    const r = g.play(mv.x, mv.y);
    assert.strictEqual(r.ok, true, `AI move ${i} should be legal`);
  }
});

test('clone() is independent of the source game', () => {
  const g = newGame();
  g.play(2, 2);
  const c = g.clone();
  c.play(2, 3);
  assert.strictEqual(g.board[g.idx(2, 3)], EMPTY); // original untouched
  assert.strictEqual(c.board[g.idx(2, 3)], WHITE);
});