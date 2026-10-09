/* ============================================================
   CYBER RIDER 3D — main.js
   Audio, input, camera, scoring, state machine and the main
   render loop. Wires together Track, Hoverbike, HazardManager,
   CollectibleManager and ParticleSystem from the CR3D namespace.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const CR = window.CR3D || {};
  const { clamp, lerp, rand, el } = CR.util;

  if (!window.THREE) { el("loadMsg").textContent = "Failed to load 3D engine (Three.js)."; return; }

  // ============================================================
  //  AUDIO MANAGER  (synthesized — no external assets)
  // ============================================================
  class AudioManager {
    constructor() { this.ac = null; this.muted = false; this.engine = null; this.engineGain = null; }
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
    noise(d, vol = 0.3) {
      if (this.muted) return; const c = this.ensure(); if (!c) return;
      const n = (c.sampleRate * d) | 0, buf = c.createBuffer(1, n, c.sampleRate), dd = buf.getChannelData(0);
      for (let i = 0; i < n; i++) dd[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = c.createBufferSource(); s.buffer = buf;
      const g = c.createGain(); g.gain.value = vol;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
      s.connect(f); f.connect(g); g.connect(c.destination); s.start();
    }
    startEngine() {
      const c = this.ensure(); if (!c || this.engine) return;
      this.engine = c.createOscillator(); this.engineGain = c.createGain();
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 800;
      this.engine.type = "sawtooth"; this.engine.frequency.value = 70;
      this.engineGain.gain.value = this.muted ? 0 : 0.05;
      this.engine.connect(lp); lp.connect(this.engineGain); this.engineGain.connect(c.destination);
      this.engine.start();
    }
    stopEngine() { if (this.engine) { try { this.engine.stop(); } catch (e) {} this.engine = null; this.engineGain = null; } }
    setEngine(speed01, boost) {
      if (!this.engine || !this.ac) return;
      this.engine.frequency.setTargetAtTime(65 + speed01 * 180 + (boost ? 70 : 0), this.ac.currentTime, 0.08);
      this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.04 + speed01 * 0.03, this.ac.currentTime, 0.1);
    }
    pickup() { this.tone(1046, 0.08, "square", 0.12, 1568); }
    nitroSfx() { this.tone(220, 0.4, "sawtooth", 0.16, 760); this.noise(0.3, 0.12); }
    crash() { this.noise(0.4, 0.35); this.tone(90, 0.35, "sawtooth", 0.18, 40); }
    power() { this.tone(523, 0.09, "square", 0.13); setTimeout(() => this.tone(880, 0.12, "square", 0.13), 80); }
    click() { this.tone(440, 0.04, "square", 0.08); }
    count(hi) { this.tone(hi ? 880 : 440, hi ? 0.25 : 0.15, "square", 0.14); }
    over() { this.tone(400, 0.25, "square", 0.16, 120); setTimeout(() => this.tone(160, 0.5, "square", 0.16, 60), 200); }
    toggle() { this.muted = !this.muted; if (this.muted) this.stopEngine(); return this.muted; }
  }

  // ============================================================
  //  INPUT MANAGER  (keyboard + touch: hold left/right half to steer)
  // ============================================================
  class InputManager {
    constructor(game) {
      this.game = game;
      this.state = { left: false, right: false, nitro: false };
      this.bindKeys(); this.bindTouch();
    }
    bindKeys() {
      const map = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "nitro", KeyW: "nitro", Space: "nitro" };
      addEventListener("keydown", (e) => {
        this.game.audio.ensure();
        if (map[e.code]) { this.state[map[e.code]] = true; e.preventDefault(); }
        if (e.code === "KeyP") { e.preventDefault(); this.game.togglePause(); }
        if (e.code === "KeyR") { e.preventDefault(); this.game.restart(); }
      });
      addEventListener("keyup", (e) => { if (map[e.code]) { this.state[map[e.code]] = false; e.preventDefault(); } });
    }
    bindTouch() {
      document.querySelectorAll(".tbtn[data-act]").forEach((b) => {
        const act = b.dataset.act;
        const on = (e) => { e.preventDefault(); this.game.audio.ensure(); this.state[act] = true; b.classList.add("active"); };
        const off = (e) => { e.preventDefault(); this.state[act] = false; b.classList.remove("active"); };
        b.addEventListener("touchstart", on, { passive: false });
        b.addEventListener("touchend", off, { passive: false });
        b.addEventListener("touchcancel", off, { passive: false });
        b.addEventListener("mousedown", on); b.addEventListener("mouseup", off); b.addEventListener("mouseleave", off);
      });
      addEventListener("touchstart", () => document.body.classList.add("touch-mode"), { once: true });
      // steer by holding/dragging across the left or right half of the screen
      const cv = el("scene");
      const steer = (touches) => {
        let anyL = false, anyR = false;
        for (const t of touches) { if (t.clientX < innerWidth / 2) anyL = true; else anyR = true; }
        this.state.left = anyL && !anyR;
        this.state.right = anyR && !anyL;
      };
      cv.addEventListener("touchstart", (e) => { this.game.audio.ensure(); document.body.classList.add("touch-mode"); steer(e.touches); }, { passive: true });
      cv.addEventListener("touchmove", (e) => steer(e.touches), { passive: true });
      cv.addEventListener("touchend", (e) => steer(e.touches), { passive: true });
      cv.addEventListener("touchcancel", (e) => steer(e.touches), { passive: true });
      document.addEventListener("touchmove", (e) => { if (this.game.state === "playing") e.preventDefault(); }, { passive: false });
    }
  }

  // ============================================================
  //  CAMERA CONTROLLER  (third-person chase, tilt on turns)
  // ============================================================
  class CameraController {
    constructor(camera) { this.cam = camera; this.shake = 0; this.pull = 0; this._look = new THREE.Vector3(); }
    update(dt, bike, speed01, boosting) {
      const back = 7.4 + this.pull, height = 3.1 + this.pull * 0.35;
      const tx = bike.x * 0.55;
      this.cam.position.x = lerp(this.cam.position.x, tx, 0.12);
      this.cam.position.y = lerp(this.cam.position.y, height, 0.1);
      this.cam.position.z = lerp(this.cam.position.z, bike.group.position.z + back, 0.16);
      this.pull = lerp(this.pull, boosting ? 1.8 : 0, 0.1);
      if (this.shake > 0.01) {
        this.cam.position.x += rand(-this.shake, this.shake);
        this.cam.position.y += rand(-this.shake, this.shake);
        this.shake *= 0.86;
      }
      this._look.set(bike.x * 0.65, 1.0, bike.group.position.z - 10);
      this.cam.lookAt(this._look);
      this.cam.rotation.z += bike.vx * 0.012;
    }
    addShake(v) { this.shake = Math.min(this.shake + v, 0.9); }
    reset() { this.cam.position.set(0, 3.1, 9); this.shake = 0; this.pull = 0; }
  }

  // ============================================================
  //  SCORE MANAGER  (localStorage)
  // ============================================================
  class ScoreManager {
    constructor() { this.key = "cyberRider3dScores"; this.data = this.load(); }
    load() { try { return JSON.parse(localStorage.getItem(this.key)) || { score: 0, dist: 0, topSpeed: 0 }; } catch (e) { return { score: 0, dist: 0, topSpeed: 0 }; } }
    submit(score, dist, topSpeed) {
      let record = false;
      if (score > this.data.score) { record = true; this.data.score = score; }
      this.data.dist = Math.max(this.data.dist, dist);
      this.data.topSpeed = Math.max(this.data.topSpeed, topSpeed);
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
      this.quality = localStorage.getItem("cyberRider3dQuality") || "auto";
      this.audio = new AudioManager();
      this.scores = new ScoreManager();
      this.initThree();
      CR.initLib();
      this.buildWorld();
      this.input = new InputManager(this);
      this.bindUI();
      this.last = performance.now();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
      el("loadScreen").classList.add("hidden");
      this.showScores();
    }

    effectiveQuality() {
      if (this.quality !== "auto") return this.quality;
      const mobile = matchMedia("(hover: none) and (pointer: coarse)").matches || innerWidth < 700;
      return mobile ? "low" : "high";
    }

    initThree() {
      const q = this.effectiveQuality();
      this.canvas = el("scene");
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: q === "high", powerPreference: "high-performance" });
      const dpr = Math.min(window.devicePixelRatio || 1, q === "high" ? 2 : 1.25);
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(innerWidth, innerHeight);

      this.scene = new THREE.Scene();
      this.skyTop = new THREE.Color(0x0a0324);
      this.skyBot = new THREE.Color(0x2a0a4a);
      this.scene.background = new THREE.Color(0x120a2c);
      this.scene.fog = new THREE.FogExp2(0x160a30, 0.0032);

      this.camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.1, 1400);
      this.camera.position.set(0, 3.1, 9);

      this.ambient = new THREE.AmbientLight(0x8866ff, 0.55); this.scene.add(this.ambient);
      this.hemi = new THREE.HemisphereLight(0x5533aa, 0x0a0618, 0.6); this.scene.add(this.hemi);
      this.sunLight = new THREE.DirectionalLight(0xff66cc, 0.7);
      this.sunLight.position.set(-20, 40, -60);
      this.scene.add(this.sunLight);

      addEventListener("resize", () => this.onResize());
    }

    onResize() {
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    }

    buildWorld() {
      const q = this.effectiveQuality();
      this.track = new CR.Track(this.scene);
      this.bike = new CR.Hoverbike(this.scene);
      this.bike.attachTrail(this.scene);
      this.hazards = new CR.HazardManager(this.scene, q);
      this.collectibles = new CR.CollectibleManager(this.scene);
      this.particles = new CR.ParticleSystem(this.scene);
      this.cameraCtl = new CameraController(this.camera);
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

    showScreen(id) {
      ["menuScreen", "scoresScreen", "helpScreen"].forEach((s) => el(s).classList.toggle("hidden", s !== id));
    }

    showScores() {
      const b = this.scores.data;
      el("scoresList").innerHTML = `
        <div class="row"><span>Best Score</span><b>${b.score.toLocaleString()}</b></div>
        <div class="row"><span>Best Distance</span><b>${b.dist.toFixed(1)} km</b></div>
        <div class="row"><span>Top Speed</span><b>${Math.round(b.topSpeed)} km/h</b></div>`;
    }

    // ---------- game flow ----------
    resetRun() {
      this.score = 0; this.dist = 0; this.level = 1; this.lives = 3;
      this.speed = 36; this.baseSpeed = 36; this.maxSpeed = 128; this.topSpeedSeen = 0;
      this.nitro = 100; this.nitroActive = false; this.invuln = 0; this.slow = 0;
      this.bike.reset(); this.hazards.reset(); this.collectibles.reset(); this.particles.reset(); this.cameraCtl.reset();
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
        else { num.textContent = "GO!"; this.audio.count(true); setTimeout(() => { cd.classList.add("hidden"); this.state = "playing"; this.audio.startEngine(); }, 600); }
      };
      step();
    }

    togglePause() {
      if (this.state === "playing") { this.state = "paused"; el("pauseScreen").classList.remove("hidden"); this.audio.stopEngine(); }
      else if (this.state === "paused") { el("pauseScreen").classList.add("hidden"); this.state = "playing"; this.audio.startEngine(); }
    }

    restart() {
      if (this.state === "menu") return;
      el("pauseScreen").classList.add("hidden"); el("overScreen").classList.add("hidden");
      this.beginRun();
    }

    toMenu() {
      this.state = "menu"; this.audio.stopEngine();
      el("pauseScreen").classList.add("hidden"); el("overScreen").classList.add("hidden");
      el("hud").classList.add("hidden");
      this.showScreen("menuScreen"); this.showScores();
    }

    gameOver() {
      this.state = "over"; this.audio.stopEngine(); this.audio.over();
      const record = this.scores.submit(Math.floor(this.score), this.dist, this.topSpeedSeen);
      el("finalScore").textContent = Math.floor(this.score).toLocaleString();
      el("finalDist").textContent = this.dist.toFixed(1) + " KM";
      el("finalBest").textContent = this.scores.data.score.toLocaleString();
      el("finalSpeed").textContent = Math.round(this.topSpeedSeen) + " KM/H";
      el("newHigh").classList.toggle("hidden", !record);
      el("overScreen").classList.remove("hidden");
      this.showScores();
    }

    // ---------- collisions ----------
    checkCollisions() {
      if (this.invuln > 0) return;
      for (const g of this.hazards.active) {
        if (CR.hitsHazard(this.bike, g)) { this.onCrash(g); return; }
      }
    }

    onCrash(g) {
      this.lives--; this.invuln = 1.4; this.slow = 0.9; this.nitro = Math.max(0, this.nitro - 30);
      this.speed = Math.max(this.baseSpeed * 0.5, this.speed * 0.4);
      this.particles.emit(this.bike.x, 1.0, this.bike.group.position.z, 30, 0xff3b5c, 11, 0.7);
      this.particles.emit(g.position.x, 1.0, g.position.z, 20, 0xffe14d, 9, 0.6);
      this.audio.crash(); this.cameraCtl.addShake(0.75);
      el("hitFlash").classList.remove("on"); void el("hitFlash").offsetWidth; el("hitFlash").classList.add("on");
      g.position.z += 8; // knock the hazard back so it doesn't double-hit
      this.updateHUD();
      if (this.lives <= 0) this.gameOver();
    }

    onPickup(kind, pos) {
      if (kind === "orb") { this.score += 35; this.nitro = Math.min(100, this.nitro + 6); this.audio.pickup(); this.particles.emit(pos.x, pos.y, pos.z, 10, 0x00fff0, 6, 0.4); }
      else { this.nitro = 100; this.audio.power(); this.particles.emit(pos.x, pos.y, pos.z, 14, 0xffe14d, 7, 0.5); }
      this.updateHUD();
    }

    // ---------- HUD ----------
    updateHUD() {
      el("scoreVal").textContent = Math.floor(this.score).toLocaleString();
      el("bestVal").textContent = this.scores.data.score.toLocaleString();
      el("distVal").innerHTML = this.dist.toFixed(1) + " <small>KM</small>";
      el("livesVal").textContent = "❤".repeat(Math.max(0, this.lives));
      el("speedVal").textContent = Math.round(this.speed * 3.1 * (this.nitroActive ? 1.6 : 1));
      el("boostFill").style.width = this.nitro + "%";
    }

    // ---------- main loop ----------
    loop(now) {
      let dt = (now - this.last) / 1000; this.last = now;
      if (dt > 0.05) dt = 0.05;
      if (this.state === "playing") this.step(dt);
      else if (this.state === "menu" || this.state === "countdown") this.idleScroll(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(this.loop);
    }

    idleScroll(dt) {
      const dz = 26 * dt;
      this.track.update(dz, 0.3);
      this.collectibles.update(dt, dz, () => {}, this.bike);
      this.hazards.update(dt, dz, 1);
      this.cameraCtl.update(dt, this.bike, 0.3, false);
      this.bike.update(dt, { left: false, right: false }, 0.3, false);
    }

    step(dt) {
      const input = this.input.state;

      const target = clamp(this.baseSpeed + this.level * 3.2, 22, this.maxSpeed);
      this.speed = lerp(this.speed, target, 0.015);
      if (this.slow > 0) { this.slow -= dt; this.speed *= 0.985; }

      // nitro boost
      this.nitroActive = false;
      if (input.nitro && this.nitro > 1) {
        this.nitroActive = true; this.nitro = Math.max(0, this.nitro - 32 * dt);
        if (!this._nitroSfxT || performance.now() - this._nitroSfxT > 500) { this.audio.nitroSfx(); this._nitroSfxT = performance.now(); }
        this.cameraCtl.addShake(0.035);
      } else {
        this.nitro = Math.min(100, this.nitro + 5 * dt);
      }
      el("speedlines").classList.toggle("on", this.nitroActive);

      const effSpeed = this.speed * (this.nitroActive ? 1.6 : 1);
      const dz = effSpeed * dt;
      this.topSpeedSeen = Math.max(this.topSpeedSeen, effSpeed * 3.1);

      this.dist += (dz / 1000) * 3.4;
      this.score += dz * 0.55;

      const newLevel = 1 + Math.floor(this.dist / 1.0);
      if (newLevel !== this.level) this.level = newLevel;

      this.track.update(dz, effSpeed / this.maxSpeed);
      this.hazards.update(dt, dz, this.level);
      this.collectibles.update(dt, dz, (k, p) => this.onPickup(k, p), this.bike);
      this.particles.update(dt);

      this.bike.update(dt, input, effSpeed / this.maxSpeed, this.nitroActive);
      this.cameraCtl.update(dt, this.bike, effSpeed / this.maxSpeed, this.nitroActive);

      this.invuln = Math.max(0, this.invuln - dt);
      this.bike.group.visible = !(this.invuln > 0 && (Math.floor(this.invuln * 12) % 2 === 0));

      this.checkCollisions();
      if (this.state !== "playing") return;

      this.audio.setEngine(effSpeed / this.maxSpeed, this.nitroActive);
      this.updateHUD();
    }
  }

  // ============================================================
  //  BOOT
  // ============================================================
  window.addEventListener("DOMContentLoaded", () => {
    try { window._cyberRider = new Game(); }
    catch (e) { console.error(e); el("loadMsg").textContent = "Error: " + e.message; }
  });
})();
