/* ============================================================
   ARCHERY DUEL 3D — main.js
   Audio, unified pointer-based aim/draw input, HUD (wind compass,
   scoreboard, power meter), cinematic arrow-follow camera, the
   round/turn state machine and the main render loop. Wires
   together Range, Archer, TargetBoard, WeatherManager and
   AIRival from the AD3D namespace.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const AD = window.AD3D || {};
  const { clamp, lerp, rand, randi, pick, el } = AD.util;

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
    noise(d, vol = 0.3, freq = 1200, type = "lowpass") {
      if (this.muted) return; const c = this.ensure(); if (!c) return null;
      const n = (c.sampleRate * d) | 0, buf = c.createBuffer(1, n, c.sampleRate), dd = buf.getChannelData(0);
      for (let i = 0; i < n; i++) dd[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = c.createBufferSource(); s.buffer = buf;
      const g = c.createGain(); g.gain.value = vol;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      s.connect(f); f.connect(g); g.connect(c.destination); s.start();
      return { source: s, gain: g };
    }
    release() { this.tone(260, 0.07, "triangle", 0.18, 900); this.noise(0.08, 0.1, 2200); }
    thud() { this.noise(0.12, 0.3, 350); this.tone(90, 0.1, "square", 0.1, 50); }
    bullseye() { this.tone(660, 0.1, "square", 0.16); setTimeout(() => this.tone(880, 0.12, "square", 0.17), 90); setTimeout(() => this.tone(1100, 0.2, "square", 0.18), 190); }
    miss() { this.noise(0.2, 0.18, 500); }
    thunder() { this.noise(1.1, 0.3, 160); this.tone(55, 0.8, "sawtooth", 0.15, 30); }
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
    constructor() { this.key = "archeryDuel3dRecords"; this.data = this.load(); }
    load() { try { return JSON.parse(localStorage.getItem(this.key)) || { bestScore: 0, wins: 0, matches: 0 }; } catch (e) { return { bestScore: 0, wins: 0, matches: 0 }; } }
    submit(playerScore, won) {
      let record = false;
      if (playerScore > this.data.bestScore) { record = true; this.data.bestScore = playerScore; }
      if (won) this.data.wins = (this.data.wins || 0) + 1;
      this.data.matches = (this.data.matches || 0) + 1;
      try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
      return record;
    }
  }

  // ============================================================
  //  GAME  (orchestrator + round/turn state machine + loop)
  // ============================================================
  const SLOWMO = 0.3;

  class Game {
    constructor() {
      this.state = "menu"; // menu | roundIntro | aiming | flight | result | paused | over
      this.difficulty = "medium";
      this.audio = new AudioManager();
      this.scores = new ScoreManager();
      this.initThree();
      AD.initLib();
      this.buildWorld();
      this.bindInput();
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
      this.scene.background = new THREE.Color(0xffb871);

      this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 400);
      this.camera.position.set(-0.6, 2.4, 4);

      this.ambient = new THREE.AmbientLight(0xffffff, 0.75); this.scene.add(this.ambient);
      this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3a4f2f, 0.5); this.scene.add(this.hemi);
      this.sun = new THREE.DirectionalLight(0xfff3d6, 1.1);
      this.sun.position.set(40, 60, 20);
      this.scene.add(this.sun);

      addEventListener("resize", () => this.onResize());
    }

    onResize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); }

    buildWorld() {
      this.range = new AD.Range(this.scene);
      this.weather = new AD.WeatherManager(this.scene, { ambient: this.ambient, sun: this.sun });
      this.weather.onThunder = () => this.audio.thunder();
      this.player = new AD.Archer(this.scene, -0.6, 0x2f5233);
      this.ai = new AD.Archer(this.scene, 0.6, 0x5a2a2a);
      this.target = new AD.TargetBoard(this.scene);
      this.target.setPosition(30);
      this.aiRival = new AD.AIRival("medium");
      this.liveArrows = []; // arrows currently rendered mid-flight
      this.camLook = new THREE.Vector3();
      this.distance = 30;
    }

    // ---------- input (unified pointer: mouse + touch) ----------
    bindInput() {
      this.drag = { active: false, startX: 0, startY: 0, x: 0, y: 0, t0: 0 };
      this.holdBreath = false;
      this.swayPhase = rand(0, 10); this.swayFreq = rand(0.9, 1.5);
      this.swayYaw = 0; this.swayPitch = 0;
      this.power = 0; this.yawOffset = 0; this.pitchOffset = 0;

      const cv = this.canvas;
      cv.addEventListener("pointerdown", (e) => {
        this.audio.ensure();
        if (this.state !== "aiming" || this.turn !== "player") return;
        if (e.button === 2) { this.holdBreath = true; return; }
        this.drag.active = true; this.drag.startX = e.clientX; this.drag.startY = e.clientY;
        this.drag.x = e.clientX; this.drag.y = e.clientY; this.drag.t0 = performance.now();
        try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      });
      cv.addEventListener("pointermove", (e) => { if (this.drag.active) { this.drag.x = e.clientX; this.drag.y = e.clientY; } });
      cv.addEventListener("pointerup", (e) => {
        if (e.button === 2) { this.holdBreath = false; return; }
        if (this.drag.active) { this.drag.active = false; this.releaseShot(); }
      });
      cv.addEventListener("pointercancel", () => { this.drag.active = false; });
      cv.addEventListener("contextmenu", (e) => e.preventDefault());

      addEventListener("keydown", (e) => {
        if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.holdBreath = true;
        if (e.code === "Escape" || e.code === "KeyP") this.togglePause();
      });
      addEventListener("keyup", (e) => { if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.holdBreath = false; });

      const breathBtn = el("breathTouchBtn");
      const bOn = (e) => { e.preventDefault(); this.holdBreath = true; breathBtn.classList.add("active"); };
      const bOff = (e) => { e.preventDefault(); this.holdBreath = false; breathBtn.classList.remove("active"); };
      breathBtn.addEventListener("touchstart", bOn, { passive: false });
      breathBtn.addEventListener("touchend", bOff, { passive: false });
      breathBtn.addEventListener("mousedown", bOn); breathBtn.addEventListener("mouseup", bOff); breathBtn.addEventListener("mouseleave", bOff);
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
      el("roundContinueBtn").addEventListener("click", () => { this.audio.click(); this.startRoundPlay(); });

      el("diffSeg").addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        el("diffSeg").querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on");
        this.difficulty = b.dataset.d;
      });
    }

    showScreen(id) { ["menuScreen", "scoresScreen", "helpScreen"].forEach((s) => el(s).classList.toggle("hidden", s !== id)); }

    showScores() {
      const b = this.scores.data;
      el("scoresList").innerHTML = `
        <div class="row"><span>Best Match Score</span><b>${b.bestScore}</b></div>
        <div class="row"><span>Duels Won</span><b>${b.wins || 0} / ${b.matches || 0}</b></div>`;
    }

    // ---------- match flow ----------
    beginMatch() {
      this.showScreen("menuScreen"); el("menuScreen").classList.add("hidden");
      this.aiRival.setDifficulty(this.difficulty);
      this.playerTotal = 0; this.aiTotal = 0; this.bullseyes = 0;
      this.roundIndex = 0;
      this.weatherOrder = AD.WEATHER_TYPES.slice().sort(() => Math.random() - 0.5);
      el("roundTotal").textContent = AD.ROUNDS;
      el("hud").classList.remove("hidden");
      if (this.isMobile()) el("touch").classList.remove("hidden");
      this.setupRound();
    }

    setupRound() {
      this.distance = pick(AD.DISTANCES);
      this.weatherType = this.weatherOrder[this.roundIndex % this.weatherOrder.length];
      this.weather.setType(this.weatherType);
      this.target.setPosition(this.distance);
      this.turnQueue = [];
      for (let i = 0; i < AD.ARROWS_PER_TURN; i++) this.turnQueue.push("player");
      for (let i = 0; i < AD.ARROWS_PER_TURN; i++) this.turnQueue.push("ai");
      this.turnIndex = 0;
      this.roundScores = { player: [null, null, null], ai: [null, null, null] };
      el("distanceVal").textContent = this.distance + "m";
      el("roundVal").textContent = this.roundIndex + 1;
      this.resetScoreboardUI();
      this.clearLiveArrows();
      this.showRoundIntro();
    }

    resetScoreboardUI() {
      document.querySelectorAll(".sb-row[data-arrow]").forEach((row) => { row.querySelector(".p-score").textContent = "–"; row.querySelector(".a-score").textContent = "–"; });
    }

    showRoundIntro() {
      this.state = "roundIntro";
      const names = { clear: "Clear Sunset", rain: "Heavy Rain & Thunderstorm", blizzard: "Mountain Blizzard", sandstorm: "Desert Sandstorm" };
      el("roundTitle").textContent = "ROUND " + (this.roundIndex + 1) + " / " + AD.ROUNDS;
      el("roundSub").textContent = names[this.weatherType] + " • " + this.distance + "m";
      el("roundScreen").classList.remove("hidden");
    }

    startRoundPlay() {
      el("roundScreen").classList.add("hidden");
      this.startCountdown(() => this.nextTurn());
    }

    startCountdown(cb) {
      const cd = el("countdown"), num = el("countNum");
      cd.classList.remove("hidden");
      let n = 3;
      const step = () => {
        if (n > 0) { num.textContent = n; num.style.animation = "none"; void num.offsetWidth; num.style.animation = ""; this.audio.count(false); n--; setTimeout(step, 700); }
        else { num.textContent = "LOOSE!"; this.audio.count(true); setTimeout(() => { cd.classList.add("hidden"); cb(); }, 550); }
      };
      step();
    }

    nextTurn() {
      if (this.turnIndex >= this.turnQueue.length) return this.endRound();
      this.turn = this.turnQueue[this.turnIndex];
      this.arrowInTurnIndex = this.turnIndex % AD.ARROWS_PER_TURN;
      el("turnBanner").textContent = this.turn === "player" ? "YOUR TURN" : "RIVAL'S TURN";
      el("turnBanner").style.color = this.turn === "player" ? "" : "#ff8c8c";
      this.state = "aiming";
      this.power = 0; this.yawOffset = 0; this.pitchOffset = 0;
      this.swayPhase = rand(0, 10); this.swayFreq = rand(0.9, 1.6);
      const archer = this.turn === "player" ? this.player : this.ai;
      archer.showNockedArrow(true);
      archer.setAimVisual(0, 0, 0);
      el("powerFill").style.width = "0%";
      el("reticle").style.transform = "translate(-50%, -50%)";
      if (this.turn === "ai") {
        this.aiWaitT = rand(0.7, 1.3);
        this.aiDrawT = 0; this.aiDrawTime = rand(0.55, 0.9);
        this.aiShot = null; this.aiFired = false;
      }
    }

    // ---------- shooting ----------
    computeAimDir(yaw, pitch) {
      return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();
    }

    baseYawFor(launchPoint) {
      const dir = new THREE.Vector3().subVectors(this.target.center, launchPoint);
      return Math.atan2(dir.x, -dir.z);
    }

    releaseShot() {
      if (this.state !== "aiming" || this.turn !== "player") return;
      const held = performance.now() - this.drag.t0;
      const dx = this.drag.x - this.drag.startX, dy = this.drag.y - this.drag.startY;
      const dragDist = Math.hypot(dx, dy);
      if (held < 120 && dragDist < 10) return; // accidental tap — no arrow spent
      const power = clamp(this.power, 0.12, 1);
      const speed = AD.PHYS.BASELINE_SPEED * lerp(0.5, 1.25, power);
      const launchPoint = this.player.getLaunchPoint();
      const baseYaw = this.baseYawFor(launchPoint);
      const basePitch = AD.solveLaunchAngle(speed, this.distance);
      const yaw = baseYaw + this.yawOffset + this.swayYaw;
      const pitch = basePitch + this.pitchOffset + this.swayPitch;
      this.audio.release();
      this.launchArrow("player", this.player, launchPoint, yaw, pitch, speed);
    }

    // dt-driven AI aim/draw — runs from the main loop so it naturally respects pause
    // (a self-scheduling rAF/timeout chain would otherwise strand the AI's turn if the
    // player paused mid-draw and resumed, since the chain would have already exited).
    updateAiAim(dt) {
      if (this.aiWaitT > 0) { this.aiWaitT -= dt; return; }
      const launchPoint = this.ai.getLaunchPoint();
      if (!this.aiShot) {
        const wind = this.weather.getWind();
        this.aiShot = this.aiRival.computeShot(launchPoint, this.target.center, this.distance, wind);
        this.aiBaseYaw = this.baseYawFor(launchPoint);
      }
      this.aiDrawT += dt;
      const p = clamp(this.aiDrawT / this.aiDrawTime, 0, 1);
      this.ai.setAimVisual((this.aiShot.yaw - this.aiBaseYaw) * p, this.aiShot.pitch * p, p);
      if (p >= 1 && !this.aiFired) {
        this.aiFired = true;
        this.audio.release();
        this.launchArrow("ai", this.ai, this.ai.getLaunchPoint(), this.aiShot.yaw, this.aiShot.pitch, this.aiShot.speed);
      }
    }

    launchArrow(who, archer, launchPoint, yaw, pitch, speed) {
      archer.showNockedArrow(false);
      const arrow = new AD.Arrow();
      this.scene.add(arrow.group);
      arrow.group.position.copy(launchPoint);
      arrow.state = AD.createArrowState(launchPoint, yaw, pitch, speed);
      arrow.orientToVelocity(arrow.state.vel);
      arrow.who = who;
      this.liveArrows.push(arrow);
      this.flightArrow = arrow;
      this.flightT = 0;
      this.state = "flight";
      el("slowmoFx").classList.add("on");
    }

    clearLiveArrows() {
      for (const a of this.liveArrows) this.scene.remove(a.group);
      this.liveArrows.length = 0;
    }

    // ---------- flight resolution ----------
    updateFlight(dtReal) {
      const dt = dtReal * SLOWMO;
      const arrow = this.flightArrow;
      const wind = this.weather.getWind();
      AD.stepArrow(arrow.state, dt, wind, this.weatherType);
      arrow.group.position.copy(arrow.state.pos);
      arrow.orientToVelocity(arrow.state.vel);
      this.flightT += dtReal;

      const targetZ = this.target.center.z;
      let resolved = null;
      if (arrow.state.prevPos.z > targetZ && arrow.state.pos.z <= targetZ) {
        const k = (arrow.state.prevPos.z - targetZ) / ((arrow.state.prevPos.z - arrow.state.pos.z) || 1e-6);
        const hitPoint = arrow.state.prevPos.clone().lerp(arrow.state.pos, k);
        const info = this.target.evaluateHit(hitPoint);
        resolved = info.onBoard
          ? { points: info.points, dx: info.dx, dy: info.dy, point: hitPoint, stick: true }
          : { points: 0, dx: info.dx, dy: info.dy, point: hitPoint, stick: false };
      } else if (arrow.state.pos.y <= 0.02) {
        resolved = { points: 0, dx: 0, dy: 0, point: arrow.state.pos.clone(), stick: false, ground: true };
      } else if (this.flightT > 7 || arrow.state.pos.z < targetZ - 15) {
        resolved = { points: 0, dx: 0, dy: 0, point: arrow.state.pos.clone(), stick: false };
      }

      if (resolved) this.resolveShot(arrow, resolved);
    }

    resolveShot(arrow, result) {
      this.state = "result";
      el("slowmoFx").classList.remove("on");
      if (result.stick) {
        this.target.stickArrowVisual(result.point, arrow.state.vel);
        this.scene.remove(arrow.group);
        this.audio.thud();
        if (result.points === 10) this.audio.bullseye();
      } else if (result.ground) {
        arrow.group.position.copy(result.point);
        this.audio.thud();
      } else {
        this.audio.miss();
      }
      const idx = this.liveArrows.indexOf(arrow); if (idx >= 0) this.liveArrows.splice(idx, 1);
      this.flightArrow = null;

      this.roundScores[arrow.who][this.arrowInTurnIndex] = result.points;
      if (arrow.who === "player") { this.playerTotal += result.points; if (result.points === 10) this.bullseyes++; }
      else this.aiTotal += result.points;
      if (arrow.who === "ai") this.aiRival.recordResult(result.dx, result.dy);
      this.updateScoreboardUI();
      this.showScorePopup(result.points, arrow.who);

      this.turnIndex++;
      setTimeout(() => {
        if (this.state === "paused") { this._resumeAction = () => this.nextTurn(); }
        else { this.nextTurn(); }
      }, 1500);
    }

    updateScoreboardUI() {
      const rows = document.querySelectorAll(".sb-row[data-arrow]");
      rows.forEach((row, i) => {
        const p = this.roundScores.player[i], a = this.roundScores.ai[i];
        row.querySelector(".p-score").textContent = p === null ? "–" : p;
        row.querySelector(".a-score").textContent = a === null ? "–" : a;
      });
      el("pTotal").textContent = this.playerTotal;
      el("aTotal").textContent = this.aiTotal;
    }

    showScorePopup(points, who) {
      const pop = el("scorePopup");
      pop.textContent = points === 10 ? "BULLSEYE!" : points === 0 ? "MISS" : points + " PTS";
      pop.style.color = who === "player" ? "" : "#ff8c8c";
      pop.classList.remove("show"); void pop.offsetWidth; pop.classList.add("show");
      if (points > 0) { el("hitFlash").classList.remove("on"); void el("hitFlash").offsetWidth; el("hitFlash").classList.add("on"); }
    }

    endRound() {
      this.roundIndex++;
      if (this.roundIndex >= AD.ROUNDS) this.endMatch();
      else this.setupRound();
    }

    endMatch() {
      this.state = "over";
      const won = this.playerTotal > this.aiTotal;
      if (won) this.audio.victory(); else this.audio.defeat();
      const record = this.scores.submit(this.playerTotal, won);
      el("finalPlayer").textContent = this.playerTotal;
      el("finalAI").textContent = this.aiTotal;
      el("finalBulls").textContent = this.bullseyes;
      el("finalBest").textContent = this.scores.data.bestScore;
      el("newHigh").classList.toggle("hidden", !record);
      el("overTitle").textContent = this.playerTotal > this.aiTotal ? "VICTORY!" : this.playerTotal < this.aiTotal ? "DEFEAT" : "DRAW";
      el("overScreen").classList.remove("hidden");
      this.showScores();
    }

    togglePause() {
      if (this.state === "paused") {
        el("pauseScreen").classList.add("hidden");
        this.state = this._preState || "aiming";
        if (this._resumeAction) { const fn = this._resumeAction; this._resumeAction = null; fn(); }
      }
      else if (["aiming", "flight", "result"].includes(this.state)) { this._preState = this.state; this.state = "paused"; el("pauseScreen").classList.remove("hidden"); }
    }

    restart() { el("pauseScreen").classList.add("hidden"); el("overScreen").classList.add("hidden"); el("roundScreen").classList.add("hidden"); this.beginMatch(); }

    toMenu() {
      this.state = "menu";
      el("pauseScreen").classList.add("hidden"); el("overScreen").classList.add("hidden"); el("roundScreen").classList.add("hidden");
      el("hud").classList.add("hidden"); el("touch").classList.add("hidden");
      this.clearLiveArrows();
      this.showScreen("menuScreen"); this.showScores();
    }

    // ---------- HUD: wind compass ----------
    drawWindCompass() {
      const cv = el("windCompass"), ctx = cv.getContext("2d");
      const size = cv.width, c = size / 2, r = c - 6;
      ctx.clearRect(0, 0, size, size);
      ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fillStyle = "#17110a"; ctx.fill();
      ctx.strokeStyle = "rgba(224,168,53,0.5)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = "rgba(224,168,53,0.25)";
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(c + Math.sin(a) * r * 0.75, c - Math.cos(a) * r * 0.75); ctx.lineTo(c + Math.sin(a) * r * 0.95, c - Math.cos(a) * r * 0.95); ctx.stroke();
      }
      const wind = this.weather.getWind();
      ctx.save(); ctx.translate(c, c); ctx.rotate(wind.angle);
      ctx.fillStyle = "#ffd166";
      ctx.beginPath(); ctx.moveTo(0, -r * 0.8); ctx.lineTo(r * 0.22, r * 0.15); ctx.lineTo(0, 0); ctx.lineTo(-r * 0.22, r * 0.15); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#8a7a5c";
      ctx.beginPath(); ctx.moveTo(0, r * 0.75); ctx.lineTo(r * 0.14, r * 0.15); ctx.lineTo(-r * 0.14, r * 0.15); ctx.closePath(); ctx.fill();
      ctx.restore();
      el("windSpeedVal").textContent = Math.round(wind.speedKmh);
      const names = { clear: "CLEAR SUNSET", rain: "THUNDERSTORM", blizzard: "MOUNTAIN BLIZZARD", sandstorm: "DESERT SANDSTORM" };
      el("weatherLabel").textContent = names[this.weatherType] || "CLEAR SUNSET";
    }

    // ---------- cameras ----------
    updateAimCamera(dt) {
      const archer = this.turn === "player" ? this.player : this.ai;
      let yaw, pitch;
      if (this.turn === "player") {
        const dx = this.drag.active ? this.drag.x - this.drag.startX : 0;
        const dy = this.drag.active ? this.drag.y - this.drag.startY : 0;
        const maxDrag = 170;
        const dragDist = Math.hypot(dx, dy);
        this.power = this.drag.active ? clamp(dragDist / maxDrag, 0, 1) : lerp(this.power, 0, 0.1);
        this.yawOffset = clamp(-dx / maxDrag, -1, 1) * 0.22;
        this.pitchOffset = clamp(dy / maxDrag, -1, 1) * 0.3;
        this.swayPhase += dt * this.swayFreq;
        const swayAmp = this.holdBreath ? 0.0045 : 0.017;
        this.swayYaw = (Math.sin(this.swayPhase) * 0.6 + Math.sin(this.swayPhase * 1.7 + 1.3) * 0.4) * swayAmp;
        this.swayPitch = (Math.cos(this.swayPhase * 0.8) * 0.6 + Math.sin(this.swayPhase * 1.3 + 0.6) * 0.4) * swayAmp;

        const launchPoint = this.player.getLaunchPoint();
        const baseYaw = this.baseYawFor(launchPoint);
        const speed = AD.PHYS.BASELINE_SPEED * lerp(0.5, 1.25, clamp(this.power, 0.12, 1));
        const basePitch = AD.solveLaunchAngle(speed, this.distance);
        yaw = baseYaw + this.yawOffset + this.swayYaw;
        pitch = basePitch + this.pitchOffset + this.swayPitch;
        archer.setAimVisual(this.yawOffset, this.pitchOffset, this.power);
        el("powerFill").style.width = Math.round(this.power * 100) + "%";
        el("reticle").style.transform = `translate(calc(-50% + ${clamp(-dx, -140, 140)}px), calc(-50% + ${clamp(-dy, -140, 140)}px))`;
        el("breathBox").classList.toggle("active", this.holdBreath);
      } else {
        yaw = this.baseYawFor(archer.getLaunchPoint()) + archer.yaw;
        pitch = archer.pitch;
      }

      const dir = this.computeAimDir(yaw, pitch);
      const shoulder = archer.getLaunchPoint().add(new THREE.Vector3(0, 0.1, 0.1));
      const back = dir.clone().multiplyScalar(-3.4);
      const desired = shoulder.clone().add(back).add(new THREE.Vector3(0, 0.55, 0));
      const t = 1 - Math.exp(-7 * dt);
      this.camera.position.lerp(desired, t);
      this.camLook.lerp(shoulder.clone().addScaledVector(dir, 40), 1 - Math.exp(-8 * dt));
      this.camera.lookAt(this.camLook);
    }

    updateFlightCamera(dt) {
      const arrow = this.flightArrow; if (!arrow) return;
      const behind = arrow.state.vel.clone().normalize().multiplyScalar(-2.2);
      const desired = arrow.state.pos.clone().add(behind).add(new THREE.Vector3(0, 0.6, 0));
      const t = 1 - Math.exp(-6 * dt);
      this.camera.position.lerp(desired, t);
      this.camLook.lerp(arrow.state.pos.clone().addScaledVector(arrow.state.vel, 0.15), 1 - Math.exp(-8 * dt));
      this.camera.lookAt(this.camLook);
    }

    // ---------- main loop ----------
    loop(now) {
      let dt = (now - this.last) / 1000; this.last = now;
      if (dt > 0.05) dt = 0.05;
      if (this.state === "paused") { this.renderer.render(this.scene, this.camera); requestAnimationFrame(this.loop); return; }
      this.weather.update(dt);
      this.drawWindCompass();
      if (this.state === "aiming") { this.updateAimCamera(dt); if (this.turn === "ai") this.updateAiAim(dt); }
      else if (this.state === "flight") { this.updateFlight(dt); this.updateFlightCamera(dt); }
      else if (this.state === "menu" || this.state === "roundIntro") this.idle(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(this.loop);
    }

    idle(dt) {
      const t = performance.now() * 0.00008;
      this.camera.position.set(Math.sin(t) * 6 - 0.3, 2.2 + Math.sin(t * 1.7) * 0.3, 4 + Math.cos(t) * 2);
      this.camera.lookAt(0, 1.3, -this.distance);
    }
  }

  // ============================================================
  //  BOOT
  // ============================================================
  window.addEventListener("DOMContentLoaded", () => {
    try { window._archeryDuel = new Game(); }
    catch (e) { console.error(e); el("loadMsg").textContent = "Error: " + e.message; }
  });
})();
