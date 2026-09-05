/* ============================================================
   LUDO — AI opponents (Easy / Normal / Hard / Expert)
   Pure function: pick a token index from legal moves given state.
   Works in browser (window.LudoAI) and Node (module.exports).
   ============================================================ */
(function (root) {
  "use strict";
  const CFG = (typeof module !== "undefined" && module.exports) ? require("./config.js") : root.LUDO_CONFIG;

  function ringIndex(color, r) { if (r >= 1 && r <= CFG.RING_LEN) return (CFG.OFFSET[color] + (r - 1)) % 52; return null; }
  function isSafeIdx(idx) { return idx == null || CFG.SAFE.has(idx); }

  // score a candidate move (higher = better)
  function scoreMove(game, color, i, v) {
    const p = game.players[game.turn]; const r = p.tokens[i];
    const nr = r === 0 ? 1 : r + v;
    let score = 0;
    // bring a token out
    if (r === 0 && v === 6) score += 30;
    // reaching home
    if (nr === CFG.PATH_LEN) score += 80;
    // entering home lane (safe zone)
    if (nr >= 52) score += 25;
    // capture?
    const idx = ringIndex(color, nr);
    if (idx != null && !CFG.SAFE.has(idx)) {
      for (const op of game.players) { if (op.color === color) continue; for (const orr of op.tokens) { if (orr >= 1 && orr <= CFG.RING_LEN && ringIndex(op.color, orr) === idx) score += 60 + orr * 0.5; } }
    }
    // land on safe cell
    if (idx != null && CFG.SAFE.has(idx)) score += 18;
    // progress
    score += nr * 0.4;
    // risk: landing on a non-safe cell within reach behind an opponent
    if (idx != null && !CFG.SAFE.has(idx)) {
      for (const op of game.players) { if (op.color === color) continue; for (const orr of op.tokens) { if (orr < 1 || orr > CFG.RING_LEN) continue; const oidx = ringIndex(op.color, orr); for (let d = 1; d <= 6; d++) { if ((oidx + d) % 52 === idx) { score -= 22; break; } } } }
    }
    return score;
  }

  const LudoAI = {
    // difficulty: 'easy'|'normal'|'hard'|'expert'
    choose(game, legal, v, difficulty) {
      if (!legal.length) return -1;
      if (legal.length === 1) return legal[0];
      const color = game.curColor();
      if (difficulty === "easy") return legal[(Math.random() * legal.length) | 0];
      const scored = legal.map((i) => ({ i, s: scoreMove(game, color, i, v) }));
      scored.sort((a, b) => b.s - a.s);
      if (difficulty === "normal") { // mostly best, sometimes 2nd
        if (scored.length > 1 && Math.random() < 0.35) return scored[1].i;
        return scored[0].i;
      }
      if (difficulty === "hard") { if (scored.length > 1 && Math.random() < 0.12) return scored[1].i; return scored[0].i; }
      // expert: best, tiny imperfection
      if (scored.length > 1 && Math.random() < 0.05) return scored[1].i;
      return scored[0].i;
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = LudoAI;
  root.LudoAI = LudoAI;
})(typeof window !== "undefined" ? window : globalThis);
