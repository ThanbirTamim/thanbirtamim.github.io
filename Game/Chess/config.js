/* ============================================================
   CHESS — configuration, board constants & networking config.
   Works in browser (window.CHESS_CONFIG) and Node (module.exports).
   ============================================================ */
(function (root) {
  "use strict";

  // Piece values (centipawns) used by the AI evaluator.
  const VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

  // Piece-square tables (white perspective, index 0 = a1 .. 63 = h8).
  // Positive = good square for a white piece. Black uses the mirror.
  const PST = {
    P: [
        0,  0,  0,  0,  0,  0,  0,  0,
        5, 10, 10,-20,-20, 10, 10,  5,
        5, -5,-10,  0,  0,-10, -5,  5,
        0,  0,  0, 20, 20,  0,  0,  0,
        5,  5, 10, 25, 25, 10,  5,  5,
       10, 10, 20, 30, 30, 20, 10, 10,
       50, 50, 50, 50, 50, 50, 50, 50,
        0,  0,  0,  0,  0,  0,  0,  0,
    ],
    N: [
      -50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,  0,  5,  5,  0,-20,-40,
      -30,  5, 10, 15, 15, 10,  5,-30,
      -30,  0, 15, 20, 20, 15,  0,-30,
      -30,  5, 15, 20, 20, 15,  5,-30,
      -30,  0, 10, 15, 15, 10,  0,-30,
      -40,-20,  0,  0,  0,  0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50,
    ],
    B: [
      -20,-10,-10,-10,-10,-10,-10,-20,
      -10,  5,  0,  0,  0,  0,  5,-10,
      -10, 10, 10, 10, 10, 10, 10,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10,  5,  5, 10, 10,  5,  5,-10,
      -10,  0,  5, 10, 10,  5,  0,-10,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -20,-10,-10,-10,-10,-10,-10,-20,
    ],
    R: [
        0,  0,  0,  5,  5,  0,  0,  0,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
        5, 10, 10, 10, 10, 10, 10,  5,
        0,  0,  0,  0,  0,  0,  0,  0,
    ],
    Q: [
      -20,-10,-10, -5, -5,-10,-10,-20,
      -10,  0,  5,  0,  0,  0,  0,-10,
      -10,  5,  5,  5,  5,  5,  0,-10,
        0,  0,  5,  5,  5,  5,  0, -5,
       -5,  0,  5,  5,  5,  5,  0, -5,
      -10,  0,  5,  5,  5,  5,  0,-10,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -20,-10,-10, -5, -5,-10,-10,-20,
    ],
    K: [ // middlegame: king wants shelter
       20, 30, 10,  0,  0, 10, 30, 20,
       20, 20,  0,  0,  0,  0, 20, 20,
      -10,-20,-20,-20,-20,-20,-20,-10,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
    ],
    Kend: [ // endgame: king becomes active
      -50,-30,-30,-30,-30,-30,-30,-50,
      -30,-30,  0,  0,  0,  0,-30,-30,
      -30,-10, 20, 30, 30, 20,-10,-30,
      -30,-10, 30, 40, 40, 30,-10,-30,
      -30,-10, 30, 40, 40, 30,-10,-30,
      -30,-10, 20, 30, 30, 20,-10,-30,
      -30,-20,-10,  0,  0,-10,-20,-30,
      -50,-40,-30,-20,-20,-30,-40,-50,
    ],
  };

  // Unicode glyphs (used as fallbacks / captured trays).
  const GLYPH = {
    wK: "\u2654", wQ: "\u2655", wR: "\u2656", wB: "\u2657", wN: "\u2658", wP: "\u2659",
    bK: "\u265A", bQ: "\u265B", bR: "\u265C", bB: "\u265D", bN: "\u265E", bP: "\u265F",
  };

  // Optional time controls (minutes base + seconds increment). null = no clock.
  const TIME_CONTROLS = {
    off:    null,
    "3+2":  { base: 180,  inc: 2 },
    "5+0":  { base: 300,  inc: 0 },
    "10+0": { base: 600,  inc: 0 },
    "15+10":{ base: 900,  inc: 10 },
  };

  const AI_DEPTH = { easy: 1, normal: 2, hard: 3, expert: 4 };
  const AI_TIME_MS = { easy: 200, normal: 500, hard: 1200, expert: 2500 };

  const CFG = {
    VALUE, PST, GLYPH, TIME_CONTROLS, AI_DEPTH, AI_TIME_MS,
    START_FEN: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    AI_DELAY: 450,

    // board theme colours
    THEME: {
      light: "#eADFc2", dark: "#a97c50", lightSel: "#f7ec9a", darkSel: "#d9c15a",
      lastFrom: "rgba(255,207,92,0.42)", lastTo: "rgba(255,207,92,0.55)",
      move: "rgba(40,60,90,0.32)", capture: "rgba(220,60,60,0.55)",
      check: "rgba(230,60,60,0.75)", coord: "rgba(30,20,10,0.55)",
    },

    // ---- signalling (WebRTC via PeerJS free broker; no backend needed) ----
    NET: {
      idPrefix: "thanbir-chess-",
      userTurn: [
        // { urls: "turn:YOUR.turn.server:3478", username: "USER", credential: "CRED" },
      ],
      stun: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:stun.l.google.com:5349" },
        { urls: "stun:stun.cloudflare.com:3478" },
        { urls: "stun:stun.relay.metered.ca:80" },
      ],
      turn: [
        { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turns:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
      ],
      graceMs: 20000,
      joinTimeoutMs: 25000,
      createTimeoutMs: 15000,
    },
  };

  CFG.NET.peerConfig = {
    debug: 1,
    config: {
      iceServers: [].concat(CFG.NET.userTurn || [], CFG.NET.stun || [], CFG.NET.turn || []),
      iceCandidatePoolSize: 4,
      sdpSemantics: "unified-plan",
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = CFG;
  root.CHESS_CONFIG = CFG;
})(typeof window !== "undefined" ? window : globalThis);
