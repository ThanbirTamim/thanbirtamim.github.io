/* ============================================================
   COMMANDO SQUAD 3D — main.js
   Audio, input (keyboard/mouse pointer-lock + touch), minimap,
   HUD, state machine (menu/countdown/playing/paused/win/lose)
   and the main render loop. Wires together World, Player, Squad,
   EnemyManager and FxManager from the CS3D namespace.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const CS = window.CS3D || {};
  const { clamp, lerp, rand, el } = CS.util;

  if (!window.THREE) { el("loadMsg").textContent = "Failed to load 3D engine (Three.js)."; return; }

  // ============================================================
  //  AUDIO MANAGER  (synthesized — no external assets)
  // ============================================================
  class AudioManager {
    constructor() { this.ac = null; this.muted = false; }
    ensure() {
      if (!this.ac) { try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ac = null; } }
      if (this.ac && this.ac.state === "suspended") this.ac.resume();
      return this.ac;
    }
    tone(f, d, type = "square", vol = 0.14, slide = null) {
      if (this.muted) return; const c = this.ensure(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, c.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + d);
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + d);
    }
    noise(d, vol = 0.3, freq = 1200) {
      if (this.muted) return; const c = this.ensure(); if (!c) return;
      const n = (c.sampleRate * d) | 0, buf = c.createBuffer(1, n, c.sampleRate), dd = buf.getChannelData(0);
      for (let i = 0; i < n; i++) dd[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = c.createBufferSource(); s.buffer = buf;
      const g = c.createGain(); g.gain.value = vol;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq;
      s.connect(f); f.connect(g); g.connect(c.destination); s.start();
    }
    shot(isRifle) { this.noise(0.1, 0.22, isRifle ? 2200 : 1500); this.tone(isRifle ? 180 : 140, 0.07, "square", 0.1, 60); }
    reload() { this.tone(500, 0.06, "square", 0.08); setTimeout(() => this.tone(700, 0.08, "square", 0.08), 180); }
    hitmark() { this.tone(1200, 0.05, "square", 0.1); }
    hurt() { this.tone(140, 0.18, "sawtooth", 0.16, 60); }
    down() { this.tone(220, 0.3, "sawtooth", 0.14, 70); }
    click() { this.tone(440, 0.04, "square", 0.08); }
    count(hi) { this.tone(hi ? 880 : 440, hi ? 0.25 : 0.15, "square", 0.14); }
    victory() { this.tone(523, 0.12, "square", 0.15); setTimeout(() => this.tone(659, 0.12, "square", 0.15), 130); setTimeout(() => this.tone(784, 0.22, "square", 0.16), 260); }
    defeat() { this.tone(300, 0.3, "sawtooth", 0.16, 100); setTimeout(() => this.tone(150, 0.5, "sawtooth", 0.16, 60), 250); }
    toggle() { this.muted = !this.muted; return this.muted; }
  }

  // ============================================================
  //  INPUT MANAGER  (keyboard + pointer-lock mouse + touch)
  // ============================================================
  class InputManager {
    constructor(game) {
      this.game = game;
      this.state = { forward: false, back: false, left: false, right: false, sprint: false };
      this.firing = false;
      this.locked = false;
      this.bindKeys(); this.bindMouse(); this.bindTouch();
    }
    bindKeys() {
      const map = { KeyW: "forward", ArrowUp: "forward", KeyS: "back", ArrowDown: "back", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right", ShiftLeft: "sprint", ShiftRight: "sprint" };
      addEventListener("keydown", (e) => {
        this.game.audio.ensure();
        if (map[e.code]) { this.state[map[e.code]] = true; }
        if (e.code === "KeyR") this.game.requestReload();
        if (e.code === "KeyQ") this.game.requestSwitchWeapon();
        if (e.code === "Digit1") this.game.squadCommand("follow");
        if (e.code === "Digit2") this.game.squadCommand("hold");
        if (e.code === "Digit3") this.game.squadCommand("fireatwill");
        if (e.code === "Escape" || e.code === "KeyP") this.game.togglePause();
        if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
      });
      addEventListener("keyup", (e) => { if (map[e.code]) this.state[map[e.code]] = false; });
    }
    bindMouse() {
      const cv = el("scene");
      cv.addEventListener("mousedown", (e) => {
        this.game.audio.ensure();
        if (e.button === 0) this.firing = true;
        if (this.game.state === "playing" && document.pointerLockElement !== cv && !this.game.isMobile()) cv.requestPointerLock();
      });
      addEventListener("mouseup", (e) => { if (e.button === 0) this.firing = false; });
      addEventListener("mousemove", (e) => {
        if (document.pointerLockElement === cv) this.game.onLook(e.movementX || 0, e.movementY || 0);
      });
      document.addEventListener("pointerlockchange", () => {
        this.locked = document.pointerLockElement === cv;
        if (!this.locked && this.game.state === "playing") this.game.togglePause();
      });
      cv.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    bindTouch() {
      document.querySelectorAll(".tbtn[data-act]").forEach((b) => {
        const act = b.dataset.act;
        const on = (e) => { e.preventDefault(); this.game.audio.ensure(); document.body.classList.add("touch-mode");
          if (act === "fire") this.firing = true;
          else if (act === "reload") this.game.requestReload();
          else if (act === "weapon") this.game.requestSwitchWeapon();
          b.classList.add("active");
        };
        const off = (e) => { e.preventDefault(); if (act === "fire") this.firing = false; b.classList.remove("active"); };
        b.addEventListener("touchstart", on, { passive: false });
        b.addEventListener("touchend", off, { passive: false });
        b.addEventListener("touchcancel", off, { passive: false });
        b.addEventListener("mousedown", on); b.addEventListener("mouseup", off); b.addEventListener("mouseleave", off);
      });
      // virtual joystick (movement)
      const base = el("touchStick").querySelector(".stick-base");
      const knob = el("stickKnob");
      let activeId = null; const radius = 46;
      const setKnob = (dx, dy) => { knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; };
      const start = (id, cx, cy) => { activeId = id; this._ox = cx; this._oy = cy; knob.classList.add("active"); document.body.classList.add("touch-mode"); this.game.audio.ensure(); };
      const move = (cx, cy) => {
        let dx = cx - this._ox, dy = cy - this._oy; const d = Math.hypot(dx, dy);
        if (d > radius) { dx = (dx / d) * radius; dy = (dy / d) * radius; }
        setKnob(dx, dy);
        const nx = dx / radius, ny = dy / radius;
        this.state.forward = ny < -0.3; this.state.back = ny > 0.3;
        this.state.left = nx < -0.3; this.state.right = nx > 0.3;
        this.state.sprint = Math.hypot(nx, ny) > 0.85;
      };
      const end = () => { activeId = null; setKnob(0, 0); knob.classList.remove("active"); this.state.forward = this.state.back = this.state.left = this.state.right = false; };
      base.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; start(t.identifier, t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
      base.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) if (t.identifier === activeId) move(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
      base.addEventListener("touchend", (e) => { for (const t of e.changedTouches) if (t.identifier === activeId) end(); }, { passive: false });
      base.addEventListener("touchcancel", () => end());

      // touch-look (drag anywhere on the right side to rotate camera / aim)
      const lookZone = el("touchLook");
      let lookId = null, lastX = 0, lastY = 0;
      lookZone.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; lookId = t.identifier; lastX = t.clientX; lastY = t.clientY; document.body.classList.add("touch-mode"); }, { passive: true });
      lookZone.addEventListener("touchmove", (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== lookId) continue;
          this.game.onLook((t.clientX - lastX) * 2.2, (t.clientY - lastY) * 2.2);
          lastX = t.clientX; lastY = t.clientY;
        }
      }, { passive: true });
      lookZone.addEventListener("touchend", (e) => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; }, { passive: true });
    }
  }

  // ============================================================
  //  SCORE MANAGER
  // ============================================================
  class ScoreManager {
    constructor() { this.key = "commandoSquad3dRecords"; this.data = this.load(); }
    load() { try { return JSON.parse(localStorage.getItem(this.key)) || { bestKills: 0, missions: 0 }; } catch (e) { return { bestKills: 0, missions: 0 }; } }
    submit(kills) {
      let record = false;
      if (kills > this.data.bestKills) { record = true; this.data.bestKills = kills; }
      this.data.missions = (this.data.missions || 0) + 1;
      try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
      return record;
    }
  }

  // ============================================================
  //  GAME  (orchestrator + state machine + loop)
  // ============================================================
  class Game {
    constructor() {
      this.state = "menu"; // menu | countdown | playing | paused | over
      this.audio = new AudioManager();
      this.scores = new ScoreManager();
      this.initThree();
      CS.initTextures("textures/");
      CS.initLib();
      this.buildWorld();
      this.input = new InputManager(this);
      this.bindUI();
      this.last = performance.now();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
      el("loadScreen").classList.add("hidden");
      this.showScores();
    }

    isMobile() { return matchMedia("(hover: none) and (pointer: coarse)").matches || innerWidth < 760; }

    initThree() {
      this.canvas = el("scene");
      const mobile = this.isMobile();
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !mobile, powerPreference: "high-performance" });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
      this.renderer.setSize(innerWidth, innerHeight);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x8fc7e0);
      this.scene.fog = new THREE.Fog(0x9fcfdf, 50, 170);

      this.camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.1, 400);
      this.camera.position.set(0, 3, 68);

      this.ambient = new THREE.AmbientLight(0xffffff, 0.68); this.scene.add(this.ambient);
      this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3a4f2f, 0.55); this.scene.add(this.hemi);
      this.sun = new THREE.DirectionalLight(0xfff3d6, 1.0);
      this.sun.position.set(60, 90, 40);
      this.scene.add(this.sun);

      addEventListener("resize", () => this.onResize());
    }

    onResize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); }

    buildWorld() {
      this.world = new CS.World(this.scene);
      this.fx = new CS.FxManager(this.scene);
      this.player = new CS.Player(this.scene, this.world, this.fx);
      this.squad = new CS.Squad(this.scene, this.world, this.fx);
      this.enemyMgr = new CS.EnemyManager(this.scene, this.world, this.fx);
      this.minimapCanvas = el("minimap"); this.minimapCtx = this.minimapCanvas.getContext("2d");
      this._minimapT = 0;
    }

    // ---------- look (mouse delta / touch drag) ----------
    onLook(dx, dy) {
      if (this.state !== "playing") return;
      const sens = 0.0024;
      this.player.yaw -= dx * sens;
      this.player.pitch = clamp(this.player.pitch - dy * sens, -0.85, 0.75);
    }

    // ---------- UI ----------
    bindUI() {
      el("playBtn").addEventListener("click", () => { this.audio.ensure(); this.audio.click(); this.beginRun(); });
      el("scoresBtn").addEventListener("click", () => { this.audio.click(); this.showScreen("scoresScreen"); });
      el("helpBtn").addEventListener("click", () => { this.audio.click(); this.showScreen("helpScreen"); });
      document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => { this.audio.click(); this.showScreen("menuScreen"); }));
      el("resumeBtn").addEventListener("click", () => this.togglePause());
      el("restartBtn2").addEventListener("click", () => this.restart());
      el("menuBtn2").addEventListener("click", () => this.toMenu());
      el("againBtn").addEventListener("click", () => this.restart());
      el("menuBtn").addEventListener("click", () => this.toMenu());
      el("pauseBtn").addEventListener("click", () => this.togglePause());
      el("soundBtn").addEventListener("click", () => { const m = this.audio.toggle(); el("soundBtn").textContent = m ? "🔇" : "🔊"; });
    }

    showScreen(id) { ["menuScreen", "scoresScreen", "helpScreen"].forEach((s) => el(s).classList.toggle("hidden", s !== id)); }

    showScores() {
      const b = this.scores.data;
      el("scoresList").innerHTML = `
        <div class="row"><span>Best Kills (1 mission)</span><b>${b.bestKills}</b></div>
        <div class="row"><span>Missions Deployed</span><b>${b.missions || 0}</b></div>`;
    }

    // ---------- squad commands ----------
    squadCommand(cmd) {
      if (this.state !== "playing") return;
      this.squad.setCommand(cmd);
      this.audio.click();
      document.querySelectorAll(".cmd-chip").forEach((c) => c.classList.remove("active"));
      const id = cmd === "follow" ? "cmdFollow" : cmd === "hold" ? "cmdHold" : "cmdFire";
      el(id).classList.add("active");
    }
    requestReload() { if (this.state === "playing") { this.player.startReload(); this.audio.reload(); } }
    requestSwitchWeapon() { if (this.state === "playing") { this.player.switchWeapon(); this.audio.click(); } }

    // ---------- game flow ----------
    resetRun() {
      this.kills = 0; this.missionTime = 0; this.prevAliveCount = 0;
      this.player.reset();
      this.squad.spawnNear(this.player);
      this.enemyMgr.spawnSector();
      this.prevAliveCount = this.enemyMgr.aliveCount();
      this.camera.position.set(this.player.pos.x, this.player.pos.y + 3, this.player.pos.z + 6);
      this.squadCommand("follow");
      el("enemyCountVal").textContent = this.enemyMgr.aliveCount();
      this.updateHUD();
    }

    beginRun() {
      this.audio.ensure();
      this.showScreen("menuScreen"); el("menuScreen").classList.add("hidden");
      this.resetRun();
      el("hud").classList.remove("hidden");
      this.startCountdown();
    }

    startCountdown() {
      this.state = "countdown";
      const cd = el("countdown"), num = el("countNum");
      cd.classList.remove("hidden");
      let n = 3;
      const step = () => {
        if (n > 0) { num.textContent = n; num.style.animation = "none"; void num.offsetWidth; num.style.animation = ""; this.audio.count(false); n--; setTimeout(step, 800); }
        else {
          num.textContent = "MOVE OUT!"; this.audio.count(true);
          setTimeout(() => {
            cd.classList.add("hidden"); this.state = "playing";
            if (!this.isMobile()) this.canvas.requestPointerLock();
          }, 650);
        }
      };
      step();
    }

    togglePause() {
      if (this.state === "playing") { this.state = "paused"; el("pauseScreen").classList.remove("hidden"); if (document.pointerLockElement) document.exitPointerLock(); }
      else if (this.state === "paused") { el("pauseScreen").classList.add("hidden"); this.state = "playing"; if (!this.isMobile()) this.canvas.requestPointerLock(); }
    }

    restart() { if (this.state === "menu") return; el("pauseScreen").classList.add("hidden"); el("overScreen").classList.add("hidden"); this.beginRun(); }

    toMenu() {
      this.state = "menu";
      if (document.pointerLockElement) document.exitPointerLock();
      el("pauseScreen").classList.add("hidden"); el("overScreen").classList.add("hidden");
      el("hud").classList.add("hidden"); el("lowHealthFx").classList.remove("on");
      this.showScreen("menuScreen"); this.showScores();
    }

    gameOver(result) {
      this.state = "over";
      if (document.pointerLockElement) document.exitPointerLock();
      if (result === "win") this.audio.victory(); else this.audio.defeat();
      const record = this.scores.submit(this.kills);
      const losses = this.squad.members.filter((m) => !m.alive).length;
      const mm = Math.floor(this.missionTime / 60), ss = Math.floor(this.missionTime % 60);
      el("finalKills").textContent = this.kills;
      el("finalTime").textContent = mm + ":" + String(ss).padStart(2, "0");
      el("finalLosses").textContent = losses;
      el("finalBest").textContent = this.scores.data.bestKills;
      el("newHigh").classList.toggle("hidden", !record);
      el("overTitle").textContent = result === "win" ? "SECTOR CLEARED" : "SQUAD DOWN";
      el("overScreen").classList.remove("hidden");
      this.showScores();
    }

    // ---------- HUD ----------
    updateHUD() {
      el("healthFill").style.width = clamp(this.player.health, 0, 100) + "%";
      const a = this.player.ammo[this.player.weaponKey];
      el("ammoVal").textContent = this.player.reloading ? "RELOADING…" : `${a.mag} / ${a.reserve}`;
      el("weaponVal").textContent = this.player.weapon.name;
      el("enemyCountVal").textContent = this.enemyMgr.aliveCount();
      el("lowHealthFx").classList.toggle("on", this.player.health < 30);

      const rows = document.querySelectorAll(".squad-row");
      this.squad.members.forEach((m, i) => {
        const row = rows[i]; if (!row) return;
        row.classList.toggle("down", !m.alive);
        row.querySelector(".squad-bar-fill").style.width = clamp((m.health / m.maxHealth) * 100, 0, 100) + "%";
        row.querySelector(".squad-state").textContent = !m.alive ? "DOWN" : m.state === "follow" ? "Following" : m.state === "hold" ? "Holding" : "Fire at Will";
      });
    }

    drawMinimap() {
      const ctx = this.minimapCtx, size = this.minimapCanvas.width;
      const range = 55; // world units shown radius
      const scale = (size / 2) / range;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = "#0c1708"; ctx.fillRect(0, 0, size, size);
      const px = this.player.pos.x, pz = this.player.pos.z;
      const toMap = (x, z) => [size / 2 + (x - px) * scale, size / 2 + (z - pz) * scale];

      // buildings (faint)
      ctx.fillStyle = "rgba(143,209,63,0.18)";
      for (const c of this.world.colliders) {
        if (c.h < 4) continue;
        const [mx, mz] = toMap(c.x, c.z);
        if (mx < -10 || mx > size + 10 || mz < -10 || mz > size + 10) continue;
        ctx.fillRect(mx - c.hw * scale, mz - c.hd * scale, c.hw * 2 * scale, c.hd * 2 * scale);
      }

      // teammates (green dots)
      ctx.fillStyle = "#4dffb0";
      for (const m of this.squad.members) {
        if (!m.alive) continue;
        const [mx, mz] = toMap(m.pos.x, m.pos.z);
        ctx.beginPath(); ctx.arc(mx, mz, 3, 0, Math.PI * 2); ctx.fill();
      }

      // spotted enemies (red dots)
      ctx.fillStyle = "#ff3b3b";
      for (const e of this.enemyMgr.list) {
        if (!e.alive) continue;
        if (e.state === "patrol") continue; // only reveal spotted hostiles
        const [mx, mz] = toMap(e.pos.x, e.pos.z);
        ctx.beginPath(); ctx.arc(mx, mz, 3, 0, Math.PI * 2); ctx.fill();
      }

      // player (blue triangle pointing in facing direction)
      const [cx, cz] = toMap(px, pz);
      ctx.save();
      ctx.translate(cx, cz);
      ctx.rotate(this.player.yaw);
      ctx.fillStyle = "#4da6ff";
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
      ctx.restore();

      ctx.strokeStyle = "rgba(143,209,63,0.4)"; ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    }

    triggerHitmarker() {
      const hm = el("hitmarker"); hm.classList.remove("on"); void hm.offsetWidth; hm.classList.add("on");
    }

    // ---------- main loop ----------
    loop(now) {
      let dt = (now - this.last) / 1000; this.last = now;
      if (dt > 0.05) dt = 0.05;
      if (this.state === "playing") this.step(dt);
      else if (this.state === "menu" || this.state === "countdown") this.idle(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(this.loop);
    }

    idle(dt) {
      this.fx.update(dt);
      const t = performance.now() * 0.00012;
      this.camera.position.set(Math.sin(t) * 70, 30, Math.cos(t) * 70);
      this.camera.lookAt(0, 4, 0);
    }

    step(dt) {
      const input = this.input;
      const moveState = { forward: input.state.forward, back: input.state.back, left: input.state.left, right: input.state.right, sprint: input.state.sprint };

      this.player.update(dt, moveState, this.camera);

      // firing
      const w = this.player.weapon;
      if (input.firing && this.player.canFire() && (w.auto || !this._firedOnce)) {
        const collidables = this.world.buildMeshes.concat(this.enemyMgr.collidableHitMeshes());
        const res = this.player.fire(this.camera, collidables, (enemy, dmg, point) => { enemy.takeDamage(dmg, this.player.pos); });
        if (res) {
          this.audio.shot(this.player.weaponKey === "rifle");
          if (res.didHitEnemy) { this.triggerHitmarker(); this.audio.hitmark(); }
          this._firedOnce = true;
        }
      }
      if (!input.firing) this._firedOnce = false;

      this.squad.update(dt, this.player, this.enemyMgr.list, this.fx);
      this.enemyMgr.update(dt, this.player, this.squad.members, this.fx);
      this.fx.update(dt);

      // track kills (any enemy death, by player or squad fire)
      const aliveNow = this.enemyMgr.aliveCount();
      if (aliveNow < this.prevAliveCount) this.kills += this.prevAliveCount - aliveNow;
      this.prevAliveCount = aliveNow;

      if (!this.player.alive) { this.gameOver("lose"); return; }
      if (this.enemyMgr.allDead()) { this.gameOver("win"); return; }

      this.missionTime += dt;
      this._minimapT -= dt;
      if (this._minimapT <= 0) { this._minimapT = 0.12; this.drawMinimap(); }
      this.updateHUD();
    }
  }

  // ============================================================
  //  BOOT
  // ============================================================
  window.addEventListener("DOMContentLoaded", () => {
    try { window._commandoSquad = new Game(); }
    catch (e) { console.error(e); el("loadMsg").textContent = "Error: " + e.message; }
  });
})();
