/* ============================================================
   LUDO — configuration, board geometry & constants
   Works in browser (window.LUDO_CONFIG) and Node (module.exports).
   ============================================================ */
(function (root) {
  "use strict";

  // ---- board geometry on a 15x15 grid (x=col, y=row, 0..14) ----
  const rot = (x, y) => ({ x: 14 - y, y: x });          // 90° clockwise about centre
  const arm0 = [[1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0]];
  const RING = [];
  {
    let cur = arm0.map((p) => ({ x: p[0], y: p[1] }));
    for (let a = 0; a < 4; a++) { for (const p of cur) RING.push({ x: p.x, y: p.y }); cur = cur.map((p) => rot(p.x, p.y)); }
  }

  const HOME = {
    red:    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
    green:  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
    yellow: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
    blue:   [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  };
  const HOME_LANE = {}; for (const c in HOME) HOME_LANE[c] = HOME[c].map((p) => ({ x: p[0], y: p[1] }));

  const OFFSET = { red: 0, green: 13, yellow: 26, blue: 39 };
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);   // start cells + star cells
  const ORDER = ["red", "green", "yellow", "blue"];

  // yard token slots (grid coords) per colour corner
  const YARD = {
    red:    [{ x: 2, y: 2 }, { x: 3.5, y: 2 }, { x: 2, y: 3.5 }, { x: 3.5, y: 3.5 }],
    green:  [{ x: 10.5, y: 2 }, { x: 12, y: 2 }, { x: 10.5, y: 3.5 }, { x: 12, y: 3.5 }],
    yellow: [{ x: 10.5, y: 10.5 }, { x: 12, y: 10.5 }, { x: 10.5, y: 12 }, { x: 12, y: 12 }],
    blue:   [{ x: 2, y: 10.5 }, { x: 3.5, y: 10.5 }, { x: 2, y: 12 }, { x: 3.5, y: 12 }],
  };
  const HEX = { red: "#e2445c", green: "#2fae5f", yellow: "#f4be36", blue: "#3a7be0" };
  const HEX_DARK = { red: "#a52a3c", green: "#1d7a40", yellow: "#b8891c", blue: "#255aa8" };
  const EMOJI = { red: "🔴", green: "🟢", yellow: "🟡", blue: "🔵" };

  const CFG = {
    RING, HOME_LANE, OFFSET, SAFE, ORDER, YARD, HEX, HEX_DARK, EMOJI,
    PATH_LEN: 57,               // r: 0 yard, 1..51 ring, 52..57 home lane (57 = finished)
    RING_LEN: 51,
    TOKENS: 4,
    GRID: 15,
    CENTER: { x: 7, y: 7 },
    MAX_SIXES: 3,               // 3 consecutive 6s forfeits the turn

    // animation
    STEP_MS: 150, STEP_MS_FAST: 60, DICE_MS: 600,

    // ---- signalling (WebRTC via PeerJS free broker; no backend needed) ----
    // PeerJS cloud broker is used ONLY to establish the peer connection.
    // To self-host, set NET.host/port/path and secure:true. No secrets here.
    NET: {
      idPrefix: "thanbir-ludo-",     // room code -> peer id (namespaced to avoid clashes)

      // ============================================================
      //  ICE SERVERS  (this is what makes SAME / DIFFERENT / MIXED
      //  networks all work)
      //  - STUN: lets two peers discover each other and punch through
      //          most NATs directly (works same-Wi-Fi and many
      //          different-network cases).
      //  - TURN: relays traffic when direct P2P is blocked (strict
      //          firewalls, symmetric NAT, mobile carriers). TURN
      //          works for EVERY combination, so with a live TURN
      //          server the game connects no matter the networks.
      // ============================================================

      // >>> For guaranteed cross-network play (optional), paste your own free
      //     TURN server below (from any provider). Checked first if present.
      //     Leave empty to use only the keyless public servers below.
      userTurn: [
        // { urls: "turn:YOUR.turn.server:3478", username: "YOUR_USER", credential: "YOUR_CRED" },
        // { urls: "turns:YOUR.turn.server:5349?transport=tcp", username: "YOUR_USER", credential: "YOUR_CRED" },
      ],

      // STUN — direct connectivity (multiple providers for redundancy).
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

      // best-effort free TURN relays (public Open Relay Project, no account
      // needed; may be rate-limited — for guaranteed uptime add your own
      // relay in userTurn above). UDP + TCP + TLS on 80/443 to survive firewalls.
      turn: [
        { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turns:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
      ],
      graceMs: 20000,                 // reconnect grace period
      joinTimeoutMs: 25000,           // ICE over TURN can be slow
      createTimeoutMs: 15000,
    },
    AI_DELAY: 700,
  };

  // assemble PeerJS options: user TURN first (preferred), then STUN, then best-effort free TURN.
  // iceCandidatePoolSize pre-gathers candidates so same-network relay fallback is quick.
  CFG.NET.peerConfig = {
    debug: 1,
    config: {
      iceServers: [].concat(CFG.NET.userTurn || [], CFG.NET.stun || [], CFG.NET.turn || []),
      iceCandidatePoolSize: 4,
      sdpSemantics: "unified-plan",
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = CFG;
  root.LUDO_CONFIG = CFG;
})(typeof window !== "undefined" ? window : globalThis);
