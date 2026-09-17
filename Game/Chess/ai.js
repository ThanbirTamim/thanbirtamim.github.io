/* ============================================================
   CHESS — AI opponents (Easy / Normal / Hard / Expert)
   Negamax + alpha-beta pruning, MVV-LVA move ordering, quiescence
   search, and a material + piece-square-table evaluation.
   Uses ChessGame's make/unmake for speed (no board cloning).
   Works in browser (window.ChessAI) and Node (module.exports).
   ============================================================ */
(function (root) {
  "use strict";
  const CFG = (typeof module !== "undefined" && module.exports) ? require("./config.js") : root.CHESS_CONFIG;
  const CG = (typeof module !== "undefined" && module.exports) ? require("./chess.js") : root.ChessGame;
  const VALUE = CFG.VALUE, PST = CFG.PST;
  const fileOf = CG.fileOf, rankOf = CG.rankOf, sq = CG.sq;
  const MATE = 1000000;

  // mirror a white-perspective square to black's perspective
  const mirror = (s) => sq(fileOf(s), 7 - rankOf(s));

  function isEndgame(board) {
    let q = 0, big = 0;
    for (const p of board) { if (!p) continue; if (p[1] === "Q") q++; if ("RQ".includes(p[1])) big++; }
    return q === 0 || big <= 2;
  }

  // static evaluation from White's perspective (centipawns)
  function evaluate(game) {
    const b = game.board; let score = 0; const end = isEndgame(b);
    for (let s = 0; s < 64; s++) {
      const p = b[s]; if (!p) continue;
      const type = p[1];
      const table = type === "K" ? (end ? PST.Kend : PST.K) : PST[type];
      if (p[0] === "w") { score += VALUE[type] + table[s]; }
      else { score -= VALUE[type] + table[mirror(s)]; }
    }
    return score;
  }

  // MVV-LVA style ordering: captures (by victim value) first, then promotions
  function orderMoves(game, moves) {
    const b = game.board;
    return moves.map((m) => {
      let s = 0;
      if (m.captured) s += 10 * VALUE[m.captured[1]] - VALUE[b[m.from][1]];
      if (m.ep) s += 10 * VALUE.P - VALUE.P;
      if (m.promotion) s += VALUE[m.promotion];
      return { m, s };
    }).sort((a, b2) => b2.s - a.s).map((x) => x.m);
  }

  // quiescence: keep searching captures to avoid the horizon effect
  function quiesce(game, alpha, beta, color, deadline) {
    const stand = color * evaluate(game);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (Date.now() > deadline) return alpha;
    const caps = game.moves().filter((m) => m.captured || m.promotion);
    for (const m of orderMoves(game, caps)) {
      game._make(m);
      const inChk = game.inCheck(color === 1 ? "w" : "b");
      if (inChk) { game._unmake(m); continue; }
      const val = -quiesce(game, -beta, -alpha, -color, deadline);
      game._unmake(m);
      if (val >= beta) return beta;
      if (val > alpha) alpha = val;
    }
    return alpha;
  }

  function negamax(game, depth, alpha, beta, color, deadline) {
    if (Date.now() > deadline) return { score: color * evaluate(game), move: null, aborted: true };
    const legal = game.moves();
    if (!legal.length) {
      if (game.inCheck(color === 1 ? "w" : "b")) return { score: -MATE - depth, move: null };
      return { score: 0, move: null }; // stalemate
    }
    if (depth === 0) return { score: quiesce(game, alpha, beta, color, deadline), move: null };
    let best = null, aborted = false;
    for (const m of orderMoves(game, legal)) {
      game._make(m);
      const r = negamax(game, depth - 1, -beta, -alpha, -color, deadline);
      game._unmake(m);
      const val = -r.score;
      if (r.aborted) aborted = true;
      if (best === null || val > best.score) best = { score: val, move: m };
      if (val > alpha) alpha = val;
      if (alpha >= beta) break; // beta cutoff
      if (aborted) break;
    }
    best.aborted = aborted;
    return best;
  }

  const ChessAI = {
    // choose a move for the side to move. difficulty: easy|normal|hard|expert
    choose(game, difficulty) {
      const legal = game.moves();
      if (!legal.length) return null;
      if (legal.length === 1) return legal[0];
      const color = game.turn === "w" ? 1 : -1;

      if (difficulty === "easy") {
        // 60% random, 40% greedy best-material — beatable but not silly
        if (Math.random() < 0.6) return legal[(Math.random() * legal.length) | 0];
        let best = null, bs = -Infinity;
        for (const m of legal) { game._make(m); const s = color * evaluate(game); game._unmake(m); if (s > bs) { bs = s; best = m; } }
        return best;
      }

      const maxDepth = CFG.AI_DEPTH[difficulty] || 2;
      const budget = CFG.AI_TIME_MS[difficulty] || 500;
      const deadline = Date.now() + budget;
      // iterative deepening for better move ordering & time control
      let chosen = legal[0], topMoves = [];
      for (let d = 1; d <= maxDepth; d++) {
        const r = negamax(game, d, -Infinity, Infinity, color, deadline);
        if (r.move) chosen = r.move;
        // gather near-best for light randomness at lower levels
        if (d === maxDepth) {
          const scored = [];
          for (const m of orderMoves(game, legal)) {
            game._make(m);
            const rr = negamax(game, d - 1, -Infinity, Infinity, -color, deadline);
            game._unmake(m);
            scored.push({ m, s: -rr.score });
          }
          scored.sort((a, b) => b.s - a.s);
          topMoves = scored;
        }
        if (Date.now() > deadline) break;
      }
      if (topMoves.length) {
        const bestScore = topMoves[0].s;
        // normal: sometimes pick a close 2nd; hard/expert: near-optimal
        const slack = difficulty === "normal" ? 40 : difficulty === "hard" ? 15 : 0;
        const chance = difficulty === "normal" ? 0.5 : difficulty === "hard" ? 0.2 : 0.04;
        const pool = topMoves.filter((x) => bestScore - x.s <= slack);
        if (pool.length > 1 && Math.random() < chance) return pool[(Math.random() * pool.length) | 0].m;
        return topMoves[0].m;
      }
      return chosen;
    },

    evaluate,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ChessAI;
  root.ChessAI = ChessAI;
})(typeof window !== "undefined" ? window : globalThis);
