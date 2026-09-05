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
      // leave host empty to use the free PeerJS cloud broker (0.peerjs.com)
      // STUN alone fails across many mobile/NAT networks, so we also include free public
      // TURN relays (openrelay.metered.ca) so phone <-> laptop connections work reliably.
      // These are public, non-secret credentials. Swap for your own TURN in production if desired.
      peerConfig: { debug: 1, config: { iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" },
        { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
      ] } },
      graceMs: 20000,                 // reconnect grace period
      joinTimeoutMs: 16000,           // ICE can be slow over TURN — give it time
      createTimeoutMs: 15000,
    },
    AI_DELAY: 700,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = CFG;
  root.LUDO_CONFIG = CFG;
})(typeof window !== "undefined" ? window : globalThis);
