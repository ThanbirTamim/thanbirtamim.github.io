/* ============================================================
   LUDO — game controller / UI / rendering / turn flow
   Ties together ludo.js (rules), ai.js (AI), network.js (P2P).
   Host-authoritative: dice + moves are validated by the authority
   (offline: this device; online: the room host) then broadcast.
   ============================================================ */
(function () {
  "use strict";
  const CFG = window.LUDO_CONFIG, LudoGame = window.LudoGame, AI = window.LudoAI;
  const el = (id) => document.getElementById(id);
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- audio ----------
  const Audio = (() => {
    let ac = null, muted = localStorage.getItem("ludoSound") === "off";
    const ensure = () => { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (ac && ac.state === "suspended") ac.resume(); return ac; };
    const tone = (f, d, type = "sine", vol = 0.1, slide = null) => { if (muted) return; const c = ensure(); if (!c) return; const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, c.currentTime); if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + d); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + d); };
    return {
      ensure, click: () => tone(500, 0.05, "square", 0.06),
      dice: () => { for (let i = 0; i < 4; i++) setTimeout(() => tone(300 + Math.random() * 300, 0.05, "square", 0.05), i * 70); },
      step: () => tone(420, 0.05, "sine", 0.05, 520),
      capture: () => { tone(200, 0.2, "sawtooth", 0.12, 90); },
      turn: () => tone(660, 0.12, "sine", 0.08, 880),
      win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, "triangle", 0.12), i * 130)),
      lose: () => tone(300, 0.4, "sine", 0.1, 150),
      toggle() { muted = !muted; localStorage.setItem("ludoSound", muted ? "off" : "on"); return muted; }, get muted() { return muted; },
    };
  })();

  // ---------- game state ----------
  const G = {
    mode: null,         // cpu | passplay | online
    game: null, players: [], mePid: null, hostAuthority: false,
    net: null, speed: localStorage.getItem("ludoFast") === "1" ? "fast" : "normal",
    dicePending: false, legal: [], selecting: false, animating: false, busy: false,
    anim: null, roomCode: null, aiDiff: "normal",
  };

  const screens = ["menu", "create", "join", "cpu", "lobby", "game", "results"];
  function show(id) { screens.forEach((s) => el(s + "Screen").classList.toggle("active", s === id)); document.body.classList.toggle("in-game", id === "game"); }
  function stepMs() { return G.speed === "fast" ? CFG.STEP_MS_FAST : CFG.STEP_MS; }

  function rollValue() { try { const a = new Uint32Array(1); crypto.getRandomValues(a); return 1 + (a[0] % 6); } catch (e) { return 1 + ((Math.random() * 6) | 0); } }

  // ============================================================
  //  BOARD RENDERING (2.5D-styled canvas)
  // ============================================================
  const canvas = el("board"), ctx = canvas.getContext("2d");
  function fitCanvas() {
    const wrap = el("board").parentElement; const rect = wrap.getBoundingClientRect();
    const size = Math.max(200, Math.min(rect.width, rect.height) - 8);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr; canvas.height = size * dpr; canvas.style.width = size + "px"; canvas.style.height = size + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); G.size = size; G.cell = size / 15;
  }
  const HEX = CFG.HEX, HEXD = CFG.HEX_DARK;
  function cellPx(gx, gy) { return { x: (gx + 0.5) * G.cell, y: (gy + 0.5) * G.cell }; }
  function tokenCoord(color, r, tokenIndex) {
    if (r === 0) return CFG.YARD[color][tokenIndex];
    if (r >= 1 && r <= CFG.RING_LEN) return CFG.RING[(CFG.OFFSET[color] + (r - 1)) % 52];
    if (r >= 52) return CFG.HOME_LANE[color][Math.min(5, r - 52)];
    return CFG.CENTER;
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function drawBoard() {
    if (!G.game) return;
    const c = G.cell, S = G.size;
    ctx.clearRect(0, 0, S, S);
    // board base
    ctx.fillStyle = "#f4f1e6"; roundRect(0, 0, S, S, c * 0.6); ctx.fill();
    // home corners
    const corners = [["red", 0, 0], ["green", 9, 0], ["yellow", 9, 9], ["blue", 0, 9]];
    for (const [col, gx, gy] of corners) {
      ctx.fillStyle = HEX[col]; roundRect(gx * c, gy * c, 6 * c, 6 * c, c * 0.4); ctx.fill();
      ctx.fillStyle = "#f4f1e6"; roundRect((gx + 1) * c, (gy + 1) * c, 4 * c, 4 * c, c * 0.3); ctx.fill();
      // token pads
      for (const slot of CFG.YARD[col]) { const p = cellPx(slot.x, slot.y); ctx.fillStyle = HEX[col]; ctx.beginPath(); ctx.arc(p.x, p.y, c * 0.42, 0, 7); ctx.fill(); ctx.fillStyle = "#f4f1e6"; ctx.beginPath(); ctx.arc(p.x, p.y, c * 0.30, 0, 7); ctx.fill(); }
    }
    // ring cells
    for (let i = 0; i < CFG.RING.length; i++) { const cell = CFG.RING[i]; ctx.fillStyle = "#ffffff"; roundRect(cell.x * c + 1, cell.y * c + 1, c - 2, c - 2, 3); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 1; ctx.stroke(); }
    // colored start cells + home lanes
    const startIdx = CFG.OFFSET;
    for (const col in startIdx) { const cell = CFG.RING[startIdx[col]]; ctx.fillStyle = HEX[col]; roundRect(cell.x * c + 1, cell.y * c + 1, c - 2, c - 2, 3); ctx.fill(); }
    for (const col in CFG.HOME_LANE) { for (const cell of CFG.HOME_LANE[col]) { ctx.fillStyle = HEX[col]; roundRect(cell.x * c + 1, cell.y * c + 1, c - 2, c - 2, 3); ctx.fill(); } }
    // safe stars
    for (const idx of CFG.SAFE) { const cell = CFG.RING[idx]; const p = cellPx(cell.x, cell.y); drawStar(p.x, p.y, c * 0.22, "rgba(0,0,0,0.28)"); }
    // center
    const ctr = cellPx(7, 7); ctx.save(); ctx.translate(ctr.x, ctr.y);
    const tri = [["red", -1, 0], ["green", 0, -1], ["yellow", 1, 0], ["blue", 0, 1]];
    for (const [col, dx, dy] of tri) { ctx.fillStyle = HEX[col]; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(dx * c * 1.5 - (dy ? c * 1.5 : 0) + (dy ? 0 : 0), dy * c * 1.5 - (dx ? c * 1.5 : 0)); ctx.lineTo(dx * c * 1.5 + (dy ? c * 1.5 : 0), dy * c * 1.5 + (dx ? c * 1.5 : 0)); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    // tokens (group by cell for stacking)
    const groups = {};
    G.players.forEach((pl, pi) => { const gp = G.game.players[pi]; if (!gp) return; gp.tokens.forEach((r, ti) => { let coord; if (G.anim && G.anim.pi === pi && G.anim.ti === ti) coord = G.anim.coord; else coord = tokenCoord(pl.color, r, ti); const key = coord.x.toFixed(2) + "," + coord.y.toFixed(2); (groups[key] || (groups[key] = [])).push({ pl, pi, ti, r, coord }); }); });
    const legalSet = new Set(G.selecting ? G.legal : []);
    for (const key in groups) {
      const arr = groups[key]; arr.forEach((tk, k) => {
        const p = cellPx(tk.coord.x, tk.coord.y);
        const off = arr.length > 1 ? (k - (arr.length - 1) / 2) * (G.cell * 0.16) : 0;
        const px = p.x + off, py = p.y - off * 0.5;
        const rad = G.cell * (arr.length > 1 ? 0.26 : 0.32);
        // shadow (2.5D)
        ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(px, py + rad * 0.5, rad * 0.9, rad * 0.5, 0, 0, 7); ctx.fill();
        // disc
        const grad = ctx.createRadialGradient(px - rad * 0.3, py - rad * 0.5, rad * 0.2, px, py, rad);
        grad.addColorStop(0, "#ffffff"); grad.addColorStop(0.25, HEX[tk.pl.color]); grad.addColorStop(1, HEXD[tk.pl.color]);
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(px, py - rad * 0.35, rad, 0, 7); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1.5; ctx.stroke();
        // legal highlight
        const isLegal = pi_ti_legal(tk, legalSet);
        if (isLegal) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(px, py - rad * 0.35, rad + 3 + Math.sin(Date.now() / 200) * 1.5, 0, 7); ctx.stroke(); }
      });
    }
  }
  function pi_ti_legal(tk, legalSet) { if (!G.selecting) return false; return tk.pi === G.game.turn && legalSet.has(tk.ti); }
  function drawStar(x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); for (let i = 0; i < 10; i++) { const ang = (Math.PI / 5) * i - Math.PI / 2; const rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr); } ctx.closePath(); ctx.fill(); }

  let rafRunning = false;
  function renderLoop() { if (!rafRunning) return; drawBoard(); requestAnimationFrame(renderLoop); }
  function startRender() { if (rafRunning) return; rafRunning = true; requestAnimationFrame(renderLoop); }

  // ============================================================
  //  ANIMATION
  // ============================================================
  async function animateMove(ev, colorOfMover) {
    const pi = G.players.findIndex((p) => p.color === colorOfMover); if (pi < 0) return;
    const ti = ev.token; const pl = G.players[pi];
    const cells = [ev.from].concat(ev.path); // from + each step
    for (let s = 0; s < cells.length - 1; s++) {
      const a = tokenCoord(pl.color, cells[s], ti), b = tokenCoord(pl.color, cells[s + 1], ti);
      const dur = stepMs(); const t0 = performance.now();
      Audio.step();
      await new Promise((res) => { const tick = () => { const t = Math.min(1, (performance.now() - t0) / dur); G.anim = { pi, ti, coord: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } }; if (t < 1) requestAnimationFrame(tick); else res(); }; tick(); });
    }
    G.anim = null;
    if (ev.captures && ev.captures.length) { Audio.capture(); }
  }

  // dice DOM
  const PIP = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function renderDice(v) { const d = el("dice"); d.innerHTML = ""; for (let i = 0; i < 9; i++) { const cell = document.createElement("div"); cell.className = "pip"; if (!PIP[v] || !PIP[v].includes(i)) cell.style.visibility = "hidden"; d.appendChild(cell); } }
  async function animateDice(v) { const d = el("dice"); d.classList.add("rolling"); Audio.dice(); const dur = G.speed === "fast" ? 250 : CFG.DICE_MS; const t0 = performance.now(); await new Promise((res) => { const tick = () => { renderDice(1 + ((Math.random() * 6) | 0)); if (performance.now() - t0 < dur) setTimeout(() => requestAnimationFrame(tick), 60); else res(); }; tick(); }); d.classList.remove("rolling"); renderDice(v); }

  // ============================================================
  //  TURN FLOW
  // ============================================================
  function isMyTurn() { const idx = G.game.turn; return controllable(idx); }
  function controllable(idx) {
    const pl = G.players[idx]; if (!pl) return false;
    if (G.mode === "passplay") return pl.type === "human";
    if (G.mode === "cpu") return pl.isMe;
    if (G.mode === "online") return pl.pid === G.mePid; // host & clients: your own colour
    return false;
  }
  function authority() { return G.mode !== "online" || (G.net && G.net.isHost); }

  function updateTurnUI() {
    const idx = G.game.turn, pl = G.players[idx];
    el("gbTurn").innerHTML = pl ? (CFG.EMOJI[pl.color] + " " + esc(pl.name) + (controllable(idx) ? " — Your turn" : "'s turn")) : "";
    // chips
    const strip = el("playstrip"); strip.innerHTML = G.players.map((p, i) => { const gp = G.game.players[i]; return `<span class="pchip ${i === idx ? "active" : ""} ${p.connected === false ? "gone" : ""}" data-pid="${p.pid}"><span class="dot" style="background:${HEX[p.color]}"></span>${esc(p.name)} <span class="hm">${gp ? gp.homeCount : 0}/4</span></span>`; }).join("");
    const banner = el("turnBanner"); banner.textContent = (pl ? (controllable(idx) ? "Your turn!" : pl.name + "'s turn") : ""); banner.classList.add("show"); setTimeout(() => banner.classList.remove("show"), 1200);
    const roll = el("rollBtn");
    const myRoll = controllable(idx) && !G.dicePending && !G.animating && !G.busy && G.game.status === "playing";
    roll.disabled = !myRoll;
    el("ctrlHint").textContent = G.game.status === "won" ? "Game over" : controllable(idx) ? (G.dicePending ? "Tap a highlighted token" : "Tap ROLL") : (pl ? "Waiting for " + pl.name + "…" : "");
  }

  // authority drives the game forward
  function authorityStep() {
    if (!authority()) { updateTurnUI(); return; }
    if (G.game.status === "won") { endGame(); return; }
    const idx = G.game.turn, pl = G.players[idx];
    updateTurnUI();
    if (pl.type === "ai") { setTimeout(() => processRoll(idx), CFG.AI_DELAY); }
    else if (pl.type === "remote") { /* wait for their action */ }
    // local human: wait for ROLL button
  }

  // ---- roll ----
  function requestRoll() {
    if (!G.game || G.game.status !== "playing" || G.dicePending || G.animating || G.busy) return;
    if (!isMyTurn()) return;
    Audio.ensure(); Audio.click();
    if (authority()) processRoll(G.game.turn);
    else G.net.sendAction({ type: "roll" });
  }
  async function processRoll(idx) {
    if (!authority() || idx !== G.game.turn || G.dicePending || G.busy) return;
    G.busy = true;
    const v = rollValue();
    const forfeit = G.game.noteRoll(v);
    G.game.setDice(v);
    const legal = forfeit ? [] : G.game.legalMoves(v);
    const ev = { type: "roll", color: G.game.curColor(), v, legal, forfeit };
    broadcast(ev);
    await applyRollEvent(ev);
    // authority decides next (keep 'busy' until the turn truly advances so nobody can re-roll)
    if (forfeit || legal.length === 0) { await delay(650); G.game.setDice(null); G.game.nextTurn(false); broadcastTurn(); G.busy = false; authorityStep(); }
    else { G.busy = false; afterRollWithMoves(idx, v, legal); }
  }
  async function applyRollEvent(ev) {
    G.dicePending = !ev.forfeit && ev.legal.length > 0;
    G.legal = ev.legal || [];
    await animateDice(ev.v);
    G.selecting = G.dicePending && controllable(G.game.turn);   // let the active player pick a token (host OR client)
    if (ev.forfeit) { el("ctrlHint").textContent = "Three 6s — turn skipped"; }
    else if (!ev.legal.length) { el("ctrlHint").textContent = "No valid move — passing"; }
    updateTurnUI();
  }
  function afterRollWithMoves(idx, v, legal) {
    const pl = G.players[idx];
    if (pl.type === "ai" && authority()) { setTimeout(() => { const t = AI.choose(G.game, legal, v, pl.ai || G.aiDiff); processMove(t); }, CFG.AI_DELAY); }
    else if (controllable(idx)) { G.selecting = true; updateTurnUI(); }
    // remote: host waits for their MOVE action
  }

  // ---- move ----
  function requestMove(token) {
    if (!G.dicePending || G.animating || !isMyTurn()) return;
    if (!G.legal.includes(token)) return;
    G.selecting = false; Audio.click();
    if (authority()) processMove(token);
    else G.net.sendAction({ type: "move", token });
  }
  async function processMove(token) {
    if (!authority() || !G.dicePending) return;
    if (!G.game.legalMoves(G.game.dice).includes(token)) return;
    G.busy = true; G.dicePending = false; G.selecting = false;
    const mover = G.game.curColor();
    const ev = G.game.applyMove(token); ev.type = "move"; ev.color = mover;
    broadcast(ev);
    await applyMoveEvent(ev);
    if (G.game.status === "won") { broadcastTurn(); G.busy = false; endGame(); return; }
    await delay(250);
    G.game.nextTurn(ev.extra); broadcastTurn();   // pass turn (or same player on 6/capture/home)
    G.busy = false;
    authorityStep();
  }
  async function applyMoveEvent(ev) {
    G.animating = true; updateTurnUI();
    await animateMove(ev, ev.color);
    G.animating = false; G.dicePending = false; G.selecting = false;
    updateTurnUI();
  }

  // ---- broadcast / receive ----
  function broadcast(event) { if (G.mode === "online" && G.net && G.net.isHost) G.net.broadcastState(G.game.serialize(), event); }
  function broadcastTurn() { if (G.mode === "online" && G.net && G.net.isHost) G.net.broadcastState(G.game.serialize(), { type: "turn" }); }

  async function onNetState(data) {
    // client receives authoritative state + event
    const st = data.state, ev = data.event;
    G.game = LudoGame.load(st);
    if (ev && ev.type === "roll") { await applyRollEvent(ev); }
    else if (ev && ev.type === "move") { G.dicePending = false; await applyMoveEvent(ev); if (G.game.status === "won") endGame(); }
    else { G.dicePending = !!st.dice; G.legal = st.dice ? G.game.legalMoves(st.dice) : []; G.selecting = G.dicePending && controllable(G.game.turn); updateTurnUI(); }
    if (G.game.status === "won") endGame();
  }
  function onHostAction(data) {
    if (!G.net.isHost) return; const idx = G.players.findIndex((p) => p.peerId === data.from);
    const a = data.action;
    if (a && a.type === "emote") { const pid = idx >= 0 ? G.players[idx].pid : null; if (pid) { G.net.broadcastEmote(pid, a.content); showEmote(pid, a.content); } return; }
    if (idx < 0 || idx !== G.game.turn) return;
    if (a.type === "roll") { if (!G.dicePending) processRoll(idx); } else if (a.type === "move") { if (G.dicePending) processMove(a.token); }
  }

  // ---- quick reactions (emoji + preset phrases) ----
  const EMOJIS = ["\ud83d\udc4d", "\ud83d\ude02", "\ud83c\udf89", "\ud83d\ude2e", "\ud83d\ude22", "\ud83d\udd25", "\ud83e\udd1d", "\ud83c\udfb2"];
  const PHRASES = ["Good move!", "Nice!", "Your turn!", "Oops!", "GG!", "Haha \ud83d\ude04"];
  function toggleEmoteTray(force) {
    const tray = el("emoteTray"); const openNow = force != null ? force : tray.classList.contains("hidden");
    if (openNow) {
      tray.innerHTML = EMOJIS.map((e) => `<button class="em" data-e="${e}">${e}</button>`).join("") +
        `<div class="ph">` + PHRASES.map((p) => `<button data-e="${esc(p)}">${esc(p)}</button>`).join("") + `</div>` +
        `<div class="chat"><input id="emoteInput" maxlength="80" placeholder="Type a message…" autocomplete="off" /><button id="emoteSend">Send</button></div>`;
      tray.querySelectorAll(".em, .ph button").forEach((b) => b.onclick = () => { sendEmote(b.dataset.e); toggleEmoteTray(false); });
      const inp = el("emoteInput"), snd = el("emoteSend");
      const fire = () => { const v = (inp.value || "").trim(); if (!v) return; sendEmote(v.slice(0, 80)); inp.value = ""; toggleEmoteTray(false); };
      snd.onclick = fire;
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fire(); } });
      setTimeout(() => { try { inp.focus(); } catch (e) {} }, 30);
      tray.classList.remove("hidden");
    } else tray.classList.add("hidden");
  }
  function sendEmote(content) {
    Audio.ensure(); Audio.click();
    const mine = (G.mode === "online") ? G.mePid : (G.mode === "cpu" ? ((G.players.find((p) => p.isMe) || {}).pid) : (G.game && G.players[G.game.turn] ? G.players[G.game.turn].pid : "me"));
    if (G.mode === "online" && G.net) {
      if (G.net.isHost) { G.net.broadcastEmote(mine, content); showEmote(mine, content); }
      else G.net.sendAction({ type: "emote", content });   // host echoes back to everyone (incl. us)
    } else { showEmote(mine, content); }
  }
  function showEmote(pid, content) {
    if (!content) return;
    const isEmoji = /\p{Extended_Pictographic}/u.test(content) && [...content].length <= 3;
    const player = (G.players || []).find((p) => p.pid === pid);
    const name = player ? player.name : "";
    const bubble = document.createElement("div"); bubble.className = "emote-bubble" + (isEmoji ? "" : " txt");
    bubble.innerHTML = (name ? `<span class="who">${esc(name)}</span>` : "") + `<span class="${isEmoji ? "big" : ""}">${esc(content)}</span>`;
    // position above that player's chip if visible, else centre-top of the board
    let x = innerWidth / 2, y = innerHeight * 0.3;
    const chip = document.querySelector('.pchip[data-pid="' + (pid || "").replace(/"/g, "") + '"]');
    if (chip) { const r = chip.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top - 6; }
    else { const bw = el("board"); if (bw) { const r = bw.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + 30; } }
    bubble.style.left = x + "px"; bubble.style.top = y + "px";
    document.body.appendChild(bubble);
    setTimeout(() => bubble.remove(), 2500);
  }

  // ============================================================
  //  SETUP GAMES
  // ============================================================
  function buildPlayers(colors, defs) { return colors.map((c, i) => Object.assign({ color: c }, defs[i])); }

  function startOffline(mode, count, human, aiDiff) {
    G.mode = mode; G.aiDiff = aiDiff || "normal";
    const colors = CFG.ORDER.slice(0, count);
    let defs;
    if (mode === "cpu") defs = colors.map((c, i) => i === 0 ? { name: human || "You", type: "human", isMe: true, pid: "me", connected: true } : { name: "CPU " + i, type: "ai", ai: aiDiff, connected: true });
    else defs = colors.map((c, i) => ({ name: ["Red", "Green", "Yellow", "Blue"][CFG.ORDER.indexOf(c)] + "", type: "human", isMe: true, pid: "p" + i, connected: true }));
    G.players = buildPlayers(colors, defs); G.mePid = "me"; G.hostAuthority = true;
    G.game = new LudoGame(colors);
    enterGame();
    authorityStep();
  }

  function enterGame() {
    show("game"); el("gbRoom").textContent = G.roomCode ? "Room " + G.roomCode : "";
    fitCanvas(); startRender(); renderDice(1); G.dicePending = false; G.selecting = false; G.animating = false; G.busy = false;
    updateTurnUI();
  }

  // ---- online: start (host) ----
  function hostStartGame() {
    const roster = G.net.roster.filter((r) => r.connected);
    if (roster.length < 2) { toast("Need at least 2 players"); return; }
    const colors = CFG.ORDER.slice(0, roster.length);
    const players = roster.map((r, i) => ({ color: colors[i], name: r.name, type: r.pid === "HOST" ? "human" : "remote", pid: r.pid, peerId: r.peerId, connected: true, isMe: r.pid === "HOST" }));
    const payload = { players, colors };
    G.net.startGame(payload); applyOnlineStart(payload);
  }
  function applyOnlineStart(payload) {
    G.mode = "online"; G.players = payload.players.map((p) => Object.assign({}, p, { isMe: p.pid === G.mePid }));
    G.game = new LudoGame(payload.colors); enterGame(); authorityStep();
  }

  // ============================================================
  //  RESULTS
  // ============================================================
  function endGame() {
    if (G._ended) return; G._ended = true;
    const standings = G.game.finalStandings();
    const meColor = (G.players.find((p) => p.isMe) || {}).color;
    const won = standings[0] === meColor;
    if (G.mode === "cpu" || G.mode === "online") { won ? Audio.win() : Audio.lose(); } else Audio.win();
    el("resultTitle").textContent = G.mode === "passplay" ? "Results" : won ? "🏆 You Win!" : "Results";
    const medals = ["🥇", "🥈", "🥉", "4️⃣"];
    el("standings").innerHTML = standings.map((col, i) => { const p = G.players.find((x) => x.color === col); return `<div class="st"><span class="medal">${medals[i]}</span><span class="dot" style="background:${HEX[col]}"></span><span class="nm">${esc(p ? p.name : col)}</span></div>`; }).join("");
    el("matchStats").innerHTML = G.players.map((p, i) => { const gp = G.game.players[i]; return `<div class="ms"><span>${CFG.EMOJI[p.color]} ${esc(p.name)}</span><span>Moves ${gp.moves} · Captures ${gp.captures} · Home ${gp.homeCount}/4</span></div>`; }).join("");
    el("toLobbyBtn").style.display = G.mode === "online" ? "" : "none";
    show("results");
  }
  function playAgain() {
    G._ended = false;
    if (G.mode === "online") { if (!G.net.isHost) { toast("Only the host can restart"); return; } G.game.reset(); G.net.broadcastState(G.game.serialize(), { type: "turn" }); enterGame(); authorityStep(); }
    else { G.game.reset(); enterGame(); authorityStep(); }
  }

  // ============================================================
  //  NETWORK WIRING
  // ============================================================
  function makeNet() {
    const net = new window.LudoNet(); G.net = net;
    net.on("error", (e) => { netErr(e.msg); });
    net.on("room-created", (d) => { G.roomCode = d.code; G.mePid = "HOST"; net.registerSelf(el("createName").value || "Host"); openLobby(true); });
    net.on("welcome", (d) => { G.mePid = d.you; G.roomCode = d.code; openLobby(false); renderRoster(d.roster); });
    net.on("roster", (d) => renderRoster(d.roster));
    net.on("peer-joined", () => { el("lobbyStatus").textContent = "Player joined."; });
    net.on("peer-left", () => { renderRoster(net.roster); if (G.mode === "online" && G.game && G.game.status === "playing") markDisconnect(); });
    net.on("peer-rejoined", () => { if (G.mode === "online" && G.net.isHost && G.game) G.net.broadcastState(G.game.serialize(), { type: "turn" }); });
    net.on("start", (payload) => applyOnlineStart(payload));
    net.on("state", (d) => onNetState(d));
    net.on("action", (d) => onHostAction(d));
    net.on("emote", (d) => showEmote(d.pid, d.content));
    net.on("host-lost", () => netOverlay("⚠", "Host disconnected", "The room host left. You can return to the menu.", [{ t: "Main Menu", fn: toMenu }]));
    return net;
  }
  function markDisconnect() {
    const gone = G.players.filter((p) => { const r = G.net.roster.find((x) => x.pid === p.pid); return r && !r.connected; });
    if (gone.length) netOverlay("⚠", "Player disconnected", gone.map((p) => p.name).join(", ") + " — waiting for reconnection…", [{ t: "Continue anyway", fn: hideNetOverlay }]);
  }
  function renderRoster(roster) {
    G._roster = roster;
    const rows = []; const slots = (G.net && G.net.maxPlayers) || roster.length || 4;
    for (let i = 0; i < slots; i++) { const r = roster[i]; const col = CFG.ORDER[i]; rows.push(`<div class="rrow ${r ? "" : "empty"}"><span class="dot" style="background:${HEX[col]}"></span><span class="nm">${r ? esc(r.name) : "Waiting…"}</span><span class="tag">${r ? (r.host ? "Host" : "Ready") : ""}</span></div>`); }
    el("lobbyRoster").innerHTML = rows.join("");
    el("lobbyStatus").textContent = "Players: " + roster.filter((x) => x.connected).length + " / " + (G.net ? G.net.maxPlayers : 4);
    el("startGameBtn").style.display = (G.net && G.net.isHost) ? "" : "none";
  }
  function openLobby(isHost) { G.mode = "online"; el("lobbyCode").textContent = G.roomCode; show("lobby"); }
  function netErr(msg) { const h = el(document.querySelector(".screen.active").id === "joinScreen" ? "joinHint" : "createHint"); if (h) { h.textContent = msg; h.className = "hint err"; } else toast(msg); }
  function netOverlay(big, title, body, btns) { const o = el("netOverlay"); o.classList.remove("hidden"); o.innerHTML = `<div><div class="big">${big}</div><b>${esc(title)}</b><p style="margin:8px 0;color:var(--dim)">${esc(body)}</p>${(btns || []).map((b, i) => `<button class="btn primary" data-i="${i}">${esc(b.t)}</button>`).join("")}</div>`; o.querySelectorAll("[data-i]").forEach((el2) => el2.onclick = () => { hideNetOverlay(); btns[+el2.dataset.i].fn(); }); }
  function hideNetOverlay() { el("netOverlay").classList.add("hidden"); }

  // ============================================================
  //  UI HELPERS
  // ============================================================
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function toast(msg) { const o = el("modal"); el("modalContent").innerHTML = `<p class="lead" style="margin:6px 0 14px">${esc(msg)}</p><button class="btn primary" id="mkOk">OK</button>`; o.classList.remove("hidden"); el("mkOk").onclick = () => o.classList.add("hidden"); }
  function toMenu() { if (G.net) { try { G.net.disconnect(); } catch (e) {} G.net = null; } G.mode = null; G._ended = false; G.game = null; rafRunning = false; hideNetOverlay(); show("menu"); }

  // ============================================================
  //  EVENT BINDINGS
  // ============================================================
  function seg(id, attr, cb) { el(id).querySelectorAll("button").forEach((b) => b.onclick = () => { el(id).querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); cb(b.dataset[attr]); }); }

  function bind() {
    // menu
    el("createBtn").onclick = () => { Audio.ensure(); Audio.click(); show("create"); };
    el("joinBtn").onclick = () => { Audio.click(); show("join"); };
    el("cpuBtn").onclick = () => { Audio.click(); renderCpuLineup(); show("cpu"); };
    el("passplayBtn").onclick = () => { Audio.click(); startOffline("passplay", 4); };
    el("soundBtn").onclick = () => { const m = Audio.toggle(); el("soundBtn").textContent = m ? "🔇 Sound" : "🔊 Sound"; };
    el("helpBtn").onclick = () => toast("Roll the dice on your turn, then tap a highlighted token to move it. Get a 6 to bring a token out of home. Land on an opponent (not on a ★ safe cell) to send it back. First to bring all 4 tokens home wins!");
    document.querySelectorAll("[data-back]").forEach((b) => b.onclick = () => { Audio.click(); show("menu"); });

    // create
    let createN = 4; seg("createPlayers", "n", (n) => createN = +n);
    el("doCreate").onclick = () => { Audio.ensure(); if (!ensureNet()) return; const name = (el("createName").value || "Host").trim(); const pass = el("createPass").value.trim(); makeNet().createRoom({ max: createN, passcode: pass || null }); el("createHint").textContent = "Creating room…"; el("createHint").className = "hint"; };
    // join
    el("doJoin").onclick = () => { Audio.ensure(); if (!ensureNet()) return; const code = (el("joinCode").value || "").trim().toUpperCase(); const name = (el("joinName").value || "Player").trim(); const pass = el("joinPass").value.trim(); if (code.length < 4) { el("joinHint").textContent = "Enter a valid room code."; el("joinHint").className = "hint err"; return; } el("joinHint").textContent = "Connecting…"; el("joinHint").className = "hint"; makeNet().joinRoom({ code, name, pass }); };
    // cpu
    let cpuN = 2, cpuDiff = "normal"; seg("cpuPlayers", "n", (n) => { cpuN = +n; renderCpuLineup(); }); seg("cpuDiff", "d", (d) => { cpuDiff = d; renderCpuLineup(); });
    el("doCpu").onclick = () => { Audio.ensure(); Audio.click(); startOffline("cpu", cpuN, (el("cpuName").value || "You").trim(), cpuDiff); };
    window._cpuState = () => ({ get n() { return cpuN; }, get d() { return cpuDiff; } });

    // lobby
    el("startGameBtn").onclick = () => { Audio.click(); hostStartGame(); };
    el("leaveLobbyBtn").onclick = () => { Audio.click(); toMenu(); };
    el("copyCode").onclick = () => { try { navigator.clipboard.writeText(G.roomCode); el("copyCode").textContent = "✓ Copied!"; setTimeout(() => el("copyCode").textContent = "📋 Copy code", 1500); } catch (e) { toast("Room code: " + G.roomCode); } };

    // game
    el("rollBtn").onclick = requestRoll;
    el("emoteBtn").onclick = () => { Audio.ensure(); toggleEmoteTray(); };
    el("gameMenuBtn").onclick = () => toast("Leave this game and return to the menu?") || setTimeout(() => {}, 0);
    el("gameMenuBtn").onclick = () => { const o = el("modal"); el("modalContent").innerHTML = `<h3 style="margin-bottom:12px">Menu</h3><div class="btns"><button class="btn" id="mResume">Resume</button><button class="btn ghost" id="mQuit">Quit to Menu</button></div>`; o.classList.remove("hidden"); el("mResume").onclick = () => o.classList.add("hidden"); el("mQuit").onclick = () => { o.classList.add("hidden"); toMenu(); }; };
    canvas.addEventListener("click", onCanvasClick);
    canvas.addEventListener("touchend", (e) => { if (e.changedTouches[0]) onCanvasClick({ clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY }); }, { passive: true });

    // results
    el("playAgainBtn").onclick = playAgain;
    el("toLobbyBtn").onclick = () => { if (G.mode === "online") { show("lobby"); renderRoster(G.net.roster); } };
    el("toMenuBtn").onclick = toMenu;

    addEventListener("resize", () => { if (document.body.classList.contains("in-game")) fitCanvas(); });
    // reflect sound label
    el("soundBtn").textContent = Audio.muted ? "🔇 Sound" : "🔊 Sound";
  }
  function ensureNet() { if (typeof window.Peer !== "function") { toast("Online play needs a network connection (couldn't load the WebRTC library). You can still Play vs Computer or Pass & Play offline."); return false; } return true; }
  function renderCpuLineup() { const st = window._cpuState ? window._cpuState() : { n: 2, d: "normal" }; const n = st.n; const names = ["You", "CPU 1", "CPU 2", "CPU 3"]; el("cpuLineup").innerHTML = CFG.ORDER.slice(0, n).map((c, i) => `<span class="pl">${CFG.EMOJI[c]} ${i === 0 ? "You" : "Computer"}</span>`).join(""); }

  function onCanvasClick(e) {
    if (!G.game || !G.selecting || !isMyTurn()) return;
    const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best = -1, bd = (G.cell * 0.7) ** 2;
    for (const ti of G.legal) { const r = G.game.players[G.game.turn].tokens[ti]; const coord = tokenCoord(G.players[G.game.turn].color, r, ti); const p = cellPx(coord.x, coord.y); const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = ti; } }
    if (best >= 0) requestMove(best);
  }

  // ============================================================
  //  BOOT
  // ============================================================
  window.addEventListener("DOMContentLoaded", () => { try { bind(); show("menu"); } catch (e) { console.error(e); } });
  window._LUDO = G; // for debugging
})();
