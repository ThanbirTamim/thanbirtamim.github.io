/* ============================================================
   STAR IMPACT  —  retro side-scrolling space shooter
   HTML5 Canvas + Vanilla JS. No dependencies, no build step.
   ------------------------------------------------------------
   Original game inspired by classic arcade space shooters.
   All graphics + sounds are generated programmatically.
   (c) 2025 Sheikh Thanbir Alam.
   ============================================================ */
(function () {
  "use strict";

  // ---------- Constants ----------
  const W = 800, H = 450;                 // logical resolution
  const HIGH_KEY = "starImpactHighScore";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // ---------- DOM ----------
  const el = (id) => document.getElementById(id);
  const scoreVal = el("scoreVal"), highVal = el("highVal"), levelVal = el("levelVal"), livesVal = el("livesVal");
  const startScreen = el("startScreen"), pauseScreen = el("pauseScreen"), overScreen = el("overScreen");
  const banner = el("banner"), bossBar = el("bossBar"), bossFill = el("bossFill"), bossName = el("bossName");
  const finalScore = el("finalScore"), finalHigh = el("finalHigh"), newHigh = el("newHigh"), overTitle = el("overTitle");

  // ---------- Utility ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const aabb = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ============================================================
  //  AUDIO — tiny Web Audio synth (no asset files needed)
  // ============================================================
  const Sound = (() => {
    let ac = null, muted = false;
    const ensure = () => {
      if (!ac) {
        try { ac = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { ac = null; }
      }
      if (ac && ac.state === "suspended") ac.resume();
      return ac;
    };
    function tone(freq, dur, type = "square", vol = 0.15, slideTo = null) {
      if (muted) return; const c = ensure(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + dur);
    }
    function noise(dur, vol = 0.25) {
      if (muted) return; const c = ensure(); if (!c) return;
      const n = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource(); src.buffer = buf;
      const g = c.createGain(); g.gain.value = vol;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1200;
      src.connect(f); f.connect(g); g.connect(c.destination); src.start();
    }
    return {
      shoot: () => tone(880, 0.08, "square", 0.08, 420),
      enemyShoot: () => tone(300, 0.10, "sawtooth", 0.05, 160),
      explode: () => { noise(0.35, 0.3); tone(120, 0.3, "sawtooth", 0.12, 40); },
      hit: () => tone(200, 0.08, "square", 0.10, 90),
      power: () => { tone(520, 0.09, "square", 0.12); setTimeout(() => tone(780, 0.12, "square", 0.12), 90); },
      boss: () => { tone(80, 0.6, "sawtooth", 0.18, 55); noise(0.4, 0.15); },
      over: () => { tone(400, 0.2, "square", 0.15, 120); setTimeout(() => tone(200, 0.4, "square", 0.15, 60), 180); },
      level: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.12, "triangle", 0.12), i * 90)); },
      toggle() { muted = !muted; if (!muted) ensure(); return muted; },
      get muted() { return muted; },
      unlock: ensure,
    };
  })();

  // ============================================================
  //  INPUT
  // ============================================================
  const keys = { up: false, down: false, left: false, right: false, fire: false };
  const touch = { active: false, tx: 0, ty: 0 };  // drag-to-move (mobile)
  const KEYMAP = {
    ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
    Space: "fire",
  };
  addEventListener("keydown", (e) => {
    if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
    if (e.code === "KeyP") { e.preventDefault(); togglePause(); }
    if (e.code === "KeyR") { e.preventDefault(); restart(); }
    if (e.code === "Space" && game.state === "start") startGame();
    Sound.unlock();
  });
  addEventListener("keyup", (e) => { if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = false; e.preventDefault(); } });

  // Touch controls
  function bindTouch() {
    document.querySelectorAll(".tbtn[data-dir]").forEach((b) => {
      const dir = b.dataset.dir;
      const on = (e) => { e.preventDefault(); keys[dir] = true; b.classList.add("active"); Sound.unlock(); };
      const off = (e) => { e.preventDefault(); keys[dir] = false; b.classList.remove("active"); };
      b.addEventListener("touchstart", on, { passive: false });
      b.addEventListener("touchend", off, { passive: false });
      b.addEventListener("touchcancel", off, { passive: false });
      b.addEventListener("mousedown", on); b.addEventListener("mouseup", off); b.addEventListener("mouseleave", off);
    });
    const fire = el("fireBtn");
    const fon = (e) => { e.preventDefault(); keys.fire = true; fire.classList.add("active"); Sound.unlock(); if (game.state === "start") startGame(); };
    const foff = (e) => { e.preventDefault(); keys.fire = false; fire.classList.remove("active"); };
    fire.addEventListener("touchstart", fon, { passive: false });
    fire.addEventListener("touchend", foff, { passive: false });
    fire.addEventListener("touchcancel", foff, { passive: false });
    fire.addEventListener("mousedown", fon); fire.addEventListener("mouseup", foff); fire.addEventListener("mouseleave", foff);
    // reveal touch controls if a touch happens
    addEventListener("touchstart", () => document.body.classList.add("touch-mode"), { once: true });

    // ---- Primary mobile control: drag anywhere on the play area to move; auto-fire ----
    const canvasPos = (cx, cy) => { const r = canvas.getBoundingClientRect(); return { x: (cx - r.left) / r.width * W, y: (cy - r.top) / r.height * H }; };
    const onTouch = (e) => { e.preventDefault(); const t = e.touches[0]; if (!t) return; const p = canvasPos(t.clientX, t.clientY); touch.active = true; touch.tx = p.x; touch.ty = p.y; Sound.unlock(); document.body.classList.add("touch-mode"); if (game.state === "start") startGame(); else if (game.state === "over") restart(); };
    canvas.addEventListener("touchstart", onTouch, { passive: false });
    canvas.addEventListener("touchmove", onTouch, { passive: false });
    canvas.addEventListener("touchend", (e) => { e.preventDefault(); if (e.touches.length === 0) touch.active = false; }, { passive: false });
    canvas.addEventListener("touchcancel", () => { touch.active = false; }, { passive: false });
  }
  // Prevent scroll/zoom gestures on the play area
  document.addEventListener("touchmove", (e) => { if (game.state === "playing") e.preventDefault(); }, { passive: false });

  // ============================================================
  //  STARFIELD (parallax background)
  // ============================================================
  const stars = [];
  function initStars() {
    stars.length = 0;
    for (let i = 0; i < 90; i++) {
      const layer = randi(0, 2);
      stars.push({ x: rand(0, W), y: rand(0, H), layer, s: layer === 0 ? 1 : layer === 1 ? 1.6 : 2.4, v: layer === 0 ? 20 : layer === 1 ? 45 : 80 });
    }
  }
  function updateStars(dt) {
    for (const s of stars) { s.x -= s.v * dt; if (s.x < 0) { s.x = W; s.y = rand(0, H); } }
  }
  function drawStars() {
    for (const s of stars) {
      ctx.globalAlpha = s.layer === 0 ? 0.5 : s.layer === 1 ? 0.75 : 1;
      ctx.fillStyle = s.layer === 2 ? "#bcd4ff" : "#ffffff";
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }

  // ============================================================
  //  GAME STATE
  // ============================================================
  const game = {
    state: "start",           // start | playing | paused | over
    score: 0,
    high: parseInt(localStorage.getItem(HIGH_KEY) || "0", 10) || 0,
    level: 1,
    lives: 3,
    shake: 0,
    kills: 0,
    killTarget: 10,
    spawnTimer: 0,
    bossActive: false,
    boss: null,
    bannerT: 0,
  };

  const player = {
    x: 70, y: H / 2 - 12, w: 34, h: 22,
    speed: 300, cooldown: 0, fireRate: 0.28,
    invuln: 0, shield: 0, rapid: 0, spread: 0,
    thrust: 0,
  };

  let bullets = [], enemyBullets = [], enemies = [], particles = [], powerups = [];

  function resetPlayer() {
    player.x = 70; player.y = H / 2 - player.h / 2;
    player.cooldown = 0; player.invuln = 1.5;
    player.shield = 0; player.rapid = 0; player.spread = 0;
  }

  function resetGame() {
    game.score = 0; game.level = 1; game.lives = 3; game.kills = 0;
    game.killTarget = 10; game.spawnTimer = 0.5; game.bossActive = false; game.boss = null;
    game.shake = 0;
    bullets = []; enemyBullets = []; enemies = []; particles = []; powerups = [];
    resetPlayer();
    bossBar.classList.remove("show");
    updateHUD();
  }

  // ============================================================
  //  ENTITY FACTORIES
  // ============================================================
  const ENEMY_TYPES = {
    drone:  { w: 30, h: 22, hp: 1, speed: 130, score: 10, color: "#5ee0a0", shoots: false, pattern: "straight" },
    wave:   { w: 32, h: 24, hp: 2, speed: 110, score: 20, color: "#ffd166", shoots: true,  pattern: "sine",     fireEvery: 1.8 },
    heavy:  { w: 42, h: 32, hp: 5, speed: 70,  score: 40, color: "#ff7b7b", shoots: true,  pattern: "drift",    fireEvery: 1.3 },
    darter: { w: 26, h: 20, hp: 1, speed: 220, score: 25, color: "#c58bff", shoots: false, pattern: "straight" },
  };

  function spawnEnemy() {
    const roll = Math.random();
    let type = "drone";
    const lv = game.level;
    if (lv >= 2 && roll < 0.28) type = "wave";
    else if (lv >= 3 && roll < 0.45) type = "heavy";
    else if (lv >= 2 && roll < 0.62) type = "darter";
    const t = ENEMY_TYPES[type];
    const y = rand(30, H - t.h - 20);
    const speedBoost = 1 + (lv - 1) * 0.08;
    enemies.push({
      type, x: W + 10, y, baseY: y, w: t.w, h: t.h,
      hp: t.hp + Math.floor((lv - 1) / 3), maxhp: t.hp,
      speed: t.speed * speedBoost, color: t.color,
      shoots: t.shoots, fireEvery: t.fireEvery || 2, fireT: rand(0.5, 2),
      pattern: t.pattern, score: t.score, t: rand(0, Math.PI * 2), amp: rand(30, 70),
    });
  }

  function spawnBoss() {
    game.bossActive = true;
    const hp = 40 + game.level * 22;
    game.boss = {
      x: W + 60, y: H / 2 - 55, w: 90, h: 110, hp, maxhp: hp,
      vx: -60, targetX: W - 150, entering: true,
      fireT: 1.2, burstT: 0, phase: 0, t: 0, color: "#ff4d6d",
    };
    bossName.textContent = "SECTOR BOSS  ·  LV " + game.level;
    bossBar.classList.add("show");
    Sound.boss();
    showBanner("⚠ BOSS INCOMING ⚠");
  }

  function firePlayer() {
    if (player.cooldown > 0) return;
    const rate = player.rapid > 0 ? player.fireRate * 0.45 : player.fireRate;
    player.cooldown = rate;
    const bx = player.x + player.w, by = player.y + player.h / 2 - 2;
    const mk = (vy) => bullets.push({ x: bx, y: by, w: 12, h: 4, vx: 620, vy, dmg: 1 });
    if (player.spread > 0) { mk(-120); mk(0); mk(120); } else mk(0);
    Sound.shoot();
  }

  function enemyFire(e) {
    const ex = e.x, ey = e.y + e.h / 2;
    const dx = (player.x + player.w / 2) - ex, dy = (player.y + player.h / 2) - ey;
    const d = Math.hypot(dx, dy) || 1;
    const sp = 230;
    enemyBullets.push({ x: ex, y: ey, w: 8, h: 8, vx: (dx / d) * sp, vy: (dy / d) * sp });
    Sound.enemyShoot();
  }

  function dropPowerup(x, y) {
    if (Math.random() > 0.16) return;
    const kinds = ["rapid", "spread", "shield", "life"];
    const weights = [0.34, 0.30, 0.26, 0.10];
    let r = Math.random(), kind = "rapid", acc = 0;
    for (let i = 0; i < kinds.length; i++) { acc += weights[i]; if (r <= acc) { kind = kinds[i]; break; } }
    powerups.push({ x, y, w: 20, h: 20, vx: -90, kind, t: 0 });
  }

  function explode(x, y, n, color, big) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(40, big ? 320 : 200);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.8), max: 0.8, color, s: rand(1.5, big ? 5 : 3) });
    }
    if (big) game.shake = Math.min(game.shake + 14, 22);
    else game.shake = Math.min(game.shake + 4, 12);
    Sound.explode();
  }

  // ============================================================
  //  UPDATE
  // ============================================================
  function update(dt) {
    updateStars(dt);
    if (game.state !== "playing") return;

    if (game.bannerT > 0) game.bannerT -= dt;
    if (game.bannerT <= 0 && !banner.classList.contains("hidden")) banner.classList.add("hidden");

    // ----- player movement -----
    // ----- player movement (keyboard OR drag-to-move on touch) -----
    if (touch.active) {
      const tx = clamp(touch.tx - player.w / 2, 6, W - player.w - 6);
      const ty = clamp(touch.ty - player.h / 2, 24, H - player.h - 6);
      const maxStep = player.speed * dt * 1.6;
      const dx = clamp(tx - player.x, -maxStep, maxStep), dy = clamp(ty - player.y, -maxStep, maxStep);
      player.x = clamp(player.x + dx, 6, W - player.w - 6);
      player.y = clamp(player.y + dy, 24, H - player.h - 6);
      player.thrust = dx > 0.2 ? 1 : dx < -0.2 ? -1 : 0;
    } else {
      let mvx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      let mvy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      player.thrust = keys.left ? -1 : keys.right ? 1 : 0;
      player.x = clamp(player.x + mvx * player.speed * dt, 6, W - player.w - 6);
      player.y = clamp(player.y + mvy * player.speed * dt, 24, H - player.h - 6);
    }

    if (keys.fire || touch.active) firePlayer();   // auto-fire while dragging
    player.cooldown = Math.max(0, player.cooldown - dt);
    player.invuln = Math.max(0, player.invuln - dt);
    for (const k of ["shield", "rapid", "spread"]) player[k] = Math.max(0, player[k] - dt);

    // ----- spawning -----
    if (!game.bossActive) {
      game.spawnTimer -= dt;
      const interval = clamp(1.35 - game.level * 0.07, 0.45, 1.35);
      if (game.spawnTimer <= 0) { spawnEnemy(); game.spawnTimer = rand(interval * 0.6, interval); }
      if (game.kills >= game.killTarget) spawnBoss();
    }

    // ----- player bullets -----
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x > W + 20 || b.y < -20 || b.y > H + 20) { bullets.splice(i, 1); continue; }
      // vs enemies
      let hit = false;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (aabb(b, e)) {
          e.hp -= b.dmg; hit = true;
          explode(b.x, b.y, 5, e.color, false);
          if (e.hp <= 0) { killEnemy(e, j); }
          break;
        }
      }
      if (!hit && game.boss && aabb(b, game.boss)) {
        game.boss.hp -= b.dmg; hit = true;
        explode(b.x, game.boss.y + rand(0, game.boss.h), 4, "#ffd166", false);
        if (game.boss.hp <= 0) killBoss();
      }
      if (hit) bullets.splice(i, 1);
    }

    // ----- enemies -----
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i]; e.t += dt;
      e.x -= e.speed * dt;
      if (e.pattern === "sine") e.y = e.baseY + Math.sin(e.t * 2.5) * e.amp;
      else if (e.pattern === "drift") e.y = clamp(e.baseY + Math.sin(e.t) * 40, 24, H - e.h - 6);
      if (e.shoots) { e.fireT -= dt; if (e.fireT <= 0 && e.x < W - 40) { enemyFire(e); e.fireT = e.fireEvery * rand(0.8, 1.3); } }
      if (e.x + e.w < -10) { enemies.splice(i, 1); continue; }
      // vs player
      if (canHitPlayer() && aabb(e, player)) { hurtPlayer(); explode(e.x, e.y, 12, e.color, true); enemies.splice(i, 1); }
    }

    // ----- enemy bullets -----
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i]; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) { enemyBullets.splice(i, 1); continue; }
      if (canHitPlayer() && aabb(b, player)) { hurtPlayer(); enemyBullets.splice(i, 1); }
    }

    // ----- boss -----
    if (game.boss) updateBoss(dt);

    // ----- powerups -----
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i]; p.x += p.vx * dt; p.t += dt;
      p.y += Math.sin(p.t * 3) * 18 * dt;
      if (p.x + p.w < -10) { powerups.splice(i, 1); continue; }
      if (aabb(p, player)) { grabPowerup(p.kind); powerups.splice(i, 1); }
    }

    // ----- particles -----
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96;
    }

    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 40);
  }

  function updateBoss(dt) {
    const b = game.boss; b.t += dt;
    if (b.entering) { b.x += b.vx * dt; if (b.x <= b.targetX) { b.x = b.targetX; b.entering = false; } }
    else { b.y = clamp(H / 2 - b.h / 2 + Math.sin(b.t * 0.9) * (H / 2 - b.h / 2 - 20), 24, H - b.h - 6); }
    bossFill.style.width = clamp((b.hp / b.maxhp) * 100, 0, 100) + "%";
    // firing patterns
    if (!b.entering) {
      b.fireT -= dt;
      if (b.fireT <= 0) {
        b.phase = (b.phase + 1) % 2;
        const cx = b.x, cy = b.y + b.h / 2;
        if (b.phase === 0) {
          // aimed triple
          for (let k = -1; k <= 1; k++) {
            const dx = (player.x) - cx, dy = (player.y + k * 40) - cy, d = Math.hypot(dx, dy) || 1;
            enemyBullets.push({ x: cx, y: cy, w: 9, h: 9, vx: dx / d * 240, vy: dy / d * 240 });
          }
        } else {
          // radial spray
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
            enemyBullets.push({ x: cx, y: cy, w: 8, h: 8, vx: Math.cos(a + Math.PI) * 170, vy: Math.sin(a) * 170 });
          }
        }
        Sound.enemyShoot();
        b.fireT = clamp(1.5 - game.level * 0.05, 0.7, 1.5);
      }
    }
    if (canHitPlayer() && aabb(b, player)) hurtPlayer();
  }

  // ============================================================
  //  EVENTS / RULES
  // ============================================================
  function canHitPlayer() { return player.invuln <= 0 && player.shield <= 0; }

  function killEnemy(e, idx) {
    enemies.splice(idx, 1);
    game.score += e.score;
    game.kills++;
    explode(e.x + e.w / 2, e.y + e.h / 2, 16, e.color, true);
    dropPowerup(e.x, e.y);
    updateHUD();
  }

  function killBoss() {
    const b = game.boss;
    game.score += 300 + game.level * 50;
    for (let i = 0; i < 6; i++) setTimeout(() => explode(b.x + rand(0, b.w), b.y + rand(0, b.h), 20, "#ffd166", true), i * 90);
    game.boss = null; game.bossActive = false;
    bossBar.classList.remove("show");
    // next level
    game.level++; game.kills = 0; game.killTarget = 10 + game.level * 2;
    enemyBullets = [];
    Sound.level();
    showBanner("LEVEL " + game.level);
    // reward
    player.shield = 3;
    updateHUD();
  }

  function hurtPlayer() {
    if (!canHitPlayer()) return;
    game.lives--;
    explode(player.x + player.w / 2, player.y + player.h / 2, 24, "#00d4ff", true);
    Sound.hit();
    updateHUD();
    if (game.lives <= 0) { gameOver(); return; }
    resetPlayer();
  }

  function grabPowerup(kind) {
    Sound.power();
    if (kind === "rapid") player.rapid = 8;
    else if (kind === "spread") player.spread = 8;
    else if (kind === "shield") player.shield = 6;
    else if (kind === "life") { game.lives = Math.min(game.lives + 1, 6); }
    game.score += 15;
    showBanner(({ rapid: "RAPID FIRE!", spread: "SPREAD SHOT!", shield: "SHIELD!", life: "+1 LIFE" })[kind], 0.9);
    updateHUD();
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (game.shake > 0.4) ctx.translate(rand(-game.shake, game.shake), rand(-game.shake, game.shake));

    // background
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "#0a0e27"); grd.addColorStop(1, "#05070f");
    ctx.fillStyle = grd; ctx.fillRect(-30, -30, W + 60, H + 60);
    drawStars();

    // distant nebula streaks
    ctx.globalAlpha = 0.06; ctx.fillStyle = "#667eea";
    ctx.fillRect(0, (Date.now() / 40 % (H + 200)) - 100, W, 40);
    ctx.globalAlpha = 1;

    drawPowerups();
    drawEnemies();
    if (game.boss) drawBoss(game.boss);
    drawBullets();
    if (game.state === "playing" || game.state === "paused") drawPlayer();
    drawParticles();

    ctx.restore();
  }

  function drawPlayer() {
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) return; // blink
    const x = player.x, y = player.y, w = player.w, h = player.h;
    // engine flame
    const fl = 6 + Math.random() * 6 + (player.thrust > 0 ? 4 : 0);
    ctx.fillStyle = "#ff9d3d";
    ctx.beginPath(); ctx.moveTo(x, y + h / 2 - 4); ctx.lineTo(x - fl, y + h / 2); ctx.lineTo(x, y + h / 2 + 4); ctx.fill();
    ctx.fillStyle = "#ffd166";
    ctx.beginPath(); ctx.moveTo(x, y + h / 2 - 2); ctx.lineTo(x - fl * 0.6, y + h / 2); ctx.lineTo(x, y + h / 2 + 2); ctx.fill();
    // body
    ctx.fillStyle = "#8fb7ff";
    ctx.beginPath();
    ctx.moveTo(x + w, y + h / 2);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x + 12, y + h / 2);
    ctx.lineTo(x + 6, y + h);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#e8f0ff";
    ctx.beginPath(); ctx.moveTo(x + w, y + h / 2); ctx.lineTo(x + 16, y + h / 2 - 4); ctx.lineTo(x + 16, y + h / 2 + 4); ctx.fill();
    // cockpit
    ctx.fillStyle = "#00d4ff"; ctx.fillRect(x + 12, y + h / 2 - 2, 6, 4);
    // shield
    if (player.shield > 0) {
      ctx.strokeStyle = `rgba(0,212,255,${0.5 + 0.3 * Math.sin(Date.now() / 100)})`;
      ctx.lineWidth = 2; ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w * 0.9, h * 1.1, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawEnemies() {
    for (const e of enemies) {
      ctx.fillStyle = e.color;
      const x = e.x, y = e.y, w = e.w, h = e.h;
      if (e.type === "heavy") {
        ctx.fillRect(x, y + 3, w, h - 6);
        ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x - 8, y); ctx.lineTo(x - 8, y + h); ctx.fill();
        ctx.fillStyle = "#5b1a1a"; ctx.fillRect(x + 6, y + h / 2 - 3, 8, 6);
      } else if (e.type === "darter") {
        ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.fill();
      } else if (e.type === "wave") {
        ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w * 0.6, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x + w * 0.6, y + h); ctx.fill();
        ctx.fillStyle = "#7a5b00"; ctx.fillRect(x + w * 0.4, y + h / 2 - 3, 8, 6);
      } else { // drone
        ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + 2); ctx.lineTo(x + w * 0.7, y + h / 2); ctx.lineTo(x + w, y + h - 2); ctx.fill();
        ctx.fillStyle = "#0a3a25"; ctx.fillRect(x + w * 0.45, y + h / 2 - 2, 6, 4);
      }
      // hp tint for damaged
      if (e.hp < e.maxhp) { ctx.globalAlpha = 0.25; ctx.fillStyle = "#fff"; ctx.fillRect(x, y, w, 2); ctx.globalAlpha = 1; }
    }
  }

  function drawBoss(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = "#7a1030";
    ctx.fillRect(10, 0, b.w - 10, b.h);
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.moveTo(10, 10); ctx.lineTo(10, b.h - 10);
    ctx.lineTo(b.w, b.h * 0.8); ctx.lineTo(b.w - 14, b.h / 2); ctx.lineTo(b.w, b.h * 0.2);
    ctx.closePath(); ctx.fill();
    // guns
    ctx.fillStyle = "#2a0512";
    ctx.fillRect(0, b.h * 0.2 - 6, 16, 12);
    ctx.fillRect(0, b.h * 0.8 - 6, 16, 12);
    // core (pulsing)
    const pulse = 6 + Math.sin(b.t * 6) * 3;
    ctx.fillStyle = "#ffd166";
    ctx.beginPath(); ctx.arc(b.w * 0.55, b.h / 2, pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(b.w * 0.55, b.h / 2, pulse * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawBullets() {
    // player
    for (const b of bullets) {
      ctx.fillStyle = "#00ffcc"; ctx.shadowColor = "#00ffcc"; ctx.shadowBlur = 8;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    // enemy
    for (const b of enemyBullets) {
      ctx.fillStyle = "#ff5d73"; ctx.shadowColor = "#ff5d73"; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function drawPowerups() {
    const glyph = { rapid: "»", spread: "W", shield: "S", life: "♥" };
    const col = { rapid: "#ffd166", spread: "#5ee0a0", shield: "#00d4ff", life: "#ff4d6d" };
    for (const p of powerups) {
      ctx.fillStyle = col[p.kind]; ctx.shadowColor = col[p.kind]; ctx.shadowBlur = 12;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.shadowBlur = 0; ctx.fillStyle = "#05070f";
      ctx.font = "bold 14px " + "monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(glyph[p.kind], p.x + p.w / 2, p.y + p.h / 2 + 1);
    }
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }
    ctx.globalAlpha = 1;
  }

  // ============================================================
  //  HUD / SCREENS
  // ============================================================
  function updateHUD() {
    scoreVal.textContent = game.score;
    highVal.textContent = game.high;
    levelVal.textContent = game.level;
    livesVal.textContent = "♥".repeat(Math.max(0, game.lives));
  }

  function showBanner(text, time = 1.4) {
    banner.textContent = text; banner.classList.remove("hidden");
    game.bannerT = time;
  }

  // ============================================================
  //  STATE TRANSITIONS
  // ============================================================
  function startGame() {
    if (game.state === "playing") return;
    Sound.unlock();
    resetGame();
    game.state = "playing";
    startScreen.classList.add("hidden");
    overScreen.classList.add("hidden");
    pauseScreen.classList.add("hidden");
    showBanner("LEVEL 1");
  }

  function togglePause() {
    if (game.state === "playing") { game.state = "paused"; pauseScreen.classList.remove("hidden"); }
    else if (game.state === "paused") { game.state = "playing"; pauseScreen.classList.add("hidden"); }
  }

  function restart() {
    if (game.state === "start") return;
    startGame();
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

  // ============================================================
  //  MAIN LOOP  (delta-timed, ~60fps)
  // ============================================================
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.05) dt = 0.05;            // clamp big pauses
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ============================================================
  //  BOOT
  // ============================================================
  initStars();
  updateHUD();
  bindTouch();
  requestAnimationFrame(frame);

  // Pause when tab hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && game.state === "playing") togglePause();
  });
})();
