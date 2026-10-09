/* ============================================================
   SKY DOGFIGHT 3D  —  infinite procedural flight combat
   Three.js (r128 UMD global) + Vanilla JS. No build step.
   ------------------------------------------------------------
   World (terrain, hills, river, trees, clouds) is generated
   procedurally on the fly in square chunks around the player
   using a value-noise height field, so the sky stays endless.
   All meshes are built from primitives; all sounds are
   synthesized with the Web Audio API — no external assets.
   (c) 2025 Sheikh Thanbir Alam.
   ============================================================ */
(function () {
  "use strict";

  if (!window.THREE) { document.getElementById("loadMsg").textContent = "Failed to load 3D engine (Three.js)."; return; }
  const THREE = window.THREE;

  // ---------- helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const el = (id) => document.getElementById(id);
  const now = () => performance.now();

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ============================================================
  //  VALUE NOISE  (deterministic, seamless-ish, no external libs)
  // ============================================================
  function hash2(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  }
  function valueNoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = hash2(xi, yi), b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    const u = smoothstep(xf), v = smoothstep(yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm(x, y, octaves) {
    let total = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      total += valueNoise(x * freq, y * freq) * amp;
      max += amp; amp *= 0.5; freq *= 2;
    }
    return total / max;
  }

  // ============================================================
  //  WORLD / TERRAIN CONSTANTS
  // ============================================================
  const CHUNK_SIZE = 240;
  const CHUNK_SEG = 18;
  const VIEW_RADIUS = 2;           // chunks in each direction -> 5x5 grid
  const RIVER_WIDTH = 16;
  const WATER_Y = -3;

  function riverCenterX(z) {
    return Math.sin(z * 0.0011) * 150 + Math.sin(z * 0.00037 + 2.1) * 260 + Math.sin(z * 0.0021 + 0.7) * 40;
  }
  function terrainHeight(x, z) {
    let h = fbm(x * 0.0018, z * 0.0018, 4) * 2 - 1;
    let height = h * 55;
    height += (fbm(x * 0.01 + 50, z * 0.01 + 50, 3) * 2 - 1) * 6;
    const rx = riverCenterX(z);
    const d = Math.abs(x - rx);
    const band = RIVER_WIDTH * 2.4;
    if (d < band) {
      const t = clamp(d / band, 0, 1);
      const bank = smoothstep(t);
      height = lerp(-9, height, bank);
    }
    return height;
  }
  function terrainColor(height, distToRiver, out) {
    let r, g, b;
    if (distToRiver < RIVER_WIDTH * 1.15) { r = 0.78; g = 0.70; b = 0.47; }        // sandy riverbank
    else if (height < 1) { r = 0.70; g = 0.64; b = 0.42; }                          // shore
    else if (height < 24) { const t = height / 24; r = lerp(0.22, 0.17, t); g = lerp(0.52, 0.42, t); b = lerp(0.23, 0.18, t); }
    else if (height < 42) { const t = (height - 24) / 18; r = lerp(0.36, 0.5, t); g = lerp(0.40, 0.47, t); b = lerp(0.28, 0.42, t); }
    else { const t = clamp((height - 42) / 20, 0, 1); r = lerp(0.55, 0.96, t); g = lerp(0.56, 0.97, t); b = lerp(0.58, 0.99, t); }
    const n = (hash2(height * 3.1, distToRiver * 1.7) - 0.5) * 0.06;
    out.x = clamp(r + n, 0, 1); out.y = clamp(g + n, 0, 1); out.z = clamp(b + n, 0, 1);
  }

  // ============================================================
  //  SHARED GEOMETRY / MATERIAL LIBRARY
  // ============================================================
  const LIB = {};
  function initLib() {
    LIB.box = new THREE.BoxGeometry(1, 1, 1);
    LIB.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
    LIB.cone = new THREE.ConeGeometry(1, 1, 7);
    LIB.sphere = new THREE.SphereGeometry(1, 10, 8);
    LIB.trunk = new THREE.CylinderGeometry(0.35, 0.5, 1, 6);
    LIB.leaf = new THREE.ConeGeometry(1, 1, 7);
    LIB.bullet = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 6);
    LIB.matTrunk = new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 1, flatShading: true });
    LIB.matLeaf = new THREE.MeshStandardMaterial({ color: 0x2f7a3c, roughness: 1, flatShading: true });
    LIB.matWater = new THREE.MeshStandardMaterial({ color: 0x2f7ad4, transparent: true, opacity: 0.78, roughness: 0.25, metalness: 0.1 });
    LIB.matPlayerBullet = new THREE.MeshBasicMaterial({ color: 0x7af7ff });
    LIB.matEnemyBullet = new THREE.MeshBasicMaterial({ color: 0xff5050 });
    LIB.matCloud = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, roughness: 1, flatShading: true });
  }
  const boxMesh = (w, h, d, mat) => { const m = new THREE.Mesh(LIB.box, mat); m.scale.set(w, h, d); return m; };

  // ============================================================
  //  AUDIO MANAGER
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
    noise(d, vol = 0.3, freq = 900) {
      if (this.muted) return; const c = this.ensure(); if (!c) return;
      const n = (c.sampleRate * d) | 0, buf = c.createBuffer(1, n, c.sampleRate), dd = buf.getChannelData(0);
      for (let i = 0; i < n; i++) dd[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = c.createBufferSource(); s.buffer = buf;
      const g = c.createGain(); g.gain.value = vol;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq;
      s.connect(f); f.connect(g); g.connect(c.destination); s.start();
    }
    startEngine() {
      const c = this.ensure(); if (!c || this.engine) return;
      this.engine = c.createOscillator(); this.engineGain = c.createGain();
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
      this.engine.type = "sawtooth"; this.engine.frequency.value = 80;
      this.engineGain.gain.value = this.muted ? 0 : 0.05;
      this.engine.connect(lp); lp.connect(this.engineGain); this.engineGain.connect(c.destination);
      this.engine.start();
    }
    stopEngine() { if (this.engine) { try { this.engine.stop(); } catch (e) {} this.engine = null; this.engineGain = null; } }
    setEngine(throttle01) {
      if (!this.engine || !this.ac) return;
      this.engine.frequency.setTargetAtTime(70 + throttle01 * 220, this.ac.currentTime, 0.08);
      this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.035 + throttle01 * 0.035, this.ac.currentTime, 0.1);
    }
    laser() { this.tone(900, 0.08, "sawtooth", 0.1, 240); }
    explosion() { this.noise(0.5, 0.35, 700); this.tone(100, 0.4, "sawtooth", 0.18, 35); }
    hit() { this.tone(300, 0.12, "square", 0.14, 120); }
    power() { this.tone(523, 0.09, "square", 0.13); setTimeout(() => this.tone(880, 0.12, "square", 0.13), 80); }
    click() { this.tone(440, 0.04, "square", 0.08); }
    count(hi) { this.tone(hi ? 880 : 440, hi ? 0.25 : 0.15, "square", 0.14); }
    over() { this.tone(400, 0.25, "square", 0.16, 120); setTimeout(() => this.tone(160, 0.5, "square", 0.16, 60), 200); }
    toggle() { this.muted = !this.muted; if (this.muted) this.stopEngine(); return this.muted; }
  }

  // ============================================================
  //  INPUT MANAGER  (keyboard + touch joystick + buttons)
  // ============================================================
  class InputManager {
    constructor(game) {
      this.game = game;
      this.keys = {};
      this.stick = { x: 0, y: 0, active: false };
      this.fireHeld = false;
      this.yawL = false; this.yawR = false; this.thrUp = false; this.thrDn = false;
      this.bindKeys(); this.bindMouse(); this.bindTouch();
    }
    bindKeys() {
      addEventListener("keydown", (e) => {
        this.game.audio.ensure();
        this.keys[e.code] = true;
        if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
        if (e.code === "KeyP") { e.preventDefault(); this.game.togglePause(); }
        if (e.code === "KeyR") { e.preventDefault(); this.game.restart(); }
      });
      addEventListener("keyup", (e) => { this.keys[e.code] = false; });
    }
    bindMouse() {
      const cv = el("scene");
      cv.addEventListener("mousedown", () => { this.game.audio.ensure(); this.fireHeld = true; });
      addEventListener("mouseup", () => { this.fireHeld = false; });
      cv.addEventListener("touchstart", () => {}, { passive: true });
    }
    bindTouch() {
      document.querySelectorAll(".tbtn[data-act]").forEach((b) => {
        const act = b.dataset.act;
        const on = (e) => { e.preventDefault(); this.game.audio.ensure(); document.body.classList.add("touch-mode");
          if (act === "yawL") this.yawL = true; else if (act === "yawR") this.yawR = true;
          else if (act === "throttleUp") this.thrUp = true; else if (act === "throttleDn") this.thrDn = true;
          else if (act === "fire") this.fireHeld = true;
          b.classList.add("active");
        };
        const off = (e) => { e.preventDefault();
          if (act === "yawL") this.yawL = false; else if (act === "yawR") this.yawR = false;
          else if (act === "throttleUp") this.thrUp = false; else if (act === "throttleDn") this.thrDn = false;
          else if (act === "fire") this.fireHeld = false;
          b.classList.remove("active");
        };
        b.addEventListener("touchstart", on, { passive: false });
        b.addEventListener("touchend", off, { passive: false });
        b.addEventListener("touchcancel", off, { passive: false });
        b.addEventListener("mousedown", on); b.addEventListener("mouseup", off); b.addEventListener("mouseleave", off);
      });
      // virtual joystick for pitch/roll
      const base = el("touchStick").querySelector(".stick-base");
      const knob = el("stickKnob");
      let activeTouchId = null;
      const radius = 50;
      const setKnob = (dx, dy) => { knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; };
      const start = (id, cx, cy) => { activeTouchId = id; this._ox = cx; this._oy = cy; knob.classList.add("active"); document.body.classList.add("touch-mode"); this.game.audio.ensure(); };
      const move = (cx, cy) => {
        let dx = cx - this._ox, dy = cy - this._oy;
        const d = Math.hypot(dx, dy);
        if (d > radius) { dx = (dx / d) * radius; dy = (dy / d) * radius; }
        setKnob(dx, dy);
        this.stick.x = dx / radius; this.stick.y = dy / radius; this.stick.active = true;
      };
      const end = () => { activeTouchId = null; setKnob(0, 0); this.stick.x = 0; this.stick.y = 0; this.stick.active = false; knob.classList.remove("active"); };
      base.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; start(t.identifier, t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
      base.addEventListener("touchmove", (e) => {
        for (const t of e.changedTouches) if (t.identifier === activeTouchId) { move(t.clientX, t.clientY); }
        e.preventDefault();
      }, { passive: false });
      base.addEventListener("touchend", (e) => { for (const t of e.changedTouches) if (t.identifier === activeTouchId) end(); }, { passive: false });
      base.addEventListener("touchcancel", () => end());
      // mouse fallback for desktop testing of stick
      base.addEventListener("mousedown", (e) => { start("m", e.clientX, e.clientY); const mv = (ev) => move(ev.clientX, ev.clientY); const up = () => { end(); removeEventListener("mousemove", mv); removeEventListener("mouseup", up); }; addEventListener("mousemove", mv); addEventListener("mouseup", up); });
    }
    get pitchInput() {
      let v = (this.keys["KeyW"] || this.keys["ArrowUp"] ? 1 : 0) - (this.keys["KeyS"] || this.keys["ArrowDown"] ? 1 : 0);
      if (this.stick.active) v -= this.stick.y;
      return clamp(v, -1, 1);
    }
    get rollInput() {
      let v = (this.keys["KeyA"] || this.keys["ArrowLeft"] ? 1 : 0) - (this.keys["KeyD"] || this.keys["ArrowRight"] ? 1 : 0);
      if (this.stick.active) v -= this.stick.x;
      return clamp(v, -1, 1);
    }
    get yawInput() {
      return (this.keys["KeyQ"] || this.yawL ? 1 : 0) - (this.keys["KeyE"] || this.yawR ? 1 : 0);
    }
    get throttleInput() {
      return (this.keys["ShiftLeft"] || this.keys["ShiftRight"] || this.thrUp ? 1 : 0) - (this.keys["ControlLeft"] || this.keys["ControlRight"] || this.keys["KeyC"] || this.thrDn ? 1 : 0);
    }
    get fireInput() { return !!(this.keys["Space"] || this.fireHeld); }
  }

  // ============================================================
  //  AIRPLANE  (player aircraft — procedural low-poly mesh + flight model)
  // ============================================================
  class Airplane {
    constructor(scene) {
      this.group = new THREE.Group();
      this.pitch = 0; this.yaw = 0; this.roll = 0;
      this.speed = 60; this.minSpeed = 28; this.maxSpeed = 170; this.throttle = 0.55;
      this.propSpin = 0;
      this.forward = new THREE.Vector3(0, 0, -1);
      this.group.rotation.order = "YXZ";
      this.build();
      scene.add(this.group);
    }
    build() {
      const g = this.group;
      const body = new THREE.MeshStandardMaterial({ color: 0xe8453c, roughness: 0.4, metalness: 0.3, flatShading: true });
      const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f28, roughness: 0.6, flatShading: true });
      const glass = new THREE.MeshStandardMaterial({ color: 0x0a1a2a, metalness: 0.6, roughness: 0.2 });
      const accent = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.4, flatShading: true });

      const fuselage = new THREE.Mesh(LIB.cyl, body);
      fuselage.scale.set(1, 1, 1); fuselage.rotation.x = Math.PI / 2; fuselage.scale.set(0.75, 0.75, 4.4); g.add(fuselage);
      const nose = new THREE.Mesh(LIB.cone, dark); nose.rotation.x = -Math.PI / 2; nose.scale.set(0.7, 1.3, 0.7); nose.position.z = -2.5; g.add(nose);
      const canopy = new THREE.Mesh(LIB.sphere, glass); canopy.scale.set(0.5, 0.42, 0.9); canopy.position.set(0, 0.5, -0.3); g.add(canopy);
      const tailCone = new THREE.Mesh(LIB.cone, body); tailCone.rotation.x = Math.PI / 2; tailCone.scale.set(0.6, 1.2, 0.6); tailCone.position.z = 2.5; g.add(tailCone);

      const wing = boxMesh(7.6, 0.18, 1.5, body); wing.position.set(0, -0.05, 0.1); g.add(wing);
      const wingStripe = boxMesh(1.2, 0.2, 1.5, accent); wingStripe.position.set(0, -0.03, 0.1); g.add(wingStripe);
      const tailWing = boxMesh(2.8, 0.14, 0.8, body); tailWing.position.set(0, 0, 2.5); g.add(tailWing);
      const fin = boxMesh(0.14, 1.3, 1.1, body); fin.position.set(0, 0.75, 2.6); g.add(fin);

      const prop = new THREE.Group();
      const p1 = boxMesh(0.16, 1.6, 0.05, dark); prop.add(p1);
      const p2 = boxMesh(1.6, 0.16, 0.05, dark); prop.add(p2);
      prop.position.z = -3.15;
      g.add(prop); this.prop = prop;

      // wingtip lights
      const red = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 1.2 });
      const grn = new THREE.MeshStandardMaterial({ color: 0x003300, emissive: 0x20ff40, emissiveIntensity: 1.2 });
      const lR = boxMesh(0.18, 0.18, 0.18, red); lR.position.set(-3.85, -0.05, 0.1); g.add(lR);
      const lG = boxMesh(0.18, 0.18, 0.18, grn); lG.position.set(3.85, -0.05, 0.1); g.add(lG);

      this.gunTip = new THREE.Vector3(0, -0.1, -4.3);
    }
    update(dt, input) {
      const pitchSpeed = 1.1, maxRoll = 1.0, rollResponse = 5.5, yawSpeed = 0.7, bankTurnRate = 0.9;
      this.pitch = clamp(this.pitch + input.pitchInput * pitchSpeed * dt, -1.35, 1.35);
      const rollTarget = input.rollInput * maxRoll;
      this.roll = lerp(this.roll, rollTarget, 1 - Math.exp(-rollResponse * dt));
      this.yaw += (input.yawInput * yawSpeed + this.roll * bankTurnRate) * dt;

      // throttle & speed
      this.throttle = clamp(this.throttle + input.throttleInput * 0.6 * dt, 0.08, 1);
      const targetSpeed = lerp(this.minSpeed, this.maxSpeed, this.throttle) - Math.sin(this.pitch) * 18;
      this.speed = lerp(this.speed, clamp(targetSpeed, this.minSpeed * 0.6, this.maxSpeed), 1 - Math.exp(-1.5 * dt));

      this.group.rotation.set(this.pitch, this.yaw, this.roll);
      this.forward.set(0, 0, -1).applyEuler(this.group.rotation);
      this.group.position.addScaledVector(this.forward, this.speed * dt);

      this.propSpin += dt * (8 + this.throttle * 40);
      this.prop.rotation.z = this.propSpin;
    }
    get position() { return this.group.position; }
    get upVector() { return new THREE.Vector3(0, 1, 0).applyEuler(this.group.rotation); }
    gunWorldPos() {
      // offset in local space transformed by current rotation (avoids relying on a
      // possibly one-frame-stale matrixWorld since this is read mid-frame, before render)
      const offset = this.gunTip.clone().applyEuler(this.group.rotation);
      return this.group.position.clone().add(offset);
    }
  }

  // ============================================================
  //  BULLET POOL  (generic pooled laser bolts)
  // ============================================================
  class BulletPool {
    constructor(scene, material, speed, life) {
      this.scene = scene; this.pool = []; this.active = [];
      this.speed = speed; this.life = life;
      for (let i = 0; i < 40; i++) {
        const m = new THREE.Mesh(LIB.bullet, material); m.visible = false;
        scene.add(m); this.pool.push(m);
      }
    }
    fire(pos, dir) {
      if (!this.pool.length) return null;
      const m = this.pool.pop();
      m.position.copy(pos);
      m._dir = dir.clone().normalize();
      // CylinderGeometry's intrinsic long axis is local +Y, so align that to the travel direction
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), m._dir);
      m._life = this.life;
      m.visible = true; this.active.push(m);
      return m;
    }
    update(dt) {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const m = this.active[i];
        m.position.addScaledVector(m._dir, this.speed * dt);
        m._life -= dt;
        if (m._life <= 0) { m.visible = false; this.active.splice(i, 1); this.pool.push(m); }
      }
    }
    remove(m) {
      const idx = this.active.indexOf(m);
      if (idx >= 0) { m.visible = false; this.active.splice(idx, 1); this.pool.push(m); }
    }
    reset() { for (const m of this.active) { m.visible = false; this.pool.push(m); } this.active.length = 0; }
  }

  // ============================================================
  //  ENEMY DRONE
  // ============================================================
  class Enemy {
    constructor(scene, pos, level) {
      this.scene = scene;
      this.health = 3;
      this.speed = rand(32, 46) + level * 2;
      this.fireTimer = rand(1, 3);
      this.waypoint = pos.clone();
      this.build();
      this.group.position.copy(pos);
      scene.add(this.group);
      this.pickWaypoint();
    }
    build() {
      const g = new THREE.Group();
      const body = new THREE.MeshStandardMaterial({ color: 0x565d6b, roughness: 0.5, metalness: 0.4, flatShading: true });
      const accent = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0x7a0000, emissiveIntensity: 0.8, flatShading: true });
      const core = new THREE.Mesh(LIB.sphere, body); core.scale.set(1.3, 0.7, 1.9); g.add(core);
      const nose = new THREE.Mesh(LIB.cone, accent); nose.rotation.x = -Math.PI / 2; nose.scale.set(0.5, 1, 0.5); nose.position.z = -1.7; g.add(nose);
      const wingL = boxMesh(3.2, 0.12, 1.0, body); wingL.position.set(-1.8, 0, 0.1); wingL.rotation.z = 0.08; g.add(wingL);
      const wingR = boxMesh(3.2, 0.12, 1.0, body); wingR.position.set(1.8, 0, 0.1); wingR.rotation.z = -0.08; g.add(wingR);
      const fin = boxMesh(0.12, 0.9, 0.8, body); fin.position.set(0, 0.55, 1.5); g.add(fin);
      const eye = new THREE.Mesh(LIB.sphere, accent); eye.scale.set(0.35, 0.35, 0.35); eye.position.set(0, 0.1, -1.1); g.add(eye);
      this.group = g;
    }
    pickWaypoint() {
      const base = this.group.position;
      this.waypoint.set(base.x + rand(-160, 160), clamp(base.y + rand(-50, 60), 60, 420), base.z + rand(-160, 160));
    }
    update(dt, player, firePlayerBullet) {
      const pos = this.group.position;
      const toWp = this.waypoint.clone().sub(pos);
      const d = toWp.length();
      if (d < 20) this.pickWaypoint();
      else toWp.normalize();
      const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), toWp);
      this.group.quaternion.slerp(targetQuat, 1 - Math.exp(-2.2 * dt));
      pos.addScaledVector(toWp, this.speed * dt);

      // occasional attack run toward player
      const toPlayer = player.position.clone().sub(pos);
      const distP = toPlayer.length();
      this.fireTimer -= dt;
      if (distP < 260 && this.fireTimer <= 0) {
        this.fireTimer = rand(1.6, 3.2);
        const lead = toPlayer.clone().normalize();
        firePlayerBullet(pos.clone().addScaledVector(lead, 3), lead);
      }
    }
    hitRadius() { return 6.5; }
    dispose() { this.scene.remove(this.group); }
  }

  class EnemyManager {
    constructor(scene) { this.scene = scene; this.list = []; this.spawnTimer = 1; }
    maxForLevel(level) { return Math.min(5 + Math.floor(level * 1.3), 16); }
    update(dt, player, level, fireEnemyBullet) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.list.length < this.maxForLevel(level)) {
        this.spawnTimer = rand(1.2, 2.4);
        const ang = rand(0, Math.PI * 2);
        const dist = rand(220, 420);
        const pos = new THREE.Vector3(
          player.position.x + Math.cos(ang) * dist,
          clamp(player.position.y + rand(-40, 70), 70, 420),
          player.position.z + Math.sin(ang) * dist
        );
        this.list.push(new Enemy(this.scene, pos, level));
      }
      for (let i = this.list.length - 1; i >= 0; i--) {
        const e = this.list[i];
        e.update(dt, player, fireEnemyBullet);
        const dz = e.group.position.distanceTo(player.position);
        if (dz > 1100) { e.dispose(); this.list.splice(i, 1); }
      }
    }
    reset() { for (const e of this.list) e.dispose(); this.list.length = 0; this.spawnTimer = 1; }
  }

  // ============================================================
  //  WORLD CHUNK MANAGER  (infinite terrain + river + trees)
  // ============================================================
  class ChunkManager {
    constructor(scene) {
      this.scene = scene; this.chunks = new Map(); this.lastKey = null;
    }
    key(cx, cz) { return cx + "," + cz; }
    chunkCoord(v) { return Math.floor((v + CHUNK_SIZE / 2) / CHUNK_SIZE); }

    buildChunk(cx, cz) {
      const originX = cx * CHUNK_SIZE, originZ = cz * CHUNK_SIZE;
      const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEG, CHUNK_SEG);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const tmp = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i), lz = pos.getZ(i);
        const wx = lx + originX, wz = lz + originZ;
        const h = terrainHeight(wx, wz);
        pos.setX(i, wx); pos.setZ(i, wz); pos.setY(i, h);
        const rx = riverCenterX(wz);
        terrainColor(h, Math.abs(wx - rx), tmp);
        colors[i * 3] = tmp.x; colors[i * 3 + 1] = tmp.y; colors[i * 3 + 2] = tmp.z;
      }
      geo.computeVertexNormals();
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      this.scene.add(mesh);

      const chunk = { mesh, water: null, trunks: null, leaves: null };

      // river water ribbon — only the chunk "owning" this row renders it (avoids duplicate overdraw)
      const midZ = originZ;
      const ownerCx = Math.round(riverCenterX(midZ) / CHUNK_SIZE);
      if (ownerCx === cx) {
        const steps = 10;
        const wpos = [], wcol = [];
        for (let s = 0; s <= steps; s++) {
          const z = originZ - CHUNK_SIZE / 2 + (CHUNK_SIZE * s) / steps;
          const rx = riverCenterX(z);
          wpos.push(rx - RIVER_WIDTH, WATER_Y, z, rx + RIVER_WIDTH, WATER_Y, z);
        }
        const idx = [];
        for (let s = 0; s < steps; s++) {
          const a = s * 2, b = a + 1, c = a + 2, d = a + 3;
          idx.push(a, c, b, b, c, d);
        }
        const wgeo = new THREE.BufferGeometry();
        wgeo.setAttribute("position", new THREE.Float32BufferAttribute(wpos, 3));
        wgeo.setIndex(idx);
        wgeo.computeVertexNormals();
        const water = new THREE.Mesh(wgeo, LIB.matWater);
        this.scene.add(water);
        chunk.water = water;
      }

      // trees — seeded per-chunk RNG for deterministic scatter
      const seed = ((cx * 374761393) ^ (cz * 668265263)) >>> 0;
      const rng = mulberry32(seed);
      const attempts = 16;
      const matrices = [];
      for (let i = 0; i < attempts; i++) {
        const tx = originX + (rng() - 0.5) * CHUNK_SIZE;
        const tz = originZ + (rng() - 0.5) * CHUNK_SIZE;
        const th = terrainHeight(tx, tz);
        const rx = riverCenterX(tz);
        if (th < 1.5 || th > 40) continue;
        if (Math.abs(tx - rx) < RIVER_WIDTH * 1.6) continue;
        const scale = 0.8 + rng() * 1.1;
        const rot = rng() * Math.PI * 2;
        matrices.push({ x: tx, y: th, z: tz, scale, rot });
      }
      if (matrices.length) {
        const trunks = new THREE.InstancedMesh(LIB.trunk, LIB.matTrunk, matrices.length);
        const leaves = new THREE.InstancedMesh(LIB.leaf, LIB.matLeaf, matrices.length);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        matrices.forEach((t, i) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
          s.set(t.scale, t.scale * 3.2, t.scale);
          m.compose(new THREE.Vector3(t.x, t.y + (t.scale * 3.2) / 2, t.z), q, s);
          trunks.setMatrixAt(i, m);
          s.set(t.scale * 2.1, t.scale * 3.6, t.scale * 2.1);
          m.compose(new THREE.Vector3(t.x, t.y + t.scale * 3.2 + (t.scale * 3.6) / 2, t.z), q, s);
          leaves.setMatrixAt(i, m);
        });
        trunks.instanceMatrix.needsUpdate = true; leaves.instanceMatrix.needsUpdate = true;
        this.scene.add(trunks); this.scene.add(leaves);
        chunk.trunks = trunks; chunk.leaves = leaves;
      }

      return chunk;
    }

    disposeChunk(chunk) {
      this.scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); chunk.mesh.material.dispose();
      if (chunk.water) { this.scene.remove(chunk.water); chunk.water.geometry.dispose(); }
      if (chunk.trunks) { this.scene.remove(chunk.trunks); chunk.trunks.dispose(); }
      if (chunk.leaves) { this.scene.remove(chunk.leaves); chunk.leaves.dispose(); }
    }

    update(playerPos) {
      const pcx = this.chunkCoord(playerPos.x), pcz = this.chunkCoord(playerPos.z);
      const key = pcx + "," + pcz;
      if (key === this.lastKey) return;
      this.lastKey = key;
      const needed = new Set();
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
          const cx = pcx + dx, cz = pcz + dz;
          const k = this.key(cx, cz);
          needed.add(k);
          if (!this.chunks.has(k)) this.chunks.set(k, this.buildChunk(cx, cz));
        }
      }
      for (const [k, chunk] of this.chunks) {
        if (!needed.has(k)) { this.disposeChunk(chunk); this.chunks.delete(k); }
      }
    }

    heightAt(x, z) { return terrainHeight(x, z); }
  }

  // ============================================================
  //  CLOUDS
  // ============================================================
  class CloudManager {
    constructor(scene) {
      this.scene = scene; this.clouds = [];
      for (let i = 0; i < 28; i++) this.clouds.push(this.make());
    }
    make() {
      const c = new THREE.Group();
      const puffs = 3 + randi(0, 3);
      for (let j = 0; j < puffs; j++) {
        const p = new THREE.Mesh(LIB.sphere, LIB.matCloud);
        p.scale.set(rand(10, 20), rand(6, 10), rand(10, 20));
        p.position.set(rand(-14, 14), rand(-3, 3), rand(-10, 10));
        c.add(p);
      }
      c.position.set(rand(-900, 900), rand(140, 340), rand(-900, 900));
      this.scene.add(c);
      return c;
    }
    update(playerPos) {
      for (const c of this.clouds) {
        const dx = c.position.x - playerPos.x, dz = c.position.z - playerPos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 1100 * 1100) {
          const ang = rand(0, Math.PI * 2), dist = rand(500, 900);
          c.position.set(playerPos.x + Math.cos(ang) * dist, rand(140, 340), playerPos.z + Math.sin(ang) * dist);
        }
      }
    }
  }

  // ============================================================
  //  PARTICLE SYSTEM  (pooled emissive bits for explosions/sparks)
  // ============================================================
  class ParticleSystem {
    constructor(scene) {
      this.scene = scene; this.pool = []; this.active = [];
      for (let i = 0; i < 160; i++) {
        const m = new THREE.Mesh(LIB.box, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        m.visible = false; scene.add(m); this.pool.push(m);
      }
    }
    emit(x, y, z, n, color, spd, life) {
      for (let i = 0; i < n; i++) {
        if (!this.pool.length) break;
        const m = this.pool.pop();
        m.material.color.setHex(color);
        m.position.set(x, y, z);
        const s = rand(0.2, 0.9); m.scale.set(s, s, s);
        m._v = new THREE.Vector3(rand(-spd, spd), rand(-spd * 0.4, spd), rand(-spd, spd));
        m._life = life * rand(0.6, 1.3); m._max = m._life;
        m.visible = true; this.active.push(m);
      }
    }
    update(dt) {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const m = this.active[i]; m._life -= dt;
        if (m._life <= 0) { m.visible = false; this.active.splice(i, 1); this.pool.push(m); continue; }
        m.position.addScaledVector(m._v, dt);
        m._v.y -= 5 * dt; m._v.multiplyScalar(0.96);
        const k = m._life / m._max; m.scale.setScalar(0.8 * k + 0.05);
      }
    }
    reset() { for (const m of this.active) { m.visible = false; this.pool.push(m); } this.active.length = 0; }
  }

  // ============================================================
  //  CAMERA CONTROLLER  (third-person chase)
  // ============================================================
  class CameraController {
    constructor(camera) { this.cam = camera; this.shake = 0; this._pos = new THREE.Vector3(); this._look = new THREE.Vector3(); }
    reset(player) {
      const back = player.forward.clone().multiplyScalar(-14);
      this.cam.position.copy(player.position).add(back).add(new THREE.Vector3(0, 4, 0));
    }
    update(dt, player) {
      const back = player.forward.clone().multiplyScalar(-13);
      const desired = player.position.clone().add(back).add(new THREE.Vector3(0, 4.2, 0));
      const t = 1 - Math.exp(-5 * dt);
      this.cam.position.lerp(desired, t);
      if (this.shake > 0.01) {
        this.cam.position.x += rand(-this.shake, this.shake);
        this.cam.position.y += rand(-this.shake, this.shake);
        this.shake *= 0.86;
      }
      const lookTarget = player.position.clone().addScaledVector(player.forward, 20);
      this._look.lerp(lookTarget, 1 - Math.exp(-6 * dt));
      this.cam.up.set(0, 1, 0);
      this.cam.lookAt(this._look);
      this.cam.rotation.z += player.roll * 0.18;
    }
    addShake(v) { this.shake = Math.min(this.shake + v, 1.2); }
  }

  // ============================================================
  //  SCORE MANAGER
  // ============================================================
  class ScoreManager {
    constructor() { this.key = "skyDogfightScores"; this.data = this.load(); }
    load() { try { return JSON.parse(localStorage.getItem(this.key)) || { score: 0, kills: 0, dist: 0 }; } catch (e) { return { score: 0, kills: 0, dist: 0 }; } }
    submit(score, kills, dist) {
      let record = false;
      if (score > this.data.score) { record = true; this.data.score = score; }
      this.data.kills = Math.max(this.data.kills, kills);
      this.data.dist = Math.max(this.data.dist, dist);
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
      initLib();
      this.initThree();
      this.buildWorld();
      this.input = new InputManager(this);
      this.bindUI();
      this.last = now();
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
      this.skyColor = new THREE.Color(0x8fcdf0);
      this.scene.background = this.skyColor;
      this.scene.fog = new THREE.Fog(0x8fcdf0, 260, 1000);

      this.camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.5, 2200);

      this.ambient = new THREE.AmbientLight(0xffffff, 0.65); this.scene.add(this.ambient);
      this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3a4f2f, 0.7); this.scene.add(this.hemi);
      this.sun = new THREE.DirectionalLight(0xfff3d6, 1.0);
      this.sun.position.set(-120, 220, -80);
      this.scene.add(this.sun);

      addEventListener("resize", () => this.onResize());
    }

    onResize() {
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    }

    buildWorld() {
      this.chunks = new ChunkManager(this.scene);
      this.clouds = new CloudManager(this.scene);
      this.player = new Airplane(this.scene);
      this.enemies = new EnemyManager(this.scene);
      this.playerBullets = new BulletPool(this.scene, LIB.matPlayerBullet, 420, 1.8);
      this.enemyBullets = new BulletPool(this.scene, LIB.matEnemyBullet, 220, 3.2);
      this.particles = new ParticleSystem(this.scene);
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
    }

    showScreen(id) {
      ["menuScreen", "scoresScreen", "helpScreen"].forEach((s) => el(s).classList.toggle("hidden", s !== id));
    }

    showScores() {
      const b = this.scores.data;
      el("scoresList").innerHTML = `
        <div class="row"><span>Best Score</span><b>${b.score.toLocaleString()}</b></div>
        <div class="row"><span>Best Kills</span><b>${b.kills}</b></div>
        <div class="row"><span>Best Distance</span><b>${b.dist.toFixed(1)} km</b></div>`;
    }

    // ---------- game flow ----------
    resetRun() {
      this.score = 0; this.kills = 0; this.dist = 0; this.level = 1;
      this.health = 100; this.invuln = 0;
      this.player.group.position.set(0, 160, 0);
      this.player.group.rotation.set(0, 0, 0);
      this.player.pitch = 0; this.player.yaw = 0; this.player.roll = 0;
      this.player.speed = 70; this.player.throttle = 0.55;
      this.enemies.reset(); this.playerBullets.reset(); this.enemyBullets.reset(); this.particles.reset();
      this.chunks.lastKey = null; this.chunks.update(this.player.position);
      this.cameraCtl.reset(this.player);
      this.fireCooldown = 0;
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
      el("hud").classList.add("hidden"); el("lowHealthFx").classList.remove("on");
      this.showScreen("menuScreen"); this.showScores();
    }

    gameOver(reason) {
      this.state = "over"; this.audio.stopEngine(); this.audio.explosion();
      this.particles.emit(this.player.position.x, this.player.position.y, this.player.position.z, 40, 0xff9d3d, 24, 1.1);
      const record = this.scores.submit(Math.floor(this.score), this.kills, this.dist);
      el("finalScore").textContent = Math.floor(this.score).toLocaleString();
      el("finalKills").textContent = this.kills;
      el("finalDist").textContent = this.dist.toFixed(1) + " KM";
      el("finalBest").textContent = this.scores.data.score.toLocaleString();
      el("newHigh").classList.toggle("hidden", !record);
      el("overTitle").textContent = reason === "crash" ? "CRASHED INTO TERRAIN" : "AIRCRAFT LOST";
      el("overScreen").classList.remove("hidden");
      el("lowHealthFx").classList.remove("on");
      this.showScores();
    }

    // ---------- combat ----------
    firePlayer() {
      if (this.fireCooldown > 0) return;
      this.fireCooldown = 0.12;
      const pos = this.player.gunWorldPos();
      this.playerBullets.fire(pos, this.player.forward);
      this.audio.laser();
    }
    fireEnemyBullet(pos, dir) {
      this.enemyBullets.fire(pos, dir);
    }

    checkCollisions(dt) {
      // player bullets vs enemies
      for (let bi = this.playerBullets.active.length - 1; bi >= 0; bi--) {
        const b = this.playerBullets.active[bi];
        for (let ei = this.enemies.list.length - 1; ei >= 0; ei--) {
          const e = this.enemies.list[ei];
          if (b.position.distanceTo(e.group.position) < e.hitRadius()) {
            this.playerBullets.remove(b);
            e.health--;
            this.particles.emit(b.position.x, b.position.y, b.position.z, 6, 0xffe08a, 8, 0.3);
            this.audio.hit();
            if (e.health <= 0) {
              this.particles.emit(e.group.position.x, e.group.position.y, e.group.position.z, 26, 0xff8c42, 16, 0.8);
              this.audio.explosion();
              this.score += 120 * this.level;
              this.kills++;
              e.dispose(); this.enemies.list.splice(ei, 1);
            }
            break;
          }
        }
      }
      if (this.invuln > 0) return;
      // enemy bullets vs player
      for (let bi = this.enemyBullets.active.length - 1; bi >= 0; bi--) {
        const b = this.enemyBullets.active[bi];
        if (b.position.distanceTo(this.player.position) < 5.5) {
          this.enemyBullets.remove(b);
          this.takeDamage(12, b.position);
        }
      }
      // ram collisions
      for (let ei = this.enemies.list.length - 1; ei >= 0; ei--) {
        const e = this.enemies.list[ei];
        if (e.group.position.distanceTo(this.player.position) < 9) {
          this.particles.emit(e.group.position.x, e.group.position.y, e.group.position.z, 22, 0xff5050, 14, 0.7);
          this.audio.explosion();
          e.dispose(); this.enemies.list.splice(ei, 1);
          this.takeDamage(28, e.group.position);
        }
      }
      // terrain collision
      const groundY = this.chunks.heightAt(this.player.position.x, this.player.position.z);
      if (this.player.position.y < groundY + 4) {
        this.gameOver("crash");
      }
    }

    takeDamage(amount, fxPos) {
      this.health = clamp(this.health - amount, 0, 100);
      this.invuln = 0.6;
      this.cameraCtl.addShake(0.5);
      el("hitFlash").classList.remove("on"); void el("hitFlash").offsetWidth; el("hitFlash").classList.add("on");
      if (fxPos) this.particles.emit(fxPos.x, fxPos.y, fxPos.z, 10, 0xff5050, 10, 0.4);
      if (this.health <= 0) this.gameOver("destroyed");
    }

    // ---------- HUD ----------
    updateHUD() {
      el("scoreVal").textContent = Math.floor(this.score).toLocaleString();
      el("bestVal").textContent = this.scores.data.score.toLocaleString();
      el("killsVal").innerHTML = this.kills + " <small>KILLS</small>";
      el("levelVal").textContent = this.level;
      el("waveTag").textContent = "WAVE " + this.level;
      el("ammoVal").textContent = "∞";
      el("altVal").textContent = Math.max(0, Math.round(this.player.position.y));
      el("speedVal").textContent = Math.round(this.player.speed * 3.2);
      el("healthFill").style.width = this.health + "%";
      el("throttleFill").style.width = Math.round(this.player.throttle * 100) + "%";
      el("lowHealthFx").classList.toggle("on", this.health < 30);
    }

    // ---------- main loop ----------
    loop(t) {
      let dt = (t - this.last) / 1000; this.last = t;
      if (dt > 0.05) dt = 0.05;
      if (this.state === "playing") this.step(dt);
      else if (this.state === "menu" || this.state === "countdown") this.idle(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(this.loop);
    }

    idle(dt) {
      this.player.update(dt, { pitchInput: 0, rollInput: Math.sin(now() * 0.0003) * 0.3, yawInput: 0, throttleInput: 0 });
      this.chunks.update(this.player.position);
      this.clouds.update(this.player.position);
      this.cameraCtl.update(dt, this.player);
    }

    step(dt) {
      const input = this.input;
      this.player.update(dt, input);
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
      if (input.fireInput) this.firePlayer();

      this.chunks.update(this.player.position);
      this.clouds.update(this.player.position);
      this.enemies.update(dt, this.player, this.level, (p, d) => this.fireEnemyBullet(p, d));
      this.playerBullets.update(dt);
      this.enemyBullets.update(dt);
      this.particles.update(dt);
      this.cameraCtl.update(dt, this.player);

      this.invuln = Math.max(0, this.invuln - dt);
      this.checkCollisions(dt);
      if (this.state !== "playing") return;

      this.dist += (this.player.speed * dt) / 1000;
      this.score += dt * 3;
      const newLevel = 1 + Math.floor(this.kills / 5);
      if (newLevel !== this.level) { this.level = newLevel; this.audio.power(); }

      this.audio.setEngine(this.player.throttle);
      this.updateHUD();
    }
  }

  // ============================================================
  //  BOOT
  // ============================================================
  window.addEventListener("DOMContentLoaded", () => {
    try { window._skyDogfight = new Game(); }
    catch (e) { console.error(e); el("loadMsg").textContent = "Error: " + e.message; }
  });
})();
