/* H5 Go — rendering and interaction layer.
 * Depends on GoEngine (js/go.js) exposing GoGame, BLACK, WHITE, EMPTY.
 */
(function () {
  'use strict';

  var Go = window.GoEngine;
  var GoGame = Go.GoGame;
  var BLACK = Go.BLACK;
  var WHITE = Go.WHITE;
  var EMPTY = Go.EMPTY;

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var wrap = document.querySelector('.board-wrap');

  var sizeSelect = document.getElementById('size-select');
  var modeSelect = document.getElementById('mode-select');
  var colorSelect = document.getElementById('color-select');
  var turnDot = document.getElementById('turn-dot');
  var turnText = document.getElementById('turn-text');
  var capturesEl = document.getElementById('captures');
  var modal = document.getElementById('modal');
  var modalBody = document.getElementById('modal-body');

  var game;
  var size = 9;
  var mode = 'pvp';       // 'pvp' | 'ai'
  var humanColor = BLACK; // colour controlled by the human when mode === 'ai'
  var layout = { px: 0, margin: 0, cell: 0 };
  var hover = null;       // {x, y} under the pointer, if legal

  // Standard star points (hoshi) per board size.
  function starPoints(n) {
    if (n === 9) return [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]];
    if (n === 13) return [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]];
    return [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]];
  }

  function newGame() {
    game = new GoGame(size, 7.5);
    hover = null;
    closeModal();
    render();
    maybeAiMove();
  }

  function computeLayout() {
    var maxPx = Math.max(240, Math.min(wrap.clientWidth - 16, 620));
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = maxPx + 'px';
    canvas.style.height = maxPx + 'px';
    canvas.width = Math.round(maxPx * dpr);
    canvas.height = Math.round(maxPx * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var margin = maxPx / (size + 2);
    var cell = (maxPx - 2 * margin) / (size - 1);
    layout = { px: maxPx, margin: margin, cell: cell };
  }

  function gridToPx(x, y) {
    return {
      px: layout.margin + x * layout.cell,
      py: layout.margin + y * layout.cell,
    };
  }

  function drawStone(x, y, color, ghost) {
    var p = gridToPx(x, y);
    var r = layout.cell * 0.46;
    var g = ghost ? 0.6 : 1;
    ctx.save();
    ctx.globalAlpha = g;
    ctx.beginPath();
    ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
    if (color === BLACK) {
      var grd = ctx.createRadialGradient(p.px - r * 0.35, p.py - r * 0.35, r * 0.1, p.px, p.py, r);
      grd.addColorStop(0, ghost ? '#333' : '#3a3a3a');
      grd.addColorStop(1, ghost ? '#111' : '#0a0a0a');
      ctx.fillStyle = grd;
    } else {
      var grd2 = ctx.createRadialGradient(p.px - r * 0.35, p.py - r * 0.35, r * 0.1, p.px, p.py, r);
      grd2.addColorStop(0, ghost ? '#ffffff' : '#ffffff');
      grd2.addColorStop(1, ghost ? '#d8d8d2' : '#e6e6e0');
      ctx.fillStyle = grd2;
    }
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = color === BLACK ? '#000' : '#aaa';
    ctx.stroke();
    ctx.restore();
  }

  function drawLastMarker(x, y, color) {
    var p = gridToPx(x, y);
    var r = layout.cell * 0.16;
    ctx.beginPath();
    ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
    ctx.fillStyle = color === BLACK ? '#fff' : '#333';
    ctx.fill();
  }

  function render() {
    if (!game) return;
    computeLayout();
    var L = layout;
    var n = size;

    // wood board background
    var wood = ctx.createLinearGradient(0, 0, L.px, L.px);
    wood.addColorStop(0, '#d9b36a');
    wood.addColorStop(1, '#e6c684');
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, L.px, L.px);

    // grid
    ctx.strokeStyle = '#5a4322';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var a = gridToPx(i, 0);
      var b = gridToPx(i, n - 1);
      ctx.moveTo(a.px, a.py);
      ctx.lineTo(b.px, b.py);
      var c = gridToPx(0, i);
      var d = gridToPx(n - 1, i);
      ctx.moveTo(c.px, c.py);
      ctx.lineTo(d.px, d.py);
    }
    ctx.stroke();

    // star points
    ctx.fillStyle = '#5a4322';
    starPoints(n).forEach(function (s) {
      var p = gridToPx(s[0], s[1]);
      ctx.beginPath();
      ctx.arc(p.px, p.py, Math.max(2, L.cell * 0.08), 0, Math.PI * 2);
      ctx.fill();
    });

    // stones
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var v = game.board[game.idx(x, y)];
        if (v !== EMPTY) drawStone(x, y, v, false);
      }
    }

    // last move marker
    if (game.lastMove >= 0) {
      var lx = game.lastMove % n;
      var ly = Math.floor(game.lastMove / n);
      drawLastMarker(lx, ly, game.board[game.lastMove]);
    }

    // hover ghost
    if (hover && game.board[game.idx(hover.x, hover.y)] === EMPTY) {
      drawStone(hover.x, hover.y, game.turn, true);
    }

    updateStatus();
  }

  function updateStatus() {
    var t = game.turn;
    turnDot.className = 'dot ' + (t === BLACK ? 'black' : 'white');
    var humanTurn = (mode === 'ai') ? humanColor : null;
    var label;
    if (game.over) {
      label = '对局结束';
    } else if (t === BLACK) {
      label = (humanTurn === BLACK) ? '轮到你落子（黑）' : '黑方落子';
    } else {
      label = (humanTurn === WHITE) ? '轮到你落子（白）' : '白方落子';
    }
    turnText.textContent = label;
    capturesEl.textContent =
      '提子 黑 ' + game.captures[BLACK] + ' · 白 ' + game.captures[WHITE];
  }

  function pxToCoord(px, py) {
    var L = layout;
    var gx = (px - L.margin) / L.cell;
    var gy = (py - L.margin) / L.cell;
    var x = Math.round(gx);
    var y = Math.round(gy);
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    var p = gridToPx(x, y);
    var d = Math.hypot(px - p.px, py - p.py);
    if (d > L.cell * 0.46) return null;
    return { x: x, y: y };
  }

  function canvasPoint(evt) {
    var rect = canvas.getBoundingClientRect();
    return { px: evt.clientX - rect.left, py: evt.clientY - rect.top };
  }

  function humanCanPlay() {
    if (game.over) return false;
    if (mode === 'ai' && game.turn !== humanColor) return false;
    return true;
  }

  function playerMove(x, y) {
    if (!humanCanPlay()) return;
    var r = game.play(x, y);
    if (!r.ok) return;
    render();
    maybeAiMove();
  }

  function maybeAiMove() {
    if (mode !== 'ai' || game.over) return;
    if (game.turn === humanColor) return;
    window.setTimeout(function () {
      var mv = game.suggestMove(game.turn);
      if (mv) {
        var r = game.play(mv.x, mv.y);
        if (r.ok) render();
      } else {
        game.pass();
        render();
      }
      maybeAiMove();
    }, 220);
  }

  function doUndo() {
    if (game.moveCount === 0) return;
    if (mode === 'ai') {
      game.undo(); // revert AI move
      game.undo(); // revert human move (if any)
    } else {
      game.undo();
    }
    render();
    maybeAiMove();
  }

  function doPass() {
    game.pass();
    render();
    maybeAiMove();
  }

  function openModal() {
    var s = game.score();
    var winText = s.winner === BLACK ? '黑胜' : (s.winner === WHITE ? '白胜' : '和棋');
    var rows = [
      ['黑方空', s.blackTerritory + ' 目'],
      ['白方空', s.whiteTerritory + ' 目'],
      ['黑方提子', s.blackCaptures + ' 子'],
      ['白方提子', s.whiteCaptures + ' 子'],
      ['白方贴目', s.komi + ' 目'],
      ['黑方合计', s.blackScore + ' 目'],
      ['白方合计', s.whiteScore + ' 目'],
    ];
    var html = rows.map(function (r) {
      return '<div class="result-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    }).join('');
    html += '<div class="result-row winner"><span>结果</span><span>' + winText + '</span></div>';
    modalBody.innerHTML = html;
    modal.classList.remove('hidden');
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  // --- events ----------------------------------------------------------------
  canvas.addEventListener('click', function (evt) {
    var p = canvasPoint(evt);
    var c = pxToCoord(p.px, p.py);
    if (c) playerMove(c.x, c.y);
  });

  canvas.addEventListener('mousemove', function (evt) {
    var p = canvasPoint(evt);
    var c = pxToCoord(p.px, p.py);
    var legal = c && game.board[game.idx(c.x, c.y)] === EMPTY;
    var changed = (hover === null) !== (c === null) ||
      (hover && c && (hover.x !== c.x || hover.y !== c.y));
    hover = legal ? c : null;
    if (changed) render();
  });

  canvas.addEventListener('mouseleave', function () {
    if (hover) { hover = null; render(); }
  });

  document.getElementById('btn-new').addEventListener('click', newGame);
  document.getElementById('btn-undo').addEventListener('click', doUndo);
  document.getElementById('btn-pass').addEventListener('click', doPass);
  document.getElementById('btn-score').addEventListener('click', openModal);
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);

  sizeSelect.addEventListener('change', function () {
    size = parseInt(sizeSelect.value, 10);
    newGame();
  });
  modeSelect.addEventListener('change', function () {
    mode = modeSelect.value;
    newGame();
  });
  colorSelect.addEventListener('change', function () {
    humanColor = colorSelect.value === 'black' ? BLACK : WHITE;
    newGame();
  });

  window.addEventListener('resize', render);

  // --- screenshot / demo scenes (headless capture) ----------------------------
  function scripted(sequence) {
    for (var i = 0; i < sequence.length; i++) {
      var m = sequence[i];
      var r = game.play(m[0], m[1]);
      if (!r.ok) continue; // skip illegal moves in scripted demo
    }
    render();
  }

  var MIDGAME = [
    [2, 2], [6, 6], [6, 2], [2, 6],
    [4, 3], [4, 5], [3, 4], [5, 4],
    [2, 4], [6, 4], [4, 2], [4, 6],
    [3, 2], [5, 6], [6, 3], [2, 5],
    [5, 3], [3, 6], [3, 3], [5, 5],
    [2, 3], [6, 5], [7, 4], [1, 4],
  ];

  function handleScene() {
    var q = new URLSearchParams(window.location.search);
    var scene = q.get('scene');
    if (!scene) return;
    if (scene === 'midgame' || scene === 'result') {
      size = 9;
      sizeSelect.value = '9';
      game = new GoGame(size, 7.5);
      scripted(MIDGAME);
      if (scene === 'result') openModal();
    } else if (scene === 'size19') {
      size = 19;
      sizeSelect.value = '19';
      game = new GoGame(size, 7.5);
      render();
    } else if (scene === 'ai') {
      size = 13;
      sizeSelect.value = '13';
      game = new GoGame(size, 7.5);
      game.play(6, 6);          // human (black) plays the centre
      var mv = game.suggestMove(WHITE); // AI (white) responds
      if (mv) game.play(mv.x, mv.y);
      render();
    }
  }

  // --- boot ------------------------------------------------------------------
  newGame();
  handleScene();
})();