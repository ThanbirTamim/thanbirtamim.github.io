/* ============================================================
   NEON SNAKE  —  retro arcade snake
   HTML5 Canvas + Vanilla JS. No dependencies, no build step.
   ------------------------------------------------------------
   Grid-based classic snake with smooth rendering, sound,
   keyboard + swipe + on-screen controls, and localStorage high score.
   (c) 2025 Sheikh Thanbir Alam.
   ============================================================ */
(function () {
  "use strict";

  // ---------- Grid / canvas ----------
  const COLS = 24, ROWS = 24;              // logical grid
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const CW = canvas.width, CH = canvas.height;
  const CELL = CW / COLS;                   // pixel size of one cell
  const HIGH_KEY = "neonSnakeHighScore";

  const el = (id) => document.getElementById(id);
  const scoreVal = el("scoreVal"), highVal = el("highVal"), speedVal = el("speedVal");
  const startScreen = el("startScreen"), pauseScreen = el("pauseScreen"), overScreen = el("overScreen");
  const finalScore = el("finalScore"), finalHigh = el("finalHigh"), newHigh = el("newHigh");

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // ============================================================
  //  AUDIO — tiny Web Audio synth
  // ============================================================
  const Sound = (() => {
    let ac = null, muted = false;
    const ensure = () => {
      if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
      if (ac && ac.state === "suspended") ac.resume();
      return ac;
    };
    function tone(freq, dur, type = "square", vol = 0.14, slideTo = null) {
      if (muted) return; const c = ensure(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
    }
    return {
      eat: () => tone(660, 0.09, "square", 0.12, 990),
      turn: () => tone(320, 0.03, "square", 0.05),
      over: () => { tone(400, 0.2, "square", 0.15, 120); setTimeout(() => tone(180, 0.4, "square", 0.15, 60), 180); },
      level: () => { [523, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.1, "triangle", 0.12), i * 80)); },
      toggle() { muted = !muted; if (!muted) ensure(); return muted; },
      unlock: ensure,
    };
  })();

  // ============================================================
  //  GAME STATE
  // ============================================================
  const game = {
    state: "start",           // start | playing | paused | over
    score: 0,
    high: parseInt(localStorage.getItem(HIGH_KEY) || "0", 10) || 0,
    speed: 1,
    stepEvery: 0.14,          // seconds per grid step (decreases with speed)
    acc: 0,
  };

  let snake, dir, nextDir, food, grow, pulse = 0;

  function reset() {
    snake = [{ x: 8, y: 12 }, { x: 7, y: 12 }, { x: 6, y: 12 }];
    dir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    grow = 0;
    game.score = 0; game.speed = 1; game.stepEvery = 0.14; game.acc = 0;
    placeFood();
    updateHUD();
  }

  function placeFood() {
    let ok = false, fx = 0, fy = 0, tries = 0;
    while (!ok && tries++ < 500) {
      fx = Math.floor(Math.random() * COLS);
      fy = Math.floor(Math.random() * ROWS);
      ok = !snake.some((s) => s.x === fx && s.y === fy);
    }
    food = { x: fx, y: fy };
  }

  // ============================================================
  //  INPUT
  // ============================================================
  function setDir(nx, ny) {
    // prevent 180° reversal
    if (nx === -dir.x && ny === -dir.y) return;
    if (nx === nextDir.x && ny === nextDir.y) return;
    nextDir = { x: nx, y: ny };
    Sound.turn();
  }
  const DIRS = {
    up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
  };
  const KEYMAP = {
    ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
  };
  addEventListener("keydown", (e) => {
    Sound.unlock();
    if (KEYMAP[e.code]) { const d = DIRS[KEYMAP[e.code]]; setDir(d[0], d[1]); e.preventDefault(); if (game.state === "start") startGame(); }
    if (e.code === "KeyP") { e.preventDefault(); togglePause(); }
    if (e.code === "KeyR") { e.preventDefault(); startGame(); }
    if (e.code === "Space" && game.state === "start") { e.preventDefault(); startGame(); }
  });

  // touch dpad
  function bindTouch() {
    document.querySelectorAll(".tbtn[data-dir]").forEach((b) => {
      const d = DIRS[b.dataset.dir];
      const on = (e) => { e.preventDefault(); Sound.unlock(); if (game.state === "start") startGame(); setDir(d[0], d[1]); b.classList.add("active"); };
      const off = (e) => { e.preventDefault(); b.classList.remove("active"); };
      b.addEventListener("touchstart", on, { passive: false });
      b.addEventListener("touchend", off, { passive: false });
      b.addEventListener("touchcancel", off, { passive: false });
      b.addEventListener("mousedown", on); b.addEventListener("mouseup", off); b.addEventListener("mouseleave", off);
    });
    addEventListener("touchstart", () => document.body.classList.add("touch-mode"), { once: true });
  }

  // swipe on canvas
  let sx = 0, sy = 0, swiping = false;
  canvas.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; swiping = true; Sound.unlock(); }, { passive: true });
  canvas.addEventListener("touchend", (e) => {
    if (!swiping) return; swiping = false;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) { if (game.state === "start") startGame(); return; }
    if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
    else setDir(0, dy > 0 ? 1 : -1);
    if (game.state === "start") startGame();
  }, { passive: true });
  document.addEventListener("touchmove", (e) => { if (game.state === "playing") e.preventDefault(); }, { passive: false });

  // ============================================================
  //  UPDATE
  // ============================================================
  function update(dt) {
    pulse += dt;
    if (game.state !== "playing") return;
    game.acc += dt;
    if (game.acc < game.stepEvery) return;
    game.acc -= game.stepEvery;
    step();
  }

  function step() {
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // wall collision
    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) { gameOver(); return; }
    // self collision (ignore tail cell that will move, unless growing)
    const willGrow = grow > 0;
    const body = willGrow ? snake : snake.slice(0, snake.length - 1);
    if (body.some((s) => s.x === head.x && s.y === head.y)) { gameOver(); return; }

    snake.unshift(head);

    if (head.x === food.x && head.y === food.y) {
      game.score += 10;
      grow += 1;
      Sound.eat();
      placeFood();
      // speed up every 50 points
      const newSpeed = 1 + Math.floor(game.score / 50);
      if (newSpeed !== game.speed) { game.speed = newSpeed; game.stepEvery = clamp(0.14 - (game.speed - 1) * 0.012, 0.06, 0.14); Sound.level(); }
      updateHUD();
    }

    if (grow > 0) grow -= 1; else snake.pop();
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function render() {
    // background
    const grd = ctx.createLinearGradient(0, 0, 0, CH);
    grd.addColorStop(0, "#0a0e27"); grd.addColorStop(1, "#05070f");
    ctx.fillStyle = grd; ctx.fillRect(0, 0, CW, CH);

    // subtle grid
    ctx.strokeStyle = "rgba(102,126,234,0.08)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < COLS; i++) { ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, CH); }
    for (let j = 1; j < ROWS; j++) { ctx.moveTo(0, j * CELL); ctx.lineTo(CW, j * CELL); }
    ctx.stroke();

    if (game.state === "start") return;

    // food (pulsing orb)
    const fp = 0.5 + 0.5 * Math.sin(pulse * 6);
    const fcx = food.x * CELL + CELL / 2, fcy = food.y * CELL + CELL / 2;
    ctx.fillStyle = "#ffd166"; ctx.shadowColor = "#ffd166"; ctx.shadowBlur = 14 + fp * 8;
    ctx.beginPath(); ctx.arc(fcx, fcy, CELL * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff8dc";
    ctx.beginPath(); ctx.arc(fcx - CELL * 0.08, fcy - CELL * 0.08, CELL * 0.12, 0, Math.PI * 2); ctx.fill();

    // snake
    for (let i = snake.length - 1; i >= 0; i--) {
      const s = snake[i];
      const t = i / snake.length;
      const px = s.x * CELL, py = s.y * CELL;
      const pad = 1.5;
      if (i === 0) {
        // head
        ctx.fillStyle = "#8fffc4"; ctx.shadowColor = "#5ee0a0"; ctx.shadowBlur = 12;
        roundRect(px + pad, py + pad, CELL - pad * 2, CELL - pad * 2, 5); ctx.fill();
        ctx.shadowBlur = 0;
        // eyes
        ctx.fillStyle = "#05231a";
        const ex = px + CELL / 2, ey = py + CELL / 2;
        const ox = dir.x * CELL * 0.18, oy = dir.y * CELL * 0.18;
        const perpx = dir.y * CELL * 0.16, perpy = dir.x * CELL * 0.16;
        ctx.beginPath(); ctx.arc(ex + ox + perpx, ey + oy + perpy, CELL * 0.07, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex + ox - perpx, ey + oy - perpy, CELL * 0.07, 0, Math.PI * 2); ctx.fill();
      } else {
        const g = 224 - t * 90;
        ctx.fillStyle = `rgb(${Math.round(94 + t * 20)}, ${Math.round(g)}, ${Math.round(160 - t * 40)})`;
        roundRect(px + pad, py + pad, CELL - pad * 2, CELL - pad * 2, 4); ctx.fill();
      }
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ============================================================
  //  HUD / STATE
  // ============================================================
  function updateHUD() {
    scoreVal.textContent = game.score;
    highVal.textContent = game.high;
    speedVal.textContent = game.speed;
  }

  function startGame() {
    Sound.unlock();
    reset();
    game.state = "playing";
    startScreen.classList.add("hidden");
    overScreen.classList.add("hidden");
    pauseScreen.classList.add("hidden");
  }

  function togglePause() {
    if (game.state === "playing") { game.state = "paused"; pauseScreen.classList.remove("hidden"); }
    else if (game.state === "paused") { game.state = "playing"; pauseScreen.classList.add("hidden"); }
  }

  function gameOver() {
    game.state = "over";
    Sound.over();
    const isNew = game.score > game.high;
    if (isNew) { game.high = game.score; localStorage.setItem(HIGH_KEY, String(game.high)); }
    finalScore.textContent = game.score;
    finalHigh.textContent = game.high;
    newHigh.classList.toggle("hidden", !isNew);
    overScreen.classList.remove("hidden");
    updateHUD();
  }

  // Buttons
  el("startBtn").addEventListener("click", startGame);
  el("resumeBtn").addEventListener("click", togglePause);
  el("restartBtn").addEventListener("click", startGame);
  el("restartBtn2").addEventListener("click", startGame);
  el("pauseBtn").addEventListener("click", () => { if (game.state === "start") startGame(); else togglePause(); });
  el("soundBtn").addEventListener("click", () => { const m = Sound.toggle(); el("soundBtn").textContent = m ? "🔇" : "🔊"; });

  document.addEventListener("visibilitychange", () => { if (document.hidden && game.state === "playing") togglePause(); });

  // ============================================================
  //  LOOP
  // ============================================================
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.1) dt = 0.1;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // Boot
  reset();
  game.state = "start";
  updateHUD();
  bindTouch();
  requestAnimationFrame(frame);
})();
