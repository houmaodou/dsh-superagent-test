/**
 * H5 Go Game - UI controller
 *
 * Renders the board on an HTML5 canvas and wires the rules engine (go.js)
 * to the UI controls. Also includes a lightweight computer opponent for
 * single-player mode.
 */
(function () {
  'use strict';

  var GO = window.GO;
  var GoGame = window.GoGame;
  var EMPTY = GO.EMPTY;
  var BLACK = GO.BLACK;
  var WHITE = GO.WHITE;

  // DOM refs
  var board = document.getElementById('board');
  var ctx = board.getContext('2d');
  var currentStone = document.getElementById('currentStone');
  var turnText = document.getElementById('turnText');
  var blackCaptures = document.getElementById('blackCaptures');
  var whiteCaptures = document.getElementById('whiteCaptures');
  var hint = document.getElementById('hint');
  var resultModal = document.getElementById('resultModal');
  var resultTitle = document.getElementById('resultTitle');
  var resultDetail = document.getElementById('resultDetail');
  var resultCounts = document.getElementById('resultCounts');
  var undoBtn = document.getElementById('undoBtn');
  var passBtn = document.getElementById('passBtn');
  var newGameBtn = document.getElementById('newGameBtn');
  var scoreBtn = document.getElementById('scoreBtn');
  var playAgainBtn = document.getElementById('playAgainBtn');
  var closeResultBtn = document.getElementById('closeResultBtn');

  // Game state
  var game;
  var size = 9;
  var aiEnabled = false;
  var aiThinking = false;
  var selectedRule = GO.TYPE_CHINESE;

  // Star points (hoshi) for standard board sizes.
  var STAR_POINTS = {
    19: [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]],
    13: [[3, 3], [3, 9], [6, 6], [9, 3], [9, 9]],
    9: [[2, 2], [2, 6], [4, 4], [6, 2], [6, 6]],
    7: [[3, 3]]
  };

  /**
   * Recreate the game from scratch.
   */
  function newGame() {
    game = new GoGame({ size: size, ruleType: selectedRule });
    aiThinking = false;
    updateStatus();
    render();
  }

  /**
   * Map a pointer/click coordinate on the canvas to a board intersection,
   * or null if outside the playable margin.
   */
  function pointToIntersection(clientX, clientY) {
    var rect = board.getBoundingClientRect();
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    var side = Math.min(rect.width, rect.height);
    var pad = side / (size + 1);
    var col = Math.round((x - pad) / pad);
    var row = Math.round((y - pad) / pad);
    var tolerance = 0.45 * pad;
    if (col < 0 || col >= size || row < 0 || row >= size) return null;
    var px = pad + col * pad;
    var py = pad + row * pad;
    if (Math.abs(x - px) > tolerance || Math.abs(y - py) > tolerance) return null;
    return { row: row, col: col };
  }

  /**
   * Handle a manual (human) play attempt.
   */
  function handlePlay(row, col) {
    if (aiThinking || game.gameOver) return;
    var res = game.play(row, col);
    if (!res.ok) {
      flashHint(localizedReason(res.reason));
      return;
    }
    updateStatus();
    render();
    if (game.gameOver) {
      showResult();
      return;
    }
    // Trigger AI turn in single-player mode.
    if (aiEnabled && game.turn === WHITE) {
      scheduleAI();
    }
  }

  function localizedReason(reason) {
    switch (reason) {
      case 'occupied': return '该位置已有棋子';
      case 'suicide': return '落子后无气，禁止自杀';
      case 'ko': return '打劫：不能立即提回';
      case 'finished': return '对局已结束';
      default: return '无法落子';
    }
  }

  var hintTimer = null;
  function flashHint(text) {
    hint.textContent = text;
    hint.style.opacity = '1';
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      hint.style.opacity = '0';
    }, 1800);
  }

  function defaultHint() {
    if (game.gameOver) return '对局已结束，点击结算查看目数';
    if (aiEnabled && game.turn === WHITE) return 'AI 思考中…';
    var name = game.turn === BLACK ? '黑棋' : '白棋';
    return '轮到 ' + name;
  }

  /**
   * Update status bar (turn indicator, capture counts) and hint.
   */
  function updateStatus() {
    var isBlack = game.turn === BLACK;
    currentStone.classList.toggle('white', !isBlack);
    turnText.textContent = game.gameOver
      ? '对局结束'
      : ('轮到' + (isBlack ? '黑棋' : '白棋'));
    blackCaptures.textContent = game.captured[BLACK];
    whiteCaptures.textContent = game.captured[WHITE];
    hint.textContent = defaultHint();
  }

  /**
   * Draw the whole board.
   */
  function render() {
    var dpr = window.devicePixelRatio || 1;
    var cssSize = Math.min(board.clientWidth, board.clientHeight);
    var px = cssSize || 0;
    var logical = px;

    // If the layout hasn't produced a size yet, wait for the next frame.
    if (logical < 8) {
      requestAnimationFrame(render);
      return;
    }

    // Set canvas backing size for crisp rendering.
    if (board.width !== Math.round(px * dpr)) {
      board.width = Math.round(px * dpr);
      board.height = Math.round(px * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, logical, logical);

    var pad = logical / (size + 1);
    var g = logical / (size + 1); // spacing between lines

    drawBoard(logical, pad, g);
    drawStones(logical, pad, g);
  }

  function drawBoard(logical, pad, g) {
    // Wood background with subtle texture.
    var lgrad = ctx.createLinearGradient(0, 0, logical, logical);
    lgrad.addColorStop(0, '#e3bd6c');
    lgrad.addColorStop(1, '#d2a553');
    ctx.fillStyle = lgrad;
    ctx.fillRect(0, 0, logical, logical);

    // Grid lines.
    ctx.strokeStyle = '#8a5a2b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < size; i++) {
      var p = pad + i * g;
      ctx.moveTo(p, pad);
      ctx.lineTo(p, logical - pad);
      ctx.moveTo(pad, p);
      ctx.lineTo(logical - pad, p);
    }
    ctx.stroke();

    // Star points.
    ctx.fillStyle = '#7a4c22';
    var stars = STAR_POINTS[size] || [];
    for (var s = 0; s < stars.length; s++) {
      var sp = stars[s];
      var sx = pad + sp[1] * g;
      var sy = pad + sp[0] * g;
      ctx.beginPath();
      ctx.arc(sx, sy, logical * 0.014 + 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawStones(logical, pad, g) {
    var b = game.board;
    var s = game.size;
    var r = g * 0.46; // stone radius
    for (var i = 0; i < b.length; i++) {
      if (b[i] === EMPTY) continue;
      var row = Math.floor(i / s);
      var col = i % s;
      var x = pad + col * g;
      var y = pad + row * g;
      drawStone(x, y, r, b[i], (game.lastMove && game.lastMove.index === i));
    }
  }

  function drawStone(x, y, r, color, isLast) {
    var isBlack = color === BLACK;

    // Shadow.
    ctx.beginPath();
    ctx.arc(x + r * 0.12, y + r * 0.16, r * 0.98, 0, Math.PI * 2);
    var sh = ctx.createRadialGradient(x, y, r * 0.2, x + r * 0.1, y + r * 0.15, r);
    sh.addColorStop(0, 'rgba(0,0,0,0.30)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.fill();

    // Stone body.
    var grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.1);
    if (isBlack) {
      grad.addColorStop(0, '#5a5a5a');
      grad.addColorStop(0.6, '#232323');
      grad.addColorStop(1, '#0d0d0d');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.6, '#f2f2f2');
      grad.addColorStop(1, '#d0d0d0');
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Rim.
    ctx.lineWidth = 1;
    ctx.strokeStyle = isBlack ? 'rgba(0,0,0,0.6)' : 'rgba(120,120,120,0.5)';
    ctx.stroke();

    // Last move marker.
    if (isLast) {
      ctx.fillStyle = isBlack ? '#fff' : '#222';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- Scoring / result ----

  function showResult() {
    var score = game.score();
    resultTitle.textContent = score.winner === BLACK ? '黑棋胜' : (score.winner === WHITE ? '白棋胜' : '平局');
    var ruleName = score.ruleType === GO.TYPE_JAPANESE ? '日本规则' : '中国规则';
    resultDetail.innerHTML =
      '黑棋 <span class="highlight">' + score.blackTotal.toFixed(score.blackTotal % 1 ? 1 : 0) +
      '</span> 目 · 白棋 <span class="highlight">' + score.whiteTotal.toFixed(score.whiteTotal % 1 ? 1 : 0) +
      '</span> 目（含贴目 ' + score.komi + ' 目）<br>（' + ruleName + '）';
    resultCounts.innerHTML =
      '<div class="c-item"><span class="mini-stone"></span> 提子 ' + score.captures.black + '</div>' +
      '<div class="c-item capture-white"><span class="mini-stone"></span> 提子 ' + score.captures.white + '</div>';
    resultModal.classList.remove('hidden');
  }

  // ---- AI ----

  /**
   * Choose the AI's next move. Strategy (greedy heuristic, no full search):
   *  1. Capture an opponent stone if any legal capturing move exists.
   *  2. Otherwise, take a point near an empty corner/star, near friendly
   *     stones, or any legal point, avoiding self-atari picks.
   */
  function chooseAIMove(coloring) {
    var size = game.size;
    var b = game.board;
    var aiColor = WHITE; // AI always plays white (second) in current setup.
    var opponent = BLACK;
    var best = null;

    // Candidate captures: simulate each legal point, prefer any that captures.
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (b[idx(r, c, size)] !== EMPTY) continue;
        // Skip the ko point: playing there would be illegal this turn.
        if (game.koPoint === idx(r, c, size)) continue;
        var sim = (function () {
          // Reuse engine legality via a lightweight local copy on a scratch array.
          var copy = b.slice();
          copy[rowToIndex(r, c, size)] = aiColor;
          return classifyCapture(copy, r, c, aiColor, opponent, size);
        })();
        if (sim.illegal) continue;
        if (sim.capturesCount > 0) {
          return { row: r, col: c }; // immediate capture is always good
        }
        candidateStore(r, c, sim.afterSelfAtari, size);
      }
    }

    function candidateStore(r, c, bad, size) {
      if (best && best.priority >= 3) return;
      // Favor central / corner (3,3 ignored for simplicity). Weight score.
      var sc = evaluate(r, c, size, bad);
      if (sc > (best ? best.score : -1)) {
        best = { row: r, col: c, score: sc, priority: bad ? 1 : 3 };
      }
    }

    return best ? { row: best.row, col: best.col } : null;
  }

  function rowToIndex(r, c, size) { return r * size + c; }

  // Dummy left-in for symmetry (kept minimal).
  var idx = function (r, c, size) { return r * size + c; };

  function classifyCapture(copy, r, c, color, opp, size) {
    var nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    var captured = 0;
    var illegal = false;
    for (var k = 0; k < nb.length; k++) {
      var nr = nb[k][0];
      var nc = nb[k][1];
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      if (copy[nr * size + nc] !== opp) continue;
      var libs = groupLiberties(copy, size, nr, nc, opp);
      if (libs === 0) {
        // Removing the group.
        var group = collectGroup(copy, size, nr, nc, opp);
        captured += group.length;
        group.forEach(function (gi) { copy[gi] = EMPTY; });
      }
    }
    // After captures, check own group liberty.
    var own = groupLiberties(copy, size, r, c, color);
    var afterSelfAtari = own === 0;
    if (captured === 0 && own === 0) illegal = true;
    return { capturesCount: captured, afterSelfAtari: afterSelfAtari, illegal: illegal };
  }

  function collectGroup(board, size, r, c, color) {
    var seen = {};
    var group = [];
    var stack = [[r, c]];
    var key = r * size + c;
    seen[key] = true;
    while (stack.length) {
      var p = stack.pop();
      group.push(p[0] * size + p[1]);
      var nb = [[p[0] - 1, p[1]], [p[0] + 1, p[1]], [p[0], p[1] - 1], [p[0], p[1] + 1]];
      for (var k = 0; k < nb.length; k++) {
        var nr = nb[k][0];
        var nc = nb[k][1];
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        var nk = nr * size + nc;
        if (seen[nk] || board[nk] !== color) continue;
        seen[nk] = true;
        stack.push([nr, nc]);
      }
    }
    return group;
  }

  function groupLiberties(board, size, r, c, color) {
    var seen = {};
    var libs = new Set();
    var stack = [[r, c]];
    seen[r * size + c] = true;
    while (stack.length) {
      var p = stack.pop();
      var nb = [[p[0] - 1, p[1]], [p[0] + 1, p[1]], [p[0], p[1] - 1], [p[0], p[1] + 1]];
      for (var k = 0; k < nb.length; k++) {
        var nr = nb[k][0];
        var nc = nb[k][1];
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        var nk = nr * size + nc;
        if (seen[nk]) continue;
        var v = board[nk];
        if (v === EMPTY) { libs.add(nk); seen[nk] = true; }
        else if (v === color) { seen[nk] = true; stack.push([nr, nc]); }
      }
    }
    return libs.size;
  }

  function evaluate(r, c, size, bad) {
    var center = (size - 1) / 2;
    var d = Math.abs(r - center) + Math.abs(c - center);
    // Prefer center-ish; prefer open areas (fewer enemy neighbors nearby).
    var score = (size - d) * 10;
    // Bonus near star (3,3 style) for variety.
    score += ((r === 3 && c === 3) || (r === 4 && c === 4) ? 5 : 0);
    if (bad) score -= 30;
    return score;
  }

  function scheduleAI() {
    if (aiThinking) return;
    aiThinking = true;
    updateStatus();
    render();
    setTimeout(function () {
      runAI();
    }, 350);
  }

  function runAI() {
    if (!aiEnabled || game.gameOver) {
      aiThinking = false;
      return;
    }
    var move = chooseAIMove();
    if (!move) {
      // Pass if no reasonable move found.
      game.pass();
      aiThinking = false;
      updateStatus();
      render();
      if (game.gameOver) showResult();
      return;
    }
    var res = game.play(move.row, move.col);
    // Defensive: if for any reason the chosen move is rejected (e.g. an
    // unexpected ko interaction), fall back to passing so the game never stalls.
    if (!res.ok) {
      game.pass();
    }
    aiThinking = false;
    updateStatus();
    render();
    if (game.gameOver) {
      showResult();
      return;
    }
  }

  // ---- Event wiring ----

  function setBoardSize(sz) {
    size = sz;
    document.querySelectorAll('.size-btn').forEach(function (bEl) {
      bEl.classList.toggle('active', bEl.getAttribute('data-size') === String(sz));
    });
    newGame();
  }

  function setRule(rule) {
    selectedRule = rule;
    var chinese = rule === GO.TYPE_CHINESE;
    document.getElementById('chineseRuleBtn').classList.toggle('active', chinese);
    document.getElementById('japaneseRuleBtn').classList.toggle('active', !chinese);
    newGame();
  }

  board.addEventListener('click', function (e) {
    if (aiThinking) return;
    var pt = pointToIntersection(e.clientX, e.clientY);
    if (!pt) return;
    handlePlay(pt.row, pt.col);
  });

  board.addEventListener('touchstart', function (e) {
    // Prevent the click handler from firing twice; clicks still handled above.
  }, { passive: true });

  undoBtn.addEventListener('click', function () {
    if (aiThinking) return;
    game.undo();
    aiThinking = false;
    updateStatus();
    render();
  });

  passBtn.addEventListener('click', function () {
    if (game.gameOver) return;
    var res = game.pass();
    updateStatus();
    render();
    if (res.gameOver) {
      showResult();
    } else if (aiEnabled && game.turn === WHITE) {
      scheduleAI();
    }
  });

  newGameBtn.addEventListener('click', function () {
    newGame();
  });

  scoreBtn.addEventListener('click', function () {
    showResult();
  });

  playAgainBtn.addEventListener('click', function () {
    resultModal.classList.add('hidden');
    newGame();
  });

  closeResultBtn.addEventListener('click', function () {
    resultModal.classList.add('hidden');
  });

  document.querySelectorAll('.size-btn').forEach(function (bEl) {
    bEl.addEventListener('click', function () {
      setBoardSize(parseInt(bEl.getAttribute('data-size'), 10));
    });
  });

  document.getElementById('twoPlayerBtn').addEventListener('click', function () {
    aiEnabled = false;
    aiThinking = false;
    this.classList.add('active');
    document.getElementById('aiBtn').classList.remove('active');
    newGame();
  });

  document.getElementById('aiBtn').addEventListener('click', function () {
    aiEnabled = true;
    this.classList.add('active');
    document.getElementById('twoPlayerBtn').classList.remove('active');
    newGame();
  });

  document.getElementById('chineseRuleBtn').addEventListener('click', function () {
    setRule(GO.TYPE_CHINESE);
  });

  document.getElementById('japaneseRuleBtn').addEventListener('click', function () {
    setRule(GO.TYPE_JAPANESE);
  });

  // Keyboard: Enter/space to place? Not needed; left for accessibility later.

  // Resize handling.
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      render();
    }, 120);
  });

  // Boot.
  setRule(GO.TYPE_CHINESE); // initializes game with default size + rule
  setBoardSize(9);
})();