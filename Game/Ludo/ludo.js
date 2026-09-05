/* ============================================================
   LUDO — pure rules engine (no DOM, deterministic, authoritative)
   Works in browser (window.LudoGame) and Node (module.exports).
   Positions r: 0 = yard, 1..51 = shared ring, 52..57 = home lane
   (57 = finished). Exact count needed to finish (no overshoot).
   ============================================================ */
(function (root) {
  "use strict";
  const CFG = (typeof module !== "undefined" && module.exports) ? require("./config.js") : root.LUDO_CONFIG;

  class LudoGame {
    constructor(colors) {
      // colors: ordered active colours e.g. ["red","green","yellow","blue"]
      this.colors = colors.slice();
      this.players = colors.map((c) => ({ color: c, tokens: [0, 0, 0, 0], moves: 0, captures: 0, homeCount: 0, finished: false }));
      this.turn = 0; this.dice = null; this.sixStreak = 0; this.status = "playing"; this.winner = null;
      this.standings = []; this.turnNumber = 1; this.lastEvent = null;
    }
    cur() { return this.players[this.turn]; }
    curColor() { return this.players[this.turn].color; }

    // absolute ring index for a token position (1..51), else null
    ringIndex(color, r) { if (r >= 1 && r <= CFG.RING_LEN) return (CFG.OFFSET[color] + (r - 1)) % 52; return null; }
    isSafeAt(color, r) { const idx = this.ringIndex(color, r); return idx == null ? true : CFG.SAFE.has(idx); }

    setDice(v) { this.dice = v; }

    legalMoves(v) {
      const p = this.cur(); const out = [];
      for (let i = 0; i < 4; i++) {
        const r = p.tokens[i];
        if (r >= CFG.PATH_LEN) continue;         // finished
        if (r === 0) { if (v === 6) out.push(i); }
        else { if (r + v <= CFG.PATH_LEN) out.push(i); }
      }
      return out;
    }

    // apply a validated move for current player; returns event object
    applyMove(i) {
      const v = this.dice; const p = this.cur(); const color = p.color; const r = p.tokens[i];
      const nr = r === 0 ? 1 : r + v;
      const path = [];
      for (let s = (r === 0 ? 1 : r + 1); s <= nr; s++) path.push(s);
      p.tokens[i] = nr; p.moves++;
      // capture (only on shared ring, non-safe cell)
      const captures = [];
      const idx = this.ringIndex(color, nr);
      if (idx != null && !CFG.SAFE.has(idx)) {
        for (const op of this.players) {
          if (op.color === color) continue;
          for (let k = 0; k < 4; k++) { const orr = op.tokens[k]; if (orr >= 1 && orr <= CFG.RING_LEN && this.ringIndex(op.color, orr) === idx) { op.tokens[k] = 0; captures.push({ color: op.color, token: k }); } }
        }
      }
      p.captures += captures.length;
      const home = nr === CFG.PATH_LEN; if (home) p.homeCount++;
      // win?
      let win = false;
      if (p.tokens.every((t) => t === CFG.PATH_LEN)) { p.finished = true; win = true; if (!this.standings.includes(color)) this.standings.push(color); this.status = "won"; this.winner = color; }
      const extra = (v === 6 || captures.length > 0 || home) && !win;
      const ev = { color, token: i, from: r, to: nr, path, captures, home, extra, dice: v };
      this.lastEvent = ev; this.dice = null;
      return ev;
    }

    // advance to next player (unless extra turn). returns next color
    nextTurn(extra) {
      if (this.status === "won") return this.curColor();
      if (extra) { this.dice = null; return this.curColor(); }
      this.sixStreak = 0;
      let n = this.turn, guard = 0;
      do { n = (n + 1) % this.players.length; guard++; } while (this.players[n].finished && guard < 8);
      this.turn = n; this.dice = null; this.turnNumber++;
      return this.curColor();
    }

    // handle a rolled six streak (call before applying); returns true if forfeited
    noteRoll(v) { if (v === 6) { this.sixStreak++; if (this.sixStreak >= CFG.MAX_SIXES) return true; } else this.sixStreak = 0; return false; }

    // compute final standings ordering (winner first, then by homeCount/progress)
    finalStandings() {
      const rank = this.players.slice().sort((a, b) => {
        const ai = this.standings.indexOf(a.color), bi = this.standings.indexOf(b.color);
        if (ai !== -1 || bi !== -1) { if (ai === -1) return 1; if (bi === -1) return -1; return ai - bi; }
        if (b.homeCount !== a.homeCount) return b.homeCount - a.homeCount;
        const prog = (p) => p.tokens.reduce((s, t) => s + t, 0);
        return prog(b) - prog(a);
      });
      return rank.map((p) => p.color);
    }

    serialize() { return { colors: this.colors, players: this.players, turn: this.turn, dice: this.dice, sixStreak: this.sixStreak, status: this.status, winner: this.winner, standings: this.standings, turnNumber: this.turnNumber }; }
    static load(s) { const g = new LudoGame(s.colors); Object.assign(g, s); return g; }
    reset() { for (const p of this.players) { p.tokens = [0, 0, 0, 0]; p.moves = 0; p.captures = 0; p.homeCount = 0; p.finished = false; } this.turn = 0; this.dice = null; this.sixStreak = 0; this.status = "playing"; this.winner = null; this.standings = []; this.turnNumber = 1; this.lastEvent = null; }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = LudoGame;
  root.LudoGame = LudoGame;
})(typeof window !== "undefined" ? window : globalThis);
