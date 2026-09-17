/* ============================================================
   CHESS — pure rules engine (no DOM, deterministic, authoritative)
   Works in browser (window.ChessGame) and Node (module.exports).

   Board: length-64 array. Square index s -> file = s & 7 (0=a..7=h),
   rank = s >> 3 (0 = rank 1 = White home, 7 = rank 8 = Black home).
   Pieces are 2-char strings: colour ('w'|'b') + type ('P N B R Q K').
   Empty squares are null. White moves +8 (up the ranks).

   Implements: full legal move generation, castling, en passant,
   promotion, check / checkmate / stalemate, 50-move rule, threefold
   repetition, insufficient material, SAN, FEN, make/undo (for AI).
   ============================================================ */
(function (root) {
  "use strict";

  const fileOf = (s) => s & 7;
  const rankOf = (s) => s >> 3;
  const sq = (f, r) => r * 8 + f;
  const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
  const FILES = "abcdefgh";
  const algebraic = (s) => FILES[fileOf(s)] + (rankOf(s) + 1);
  const fromAlgebraic = (a) => sq(FILES.indexOf(a[0]), parseInt(a[1], 10) - 1);

  const KNIGHT_D = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const KING_D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const BISHOP_D = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ROOK_D = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  class ChessGame {
    constructor(fen) {
      this.load(fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    }

    // ---------------- FEN ----------------
    load(fen) {
      const parts = fen.trim().split(/\s+/);
      const board = new Array(64).fill(null);
      const rows = parts[0].split("/"); // rank 8 first
      for (let r = 0; r < 8; r++) {
        const row = rows[r]; let f = 0;
        for (const ch of row) {
          if (/\d/.test(ch)) { f += parseInt(ch, 10); }
          else {
            const color = ch === ch.toUpperCase() ? "w" : "b";
            board[sq(f, 7 - r)] = color + ch.toUpperCase();
            f++;
          }
        }
      }
      this.board = board;
      this.turn = parts[1] === "b" ? "b" : "w";
      const c = parts[2] || "-";
      this.castling = { K: c.includes("K"), Q: c.includes("Q"), k: c.includes("k"), q: c.includes("q") };
      this.ep = (parts[3] && parts[3] !== "-") ? fromAlgebraic(parts[3]) : -1;
      this.half = parseInt(parts[4] || "0", 10);
      this.full = parseInt(parts[5] || "1", 10);
      this.history = [];         // undo stack (make/undo)
      this.sanHistory = [];      // human-readable move list
      this.posCounts = {};       // repetition tracking
      this.status = "playing";   // playing | checkmate | stalemate | draw
      this.winner = null;        // 'w' | 'b' | null
      this.reason = null;        // e.g. 'checkmate','stalemate','fifty','repetition','material','resign','timeout','agreement'
      this._countPosition();
      this._refreshStatus();
      return this;
    }

    fen() {
      let out = "";
      for (let r = 7; r >= 0; r--) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.board[sq(f, r)];
          if (!p) { empty++; continue; }
          if (empty) { out += empty; empty = 0; }
          out += p[0] === "w" ? p[1] : p[1].toLowerCase();
        }
        if (empty) out += empty;
        if (r > 0) out += "/";
      }
      const cr = (this.castling.K ? "K" : "") + (this.castling.Q ? "Q" : "") + (this.castling.k ? "k" : "") + (this.castling.q ? "q" : "");
      out += " " + this.turn + " " + (cr || "-") + " " + (this.ep >= 0 ? algebraic(this.ep) : "-") + " " + this.half + " " + this.full;
      return out;
    }

    // repetition key: board + turn + castling + ep
    _posKey() {
      const cr = (this.castling.K ? "K" : "") + (this.castling.Q ? "Q" : "") + (this.castling.k ? "k" : "") + (this.castling.q ? "q" : "");
      return this.board.map((p) => p || "-").join("") + this.turn + cr + this.ep;
    }
    _countPosition() { const k = this._posKey(); this.posCounts[k] = (this.posCounts[k] || 0) + 1; return this.posCounts[k]; }

    // ---------------- attack / check ----------------
    kingSquare(color) { const t = color + "K"; for (let s = 0; s < 64; s++) if (this.board[s] === t) return s; return -1; }

    isAttacked(s, by) {
      const b = this.board, f = fileOf(s), r = rankOf(s);
      // pawn: a 'by' pawn attacks s if it sits one rank toward its own side, file ±1
      const pdir = by === "w" ? -1 : 1; // where the attacking pawn would be relative to s
      for (const df of [-1, 1]) {
        const pf = f + df, pr = r + pdir;
        if (onBoard(pf, pr) && b[sq(pf, pr)] === by + "P") return true;
      }
      // knight
      for (const [df, dr] of KNIGHT_D) { const nf = f + df, nr = r + dr; if (onBoard(nf, nr) && b[sq(nf, nr)] === by + "N") return true; }
      // king
      for (const [df, dr] of KING_D) { const nf = f + df, nr = r + dr; if (onBoard(nf, nr) && b[sq(nf, nr)] === by + "K") return true; }
      // bishop / queen (diagonals)
      for (const [df, dr] of BISHOP_D) {
        let nf = f + df, nr = r + dr;
        while (onBoard(nf, nr)) { const p = b[sq(nf, nr)]; if (p) { if (p[0] === by && (p[1] === "B" || p[1] === "Q")) return true; break; } nf += df; nr += dr; }
      }
      // rook / queen (orthogonals)
      for (const [df, dr] of ROOK_D) {
        let nf = f + df, nr = r + dr;
        while (onBoard(nf, nr)) { const p = b[sq(nf, nr)]; if (p) { if (p[0] === by && (p[1] === "R" || p[1] === "Q")) return true; break; } nf += df; nr += dr; }
      }
      return false;
    }

    inCheck(color) { const ks = this.kingSquare(color); return ks < 0 ? false : this.isAttacked(ks, color === "w" ? "b" : "w"); }

    // ---------------- pseudo-legal generation ----------------
    _pseudo(color) {
      const b = this.board, moves = [];
      const enemy = color === "w" ? "b" : "w";
      const push = (from, to, extra) => moves.push(Object.assign({ from, to, promotion: null, captured: b[to] || null, ep: false, castle: null, double: false }, extra));
      for (let s = 0; s < 64; s++) {
        const p = b[s]; if (!p || p[0] !== color) continue;
        const f = fileOf(s), r = rankOf(s), type = p[1];
        if (type === "P") {
          const dir = color === "w" ? 1 : -1;
          const startRank = color === "w" ? 1 : 6;
          const promoRank = color === "w" ? 7 : 0;
          const one = sq(f, r + dir);
          if (onBoard(f, r + dir) && !b[one]) {
            if (r + dir === promoRank) for (const pr of ["Q", "R", "B", "N"]) push(s, one, { promotion: pr });
            else push(s, one);
            if (r === startRank) { const two = sq(f, r + 2 * dir); if (!b[two]) push(s, two, { double: true }); }
          }
          for (const df of [-1, 1]) {
            const cf = f + df, cr = r + dir; if (!onBoard(cf, cr)) continue;
            const t = sq(cf, cr), tp = b[t];
            if (tp && tp[0] === enemy) {
              if (cr === promoRank) for (const pr of ["Q", "R", "B", "N"]) push(s, t, { promotion: pr });
              else push(s, t);
            } else if (t === this.ep) {
              push(s, t, { ep: true, captured: enemy + "P" });
            }
          }
        } else if (type === "N") {
          for (const [df, dr] of KNIGHT_D) { const nf = f + df, nr = r + dr; if (!onBoard(nf, nr)) continue; const t = sq(nf, nr); if (!b[t] || b[t][0] === enemy) push(s, t); }
        } else if (type === "K") {
          for (const [df, dr] of KING_D) { const nf = f + df, nr = r + dr; if (!onBoard(nf, nr)) continue; const t = sq(nf, nr); if (!b[t] || b[t][0] === enemy) push(s, t); }
          // castling
          const rights = color === "w" ? { k: this.castling.K, q: this.castling.Q } : { k: this.castling.k, q: this.castling.q };
          const home = color === "w" ? 4 : 60;
          if (s === home && !this.inCheck(color)) {
            if (rights.k && !b[home + 1] && !b[home + 2] && !this.isAttacked(home + 1, enemy) && !this.isAttacked(home + 2, enemy) && b[home + 3] === color + "R")
              push(s, home + 2, { castle: "k" });
            if (rights.q && !b[home - 1] && !b[home - 2] && !b[home - 3] && !this.isAttacked(home - 1, enemy) && !this.isAttacked(home - 2, enemy) && b[home - 4] === color + "R")
              push(s, home - 2, { castle: "q" });
          }
        } else {
          const dirs = type === "B" ? BISHOP_D : type === "R" ? ROOK_D : BISHOP_D.concat(ROOK_D);
          for (const [df, dr] of dirs) {
            let nf = f + df, nr = r + dr;
            while (onBoard(nf, nr)) { const t = sq(nf, nr); if (!b[t]) { push(s, t); } else { if (b[t][0] === enemy) push(s, t); break; } nf += df; nr += dr; }
          }
        }
      }
      return moves;
    }

    // legal moves for the side to move
    moves() {
      const color = this.turn, out = [];
      for (const m of this._pseudo(color)) {
        this._make(m);
        if (!this.inCheck(color)) out.push(m);
        this._unmake(m);
      }
      return out;
    }

    movesFrom(from) { return this.moves().filter((m) => m.from === from); }

    // ---------------- make / unmake (internal, no status refresh) ----------------
    _make(m) {
      const b = this.board, piece = b[m.from], color = piece[0];
      const undo = { m, piece, captured: null, capSq: -1, castling: { K: this.castling.K, Q: this.castling.Q, k: this.castling.k, q: this.castling.q }, ep: this.ep, half: this.half, full: this.full, turn: this.turn };
      b[m.from] = null;
      if (m.ep) { const capSq = m.to + (color === "w" ? -8 : 8); undo.captured = b[capSq]; undo.capSq = capSq; b[capSq] = null; }
      else if (b[m.to]) { undo.captured = b[m.to]; undo.capSq = m.to; }
      b[m.to] = m.promotion ? color + m.promotion : piece;
      if (m.castle === "k") { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
      else if (m.castle === "q") { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }
      // castling rights
      if (piece[1] === "K") { if (color === "w") { this.castling.K = this.castling.Q = false; } else { this.castling.k = this.castling.q = false; } }
      const clearRookRight = (s2) => {
        if (s2 === 0) this.castling.Q = false; else if (s2 === 7) this.castling.K = false;
        else if (s2 === 56) this.castling.q = false; else if (s2 === 63) this.castling.k = false;
      };
      if (piece[1] === "R") clearRookRight(m.from);
      if (undo.capSq >= 0) clearRookRight(undo.capSq);
      // en passant target
      this.ep = m.double ? (m.from + m.to) / 2 : -1;
      // clocks / counters
      this.half = (piece[1] === "P" || undo.captured) ? 0 : this.half + 1;
      if (color === "b") this.full++;
      this.turn = color === "w" ? "b" : "w";
      this.history.push(undo);
    }
    _unmake() {
      const undo = this.history.pop(); if (!undo) return;
      const b = this.board, m = undo.m, piece = undo.piece, color = piece[0];
      b[m.from] = piece; b[m.to] = null;
      if (m.castle === "k") { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = null; }
      else if (m.castle === "q") { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = null; }
      if (undo.capSq >= 0) b[undo.capSq] = undo.captured;
      this.castling = undo.castling; this.ep = undo.ep; this.half = undo.half; this.full = undo.full; this.turn = undo.turn;
    }

    // ---------------- public move application (with SAN + status) ----------------
    // accepts a move object OR {from,to,promotion}
    move(input) {
      const legal = this.moves();
      let m = null;
      if (input && input.from != null && input.to != null) {
        m = legal.find((x) => x.from === input.from && x.to === input.to && (input.promotion ? x.promotion === input.promotion : (!x.promotion || x.promotion === "Q")));
      }
      if (!m) return null;
      const san = this._san(m, legal);
      this._make(m);
      this._countPosition();
      this._refreshStatus();
      const rec = { from: m.from, to: m.to, promotion: m.promotion, san, color: this.board[m.to][0] === "w" ? "b" : "w" };
      this.sanHistory.push(rec);
      return { move: m, san, status: this.status, winner: this.winner, reason: this.reason };
    }

    _san(m, legal) {
      if (m.castle === "k") return this._checkSuffix(m, "O-O");
      if (m.castle === "q") return this._checkSuffix(m, "O-O-O");
      const piece = this.board[m.from], type = piece[1];
      const capture = !!(m.captured || m.ep);
      let s = "";
      if (type === "P") {
        if (capture) s += FILES[fileOf(m.from)] + "x";
        s += algebraic(m.to);
        if (m.promotion) s += "=" + m.promotion;
      } else {
        s += type;
        // disambiguation
        const same = legal.filter((x) => x.to === m.to && x.from !== m.from && this.board[x.from] === piece);
        if (same.length) {
          const sameFile = same.some((x) => fileOf(x.from) === fileOf(m.from));
          const sameRank = same.some((x) => rankOf(x.from) === rankOf(m.from));
          if (!sameFile) s += FILES[fileOf(m.from)];
          else if (!sameRank) s += (rankOf(m.from) + 1);
          else s += algebraic(m.from);
        }
        if (capture) s += "x";
        s += algebraic(m.to);
      }
      return this._checkSuffix(m, s);
    }
    _checkSuffix(m, s) {
      this._make(m);
      const opp = this.turn;
      let suffix = "";
      if (this.inCheck(opp)) suffix = this._hasLegal() ? "+" : "#";
      this._unmake(m);
      return s + suffix;
    }
    _hasLegal() {
      const color = this.turn;
      for (const m of this._pseudo(color)) { this._make(m); const ok = !this.inCheck(color); this._unmake(m); if (ok) return true; }
      return false;
    }

    // ---------------- status ----------------
    _insufficientMaterial() {
      const pieces = [];
      for (const p of this.board) if (p && p[1] !== "K") pieces.push(p);
      if (pieces.length === 0) return true;                             // K vs K
      if (pieces.length === 1 && (pieces[0][1] === "B" || pieces[0][1] === "N")) return true; // K+minor vs K
      if (pieces.length === 2 && pieces.every((p) => p[1] === "B")) {   // K+B vs K+B, same colour bishops
        // (approximate: two bishops with different owners on same colour) -> treat generic 2-bishop as insufficient only if same square colour
        const bishSquares = [];
        for (let s = 0; s < 64; s++) { const p = this.board[s]; if (p && p[1] === "B") bishSquares.push((fileOf(s) + rankOf(s)) & 1); }
        if (bishSquares.length === 2 && bishSquares[0] === bishSquares[1]) return true;
      }
      return false;
    }
    _refreshStatus() {
      const color = this.turn;
      const hasMove = this._hasLegal();
      if (!hasMove) {
        if (this.inCheck(color)) { this.status = "checkmate"; this.winner = color === "w" ? "b" : "w"; this.reason = "checkmate"; }
        else { this.status = "stalemate"; this.winner = null; this.reason = "stalemate"; }
        return;
      }
      if (this.half >= 100) { this.status = "draw"; this.winner = null; this.reason = "fifty"; return; }
      if (this.posCounts[this._posKey()] >= 3) { this.status = "draw"; this.winner = null; this.reason = "repetition"; return; }
      if (this._insufficientMaterial()) { this.status = "draw"; this.winner = null; this.reason = "material"; return; }
      this.status = "playing"; this.winner = null; this.reason = null;
    }

    // externally forced results (resign / timeout / agreement)
    setResult(status, winner, reason) { this.status = status; this.winner = winner; this.reason = reason; }

    // ---------------- serialize for network ----------------
    serialize() {
      return {
        board: this.board.slice(), turn: this.turn, castling: Object.assign({}, this.castling),
        ep: this.ep, half: this.half, full: this.full, status: this.status, winner: this.winner,
        reason: this.reason, sanHistory: this.sanHistory.slice(), posCounts: Object.assign({}, this.posCounts),
        lastMove: this.history.length ? { from: this.history[this.history.length - 1].m.from, to: this.history[this.history.length - 1].m.to } : null,
      };
    }
    static deserialize(s) {
      const g = new ChessGame();
      g.board = s.board.slice(); g.turn = s.turn; g.castling = Object.assign({}, s.castling);
      g.ep = s.ep; g.half = s.half; g.full = s.full; g.status = s.status; g.winner = s.winner; g.reason = s.reason;
      g.sanHistory = (s.sanHistory || []).slice(); g.posCounts = Object.assign({}, s.posCounts || {}); g.history = [];
      g._lastMove = s.lastMove || null;
      return g;
    }
    lastMove() { if (this._lastMove) return this._lastMove; const h = this.history[this.history.length - 1]; return h ? { from: h.m.from, to: h.m.to } : null; }

    reset() { this.load("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"); }
  }

  ChessGame.fileOf = fileOf; ChessGame.rankOf = rankOf; ChessGame.sq = sq;
  ChessGame.algebraic = algebraic; ChessGame.fromAlgebraic = fromAlgebraic;

  if (typeof module !== "undefined" && module.exports) module.exports = ChessGame;
  root.ChessGame = ChessGame;
})(typeof window !== "undefined" ? window : globalThis);
