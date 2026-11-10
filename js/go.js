/* H5 Go (围棋) rule engine — pure logic, no DOM dependency.
 * Usable both in the browser (window.GoEngine) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.GoEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EMPTY = 0;
  var BLACK = 1;
  var WHITE = 2;

  function opposite(color) {
    return color === BLACK ? WHITE : BLACK;
  }

  function colorName(color) {
    return color === BLACK ? 'black' : color === WHITE ? 'white' : 'empty';
  }

  function neighbors(size, x, y) {
    var out = [];
    if (x > 0) out.push([x - 1, y]);
    if (x < size - 1) out.push([x + 1, y]);
    if (y > 0) out.push([x, y - 1]);
    if (y < size - 1) out.push([x, y + 1]);
    return out;
  }

  function GoGame(size, komi) {
    if (typeof size !== 'number' || size < 5 || size > 19) {
      throw new Error('size must be an integer between 5 and 19');
    }
    this.size = size;
    this.komi = typeof komi === 'number' ? komi : 7.5;
    this.reset();
  }

  GoGame.prototype.reset = function () {
    var n = this.size * this.size;
    this.board = new Int8Array(n); // 0 empty, 1 black, 2 white
    this.turn = BLACK;             // black plays first
    this.captures = [0, 0, 0];     // indexed by BLACK/WHITE
    this.passes = 0;               // consecutive passes
    this.ko = -1;                  // forbidden recapture point (index) or -1
    this.moveCount = 0;
    this.over = false;
    this.lastMove = -1;
    this.history = [];
    this.record();
  };

  GoGame.prototype.idx = function (x, y) {
    return y * this.size + x;
  };

  GoGame.prototype.inBounds = function (x, y) {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  };

  GoGame.prototype.at = function (x, y) {
    return this.inBounds(x, y) ? this.board[this.idx(x, y)] : -1;
  };

  GoGame.prototype.snapshot = function () {
    return {
      board: Int8Array.from(this.board),
      turn: this.turn,
      capturesB: this.captures[BLACK],
      capturesW: this.captures[WHITE],
      passes: this.passes,
      ko: this.ko,
      moveCount: this.moveCount,
      over: this.over,
      lastMove: this.lastMove,
    };
  };

  GoGame.prototype.restore = function (s) {
    this.board = Int8Array.from(s.board);
    this.turn = s.turn;
    this.captures[BLACK] = s.capturesB;
    this.captures[WHITE] = s.capturesW;
    this.passes = s.passes;
    this.ko = s.ko;
    this.moveCount = s.moveCount;
    this.over = s.over;
    this.lastMove = s.lastMove;
  };

  GoGame.prototype.record = function () {
    this.history.push(this.snapshot());
  };

  // Group containing the stone at (x, y): its stones (indices) and liberties (unique indices).
  GoGame.prototype.group = function (x, y) {
    var size = this.size;
    var color = this.board[this.idx(x, y)];
    var stones = [];
    var libs = [];
    var libSet = new Set();
    var seen = new Uint8Array(size * size);
    var stack = [[x, y]];
    seen[this.idx(x, y)] = 1;
    while (stack.length) {
      var cur = stack.pop();
      var cx = cur[0], cy = cur[1];
      stones.push(this.idx(cx, cy));
      var nbrs = neighbors(size, cx, cy);
      for (var k = 0; k < nbrs.length; k++) {
        var nx = nbrs[k][0], ny = nbrs[k][1];
        var ii = this.idx(nx, ny);
        var v = this.board[ii];
        if (v === EMPTY) {
          if (!libSet.has(ii)) { libSet.add(ii); libs.push(ii); }
        } else if (v === color && !seen[ii]) {
          seen[ii] = 1;
          stack.push([nx, ny]);
        }
      }
    }
    return { stones: stones, liberties: libs };
  };

  GoGame.prototype.clone = function () {
    var g = new GoGame(this.size, this.komi);
    g.board = Int8Array.from(this.board);
    g.turn = this.turn;
    g.captures[BLACK] = this.captures[BLACK];
    g.captures[WHITE] = this.captures[WHITE];
    g.passes = this.passes;
    g.ko = this.ko;
    g.moveCount = this.moveCount;
    g.over = this.over;
    g.lastMove = this.lastMove;
    g.history = [g.snapshot()];
    return g;
  };

  // Try to place a stone of the current turn colour at (x, y).
  GoGame.prototype.play = function (x, y) {
    if (this.over) return { ok: false, reason: 'game-over' };
    if (!this.inBounds(x, y)) return { ok: false, reason: 'out-of-bounds' };
    var i = this.idx(x, y);
    if (this.board[i] !== EMPTY) return { ok: false, reason: 'occupied' };
    if (this.ko >= 0 && i === this.ko) return { ok: false, reason: 'ko' };

    var size = this.size;
    var color = this.turn;
    var opp = opposite(color);
    var before = this.snapshot(); // for clean rollback on suicide

    // 1. place the stone
    this.board[i] = color;

    // 2. remove any adjacent opponent groups with zero liberties
    var captured = 0;
    var singleCaptured = -1;
    var nbrs = neighbors(size, x, y);
    for (var k = 0; k < nbrs.length; k++) {
      var nx = nbrs[k][0], ny = nbrs[k][1];
      if (this.board[this.idx(nx, ny)] === opp) {
        var g = this.group(nx, ny);
        if (g.liberties.length === 0) {
          for (var m = 0; m < g.stones.length; m++) this.board[g.stones[m]] = EMPTY;
          captured += g.stones.length;
          if (g.stones.length === 1) singleCaptured = g.stones[0];
        }
      }
    }

    // 3. suicide rule: the placed group must still have at least one liberty
    var own = this.group(x, y);
    if (own.liberties.length === 0) {
      this.restore(before);
      return { ok: false, reason: 'suicide' };
    }

    // 4. simple ko: a single stone captured by a single stone is forbidden
    //    to be immediately recaptured (next move may not play at that point).
    var newKo = -1;
    if (captured === 1 && singleCaptured >= 0 &&
        own.stones.length === 1 && own.liberties.length === 1) {
      newKo = singleCaptured;
    }

    this.captures[color] += captured;
    this.ko = newKo;
    this.moveCount += 1;
    this.passes = 0;
    this.lastMove = i;
    this.turn = opp;
    this.record();
    return { ok: true, captured: captured };
  };

  GoGame.prototype.pass = function () {
    if (this.over) return { ok: false, reason: 'game-over' };
    this.passes += 1;
    this.ko = -1;
    this.lastMove = -1;
    this.turn = opposite(this.turn);
    if (this.passes >= 2) this.over = true;
    this.record();
    return { ok: true, over: this.over };
  };

  GoGame.prototype.undo = function () {
    if (this.history.length <= 1) return false;
    this.history.pop();
    this.restore(this.history[this.history.length - 1]);
    return true;
  };

  // Territory (Japanese-style) scoring: empty regions surrounded by one colour
  // count for that colour; regions touching both are neutral. Captures are added,
  // and komi is added to White.
  GoGame.prototype.score = function () {
    var size = this.size;
    var seen = new Uint8Array(size * size);
    var blackTerritory = 0, whiteTerritory = 0;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var i = this.idx(x, y);
        if (this.board[i] !== EMPTY || seen[i]) continue;
        var regionLen = 0;
        var touches = { black: false, white: false };
        var stack = [[x, y]];
        seen[i] = 1;
        while (stack.length) {
          var cur = stack.pop();
          regionLen++;
          var nbrs = neighbors(size, cur[0], cur[1]);
          for (var k = 0; k < nbrs.length; k++) {
            var ii = this.idx(nbrs[k][0], nbrs[k][1]);
            var v = this.board[ii];
            if (v === EMPTY) {
              if (!seen[ii]) { seen[ii] = 1; stack.push([nbrs[k][0], nbrs[k][1]]); }
            } else if (v === BLACK) touches.black = true;
            else touches.white = true;
          }
        }
        if (touches.black && !touches.white) blackTerritory += regionLen;
        else if (touches.white && !touches.black) whiteTerritory += regionLen;
      }
    }
    var blackScore = blackTerritory + this.captures[BLACK];
    var whiteScore = whiteTerritory + this.captures[WHITE] + this.komi;
    var winner = blackScore > whiteScore ? BLACK : (blackScore < whiteScore ? WHITE : 0);
    return {
      blackTerritory: blackTerritory,
      whiteTerritory: whiteTerritory,
      blackCaptures: this.captures[BLACK],
      whiteCaptures: this.captures[WHITE],
      blackScore: blackScore,
      whiteScore: whiteScore,
      komi: this.komi,
      winner: winner,
    };
  };

  // --- Simple AI ----------------------------------------------------------
  // Heuristic picker for a single move. It prefers captures, survives suicide
  // and self-atari when possible, extends near friendly stones, and favours the
  // centre. Returns {x, y} or null to pass.
  GoGame.prototype.suggestMove = function (color) {
    var size = this.size;
    if (this.over) return null;
    if (this.turn !== color) return null; // caller mistake guard

    // First move: play centre.
    var anyStone = false;
    for (var ii = 0; ii < this.board.length; ii++) {
      if (this.board[ii] !== EMPTY) { anyStone = true; break; }
    }
    if (!anyStone) {
      var c = Math.floor(size / 2);
      return { x: c, y: c };
    }

    // Candidate points: empty and not the ko point, adjacent to at least one stone.
    var cand = [];
    var candSet = new Set();
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var i = this.idx(x, y);
        if (this.board[i] !== EMPTY) continue;
        if (i === this.ko) continue;
        var nbrs = neighbors(size, x, y);
        for (var k = 0; k < nbrs.length; k++) {
          if (this.board[this.idx(nbrs[k][0], nbrs[k][1])] !== EMPTY) {
            if (!candSet.has(i)) { candSet.add(i); cand.push([x, y]); }
            break;
          }
        }
      }
    }
    if (cand.length === 0) return null;

    var best = null;
    var bestScore = -Infinity;
    for (var cidx = 0; cidx < cand.length; cidx++) {
      var cx = cand[cidx][0], cy = cand[cidx][1];
      var sim = this.clone();
      var r = sim.play(cx, cy);
      if (!r.ok) continue;

      var sc = 0;
      // 1. captures are highly desirable
      sc += r.captured * 12;
      // 2. liberties of the placed group (more is safer)
      var g = sim.group(cx, cy);
      sc += g.liberties.length * 1.2;
      // 4. avoid leaving a throw-in that the opponent can recapture for free
      //    (single stone with one liberty next to an opponent stone is risky)
      if (g.stones.length === 1 && g.liberties.length === 1) sc -= 6;
      // 5. mild centre preference for early development
      var centre = (size - 1) / 2;
      var dist = Math.max(Math.abs(cx - centre), Math.abs(cy - centre));
      sc -= dist * 0.05;
      // 6. tiny random jitter so the AI doesn't always play identically
      sc += Math.random() * 0.5;

      if (sc > bestScore) { bestScore = sc; best = { x: cx, y: cy }; }
    }
    return best; // null => caller will pass
  };

  return {
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    opposite: opposite,
    colorName: colorName,
    neighbors: neighbors,
    GoGame: GoGame,
  };
});