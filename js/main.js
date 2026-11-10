/* 五子棋 UI 控制器与渲染 */
(function () {
  'use strict';

  const { EMPTY, BLACK, WHITE } = window.GomokuConstants;
  const HUMAN = BLACK;   // 人机对战时，玩家执黑先行
  const AI_COLOR = WHITE;

  // ---------- DOM ----------
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const boardWrap = document.getElementById('boardWrap');
  const turnText = document.getElementById('turnText');
  const currentStone = document.getElementById('currentStone');
  const hintEl = document.getElementById('hint');
  const undoBtn = document.getElementById('undoBtn');
  const newGameBtn = document.getElementById('newGameBtn');
  const twoPlayerBtn = document.getElementById('twoPlayerBtn');
  const aiBtn = document.getElementById('aiBtn');
  const sizeBtns = Array.from(document.querySelectorAll('.size-btn'));
  const resultModal = document.getElementById('resultModal');
  const resultTitle = document.getElementById('resultTitle');
  const resultDetail = document.getElementById('resultDetail');
  const playAgainBtn = document.getElementById('playAgainBtn');
  const closeResultBtn = document.getElementById('closeResultBtn');

  // ---------- 状态 ----------
  let size = 15;
  let game = new Gomoku(size, 5);
  let aiMode = false;
  let lastMove = null;
  let hover = null;
  let aiTimer = null;
  let padding = 0;
  let cell = 0;

  const STAR_POINTS = {
    9:  [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]],
    13: [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]],
    15: [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]]
  };

  // ---------- 几何计算 ----------
  function cellToPixel(row, col) {
    return { x: padding + col * cell, y: padding + row * cell };
  }

  function pixelToCell(x, y) {
    const col = Math.round((x - padding) / cell);
    const row = Math.round((y - padding) / cell);
    if (row < 0 || row >= size || col < 0 || col >= size) return null;
    return { row, col };
  }

  // ---------- 渲染 ----------
  function resize() {
    const css = Math.floor(Math.min(boardWrap.clientWidth || 320, 520));
    canvas.style.width = css + 'px';
    canvas.style.height = css + 'px';
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = css / (size + 1);
    padding = cell;
    render();
  }

  function drawBoard() {
    const w = canvas.width / (window.devicePixelRatio || 1);
    // 木质底
    const wood = ctx.createLinearGradient(0, 0, w, w);
    wood.addColorStop(0, '#e2b06a');
    wood.addColorStop(1, '#c9924b');
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, w, w);

    // 网格
    ctx.strokeStyle = '#70471f';
    ctx.lineWidth = 1;
    for (let i = 0; i < size; i++) {
      const p = padding + i * cell;
      ctx.beginPath();
      ctx.moveTo(padding, p);
      ctx.lineTo(padding + (size - 1) * cell, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, padding);
      ctx.lineTo(p, padding + (size - 1) * cell);
      ctx.stroke();
    }

    // 星位
    ctx.fillStyle = '#563718';
    const stars = STAR_POINTS[size] || [];
    for (const [r, c] of stars) {
      const { x, y } = cellToPixel(r, c);
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawStone(row, col, color, ghost) {
    const { x, y } = cellToPixel(row, col);
    const r = cell * 0.42;
    ctx.save();
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.12, x, y, r);
    if (color === BLACK) {
      grad.addColorStop(0, '#7a7a7a');
      grad.addColorStop(0.55, '#3a3a3a');
      grad.addColorStop(1, '#101010');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.7, '#ececec');
      grad.addColorStop(1, '#c8c8c8');
    }
    ctx.globalAlpha = ghost ? 0.4 : 1;
    if (!ghost) {
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = r * 0.3;
      ctx.shadowOffsetY = r * 0.12;
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawWinLine() {
    if (!game.winLine) return;
    const pts = game.winLine;
    const a = cellToPixel(pts[0][0], pts[0][1]);
    const b = cellToPixel(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.save();
    ctx.strokeStyle = 'rgba(235, 60, 60, 0.9)';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, cell * 0.14);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(235, 60, 60, 0.95)';
    ctx.lineWidth = 2;
    for (const [r, c] of pts) {
      const p = cellToPixel(r, c);
      ctx.beginPath();
      ctx.arc(p.x, p.y, cell * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLastMoveMarker() {
    if (!lastMove) return;
    const { x, y } = cellToPixel(lastMove.row, lastMove.col);
    const stoneColor = game.get(lastMove.row, lastMove.col);
    ctx.save();
    ctx.strokeStyle = stoneColor === BLACK ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    drawBoard();
    for (const step of game.history) {
      drawStone(step.row, step.col, step.color, false);
    }
    drawWinLine();
    drawLastMoveMarker();

    // 悬停预览
    if (hover && !game.finished && game.get(hover.row, hover.col) === EMPTY) {
      const canPlay = !aiMode || game.turn === HUMAN;
      if (canPlay) drawStone(hover.row, hover.col, game.turn, true);
    }
  }

  // ---------- 状态文字 ----------
  function colorName(color) {
    return color === BLACK ? '黑棋' : '白棋';
  }

  function updateTurnUI() {
    const preview = currentStone;
    if (game.finished) return;
    preview.className = 'stone-preview' + (game.turn === WHITE ? ' white' : '');
    if (aiMode) {
      turnText.textContent = game.turn === HUMAN ? '轮到你（黑棋）' : '电脑思考中…';
    } else {
      turnText.textContent = colorName(game.turn) + '走';
    }
  }

  function showResult(res) {
    let title;
    let detail;
    if (res.win) {
      const winner = colorName(res.color);
      title = winner + '获胜';
      detail = '五子连珠，' + winner + '取得胜利！';
      if (aiMode) {
        title = res.color === HUMAN ? '你赢了 🎉' : '电脑获胜';
        detail = res.color === HUMAN ? '恭喜，你率先连成五子！' : '电脑率先连成五子，再接再厉！';
      }
      currentStone.className = 'stone-preview' + (res.color === WHITE ? ' white' : '');
      turnText.textContent = winner + '胜';
    } else {
      title = '平局';
      detail = '棋盘已满，未分胜负。';
      turnText.textContent = '平局';
    }
    resultTitle.textContent = title;
    resultDetail.textContent = detail;
    hintEl.style.display = 'none';
    resultModal.classList.remove('hidden');
  }

  function hideResult() {
    resultModal.classList.add('hidden');
    hintEl.style.display = '';
  }

  // ---------- 游戏流程 ----------
  function doMove(row, col) {
    const res = game.place(row, col);
    if (!res) return;
    lastMove = { row: res.row, col: res.col };
    render();
    updateTurnUI();
    if (res.win || res.draw) {
      showResult(res);
      return;
    }
    if (aiMode && !game.finished && game.turn === AI_COLOR) {
      scheduleAiMove();
    }
  }

  function handleInput(row, col) {
    if (game.finished) return;
    if (aiMode && game.turn !== HUMAN) return;   // 电脑思考时忽略点击
    doMove(row, col);
  }

  function scheduleAiMove() {
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = setTimeout(() => {
      aiTimer = null;
      if (aiMode && !game.finished && game.turn === AI_COLOR) {
        const mv = game.aiMove(AI_COLOR);
        if (mv) doMove(mv[0], mv[1]);
      }
    }, 260);
  }

  function newGame() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    game = new Gomoku(size, 5);
    lastMove = null;
    hover = null;
    hideResult();
    render();
    updateTurnUI();
  }

  function undo() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    if (game.history.length === 0) return;
    if (aiMode) {
      let humanRemoved = false;
      while (game.history.length > 0 && !humanRemoved) {
        const top = game.history[game.history.length - 1];
        game.undo();
        if (top.color === HUMAN) humanRemoved = true;
      }
    } else {
      game.undo();
    }
    lastMove = game.history.length
      ? { row: game.history[game.history.length - 1].row, col: game.history[game.history.length - 1].col }
      : null;
    hideResult();
    render();
    updateTurnUI();
  }

  function setSize(newSize) {
    if (newSize === size) return;
    size = newSize;
    sizeBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.size) === size));
    newGame();
    resize();
  }

  function setMode(ai) {
    if (ai === aiMode && game.history.length === 0) {
      aiMode = ai;
      updateButtons();
    } else {
      aiMode = ai;
      updateButtons();
      newGame();
    }
  }

  function updateButtons() {
    twoPlayerBtn.classList.toggle('active', !aiMode);
    aiBtn.classList.toggle('active', aiMode);
  }

  // ---------- 输入事件 ----------
  function localPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.focus();
    const { x, y } = localPoint(e);
    const info = pixelToCell(x, y);
    if (info) handleInput(info.row, info.col);
  });

  canvas.addEventListener('pointermove', (e) => {
    const { x, y } = localPoint(e);
    const info = pixelToCell(x, y);
    if ((info && (!hover || hover.row !== info.row || hover.col !== info.col)) ||
        (!info && hover)) {
      hover = info;
      render();
    }
  });

  canvas.addEventListener('pointerleave', () => {
    if (hover) { hover = null; render(); }
  });

  // ---------- 按钮 ----------
  undoBtn.addEventListener('click', undo);
  newGameBtn.addEventListener('click', newGame);
  twoPlayerBtn.addEventListener('click', () => setMode(false));
  aiBtn.addEventListener('click', () => setMode(true));
  sizeBtns.forEach((b) => b.addEventListener('click', () => setSize(Number(b.dataset.size))));
  playAgainBtn.addEventListener('click', newGame);
  closeResultBtn.addEventListener('click', hideResult);

  window.addEventListener('resize', resize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize);
  }

  // ---------- 启动 ----------
  resize();
  updateTurnUI();

  // 供测试与截图脚本使用（与点击走同一条代码路径）
  window.gomokuApp = {
    get game() { return game; },
    get size() { return size; },
    get aiMode() { return aiMode; },
    set size(v) { setSize(v); },
    set mode(ai) { setMode(ai); },
    playAt: handleInput,
    newGame,
    undo,
    resize,
    render
  };
})();