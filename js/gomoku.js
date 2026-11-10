/* 五子棋规则引擎与简单 AI */
(function (global) {
  'use strict';

  const EMPTY = 0;
  const BLACK = 1; // 黑棋先手
  const WHITE = 2; // 白棋后手

  const DIRS = [
    [0, 1],   // 水平
    [1, 0],   // 垂直
    [1, 1],   // 主对角线
    [1, -1]   // 副对角线
  ];

  class Gomoku {
    /**
     * @param {number} size   棋盘边长（格数）
     * @param {number} winLen 连成多少子算赢
     */
    constructor(size, winLen) {
      this.size = size;
      this.winLen = winLen;
      this.reset();
    }

    reset() {
      this.size = Math.max(5, Math.min(19, this.size));
      this.board = new Array(this.size * this.size).fill(EMPTY);
      this.history = [];       // [{row, col, color}]
      this.winner = 0;         // 0 未分胜负，BLACK/WHITE 胜方
      this.winLine = null;     // 获胜连线上的所有落点 [[r,c], ...]
      this.finished = false;
    }

    static get EMPTY() { return EMPTY; }
    static get BLACK() { return BLACK; }
    static get WHITE() { return WHITE; }

    inBounds(r, c) {
      return r >= 0 && r < this.size && c >= 0 && c < this.size;
    }

    get(r, c) {
      return this.board[r * this.size + c];
    }

    set(r, c, v) {
      this.board[r * this.size + c] = v;
    }

    /** 当前轮到谁：黑先白后，按历史落子数奇偶判定 */
    get turn() {
      return this.history.length % 2 === 0 ? BLACK : WHITE;
    }

    /** 是否已全盘落满（平局前提） */
    isFull() {
      return this.history.length >= this.size * this.size;
    }

    /** 返回以 (r,c) 为端点之一、颜色为 color 的获胜连线，否则返回 null */
    getWinLine(r, c, color) {
      for (const [dr, dc] of DIRS) {
        const line = [[r, c]];
        let rr = r + dr;
        let cc = c + dc;
        while (this.inBounds(rr, cc) && this.get(rr, cc) === color) {
          line.push([rr, cc]);
          rr += dr;
          cc += dc;
        }
        rr = r - dr;
        cc = c - dc;
        while (this.inBounds(rr, cc) && this.get(rr, cc) === color) {
          line.unshift([rr, cc]);
          rr -= dr;
          cc -= dc;
        }
        if (line.length >= this.winLen) {
          return line;
        }
      }
      return null;
    }

    /**
     * 在 (row, col) 落一子，返回结果对象；非法落子返回 null。
     * 结果：{ row, col, color, win, draw, line }
     */
    place(row, col) {
      if (this.finished) return null;
      if (!this.inBounds(row, col)) return null;
      if (this.get(row, col) !== EMPTY) return null;

      const color = this.turn;
      this.set(row, col, color);
      this.history.push({ row, col, color });

      let win = false;
      let draw = false;
      let line = this.getWinLine(row, col, color);
      if (line) {
        this.winner = color;
        this.winLine = line;
        this.finished = true;
        win = true;
      } else if (this.isFull()) {
        this.finished = true;
        this.winner = 0;
        draw = true;
      }

      return { row, col, color, win, draw, line };
    }

    /** 悔一步棋，返回被撤消的落点，或 null（无子可悔） */
    undo() {
      if (this.history.length === 0) return null;
      const step = this.history.pop();
      this.set(step.row, step.col, EMPTY);
      this.finished = false;
      this.winner = 0;
      this.winLine = null;
      return step;
    }

    /**
     * 评估把 color 落在 (r,c) 的分值（越大越好）。
     * 四个方向分别统计「连子数 + 两端空位」，映射为启发式分数。
     */
    scoreMove(r, c, color) {
      let total = 0;
      for (const [dr, dc] of DIRS) {
        total += this.scoreDirection(r, c, dr, dc, color);
      }
      return total;
    }

    scoreDirection(r, c, dr, dc, color) {
      let count = 1;
      let open = 0;

      let rr = r + dr;
      let cc = c + dc;
      while (this.inBounds(rr, cc) && this.get(rr, cc) === color) {
        count++;
        rr += dr;
        cc += dc;
      }
      if (this.inBounds(rr, cc) && this.get(rr, cc) === EMPTY) open++;

      rr = r - dr;
      cc = c - dc;
      while (this.inBounds(rr, cc) && this.get(rr, cc) === color) {
        count++;
        rr -= dr;
        cc -= dc;
      }
      if (this.inBounds(rr, cc) && this.get(rr, cc) === EMPTY) open++;

      if (count >= 5) return 10000000;
      if (count === 4) {
        if (open === 2) return 100000;   // 活四，必胜
        if (open === 1) return 10000;    // 冲四
        return 0;
      }
      if (count === 3) {
        if (open === 2) return 10000;    // 活三
        if (open === 1) return 500;
        return 0;
      }
      if (count === 2) {
        if (open === 2) return 500;
        if (open === 1) return 50;
        return 0;
      }
      if (count === 1) {
        if (open === 2) return 50;
        if (open === 1) return 5;
        return 0;
      }
      return 0;
    }

    /** 候选落点：已有棋子周围 2 格内的空位；空棋盘时取中心 */
    candidateCells() {
      if (this.history.length === 0) {
        const mid = Math.floor(this.size / 2);
        return [[mid, mid]];
      }
      const seen = new Set();
      const cells = [];
      for (const step of this.history) {
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const rr = step.row + dr;
            const cc = step.col + dc;
            if (!this.inBounds(rr, cc) || this.get(rr, cc) !== EMPTY) continue;
            const key = rr * this.size + cc;
            if (!seen.has(key)) {
              seen.add(key);
              cells.push([rr, cc]);
            }
          }
        }
      }
      return cells;
    }

    /**
     * 简单 AI：在候选点中取「进攻 + 防守」综合分最高者。
     * @param {number} color AI 执子的颜色
     * @returns {[number, number] | null}
     */
    aiMove(color) {
      if (this.finished) return null;
      const opp = color === BLACK ? WHITE : BLACK;
      const candidates = this.candidateCells();
      let best = null;
      let bestScore = -Infinity;
      for (const [r, c] of candidates) {
        const attack = this.scoreMove(r, c, color);
        const defense = this.scoreMove(r, c, opp);
        // 防守对手的成五优先级最高，进攻略权重于防守
        const score = attack * 1.1 + defense;
        if (score > bestScore) {
          bestScore = score;
          best = [r, c];
        }
      }
      return best;
    }
  }

  global.Gomoku = Gomoku;
  global.GomokuConstants = { EMPTY, BLACK, WHITE };
})(typeof window !== 'undefined' ? window : globalThis);