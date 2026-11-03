/**
 * H5 Go Game - rules engine
 *
 * Implements a Go (囲碁 / 围棋) rules engine:
 *  - Legal move checking (occupied, liberties/suicide)
 *  - Capturing opponent stones
 *  - Simple ko rule
 *  - Pass handling and consecutive-pass game end
 *  - Scoring using Chinese (area) or Japanese (territory) counting
 *
 * The board is stored as a flat array of size*size integers where 0 = empty,
 * 1 = black, 2 = white. Row `r`, column `c` maps to index r*size + c.
 */

(function (global) {
  'use strict';

  var EMPTY = 0;
  var BLACK = 1;
  var WHITE = 2;

  var TYPE_CHINESE = 'chinese';
  var TYPE_JAPANESE = 'japanese';

  function idx(row, col, size) {
    return row * size + col;
  }

  function neighbors(row, col, size) {
    var out = [];
    if (row > 0) out.push([row - 1, col]);
    if (row < size - 1) out.push([row + 1, col]);
    if (col > 0) out.push([row, col - 1]);
    if (col < size - 1) out.push([row, col + 1]);
    return out;
  }

  /**
   * Collect all stones connected to (row,col) of `color`, returning a Set of
   * indices. If `liberties` is provided, adds adjacent empty indices to it.
   */
  function findGroup(board, size, row, col, color, liberties) {
    var group = new Set();
    var queue = [[row, col]];
    group.add(idx(row, col, size));
    while (queue.length) {
      var pos = queue.pop();
      var nb = neighbors(pos[0], pos[1], size);
      for (var i = 0; i < nb.length; i++) {
        var n = nb[i];
        var ni = idx(n[0], n[1], size);
        if (group.has(ni)) continue;
        var v = board[ni];
        if (v === color) {
          group.add(ni);
          queue.push([n[0], n[1]]);
        } else if (v === EMPTY && liberties) {
          liberties.add(ni);
        }
      }
    }
    return group;
  }

  /**
   * Simulate placing `color` at (row,col) on a copy and return:
   *  - capturedSkips: array of captured stone indices
   *  - resultBoard: the modified copy
   *  - ok, reason
   */
  function simulateMove(board, size, row, col, color) {
    var i = idx(row, col, size);
    if (board[i] !== EMPTY) {
      return { ok: false, reason: 'occupied' };
    }
    var copy = board.slice();
    copy[i] = color;
    var opponent = color === BLACK ? WHITE : BLACK;
    var captured = [];

    var nb = neighbors(row, col, size);
    for (var j = 0; j < nb.length; j++) {
      var p = nb[j];
      var pi = idx(p[0], p[1], size);
      if (copy[pi] === opponent) {
        var libs = new Set();
        findGroup(copy, size, p[0], p[1], opponent, libs);
        if (libs.size === 0) {
          var grp = findGroup(copy, size, p[0], p[1], opponent, null);
          grp.forEach(function (gi) {
            copy[gi] = EMPTY;
            captured.push(gi);
          });
        }
      }
    }

    // Suicide: after captures (or none), the placed stone must have a liberty.
    var ownLibs = new Set();
    findGroup(copy, size, row, col, color, ownLibs);
    if (ownLibs.size === 0) {
      return { ok: false, reason: 'suicide' };
    }

    return { ok: true, board: copy, captured: captured };
  }

  function emptyBoard(size) {
    var b = new Array(size * size);
    for (var i = 0; i < b.length; i++) b[i] = EMPTY;
    return b;
  }

  /**
   * GoGame: a single Go game with full undo history and simple-ko tracking.
   */
  function GoGame(options) {
    options = options || {};
    this.size = options.size || 9;
    this.ruleType = options.ruleType || TYPE_CHINESE;
    this.reset();
  }

  GoGame.prototype.reset = function () {
    var s = this.size;
    this.board = emptyBoard(s);
    this.turn = BLACK;
    this.passes = 0;
    this.lastMove = null;
    this.history = [];
    this.captured = { 1: 0, 2: 0 };
    this.koPoint = null; // index of the single stone captured last move, or null
    this.moveLog = [];
    this.gameOver = false;
  };

  /**
   * Play a stone for the current turn. Returns {ok, reason, ...}.
   */
  GoGame.prototype.play = function (row, col) {
    if (this.gameOver) return { ok: false, reason: 'finished' };
    var color = this.turn;
    // Simple ko: cannot play on the point where the opponent just captured a
    // single stone (immediate recapture forbidden).
    var target = idx(row, col, this.size);
    if (this.board[target] !== EMPTY) {
      return { ok: false, reason: 'occupied' };
    }
    // Simple ko: after a move captures exactly one stone, the opponent may not
    // immediately play on the captured stone's point (which would recapture and
    // restore the previous position).
    if (this.koPoint === target) {
      return { ok: false, reason: 'ko' };
    }

    var sim = simulateMove(this.board, this.size, row, col, color);
    if (!sim.ok) return sim;

    // Save snapshot for undo before mutating.
    this.history.push({
      board: this.board.slice(),
      turn: this.turn,
      passes: this.passes,
      captured: Object.assign({}, this.captured),
      lastMove: this.lastMove,
      koPoint: this.koPoint,
      moveLogLength: this.moveLog.length
    });

    this.board = sim.board;
    var capturedCount = sim.captured.length;
    this.captured[color] += capturedCount;

    // Simple ko: if exactly one stone was captured, the opponent may not, on the
    // very next move, play on the captured stone's point (which would recreate
    // the pre-capture position). Multiple captures or zero captures clear it.
    if (capturedCount === 1) {
      this.koPoint = sim.captured[0];
    } else {
      this.koPoint = null;
    }

    this.passes = 0;
    this.lastMove = { row: row, col: col, color: color, index: target };
    this.moveLog.push({
      move: color,
      row: row,
      col: col,
      captured: capturedCount,
      number: this.history.length
    });

    this.turn = color === BLACK ? WHITE : BLACK;
    return { ok: true, move: this.lastMove, capturedCount: capturedCount };
  };

  /**
   * Pass for the current turn.
   */
  GoGame.prototype.pass = function () {
    if (this.gameOver) return { ok: false, reason: 'finished' };
    var color = this.turn;
    this.history.push({
      board: this.board.slice(),
      turn: this.turn,
      passes: this.passes,
      captured: Object.assign({}, this.captured),
      lastMove: this.lastMove,
      koPoint: this.koPoint,
      moveLogLength: this.moveLog.length
    });
    this.passes += 1;
    this.koPoint = null; // a pass breaks the ko shape
    this.lastMove = null;
    this.moveLog.push({ move: color, pass: true });
    this.turn = color === BLACK ? WHITE : BLACK;
    if (this.passes >= 2) {
      this.gameOver = true;
    }
    return { ok: true, gameOver: this.gameOver };
  };

  /**
   * Undo the last action (stone or pass). Returns true on success.
   */
  GoGame.prototype.undo = function () {
    var snap = this.history.pop();
    if (!snap) return false;
    this.board = snap.board.slice();
    this.turn = snap.turn;
    this.passes = snap.passes;
    this.captured = Object.assign({}, snap.captured);
    this.lastMove = snap.lastMove;
    this.koPoint = snap.koPoint;
    this.moveLog.length = snap.moveLogLength;
    this.gameOver = snap.passes >= 2;
    return true;
  };

  /**
   * Determine final ownership of every point for scoring.
   * Returns the marks array: 1 black, 2 white, or 3 for dame/neutral.
   */
  GoGame.prototype.computeTerritory = function () {
    var s = this.size;
    var marks = this.board.slice();
    var visited = new Array(s * s).fill(false);

    for (var r = 0; r < s; r++) {
      for (var c = 0; c < s; c++) {
        var ii = idx(r, c, s);
        if (visited[ii] || marks[ii] !== EMPTY) continue;
        // BFS the empty region.
        var region = [];
        var queue = [[r, c]];
        var touching = new Set();
        visited[ii] = true;
        while (queue.length) {
          var cur = queue.pop();
          region.push(cur);
          var nb = neighbors(cur[0], cur[1], s);
          for (var k = 0; k < nb.length; k++) {
            var ni = idx(nb[k][0], nb[k][1], s);
            if (marks[ni] !== EMPTY) {
              touching.add(marks[ni]);
              continue;
            }
            if (visited[ni]) continue;
            visited[ni] = true;
            queue.push([nb[k][0], nb[k][1]]);
          }
        }
        var owner;
        if (touching.size === 1) {
          owner = touching.values().next().value; // BLACK or WHITE
        } else {
          owner = 3; // dame: bordered by both colors (or no stones)
        }
        region.forEach(function (p) {
          marks[idx(p[0], p[1], s)] = owner;
        });
      }
    }
    return marks;
  };

  /**
   * Score the final position. Returns { black, white, captures, winner, ... }.
   */
  GoGame.prototype.score = function () {
    var s = this.size;
    var marks = this.computeTerritory();
    var blackStones = 0;
    var whiteStones = 0;
    var blackTerritory = 0;
    var whiteTerritory = 0;
    var dame = 0;

    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      var live = this.board[i];
      if (live === BLACK) blackStones++;
      else if (live === WHITE) whiteStones++;
      else if (m === BLACK) blackTerritory++;
      else if (m === WHITE) whiteTerritory++;
      else if (m === 3) dame++;
    }

    var black, white;
    if (this.ruleType === TYPE_JAPANESE) {
      // Score = territory (empty owned) + opponent's captured stones.
      black = blackTerritory + this.captured[WHITE];
      white = whiteTerritory + this.captured[BLACK];
    } else {
      // Chinese area counting: territory + own living stones (equivalent to
      // all points owned). Dame is split.
      black = blackTerritory + blackStones + dame / 2;
      white = whiteTerritory + whiteStones + dame / 2;
    }

    // Add komi to white's score (first-player advantage compensation).
    var komi = 0.5;
    var whiteTotal = white + komi;
    var blackTotal = black;
    var winner = whiteTotal > blackTotal ? WHITE : (blackTotal > whiteTotal ? BLACK : null);

    return {
      black: black,
      white: white,
      blackTotal: blackTotal,
      whiteTotal: whiteTotal,
      komi: komi,
      blackTerritory: blackTerritory,
      whiteTerritory: whiteTerritory,
      blackStones: blackStones,
      whiteStones: whiteStones,
      captures: { black: this.captured[BLACK], white: this.captured[WHITE] },
      winner: winner
    };
  };

  global.GoGame = GoGame;
  global.GO = {
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    TYPE_CHINESE: TYPE_CHINESE,
    TYPE_JAPANESE: TYPE_JAPANESE
  };
})(typeof window !== 'undefined' ? window : globalThis);