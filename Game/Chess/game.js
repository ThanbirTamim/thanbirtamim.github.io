/* ============================================================
   CHESS — game controller / UI / rendering / turn flow
   Ties together chess.js (rules), ai.js (AI), network.js (P2P).
   Host-authoritative: moves are validated by the authority
   (offline: this device; online: the room host) then broadcast.
   ============================================================ */
(function () {
  "use strict";
  const CFG = window.CHESS_CONFIG, ChessGame = window.ChessGame, AI = window.ChessAI;
  const el = (id) => document.getElementById(id);
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const fileOf = ChessGame.fileOf, rankOf = ChessGame.rankOf, SQ = ChessGame.sq, alg = ChessGame.algebraic;
  const SOLID = { K: "\u265A", Q: "\u265B", R: "\u265C", B: "\u265D", N: "\u265E", P: "\u265F" };

  // ---------- audio (WebAudio synth, no files) ----------
  const Audio = (() => {
    let ac = null, muted = localStorage.getItem("chessSound") === "off";
    const ensure = () => { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (ac && ac.state === "suspended") ac.resume(); return ac; };
    const tone = (f, d, type = "sine", vol = 0.1, slide = null) => { if (muted) return; const c = ensure(); if (!c) return; const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, c.currentTime); if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + d); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + d); };
    return {
      ensure, click: () => tone(500, 0.05, "square", 0.05),
      move: () => tone(300, 0.08, "sine", 0.09, 420),
      capture: () => { tone(200, 0.16, "sawtooth", 0.12, 90); },
      castle: () => { tone(360, 0.09, "square", 0.08, 500); setTimeout(() => tone(300, 0.09, "square", 0.07, 420), 70); },
      check: () => tone(760, 0.14, "triangle", 0.11, 980),
      promote: () => [523, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.12, "triangle", 0.1), i * 90)),
      win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, "triangle", 0.12), i * 130)),
      lose: () => tone(300, 0.4, "sine", 0.1, 150),
      notify: () => tone(660, 0.12, "sine", 0.08, 880),
      toggle() { muted = !muted; localStorage.setItem("chessSound", muted ? "off" : "on"); return muted; }, get muted() { return muted; },
    };
  })();

  // ---------- game state ----------
  const G = {
    mode: null,               // cpu | passplay | online
    game: null, players: [], mePid: null, myColor: "w",
    net: null, roomCode: null, aiDiff: "normal",
    orient: "w",              // which colour sits at the bottom
    manualFlip: false,
    selected: -1, legalTargets: [], busy: false, animating: false,
    anim: null, lastMove: null, pendingPromo: null,
    clock: { enabled: false, w: 0, b: 0, inc: 0, active: null, syncAt: 0 },
    drawOfferBy: null, _ended: false, tc: "off",
  };

  const screens = ["menu", "create", "join", "cpu", "lobby", "game", "results"];
  function show(id) { screens.forEach((s) => el(s + "Screen").classList.toggle("active", s === id)); document.body.classList.toggle("in-game", id === "game"); }

  // ============================================================
  //  BOARD RENDERING (2D canvas)
  // ============================================================
  const canvas = el("board"), ctx = canvas.getContext("2d");
  function fitCanvas() {
    const wrap = canvas.parentElement; const rect = wrap.getBoundingClientRect();
    const size = Math.max(200, Math.min(rect.width, rect.height) - 6);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr; canvas.height = size * dpr; canvas.style.width = size + "px"; canvas.style.height = size + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); G.size = size; G.cell = size / 8;
  }
  // square index -> screen col/row (respecting orientation)
  function sqToRC(s) { const f = fileOf(s), r = rankOf(s); return G.orient === "w" ? { col: f, row: 7 - r } : { col: 7 - f, row: r }; }
  function rcToSq(col, row) { const f = G.orient === "w" ? col : 7 - col; const r = G.orient === "w" ? 7 - row : row; return (f < 0 || f > 7 || r < 0 || r > 7) ? -1 : SQ(f, r); }
  function sqCenter(s) { const { col, row } = sqToRC(s); const c = G.cell; return { x: col * c + c / 2, y: row * c + c / 2 }; }

  const TH = CFG.THEME;
  function drawBoard() {
    if (!G.game) return;
    const c = G.cell, b = G.game.board;
    ctx.clearRect(0, 0, G.size, G.size);
    const checkSq = G.game.status === "playing" && G.game.inCheck(G.game.turn) ? G.game.kingSquare(G.game.turn) : -1;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const s = rcToSq(col, row); const light = (fileOf(s) + rankOf(s)) % 2 === 1;
      const x = col * c, y = row * c;
      ctx.fillStyle = light ? TH.light : TH.dark; ctx.fillRect(x, y, c, c);
    }
    // last move highlight
    if (G.lastMove) { for (const [s, col] of [[G.lastMove.from, TH.lastFrom], [G.lastMove.to, TH.lastTo]]) { const { col: cc, row: rr } = sqToRC(s); ctx.fillStyle = col; ctx.fillRect(cc * c, rr * c, c, c); } }
    // check highlight
    if (checkSq >= 0) { const { col, row } = sqToRC(checkSq); const g = ctx.createRadialGradient(col * c + c / 2, row * c + c / 2, c * 0.1, col * c + c / 2, row * c + c / 2, c * 0.6); g.addColorStop(0, TH.check); g.addColorStop(1, "rgba(230,60,60,0)"); ctx.fillStyle = g; ctx.fillRect(col * c, row * c, c, c); }
    // selection
    if (G.selected >= 0) { const { col, row } = sqToRC(G.selected); const light = (fileOf(G.selected) + rankOf(G.selected)) % 2 === 1; ctx.fillStyle = light ? TH.lightSel : TH.darkSel; ctx.fillRect(col * c, row * c, c, c); }
    // coordinates
    ctx.fillStyle = TH.coord; ctx.font = `${Math.max(9, c * 0.16)}px system-ui, sans-serif`; ctx.textBaseline = "top"; ctx.textAlign = "left";
    for (let i = 0; i < 8; i++) {
      const fileChar = G.orient === "w" ? "abcdefgh"[i] : "hgfedcba"[i];
      const rankChar = G.orient === "w" ? (8 - i) : (i + 1);
      const lightBottom = (i + 7) % 2 === 1;
      ctx.fillStyle = ((i % 2 === 0) ? TH.dark : TH.light); ctx.globalAlpha = 0.6;
      ctx.fillText(fileChar, i * c + c * 0.06, 8 * c - c * 0.2 - 2);
      ctx.fillText(rankChar, c * 0.04, i * c + 2);
      ctx.globalAlpha = 1;
    }
    // legal target markers
    for (const s of G.legalTargets) {
      const { col, row } = sqToRC(s); const cx = col * c + c / 2, cy = row * c + c / 2;
      const occupied = b[s] || (G.game.ep === s);
      ctx.fillStyle = occupied ? TH.capture : TH.move;
      if (occupied) { ctx.lineWidth = c * 0.09; ctx.strokeStyle = TH.capture; ctx.beginPath(); ctx.arc(cx, cy, c * 0.42, 0, 7); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(cx, cy, c * 0.16, 0, 7); ctx.fill(); }
    }
    // pieces
    for (let s = 0; s < 64; s++) {
      const p = b[s]; if (!p) continue;
      if (G.anim && G.anim.to === s) continue; // will draw animated piece separately
      const { x, y } = sqCenter(s); drawPiece(p, x, y, c);
    }
    if (G.anim) { drawPiece(G.anim.piece, G.anim.x, G.anim.y, c); }
  }
  function drawPiece(p, x, y, c) {
    const isWhite = p[0] === "w"; const glyph = SOLID[p[1]];
    const size = c * 0.78;
    ctx.font = `${size}px "Segoe UI Symbol","Apple Symbols","Noto Sans Symbols2",system-ui,sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillText(glyph, x + c * 0.02, y + c * 0.04);
    // body + outline
    ctx.lineWidth = Math.max(1.5, c * 0.035);
    ctx.strokeStyle = isWhite ? "#2a2a2a" : "#000"; ctx.fillStyle = isWhite ? "#fbfbf7" : "#1d1d1d";
    ctx.strokeText(glyph, x, y); ctx.fillText(glyph, x, y);
    if (isWhite) { ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.strokeText(glyph, x, y); }
  }

  let rafRunning = false;
  function renderLoop() { if (!rafRunning) return; drawBoard(); if (G.clock.enabled) updateClockUI(); requestAnimationFrame(renderLoop); }
  function startRender() { if (rafRunning) return; rafRunning = true; requestAnimationFrame(renderLoop); }

  async function animateMove(from, to, piece) {
    const a = sqCenter(from), bpt = sqCenter(to);
    const dur = 180, t0 = performance.now();
    await new Promise((res) => { const tick = () => { const raw = Math.min(1, (performance.now() - t0) / dur); const t = 1 - Math.pow(1 - raw, 3); G.anim = { to, piece, x: a.x + (bpt.x - a.x) * t, y: a.y + (bpt.y - a.y) * t }; if (raw < 1) requestAnimationFrame(tick); else res(); }; tick(); });
    G.anim = null;
  }

  // ============================================================
  //  TURN / CONTROL
  // ============================================================
  function playerByColor(color) { return G.players.find((p) => p.color === color); }
  function authority() { return G.mode !== "online" || (G.net && G.net.isHost); }
  function controllable(color) {
    if (G.game.status !== "playing") return false;
    if (G.mode === "passplay") return true;
    return color === G.myColor;
  }
  function isMyTurn() { return controllable(G.game.turn); }

  function updateUI() {
    const g = G.game; if (!g) return;
    // auto-orient for passplay
    if (G.mode === "passplay" && !G.manualFlip) G.orient = g.turn;
    const top = G.orient === "w" ? "b" : "w", bot = G.orient;
    const pt = playerByColor(top), pb = playerByColor(bot);
    el("topName").innerHTML = nameTag(pt, top);
    el("botName").innerHTML = nameTag(pb, bot);
    renderCaptures();
    // turn text
    const mover = playerByColor(g.turn);
    let turnTxt = "";
    if (g.status === "playing") turnTxt = (controllable(g.turn) ? "Your move" : (mover ? esc(mover.name) + " to move" : "")) + (g.inCheck(g.turn) ? " · Check!" : "");
    else turnTxt = "Game over";
    el("gbTurn").textContent = turnTxt;
    el("ctrlHint").textContent = g.status !== "playing" ? "Game over" : (controllable(g.turn) ? (g.inCheck(g.turn) ? "You're in check" : "Your move") : "Waiting for opponent…");
    renderMoveList();
    // banner
    if (g.status === "playing") { const banner = el("turnBanner"); banner.textContent = controllable(g.turn) ? "Your move" : (mover ? mover.name + "'s move" : ""); banner.classList.add("show"); clearTimeout(banner._t); banner._t = setTimeout(() => banner.classList.remove("show"), 1100); }
    // resign/draw availability
    const active = g.status === "playing";
    el("resignBtn").disabled = !active;
    el("drawBtn").disabled = !active;
    el("drawBtn").style.display = (G.mode === "passplay") ? "none" : "";
  }
  function nameTag(pl, color) {
    const glyph = color === "w" ? "\u2654" : "\u265A";
    const gone = pl && pl.connected === false ? " ⚠" : "";
    return `${glyph} ${esc(pl ? pl.name : (color === "w" ? "White" : "Black"))}${gone}`;
  }

  function renderMoveList() {
    const h = G.game.sanHistory; const rows = [];
    for (let i = 0; i < h.length; i += 2) { const n = i / 2 + 1; const w = h[i] ? h[i].san : ""; const bl = h[i + 1] ? h[i + 1].san : ""; rows.push(`<span class="mv"><i>${n}.</i> ${esc(w)} ${esc(bl)}</span>`); }
    const ml = el("moveList"); ml.innerHTML = rows.join(""); ml.scrollLeft = ml.scrollWidth;
  }

  const START_COUNT = { P: 8, N: 2, B: 2, R: 2, Q: 1, K: 1 };
  function renderCaptures() {
    const cnt = { w: {}, b: {} };
    for (const p of G.game.board) if (p) cnt[p[0]][p[1]] = (cnt[p[0]][p[1]] || 0) + 1;
    // captured BY white = missing black pieces, and vice-versa
    const capturedBy = (byColor) => { const opp = byColor === "w" ? "b" : "w"; let s = ""; for (const t of ["Q", "R", "B", "N", "P"]) { const missing = START_COUNT[t] - (cnt[opp][t] || 0); for (let i = 0; i < missing; i++) s += `<span class="cap ${opp}">${SOLID[t]}</span>`; } return s; };
    const mat = materialDiff(cnt);
    const top = G.orient === "w" ? "b" : "w", bot = G.orient;
    el("topCaptures").innerHTML = capturedBy(top) + advTag(mat, top);
    el("botCaptures").innerHTML = capturedBy(bot) + advTag(mat, bot);
  }
  function materialDiff(cnt) { const v = CFG.VALUE; let w = 0, b = 0; for (const t in START_COUNT) { if (t === "K") continue; w += (cnt.w[t] || 0) * v[t]; b += (cnt.b[t] || 0) * v[t]; } return (w - b) / 100; }
  function advTag(diff, color) { const adv = color === "w" ? diff : -diff; return adv > 0 ? `<span class="adv">+${Math.round(adv)}</span>` : ""; }

  // ============================================================
  //  CLOCKS
  // ============================================================
  function setupClock(tc) {
    const conf = CFG.TIME_CONTROLS[tc];
    if (!conf) { G.clock.enabled = false; el("topClock").style.display = el("botClock").style.display = "none"; return; }
    G.clock = { enabled: true, w: conf.base, b: conf.base, inc: conf.inc, active: null, syncAt: performance.now() };
    el("topClock").style.display = el("botClock").style.display = "";
  }
  function clockStart(color) { if (!G.clock.enabled) return; syncClock(); G.clock.active = G.game.status === "playing" ? color : null; G.clock.syncAt = performance.now(); }
  function syncClock() { const cl = G.clock; if (!cl.enabled || !cl.active) return; const now = performance.now(); const spent = (now - cl.syncAt) / 1000; cl[cl.active] = Math.max(0, cl[cl.active] - spent); cl.syncAt = now; }
  function remaining(color) { const cl = G.clock; if (!cl.enabled) return 0; if (cl.active === color && G.game.status === "playing") return Math.max(0, cl[color] - (performance.now() - cl.syncAt) / 1000); return cl[color]; }
  function fmtClock(sec) { sec = Math.max(0, Math.ceil(sec)); const m = Math.floor(sec / 60), s = sec % 60; return m + ":" + String(s).padStart(2, "0"); }
  function updateClockUI() {
    if (!G.clock.enabled) return;
    const top = G.orient === "w" ? "b" : "w", bot = G.orient;
    const setC = (id, color) => { const e = el(id); const rem = remaining(color); e.textContent = fmtClock(rem); e.classList.toggle("low", rem <= 20); e.classList.toggle("run", G.clock.active === color && G.game.status === "playing"); };
    setC("topClock", top); setC("botClock", bot);
    // authority enforces flag
    if (authority() && G.game.status === "playing" && G.clock.active) { if (remaining(G.clock.active) <= 0) onTimeout(G.clock.active); }
  }
  function onTimeout(color) {
    if (G._ended) return;
    syncClock(); G.clock[color] = 0; G.clock.active = null;
    G.game.setResult("timeout", color === "w" ? "b" : "w", "timeout");
    broadcastState({ type: "gameover" }); endGame();
  }
  function clockSnapshot() { syncClock(); return { w: G.clock.w, b: G.clock.b, active: G.clock.active, enabled: G.clock.enabled, inc: G.clock.inc }; }
  function applyClockSnapshot(cs) { if (!cs || !cs.enabled) { G.clock.enabled = false; el("topClock").style.display = el("botClock").style.display = "none"; return; } G.clock.enabled = true; G.clock.w = cs.w; G.clock.b = cs.b; G.clock.active = cs.active; G.clock.inc = cs.inc; G.clock.syncAt = performance.now(); el("topClock").style.display = el("botClock").style.display = ""; }

  // ============================================================
  //  MOVE FLOW
  // ============================================================
  function onCanvasClick(e) {
    if (!G.game || G.animating || G.pendingPromo) return;
    if (G.game.status !== "playing") return;
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / G.cell), row = Math.floor((e.clientY - rect.top) / G.cell);
    const s = rcToSq(col, row); if (s < 0) return;
    const b = G.game.board, piece = b[s];
    if (G.selected >= 0 && G.legalTargets.includes(s)) { attemptMove(G.selected, s); return; }
    if (piece && piece[0] === G.game.turn && controllable(G.game.turn)) {
      Audio.ensure(); Audio.click();
      G.selected = s; G.legalTargets = G.game.movesFrom(s).map((m) => m.to).filter((v, i, a) => a.indexOf(v) === i);
    } else { G.selected = -1; G.legalTargets = []; }
  }

  function attemptMove(from, to) {
    // promotion?
    const promos = G.game.movesFrom(from).filter((m) => m.to === to && m.promotion);
    if (promos.length) { showPromo(from, to); return; }
    requestMove(from, to, null);
  }

  function showPromo(from, to) {
    G.pendingPromo = { from, to };
    const color = G.game.turn; const picker = el("promo"); picker.classList.remove("hidden");
    picker.innerHTML = ["Q", "R", "B", "N"].map((t) => `<button data-t="${t}" style="color:${color === "w" ? "#fbfbf7" : "#1d1d1d"}">${SOLID[t]}</button>`).join("") + `<button class="cancel" data-t="x">✕</button>`;
    picker.querySelectorAll("button").forEach((btn) => btn.onclick = () => {
      const t = btn.dataset.t; picker.classList.add("hidden");
      const pp = G.pendingPromo; G.pendingPromo = null;
      if (t !== "x" && pp) requestMove(pp.from, pp.to, t);
      else { G.selected = -1; G.legalTargets = []; }
    });
  }

  function requestMove(from, to, promo) {
    if (!isMyTurn()) return;
    G.selected = -1; G.legalTargets = [];
    if (authority()) processMove(from, to, promo);
    else G.net.sendAction({ type: "move", from, to, promotion: promo });
  }

  async function processMove(from, to, promo) {
    if (!authority() || G.busy) return;
    if (G.game.status !== "playing") return;
    const piece = G.game.board[from];
    const res = G.game.move({ from, to, promotion: promo });
    if (!res) return;
    G.busy = true;
    // clock: add increment to the mover, switch active
    if (G.clock.enabled) { syncClock(); const mover = res.san ? (G.game.turn === "w" ? "b" : "w") : null; if (mover) G.clock[mover] += G.clock.inc; clockStart(G.game.turn); }
    G.lastMove = { from, to };
    broadcastState({ type: "move", from, to, promo, san: res.san });
    await playMoveFx(res, from, to, piece, promo);
    G.busy = false;
    if (G.game.status !== "playing") { endGame(); return; }
    G.selected = -1; G.legalTargets = []; updateUI();
    step();
  }

  async function playMoveFx(res, from, to, piece, promo) {
    G.animating = true; updateUI();
    await animateMove(from, to, piece);
    // sound
    if (res.san.includes("#")) { Audio.capture(); }
    else if (res.san.startsWith("O-O")) Audio.castle();
    else if (promo) Audio.promote();
    else if (res.san.includes("x")) Audio.capture();
    else Audio.move();
    if (res.san.includes("+")) setTimeout(() => Audio.check(), 80);
    G.animating = false; updateUI();
  }

  function step() {
    updateUI();
    if (G.game.status !== "playing") { endGame(); return; }
    const mover = playerByColor(G.game.turn);
    if (authority() && mover && mover.type === "ai") { setTimeout(runAI, CFG.AI_DELAY); }
  }
  function runAI() {
    if (!G.game || G.game.status !== "playing") return;
    const mover = playerByColor(G.game.turn); if (!mover || mover.type !== "ai") return;
    const m = AI.choose(G.game, mover.ai || G.aiDiff);
    if (m) processMove(m.from, m.to, m.promotion);
  }

  // ============================================================
  //  BROADCAST / RECEIVE (online)
  // ============================================================
  function broadcastState(event) {
    if (G.mode !== "online" || !G.net || !G.net.isHost) return;
    const state = G.game.serialize(); state.clock = clockSnapshot(); state.drawOfferBy = G.drawOfferBy;
    G.net.broadcastState(state, event);
  }
  async function onNetState(data) {
    const st = data.state, ev = data.event || {};
    const prevStatus = G.game ? G.game.status : "playing";
    G.game = ChessGame.deserialize(st);
    applyClockSnapshot(st.clock); if (st.clock) G.clock.active = st.clock.active;
    G.drawOfferBy = st.drawOfferBy || null;
    G.lastMove = G.game.lastMove();
    if (ev.type === "move" && ev.from != null) {
      // animate opponent's move (piece already on 'to' in state)
      const piece = G.game.board[ev.to];
      G.animating = true; updateUI();
      // temporarily hide dest to animate from origin
      await animateMove(ev.from, ev.to, piece);
      if (ev.san && ev.san.includes("x")) Audio.capture(); else if (ev.san && ev.san.startsWith("O-O")) Audio.castle(); else Audio.move();
      if (ev.san && ev.san.includes("+")) setTimeout(() => Audio.check(), 80);
      G.animating = false;
    } else if (ev.type === "draw-offer") {
      if (ev.by && ev.by !== G.myColor) promptDrawOffer(ev.by);
    } else if (ev.type === "draw-decline") { toast("Draw offer declined."); }
    G.selected = -1; G.legalTargets = [];
    updateUI();
    if (G.game.status !== "playing" && prevStatus === "playing") endGame();
  }
  function onHostAction(data) {
    if (!G.net.isHost) return;
    const pl = G.players.find((p) => p.peerId === data.from); const a = data.action;
    if (!a) return;
    if (a.type === "emote") { if (pl) { G.net.broadcastEmote(pl.pid, a.content); showEmote(pl.pid, a.content); } return; }
    if (a.type === "resign") { if (pl) doResign(pl.color); return; }
    if (a.type === "draw-offer") { if (pl) promptDrawOffer(pl.color); return; }
    if (a.type === "draw-accept") { acceptDraw(); return; }
    if (a.type === "draw-decline") { G.drawOfferBy = null; toast("Draw offer declined."); return; }
    if (a.type === "move") { if (!pl || pl.color !== G.game.turn) return; processMove(a.from, a.to, a.promotion); }
  }

  // ============================================================
  //  RESIGN / DRAW
  // ============================================================
  function requestResign() {
    if (!G.game || G.game.status !== "playing") return;
    const who = G.mode === "passplay" ? G.game.turn : G.myColor;
    modalConfirm("Resign the game?", () => {
      if (authority()) doResign(who);
      else G.net.sendAction({ type: "resign" });
    });
  }
  function doResign(color) {
    if (!authority() || G.game.status !== "playing") return;
    G.game.setResult("resign", color === "w" ? "b" : "w", "resign");
    broadcastState({ type: "gameover" }); Audio.lose(); endGame();
  }
  function requestDraw() {
    if (!G.game || G.game.status !== "playing") return;
    if (G.mode === "cpu") { // ask AI
      const evalWhite = AI.evaluate(G.game); const aiColor = playerByColor("w").type === "ai" ? "w" : "b";
      const aiScore = aiColor === "w" ? evalWhite : -evalWhite;
      if (aiScore <= 30) { acceptDraw(); } else { toast("The computer declines the draw."); }
      return;
    }
    if (G.mode === "passplay") { acceptDraw(); return; }
    // online
    G.drawOfferBy = G.myColor;
    if (authority()) broadcastState({ type: "draw-offer", by: G.myColor });
    else G.net.sendAction({ type: "draw-offer" });
    toast("Draw offer sent.");
  }
  function promptDrawOffer(byColor) {
    G.drawOfferBy = byColor;
    const o = el("modal"); el("modalContent").innerHTML = `<h3 style="margin-bottom:10px">Draw offer</h3><p class="lead" style="margin-bottom:14px">Your opponent offers a draw.</p><div class="btns"><button class="btn primary" id="dAccept">Accept</button><button class="btn ghost" id="dDecline">Decline</button></div>`;
    o.classList.remove("hidden"); Audio.notify();
    el("dAccept").onclick = () => { o.classList.add("hidden"); if (authority()) acceptDraw(); else G.net.sendAction({ type: "draw-accept" }); };
    el("dDecline").onclick = () => { o.classList.add("hidden"); G.drawOfferBy = null; if (authority()) broadcastState({ type: "draw-decline" }); else G.net.sendAction({ type: "draw-decline" }); };
  }
  function acceptDraw() {
    if (!authority()) { G.net.sendAction({ type: "draw-accept" }); return; }
    if (G.game.status !== "playing") return;
    G.game.setResult("draw", null, "agreement"); G.drawOfferBy = null;
    broadcastState({ type: "gameover" }); endGame();
  }

  // ============================================================
  //  SETUP GAMES
  // ============================================================
  function resolveColor(choice) { return choice === "r" ? (Math.random() < 0.5 ? "w" : "b") : choice; }

  function startOffline(mode, opts) {
    G.mode = mode; G._ended = false;
    G.game = new ChessGame(); G.selected = -1; G.legalTargets = []; G.lastMove = null; G.drawOfferBy = null;
    if (mode === "cpu") {
      G.aiDiff = opts.diff || "normal";
      const my = resolveColor(opts.color || "w"); G.myColor = my;
      const aiColor = my === "w" ? "b" : "w";
      G.players = [
        { color: my, name: opts.name || "You", type: "human", isMe: true, pid: "me", connected: true },
        { color: aiColor, name: "Computer (" + (opts.diff || "normal") + ")", type: "ai", ai: opts.diff, connected: true },
      ];
      G.orient = my;
    } else { // passplay
      G.myColor = "w";
      G.players = [
        { color: "w", name: "White", type: "human", isMe: true, pid: "w", connected: true },
        { color: "b", name: "Black", type: "human", isMe: true, pid: "b", connected: true },
      ];
      G.orient = "w";
    }
    G.tc = opts.tc || "off";
    enterGame();
    setupClock(G.tc); if (G.clock.enabled) clockStart("w");
    step();
  }

  function enterGame() {
    show("game"); el("gbRoom").textContent = G.roomCode ? "Room " + G.roomCode : "";
    G.manualFlip = false; G.busy = false; G.animating = false; G.pendingPromo = null; G._ended = false;
    fitCanvas(); startRender(); updateUI();
  }

  // ---- online start (host) ----
  function hostStartGame() {
    const roster = G.net.roster.filter((r) => r.connected);
    if (roster.length < 2) { toast("Waiting for an opponent to join."); return; }
    const hostColor = resolveColor(G.net.hostColor || "w");
    const host = roster.find((r) => r.pid === "HOST"), guest = roster.find((r) => r.pid !== "HOST");
    const players = [
      { color: hostColor, name: host.name, type: "human", pid: "HOST", peerId: host.peerId, connected: true },
      { color: hostColor === "w" ? "b" : "w", name: guest.name, type: "human", pid: guest.pid, peerId: guest.peerId, connected: true },
    ];
    const payload = { players, tc: G.net.timeControl || "off" };
    G.net.startGame(payload); applyOnlineStart(payload);
  }
  function applyOnlineStart(payload) {
    G.mode = "online"; G._ended = false;
    G.players = payload.players.map((p) => Object.assign({}, p, { isMe: p.pid === G.mePid }));
    const me = G.players.find((p) => p.isMe); G.myColor = me ? me.color : "w"; G.orient = G.myColor;
    G.game = new ChessGame(); G.selected = -1; G.legalTargets = []; G.lastMove = null; G.drawOfferBy = null;
    G.tc = payload.tc || "off";
    enterGame();
    setupClock(G.tc);
    if (G.net.isHost) { if (G.clock.enabled) clockStart("w"); step(); }
    else updateUI();
  }

  // ============================================================
  //  RESULTS
  // ============================================================
  const REASON_TEXT = { checkmate: "Checkmate", stalemate: "Stalemate", fifty: "Draw — 50-move rule", repetition: "Draw — threefold repetition", material: "Draw — insufficient material", resign: "Resignation", timeout: "Timeout", agreement: "Draw agreed" };
  function endGame() {
    if (G._ended) return; G._ended = true;
    G.clock.active = null;
    const g = G.game; const meColor = G.mode === "passplay" ? null : G.myColor;
    let title, icon;
    if (g.winner === null) { title = "½–½ Draw"; icon = "🤝"; }
    else if (G.mode === "passplay") { title = (g.winner === "w" ? "White" : "Black") + " wins!"; icon = "🏆"; }
    else { const won = g.winner === meColor; title = won ? "🏆 You Win!" : "You Lose"; icon = won ? "🏆" : "😞"; if (won) Audio.win(); else Audio.lose(); }
    if (g.winner === null) Audio.notify();
    el("resultIcon").textContent = icon;
    el("resultTitle").textContent = title;
    const winnerName = g.winner ? (playerByColor(g.winner) ? playerByColor(g.winner).name : (g.winner === "w" ? "White" : "Black")) : null;
    el("resultReason").textContent = (REASON_TEXT[g.reason] || "") + (g.winner && g.reason !== "checkmate" ? " — " + winnerName + " wins" : g.reason === "checkmate" ? " — " + winnerName + " wins" : "");
    // stats
    const moves = Math.ceil(g.sanHistory.length / 2);
    const cnt = { w: {}, b: {} }; for (const p of g.board) if (p) cnt[p[0]][p[1]] = (cnt[p[0]][p[1]] || 0) + 1;
    const capByW = Object.keys(START_COUNT).reduce((a, t) => a + (t === "K" ? 0 : START_COUNT[t] - (cnt.b[t] || 0)), 0);
    const capByB = Object.keys(START_COUNT).reduce((a, t) => a + (t === "K" ? 0 : START_COUNT[t] - (cnt.w[t] || 0)), 0);
    el("matchStats").innerHTML =
      `<div class="ms"><span>Moves</span><span>${moves}</span></div>` +
      `<div class="ms"><span>♔ ${esc(playerByColor("w").name)} · captures</span><span>${capByW}</span></div>` +
      `<div class="ms"><span>♚ ${esc(playerByColor("b").name)} · captures</span><span>${capByB}</span></div>`;
    el("toLobbyBtn").style.display = G.mode === "online" ? "" : "none";
    el("playAgainBtn").style.display = (G.mode === "online" && !G.net.isHost) ? "none" : "";
    show("results");
  }
  function playAgain() {
    G._ended = false;
    if (G.mode === "online") {
      if (!G.net.isHost) { toast("Only the host can start a new game."); return; }
      // swap colours for fairness
      G.players.forEach((p) => p.color = p.color === "w" ? "b" : "w");
      const me = G.players.find((p) => p.isMe); G.myColor = me.color; G.orient = G.myColor;
      G.game.reset(); G.selected = -1; G.legalTargets = []; G.lastMove = null; G.drawOfferBy = null;
      enterGame(); setupClock(G.tc);
      G.net.startGame({ players: G.players.map((p) => ({ color: p.color, name: p.name, type: "human", pid: p.pid, peerId: p.peerId, connected: true })), tc: G.tc });
      broadcastState({ type: "restart" }); if (G.clock.enabled) clockStart("w"); step();
    } else {
      // offline: swap sides for cpu, keep for passplay
      if (G.mode === "cpu") { G.players.forEach((p) => p.color = p.color === "w" ? "b" : "w"); G.myColor = playerByColor && (G.players.find((p) => p.isMe).color); G.orient = G.myColor; }
      G.game.reset(); G.selected = -1; G.legalTargets = []; G.lastMove = null; G.drawOfferBy = null;
      enterGame(); setupClock(G.tc); if (G.clock.enabled) clockStart("w"); step();
    }
  }

  // ============================================================
  //  NETWORK WIRING
  // ============================================================
  function makeNet() {
    const net = new window.ChessNet(); G.net = net;
    net.on("error", (e) => { netErr(e.msg); });
    net.on("room-created", (d) => { G.roomCode = d.code; G.mePid = "HOST"; net.registerSelf(el("createName").value || "Host"); openLobby(); });
    net.on("welcome", (d) => { G.mePid = d.you; G.roomCode = d.code; openLobby(); renderRoster(d.roster); });
    net.on("roster", (d) => renderRoster(d.roster));
    net.on("peer-joined", () => { el("lobbyStatus").textContent = "Opponent joined — ready to start."; });
    net.on("peer-left", () => { renderRoster(net.roster); if (G.mode === "online" && G.game && G.game.status === "playing") markDisconnect(); });
    net.on("peer-rejoined", () => { if (G.mode === "online" && G.net.isHost && G.game) { hideNetOverlay(); broadcastState({ type: "turn" }); } });
    net.on("start", (payload) => applyOnlineStart(payload));
    net.on("state", (d) => onNetState(d));
    net.on("action", (d) => onHostAction(d));
    net.on("emote", (d) => showEmote(d.pid, d.content));
    net.on("host-lost", () => netOverlay("⚠", "Host disconnected", "The room host left. You can return to the menu.", [{ t: "Main Menu", fn: toMenu }]));
    return net;
  }
  function markDisconnect() {
    const gone = G.players.filter((p) => { const r = G.net.roster.find((x) => x.pid === p.pid); return r && !r.connected; });
    if (gone.length) netOverlay("⚠", "Opponent disconnected", gone.map((p) => p.name).join(", ") + " — waiting for reconnection…", [{ t: "Return to menu", fn: toMenu }]);
  }
  function renderRoster(roster) {
    const rows = []; const colors = ["w", "b"];
    for (let i = 0; i < 2; i++) { const r = roster[i]; const glyph = colors[i] === "w" ? "\u2654" : "\u265A"; rows.push(`<div class="rrow ${r ? "" : "empty"}"><span class="pieceico">${glyph}</span><span class="nm">${r ? esc(r.name) : "Waiting…"}</span><span class="tag">${r ? (r.host ? "Host" : "Guest") : ""}</span></div>`); }
    el("lobbyRoster").innerHTML = rows.join("");
    el("lobbyStatus").textContent = "Players: " + roster.filter((x) => x.connected).length + " / 2";
    el("startGameBtn").style.display = (G.net && G.net.isHost) ? "" : "none";
  }
  function openLobby() { G.mode = "online"; el("lobbyCode").textContent = G.roomCode; show("lobby"); }
  function netErr(msg) { const active = document.querySelector(".screen.active"); const h = el(active && active.id === "joinScreen" ? "joinHint" : "createHint"); if (h) { h.textContent = msg; h.className = "hint err"; } else toast(msg); }
  function netOverlay(big, title, body, btns) { const o = el("netOverlay"); o.classList.remove("hidden"); o.innerHTML = `<div><div class="big">${big}</div><b>${esc(title)}</b><p style="margin:8px 0;color:var(--dim)">${esc(body)}</p>${(btns || []).map((b, i) => `<button class="btn primary" data-i="${i}">${esc(b.t)}</button>`).join("")}</div>`; o.querySelectorAll("[data-i]").forEach((e2) => e2.onclick = () => { hideNetOverlay(); btns[+e2.dataset.i].fn(); }); }
  function hideNetOverlay() { el("netOverlay").classList.add("hidden"); }

  // ============================================================
  //  QUICK REACTIONS (emoji + phrases + chat)
  // ============================================================
  const EMOJIS = ["\ud83d\udc4d", "\ud83d\ude02", "\ud83c\udf89", "\ud83d\ude2e", "\ud83d\ude22", "\ud83d\udd25", "\ud83e\udd1d", "\u265F\ufe0f"];
  const PHRASES = ["Good move!", "Nice!", "Well played", "Oops!", "GG!", "Check!"];
  function toggleEmoteTray(force) {
    const tray = el("emoteTray"); const openNow = force != null ? force : tray.classList.contains("hidden");
    if (openNow) {
      tray.innerHTML = EMOJIS.map((e) => `<button class="em" data-e="${e}">${e}</button>`).join("") +
        `<div class="ph">` + PHRASES.map((p) => `<button data-e="${esc(p)}">${esc(p)}</button>`).join("") + `</div>` +
        `<div class="chat-label">💬 Write your own message</div>` +
        `<div class="chat"><input id="emoteInput" maxlength="80" placeholder="Type a message…" autocomplete="off" /><button id="emoteSend">▶</button></div>`;
      tray.querySelectorAll(".em, .ph button").forEach((b) => b.onclick = () => { sendEmote(b.dataset.e); toggleEmoteTray(false); });
      const inp = el("emoteInput"), snd = el("emoteSend");
      const fire = () => { const v = (inp.value || "").trim(); if (!v) return; sendEmote(v.slice(0, 80)); inp.value = ""; try { inp.focus(); } catch (e) {} };
      snd.onclick = fire; inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fire(); } });
      setTimeout(() => { try { inp.focus(); } catch (e) {} }, 30);
      tray.classList.remove("hidden");
    } else tray.classList.add("hidden");
  }
  function sendEmote(content) {
    Audio.ensure(); Audio.click();
    const mine = (G.mode === "online") ? G.mePid : (G.mode === "cpu" ? "me" : G.game ? G.game.turn : "me");
    if (G.mode === "online" && G.net) { if (G.net.isHost) { G.net.broadcastEmote(mine, content); showEmote(mine, content); } else G.net.sendAction({ type: "emote", content }); }
    else showEmote(mine, content);
  }
  function showEmote(pid, content) {
    if (!content) return;
    const isEmoji = /\p{Extended_Pictographic}/u.test(content) && [...content].length <= 3;
    const player = (G.players || []).find((p) => p.pid === pid);
    const name = player ? player.name : "";
    const bubble = document.createElement("div"); bubble.className = "emote-bubble" + (isEmoji ? "" : " txt");
    bubble.innerHTML = (name ? `<span class="who">${esc(name)}</span>` : "") + `<span class="${isEmoji ? "big" : ""}">${esc(content)}</span>`;
    const bw = el("board"); let x = innerWidth / 2, y = innerHeight * 0.3;
    if (bw) { const r = bw.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + 30; }
    bubble.style.left = x + "px"; bubble.style.top = y + "px";
    document.body.appendChild(bubble); setTimeout(() => bubble.remove(), 2500);
  }

  // ============================================================
  //  UI HELPERS
  // ============================================================
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function toast(msg) { const o = el("modal"); el("modalContent").innerHTML = `<p class="lead" style="margin:6px 0 14px">${esc(msg)}</p><button class="btn primary" id="mkOk">OK</button>`; o.classList.remove("hidden"); el("mkOk").onclick = () => o.classList.add("hidden"); }
  function modalConfirm(msg, onYes) { const o = el("modal"); el("modalContent").innerHTML = `<p class="lead" style="margin:6px 0 14px">${esc(msg)}</p><div class="btns"><button class="btn primary" id="mkYes">Yes</button><button class="btn ghost" id="mkNo">Cancel</button></div>`; o.classList.remove("hidden"); el("mkYes").onclick = () => { o.classList.add("hidden"); onYes(); }; el("mkNo").onclick = () => o.classList.add("hidden"); }
  function toMenu() { if (G.net) { try { G.net.disconnect(); } catch (e) {} G.net = null; } G.mode = null; G._ended = false; G.game = null; rafRunning = false; hideNetOverlay(); show("menu"); }

  // ============================================================
  //  EVENT BINDINGS
  // ============================================================
  function seg(id, attr, cb) { const box = el(id); if (!box) return; box.querySelectorAll("button").forEach((b) => b.onclick = () => { box.querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); cb(b.dataset[attr]); }); }

  function bind() {
    el("createBtn").onclick = () => { Audio.ensure(); Audio.click(); show("create"); };
    el("joinBtn").onclick = () => { Audio.click(); show("join"); };
    el("cpuBtn").onclick = () => { Audio.click(); show("cpu"); };
    el("passplayBtn").onclick = () => { Audio.ensure(); Audio.click(); startOffline("passplay", { tc: passTc }); };
    el("soundBtn").onclick = () => { const m = Audio.toggle(); el("soundBtn").textContent = m ? "🔇 Sound" : "🔊 Sound"; };
    el("helpBtn").onclick = () => toast("Tap a piece to select it, then tap a highlighted square to move. Standard chess rules apply: castling, en passant and promotion are all supported. Deliver checkmate, or win on time / by resignation. Create a room to play a friend online, or challenge the computer offline.");
    document.querySelectorAll("[data-back]").forEach((b) => b.onclick = () => { Audio.click(); show("menu"); });

    // create
    let createColor = "w", createTime = "off";
    seg("createColor", "c", (c) => createColor = c); seg("createTime", "t", (t) => createTime = t);
    el("doCreate").onclick = () => { Audio.ensure(); if (!ensureNet()) return; const pass = el("createPass").value.trim(); makeNet().createRoom({ color: createColor, timeControl: createTime, passcode: pass || null }); el("createHint").textContent = "Creating room…"; el("createHint").className = "hint"; };
    // join
    el("doJoin").onclick = () => { Audio.ensure(); if (!ensureNet()) return; const code = (el("joinCode").value || "").trim().toUpperCase(); const name = (el("joinName").value || "Player").trim(); const pass = el("joinPass").value.trim(); if (code.length < 4) { el("joinHint").textContent = "Enter a valid room code."; el("joinHint").className = "hint err"; return; } el("joinHint").textContent = "Connecting…"; el("joinHint").className = "hint"; makeNet().joinRoom({ code, name, pass }); };
    // cpu
    let cpuColor = "w", cpuDiff = "normal", cpuTime = "off";
    seg("cpuColor", "c", (c) => cpuColor = c); seg("cpuDiff", "d", (d) => cpuDiff = d); seg("cpuTime", "t", (t) => cpuTime = t);
    el("doCpu").onclick = () => { Audio.ensure(); Audio.click(); startOffline("cpu", { name: (el("cpuName").value || "You").trim(), color: cpuColor, diff: cpuDiff, tc: cpuTime }); };

    // lobby
    el("startGameBtn").onclick = () => { Audio.click(); hostStartGame(); };
    el("leaveLobbyBtn").onclick = () => { Audio.click(); toMenu(); };
    el("copyCode").onclick = () => { try { navigator.clipboard.writeText(G.roomCode); el("copyCode").textContent = "✓ Copied!"; setTimeout(() => el("copyCode").textContent = "📋 Copy code", 1500); } catch (e) { toast("Room code: " + G.roomCode); } };

    // game
    canvas.addEventListener("click", onCanvasClick);
    el("flipBtn").onclick = () => { Audio.click(); G.orient = G.orient === "w" ? "b" : "w"; G.manualFlip = true; };
    el("resignBtn").onclick = () => { Audio.click(); requestResign(); };
    el("drawBtn").onclick = () => { Audio.click(); requestDraw(); };
    el("emoteBtn").onclick = () => { Audio.ensure(); toggleEmoteTray(); };
    el("gameMenuBtn").onclick = () => { const o = el("modal"); el("modalContent").innerHTML = `<h3 style="margin-bottom:12px">Menu</h3><div class="btns"><button class="btn" id="mResume">Resume</button><button class="btn ghost" id="mQuit">Quit to Menu</button></div>`; o.classList.remove("hidden"); el("mResume").onclick = () => o.classList.add("hidden"); el("mQuit").onclick = () => { o.classList.add("hidden"); toMenu(); }; };

    // results
    el("playAgainBtn").onclick = playAgain;
    el("toLobbyBtn").onclick = () => { if (G.mode === "online") { show("lobby"); renderRoster(G.net.roster); } };
    el("toMenuBtn").onclick = toMenu;

    addEventListener("resize", () => { if (document.body.classList.contains("in-game")) fitCanvas(); });
    el("soundBtn").textContent = Audio.muted ? "🔇 Sound" : "🔊 Sound";
  }
  let passTc = "off";
  function ensureNet() { if (typeof window.Peer !== "function") { toast("Online play needs a network connection (couldn't load the WebRTC library). You can still Play vs Computer or Pass & Play offline."); return false; } return true; }

  // ============================================================
  //  BOOT
  // ============================================================
  window.addEventListener("DOMContentLoaded", () => { try { bind(); show("menu"); } catch (e) { console.error(e); } });
  window._CHESS = G;
})();
