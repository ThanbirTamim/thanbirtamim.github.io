/* ============================================================
   GRAPPLE MECH 3D — main.js
   Audio, pointer-lock mouse-look + keyboard/touch input, the
   crosshair-accurate chase camera, shared hitscan weapon
   resolution (player & AI fire through the same code path),
   grapple melee resolution, HUD (radar/leaderboard/status/kill
   feed), the match state machine and the main render loop.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const GM = window.GM3D || {};
  const { clamp, lerp, rand, randi, pick, el, dist2D } = GM.util;

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
    plasma() { this.tone(900, 0.06, "sawtooth", 0.1, 260); }
    rail(charge) { this.noise(0.3, 0.3, 500); this.tone(160, 0.3, "sawtooth", 0.18 * clamp(charge, 0.3, 1), 50); }
    grapple() { this.tone(500, 0.08, "triangle", 0.12, 1100); }
    melee() { this.noise(0.1, 0.25, 300); this.tone(120, 0.1, "square", 0.14, 60); }
    hit() { this.tone(300, 0.07, "square", 0.1); }
    explosion() { this.noise(0.6, 0.35, 220); this.tone(80, 0.5, "sawtooth", 0.18, 30); }
    boost() { this.tone(220, 0.15, "sawtooth", 0.12, 440); }
    click() { this.tone(440, 0.04, "square", 0.08); }
    count(hi) { this.tone(hi ? 880 : 440, hi ? 0.25 : 0.15, "square", 0.14); }
    victory() { this.tone(523, 0.12, "square", 0.15); setTimeout(() => this.tone(659, 0.12, "square", 0.15), 130); setTimeout(() => this.tone(784, 0.22, "square", 0.16), 260); }
    defeat() { this.tone(300, 0.3, "sawtooth", 0.16, 100); setTimeout(() => this.tone(150, 0.5, "sawtooth", 0.16, 60), 250); }
    toggle() { this.muted = !this.muted; return this.muted; }
  }

  // ============================================================
  //  SCORE MANAGER
  // ============================================================
  class ScoreManager {
    constructor() { this.key = "grappleMech3dRecords"; this.data = this.load(); }
    load() { try { return JSON.parse(localStorage.getItem(this.key)) || { bestKills: 0, wins: 0, matches: 0 }; } catch (e) { return { bestKills: 0, wins: 0, matches: 0 }; } }
    submit(kills, won) {
      let record = false;
      if (kills > this.data.bestKills) { record = true; this.data.bestKills = kills; }
      if (won) this.data.wins = (this.data.wins || 0) + 1;
      this.data.matches = (this.data.matches || 0) + 1;
      try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
      return record;
    }
  }

  // ============================================================
  //  INPUT MANAGER
  // ============================================================
  class InputManager {
    constructor(game) {
      this.game = game;
      this.move = { forward: 0, strafe: 0 };
      this.boost = false;
      this.plasmaHeld = false;
      this.railHeld = false;
      this.keys = {};
      this.bindKeys(); this.bindMouse(); this.bindTouch();
    }
    bindKeys() {
      addEventListener("keydown", (e) => {
        this.game.audio.ensure();
        this.keys[e.code] = true;
        this.updateMove();
        if (e.code === "Space") { this.boost = true; e.preventDefault(); }
        if (e.code === "KeyQ") this.game.triggerHook("left");
        if (e.code === "KeyE") this.game.triggerHook("right");
        if (e.code === "KeyF") this.plasmaHeld = true;
        if (e.code === "KeyR") this.railHeld = true;
        if (e.code === "Escape" || e.code === "KeyP") this.game.togglePause();
        if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      });
      addEventListener("keyup", (e) => {
        this.keys[e.code] = false;
        this.updateMove();
        if (e.code === "Space") this.boost = false;
        if (e.code === "KeyF") this.plasmaHeld = false;
        if (e.code === "KeyR") this.railHeld = false;
      });
    }
    updateMove() {
      const f = (this.keys["KeyW"] || this.keys["ArrowUp"] ? 1 : 0) - (this.keys["KeyS"] || this.keys["ArrowDown"] ? 1 : 0);
      const s = (this.keys["KeyD"] || this.keys["ArrowRight"] ? 1 : 0) - (this.keys["KeyA"] || this.keys["ArrowLeft"] ? 1 : 0);
      this.move.forward = f; this.move.strafe = s;
    }
    bindMouse() {
      const cv = el("scene");
      cv.addEventListener("mousedown", (e) => {
        this.game.audio.ensure();
        if (this.game.state === "playing" && document.pointerLockElement !== cv && !this.game.isMobile()) cv.requestPointerLock();
        if (e.button === 0) this.game.triggerHook("left");
        if (e.button === 2) this.game.triggerHook("right");
      });
      addEventListener("mousemove", (e) => {
        if (document.pointerLockElement === cv) this.game.onLook(e.movementX || 0, e.movementY || 0);
      });
      cv.addEventListener("contextmenu", (e) => e.preventDefault());
      document.addEventListener("pointerlockchange", () => {
        if (document.pointerLockElement !== cv && this.game.state === "playing") this.game.togglePause();
      });
    }
    bindTouch() {
      document.querySelectorAll(".tbtn[data-act]").forEach((b) => {
        const act = b.dataset.act;
        const on = (e) => {
          e.preventDefault(); this.game.audio.ensure(); document.body.classList.add("touch-mode"); b.classList.add("active");
          if (act === "hookL") this.game.triggerHook("left");
          else if (act === "hookR") this.game.triggerHook("right");
          else if (act === "boost") this.boost = true;
          else if (act === "plasma") this.plasmaHeld = true;
          else if (act === "railgun") this.railHeld = true;
        };
        const off = (e) => {
          e.preventDefault(); b.classList.remove("active");
          if (act === "boost") this.boost = false;
          else if (act === "plasma") this.plasmaHeld = false;
          else if (act === "railgun") this.railHeld = false;
        };
        b.addEventListener("touchstart", on, { passive: false });
        b.addEventListener("touchend", off, { passive: false });
        b.addEventListener("touchcancel", off, { passive: false });
        b.addEventListener("mousedown", on); b.addEventListener("mouseup", off); b.addEventListener("mouseleave", off);
      });
      // virtual joystick (movement)
      const base = el("touchStick").querySelector(".stick-base");
      const knob = el("stickKnob");
      let activeId = null; const radius = 44;
      const setKnob = (dx, dy) => { knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; };
      const start = (id, cx, cy) => { activeId = id; this._ox = cx; this._oy = cy; knob.classList.add("active"); document.body.classList.add("touch-mode"); this.game.audio.ensure(); };
      const move = (cx, cy) => {
        let dx = cx - this._ox, dy = cy - this._oy; const d = Math.hypot(dx, dy);
        if (d > radius) { dx = (dx / d) * radius; dy = (dy / d) * radius; }
        setKnob(dx, dy);
        this.move.forward = clamp(-dy / radius, -1, 1);
        this.move.strafe = clamp(dx / radius, -1, 1);
      };
      const end = () => { activeId = null; setKnob(0, 0); knob.classList.remove("active"); this.move.forward = 0; this.move.strafe = 0; };
      base.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; start(t.identifier, t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
      base.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) if (t.identifier === activeId) move(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
      base.addEventListener("touchend", (e) => { for (const t of e.changedTouches) if (t.identifier === activeId) end(); }, { passive: false });
      base.addEventListener("touchcancel", () => end());

      // touch-look (drag to rotate / aim)
      const lookZone = el("touchLook");
      let lookId = null, lastX = 0, lastY = 0;
      lookZone.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; lookId = t.identifier; lastX = t.clientX; lastY = t.clientY; document.body.classList.add("touch-mode"); }, { passive: true });
      lookZone.addEventListener("touchmove", (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== lookId) continue;
          this.game.onLook((t.clientX - lastX) * 2.0, (t.clientY - lastY) * 2.0);
          lastX = t.clientX; lastY = t.clientY;
        }
      }, { passive: true });
      lookZone.addEventListener("touchend", (e) => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; }, { passive: true });
    }
  }

  // ============================================================
  //  GAME  (orchestrator + match state machine + loop)
  // ============================================================
  const SPAWN_POINTS = [
    new THREE.Vector3(16, 0, 0), new THREE.Vector3(-16, 0, 0),
    new THREE.Vector3(0, 0, 16), new THREE.Vector3(0, 0, -16),
  ];

  class Game {
    constructor() {
      this.state = "menu"; // menu | countdown | playing | paused | over
      this.audio = new AudioManager();
      this.scores = new ScoreManager();
      this.initThree();
      GM.initTextures("textures/");
      GM.initLib();
      this.buildWorld();
      this.input = new InputManager(this);
      this.bindUI();
      this.pendingRespawns = []; // { mech, t } — dt-driven so pause can't desync it
      this.killFeedItems = [];   // { el, t }
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
      this.scene.background = new THREE.Color(0x090b14);
      this.scene.fog = new THREE.Fog(0x090b14, 60, 220);

      this.camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.1, 500);
      this.camera.position.set(16, 6, 10);

      this.ambient = new THREE.AmbientLight(0x6688aa, 0.6); this.scene.add(this.ambient);
      this.hemi = new THREE.HemisphereLight(0x3a4f6a, 0x1a0a04, 0.55); this.scene.add(this.hemi);
      this.sun = new THREE.DirectionalLight(0xcfe8ff, 0.9);
      this.sun.position.set(-30, 60, 20);
      this.scene.add(this.sun);

      addEventListener("resize", () => this.onResize());
    }

    onResize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); }

    buildWorld() {
      this.arena = new GM.Arena(this.scene);
      this.fx = new GM.FxManager(this.scene);

      this.player = new GM.Mech(this.scene, { id: "player", name: "YOU", isPlayer: true, color: 0x35d2ff, spawn: SPAWN_POINTS[0], yaw: Math.PI, maxArmor: 100, maxShield: 55 });
      this.aiRival = new GM.AIMech(this.scene, { aiType: "rival", id: "rival", name: "Rival", color: 0xff8a3d, spawn: SPAWN_POINTS[1], yaw: 0, maxArmor: 95, maxShield: 50 });
      this.aiHeavy = new GM.AIMech(this.scene, { aiType: "heavy", id: "heavy", name: "Brawler", color: 0xff3b5c, spawn: SPAWN_POINTS[2], yaw: Math.PI / 2, maxArmor: 150, maxShield: 70 });
      this.aiSniper = new GM.AIMech(this.scene, { aiType: "sniper", id: "sniper", name: "Sniper", color: 0xc767ff, spawn: SPAWN_POINTS[3], yaw: -Math.PI / 2, maxArmor: 80, maxShield: 40 });
      this.aiList = [this.aiRival, this.aiHeavy, this.aiSniper];
      this.allMechs = [this.player, this.aiRival.mech, this.aiHeavy.mech, this.aiSniper.mech];

      this.radarCanvas = el("radar"); this.radarCtx = this.radarCanvas.getContext("2d");
      this._radarT = 0;
      this.camLook = new THREE.Vector3();
    }

    // ---------- look ----------
    onLook(dx, dy) {
      if (this.state !== "playing") return;
      const sens = 0.0022;
      this.player.yaw -= dx * sens;
      this.player.pitch = clamp(this.player.pitch - dy * sens, -0.85, 0.75);
    }

    // ---------- grapple trigger (toggle fire/release) ----------
    triggerHook(side) {
      if (this.state !== "playing" || !this.player.alive) return;
      const hook = side === "left" ? this.player.hookLeft : this.player.hookRight;
      if (hook.state === "idle") {
        const origin = this.player.handWorldPos(side);
        const hit = hook.tryFire(origin, this.player.aimDir(), this.arena, this.allMechs);
        if (hit) this.audio.grapple();
      } else {
        hook.release();
      }
    }

    // ---------- UI ----------
    bindUI() {
      el("playBtn").addEventListener("click", () => { this.audio.ensure(); this.audio.click(); this.beginMatch(); });
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
        <div class="row"><span>Best Kills (1 match)</span><b>${b.bestKills}</b></div>
        <div class="row"><span>Duels Won</span><b>${b.wins || 0} / ${b.matches || 0}</b></div>`;
    }

    // ---------- match flow ----------
    beginMatch() {
      this.showScreen("menuScreen"); el("menuScreen").classList.add("hidden");
      this.pendingRespawns.length = 0;
      this.killFeedItems.forEach((k) => k.el.remove()); this.killFeedItems.length = 0;
      el("killfeed").innerHTML = "";

      const pts = SPAWN_POINTS.slice();
      this.player.respawn(pts[0]);
      this.player.kills = 0; this.player.deaths = 0;
      this.player.yaw = Math.PI; this.player.pitch = 0;
      let i = 1;
      for (const ai of this.aiList) { ai.mech.respawn(pts[i]); ai.mech.kills = 0; ai.mech.deaths = 0; ai.target = null; i++; }

      this.arena.safeRadius = this.arena.maxRadius;
      this.arena.displayRadius = this.arena.maxRadius;
      this.arena.stormT = rand(24, 32);
      this.arena.stormWarning = false;
      el("stormBanner").classList.add("hidden");

      el("hud").classList.remove("hidden");
      if (this.isMobile()) el("touch").classList.remove("hidden");
      this.updateLeaderboard();
      this.updateHUD();
      this.startCountdown();
    }

    startCountdown() {
      this.state = "countdown";
      const cd = el("countdown"), num = el("countNum");
      cd.classList.remove("hidden");
      let n = 3;
      const step = () => {
        if (n > 0) { num.textContent = n; num.style.animation = "none"; void num.offsetWidth; num.style.animation = ""; this.audio.count(false); n--; setTimeout(step, 700); }
        else {
          num.textContent = "ENGAGE!"; this.audio.count(true);
          setTimeout(() => { cd.classList.add("hidden"); this.state = "playing"; if (!this.isMobile()) this.canvas.requestPointerLock(); }, 550);
        }
      };
      step();
    }

    togglePause() {
      if (this.state === "playing") { this.state = "paused"; el("pauseScreen").classList.remove("hidden"); if (document.pointerLockElement) document.exitPointerLock(); }
      else if (this.state === "paused") { el("pauseScreen").classList.add("hidden"); this.state = "playing"; if (!this.isMobile()) this.canvas.requestPointerLock(); }
    }

    restart() { el("pauseScreen").classList.add("hidden"); el("overScreen").classList.add("hidden"); this.beginMatch(); }

    toMenu() {
      this.state = "menu";
      if (document.pointerLockElement) document.exitPointerLock();
      el("pauseScreen").classList.add("hidden"); el("overScreen").classList.add("hidden");
      el("hud").classList.add("hidden"); el("touch").classList.add("hidden"); el("lowHealthFx").classList.remove("on"); el("heatWarnFx").classList.remove("on");
      this.showScreen("menuScreen"); this.showScores();
    }

    endMatch(winnerMech) {
      this.state = "over";
      if (document.pointerLockElement) document.exitPointerLock();
      const playerWon = winnerMech === this.player;
      if (playerWon) this.audio.victory(); else this.audio.defeat();
      const record = this.scores.submit(this.player.kills, playerWon);
      el("finalKills").textContent = this.player.kills;
      el("finalDeaths").textContent = this.player.deaths;
      el("finalWinner").textContent = winnerMech.name;
      el("finalBest").textContent = this.scores.data.bestKills;
      el("newHigh").classList.toggle("hidden", !record);
      el("overTitle").textContent = playerWon ? "VICTORY!" : "DEFEATED";
      el("overScreen").classList.remove("hidden");
      this.showScores();
    }

    // ---------- combat resolution (shared by player + AI) ----------
    fireWeapon(shooter, weaponKey, chargeFrac) {
      if (!shooter.alive || shooter.fireCooldown > 0) return false;
      const w = GM.WEAPONS[weaponKey];
      const origin = shooter.eyePos();
      const dir = GM.applySpread(shooter.aimDir(), w.spread);
      const collidables = this.arena.wallMeshes.slice();
      for (const mech of this.allMechs) { if (mech !== shooter && mech.alive) collidables.push(...mech.hitMeshes()); }
      const hit = GM.hitscan(origin, dir, w.range, collidables);
      let hitPoint = origin.clone().addScaledVector(dir, w.range);
      const dmg = weaponKey === "plasma" ? w.damage : lerp(w.minDamage, w.maxDamage, clamp(chargeFrac || 1, 0, 1));
      if (hit) {
        hitPoint = hit.point;
        const victim = hit.object.userData && hit.object.userData.mechRef;
        if (victim) this.applyHit(shooter, victim, dmg * (hit.object.userData.headshot ? 1.6 : 1), hit.point);
        else this.fx.sparks(hit.point);
      }
      this.fx.weaponFx(origin, hitPoint, weaponKey, shooter.isPlayer ? this.camera.quaternion : null);
      shooter.fireCooldown = weaponKey === "plasma" ? w.fireRate : w.cooldown;
      if (weaponKey === "plasma") this.audio.plasma(); else this.audio.rail(chargeFrac || 1);
      return true;
    }

    applyHit(attacker, victim, dmg, hitPoint) {
      if (!victim.alive) return;
      const result = victim.applyDamage(dmg);
      if (victim.isPlayer) { this.audio.hit(); if (!result.shieldHit) this.fx.flash("hit"); }
      if (result.shieldHit) this.fx.shieldHit(hitPoint); else this.fx.armorHit(hitPoint);
      if (result.died) this.onMechDeath(attacker, victim);
    }

    onMechDeath(attacker, victim) {
      this.fx.explosion(victim.pos.clone().add(new THREE.Vector3(0, 1.4, 0)));
      this.audio.explosion();
      if (attacker && attacker !== victim && attacker.alive) attacker.kills++;
      this.addKillFeed((attacker ? attacker.name : "The Void") + "  ⚔  " + victim.name);
      this.updateLeaderboard();
      this.pendingRespawns.push({ mech: victim, t: 2.6 });
      if (attacker && attacker.kills >= GM.KILL_TARGET) this.endMatch(attacker);
    }

    addKillFeed(text) {
      const row = document.createElement("div");
      row.className = "kf-row"; row.textContent = text;
      el("killfeed").appendChild(row);
      this.killFeedItems.push({ el: row, t: 4.2 });
    }

    randomSpawnAwayFromOthers() {
      let best = SPAWN_POINTS[0], bestScore = -Infinity;
      for (const p of SPAWN_POINTS) {
        let minD = Infinity;
        for (const m of this.allMechs) { if (!m.alive) continue; const d = dist2D(p.x, p.z, m.pos.x, m.pos.z); if (d < minD) minD = d; }
        if (minD > bestScore) { bestScore = minD; best = p; }
      }
      return best;
    }

    // ---------- HUD ----------
    updateHUD() {
      el("shieldFill").style.width = clamp((this.player.shield / this.player.maxShield) * 100, 0, 100) + "%";
      el("armorFill").style.width = clamp((this.player.armor / this.player.maxArmor) * 100, 0, 100) + "%";
      el("heatFill").style.width = clamp((this.player.heat / this.player.maxHeat) * 100, 0, 100) + "%";
      el("hookLeftFill").style.width = Math.round((1 - this.player.hookLeft.cooldownFrac()) * 100) + "%";
      el("hookRightFill").style.width = Math.round((1 - this.player.hookRight.cooldownFrac()) * 100) + "%";
      const w = GM.WEAPONS[this.player.weaponKey];
      el("weaponVal").textContent = w.name;
      const wfrac = this.player.weaponKey === "railgun" ? this.player.railCharge : clamp(1 - this.player.fireCooldown / w.fireRate, 0, 1);
      el("weaponFill").style.width = Math.round(wfrac * 100) + "%";
      el("lowHealthFx").classList.toggle("on", this.player.armor < 28);
      el("heatWarnFx").classList.toggle("on", this.player.overheated);
    }

    updateLeaderboard() {
      const entries = [
        { id: "player", mech: this.player }, { id: "rival", mech: this.aiRival.mech },
        { id: "heavy", mech: this.aiHeavy.mech }, { id: "sniper", mech: this.aiSniper.mech },
      ];
      const topKills = Math.max(...entries.map((e) => e.mech.kills));
      for (const e of entries) {
        const row = document.querySelector(`.lb-row[data-id="${e.id}"]`);
        if (!row) continue;
        row.querySelector(".lb-kd").textContent = e.mech.kills + " / " + e.mech.deaths;
        row.classList.toggle("leader", e.mech.kills === topKills && topKills > 0);
      }
    }

    drawRadar() {
      const ctx = this.radarCtx, size = this.radarCanvas.width, c = size / 2;
      const scale = (c - 8) / this.arena.maxRadius;
      ctx.clearRect(0, 0, size, size);
      ctx.beginPath(); ctx.arc(c, c, c - 2, 0, Math.PI * 2); ctx.fillStyle = "#070c16"; ctx.fill();
      // safe zone
      ctx.beginPath(); ctx.arc(c, c, this.arena.displayRadius * scale, 0, Math.PI * 2);
      ctx.strokeStyle = this.arena.stormWarning ? "rgba(255,92,61,0.7)" : "rgba(53,210,255,0.4)"; ctx.lineWidth = 2; ctx.stroke();
      // anchors
      ctx.fillStyle = "rgba(53,210,255,0.55)";
      for (const a of this.arena.anchors) {
        const rx = c + a.x * scale, rz = c + a.z * scale;
        ctx.beginPath(); ctx.arc(rx, rz, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      // AI mechs
      for (const ai of this.aiList) {
        if (!ai.mech.alive) continue;
        ctx.fillStyle = "#" + ai.mech.color.toString(16).padStart(6, "0");
        const rx = c + ai.mech.pos.x * scale, rz = c + ai.mech.pos.z * scale;
        ctx.beginPath(); ctx.arc(rx, rz, 3, 0, Math.PI * 2); ctx.fill();
      }
      // player triangle
      if (this.player.alive) {
        const rx = c + this.player.pos.x * scale, rz = c + this.player.pos.z * scale;
        ctx.save(); ctx.translate(rx, rz); ctx.rotate(this.player.yaw);
        ctx.fillStyle = "#35d2ff";
        ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(-3.5, 4); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = "rgba(53,210,255,0.4)"; ctx.beginPath(); ctx.arc(c, c, c - 2, 0, Math.PI * 2); ctx.stroke();
    }

    // ---------- camera (crosshair-accurate chase) ----------
    updateCamera(dt) {
      const m = this.player;
      const dir = m.aimDir();
      const pivot = m.pos.clone().add(new THREE.Vector3(0, 2.1, 0));
      const camDist = 6.4, camHeight = 1.1;
      const desired = pivot.clone().addScaledVector(dir, -camDist).add(new THREE.Vector3(0, camHeight, 0));
      const t = 1 - Math.exp(-9 * dt);
      this.camera.position.lerp(desired, t);
      this.camLook.lerp(pivot.clone().addScaledVector(dir, 40), 1 - Math.exp(-10 * dt));
      this.camera.lookAt(this.camLook);
      const shake = this.fx.shake.sample();
      this.camera.position.x += shake.x; this.camera.position.y += shake.y;
      this.camera.rotation.z += shake.roll;
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
      const t = performance.now() * 0.00009;
      this.camera.position.set(Math.sin(t) * 40, 22, Math.cos(t) * 40);
      this.camera.lookAt(0, 4, 0);
    }

    step(dt) {
      const input = this.input;

      // ---- player ----
      if (this.player.alive) {
        if (input.plasmaHeld) this.fireWeapon(this.player, "plasma", 1);
        if (input.railHeld) {
          if (!this.player.railCharging) { this.player.railCharging = true; this.player.railCharge = 0; }
          this.player.railCharge = Math.min(1, this.player.railCharge + dt / GM.WEAPONS.railgun.chargeTime);
        } else if (this.player.railCharging) {
          if (this.player.railCharge > 0.12) this.fireWeapon(this.player, "railgun", Math.max(0.3, this.player.railCharge));
          this.player.railCharging = false; this.player.railCharge = 0;
        }
      }
      this.player.update(dt, input.move, input.boost, this.arena, this.allMechs);

      // ---- AI ----
      for (const ai of this.aiList) {
        const decision = ai.mech.alive ? ai.decide(dt, this.allMechs, this.arena) : { moveInput: { forward: 0, strafe: 0 }, boost: false, wantsFire: null };
        ai.mech.update(dt, decision.moveInput, decision.boost, this.arena, this.allMechs);
        if (decision.wantsFire) this.fireWeapon(ai.mech, decision.wantsFire, decision.wantsFire === "railgun" ? rand(0.6, 1) : 1);
      }

      // ---- grapple melee resolution ----
      for (const mech of this.allMechs) {
        for (const hook of [mech.hookLeft, mech.hookRight]) {
          if (hook.pendingMelee) {
            const { target, damage } = hook.pendingMelee;
            hook.pendingMelee = null;
            this.audio.melee();
            this.applyHit(mech, target, damage, target.pos.clone().add(new THREE.Vector3(0, 1.4, 0)));
          }
        }
      }

      // ---- respawns (dt-driven so pause can never desync them) ----
      for (let i = this.pendingRespawns.length - 1; i >= 0; i--) {
        const r = this.pendingRespawns[i];
        r.t -= dt;
        if (r.t <= 0) { r.mech.respawn(this.randomSpawnAwayFromOthers()); this.pendingRespawns.splice(i, 1); }
      }

      // ---- kill feed aging ----
      for (let i = this.killFeedItems.length - 1; i >= 0; i--) {
        const k = this.killFeedItems[i]; k.t -= dt;
        if (k.t <= 0) { k.el.remove(); this.killFeedItems.splice(i, 1); }
      }

      // ---- arena storm ----
      this.arena.update(dt, () => { this.audio.boost(); this.fx.shake.add(0.2); });
      el("stormBanner").classList.toggle("hidden", !this.arena.stormWarning);

      this.fx.update(dt);
      this.updateCamera(dt);

      this._radarT -= dt;
      if (this._radarT <= 0) { this._radarT = 0.1; this.drawRadar(); }
      this.updateHUD();
    }
  }

  // ============================================================
  //  BOOT
  // ============================================================
  window.addEventListener("DOMContentLoaded", () => {
    try { window._grappleMech = new Game(); }
    catch (e) { console.error(e); el("loadMsg").textContent = "Error: " + e.message; }
  });
})();
