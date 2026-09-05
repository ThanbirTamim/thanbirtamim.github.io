/* ============================================================
   3D RACING  —  arcade endless highway racer
   Three.js (r128 UMD global) + Vanilla JS. No build step.
   ------------------------------------------------------------
   All 3D models are built procedurally from primitives and all
   sounds are synthesized with the Web Audio API — no external
   assets. Object pooling is used for traffic, scenery, coins
   and particles to keep draw calls and GC low.
   (c) 2025 Sheikh Thanbir Alam.
   ============================================================ */
(function () {
  "use strict";

  if (!window.THREE) { document.getElementById("loadMsg").textContent = "Failed to load 3D engine (Three.js)."; return; }
  const THREE = window.THREE;

  // ---------- helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const el = (id) => document.getElementById(id);

  // ---------- world constants ----------
  const LANES = [-6, -2, 2, 6];
  const ROAD_HALF = 9.5;        // road width / 2 (incl shoulders)
  const PLAYER_X_LIMIT = 7.4;
  const Z_SPAWN = -300;         // far spawn
  const Z_RECYCLE = 26;         // behind camera -> recycle
  const ROAD_LEN = 360;

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
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700;
      this.engine.type = "sawtooth"; this.engine.frequency.value = 60;
      this.engineGain.gain.value = this.muted ? 0 : 0.05;
      this.engine.connect(lp); lp.connect(this.engineGain); this.engineGain.connect(c.destination);
      this.engine.start();
    }
    stopEngine() { if (this.engine) { try { this.engine.stop(); } catch (e) {} this.engine = null; this.engineGain = null; } }
    setEngine(speed01, nitro) {
      if (!this.engine || !this.ac) return;
      this.engine.frequency.setTargetAtTime(55 + speed01 * 150 + (nitro ? 60 : 0), this.ac.currentTime, 0.08);
      this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.04 + speed01 * 0.03, this.ac.currentTime, 0.1);
    }
    coin() { this.tone(1046, 0.08, "square", 0.12, 1568); }
    nitroSfx() { this.tone(220, 0.4, "sawtooth", 0.16, 720); this.noise(0.3, 0.12); }
    crash() { this.noise(0.4, 0.35); this.tone(90, 0.35, "sawtooth", 0.18, 40); }
    power() { this.tone(523, 0.09, "square", 0.13); setTimeout(() => this.tone(880, 0.12, "square", 0.13), 80); }
    click() { this.tone(440, 0.04, "square", 0.08); }
    count(hi) { this.tone(hi ? 880 : 440, hi ? 0.25 : 0.15, "square", 0.14); }
    over() { this.tone(400, 0.25, "square", 0.16, 120); setTimeout(() => this.tone(160, 0.5, "square", 0.16, 60), 200); }
    toggle() { this.muted = !this.muted; if (this.muted) this.stopEngine(); return this.muted; }
  }

  // ============================================================
  //  INPUT MANAGER
  // ============================================================
  class InputManager {
    constructor(game) {
      this.game = game;
      this.state = { left: false, right: false, up: false, down: false, nitro: false };
      this.bindKeys(); this.bindTouch();
    }
    bindKeys() {
      const map = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", Space: "nitro" };
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
      // swipe steering on canvas
      const cv = el("scene"); let sx = 0, sy = 0, sw = false;
      cv.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; sw = true; }, { passive: true });
      cv.addEventListener("touchend", (e) => {
        if (!sw) return; sw = false; const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { const k = dx > 0 ? "right" : "left"; this.state[k] = true; setTimeout(() => (this.state[k] = false), 140); }
      }, { passive: true });
      document.addEventListener("touchmove", (e) => { if (this.game.state === "playing") e.preventDefault(); }, { passive: false });
    }
  }

  // ============================================================
  //  SHARED GEOMETRY / MATERIAL LIBRARY  (reused → few allocations)
  // ============================================================
  const LIB = {};
  function initLib() {
    LIB.box = new THREE.BoxGeometry(1, 1, 1);
    LIB.wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
    LIB.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
    LIB.cone = new THREE.ConeGeometry(1, 1, 7);
    LIB.sphere = new THREE.SphereGeometry(1, 10, 8);
    LIB.coin = new THREE.CylinderGeometry(0.55, 0.55, 0.14, 16);
    LIB.torus = new THREE.TorusGeometry(0.5, 0.16, 8, 14);
    LIB.mWheel = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.9 });
    LIB.mGlass = new THREE.MeshStandardMaterial({ color: 0x0a1a2a, metalness: 0.6, roughness: 0.2 });
  }
  const boxMesh = (w, h, d, mat) => { const m = new THREE.Mesh(LIB.box, mat); m.scale.set(w, h, d); return m; };

  // ============================================================
  //  PLAYER CAR
  // ============================================================
  class PlayerCar {
    constructor(scene, quality) {
      this.group = new THREE.Group();
      this.x = 0; this.vx = 0; this.tilt = 0; this.susp = 0;
      this.build(0x00d4ff, quality);
      scene.add(this.group);
    }
    build(color, quality) {
      const g = this.group;
      const body = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x11151f, roughness: 0.7 });
      // chassis
      const chassis = boxMesh(2.0, 0.5, 4.2, body); chassis.position.y = 0.55; g.add(chassis);
      const lower = boxMesh(2.1, 0.35, 4.0, dark); lower.position.y = 0.32; g.add(lower);
      // cabin / roof
      const cabin = boxMesh(1.5, 0.55, 1.8, body); cabin.position.set(0, 1.02, -0.1); g.add(cabin);
      const glass = boxMesh(1.42, 0.5, 1.7, LIB.mGlass); glass.position.set(0, 1.04, -0.1); g.add(glass);
      // nose slope
      const nose = boxMesh(1.9, 0.3, 1.0, body); nose.position.set(0, 0.62, 1.9); g.add(nose);
      // spoiler
      const spoiler = boxMesh(2.0, 0.12, 0.5, dark); spoiler.position.set(0, 1.05, -2.05); g.add(spoiler);
      const s1 = boxMesh(0.14, 0.4, 0.4, dark); s1.position.set(-0.8, 0.85, -2.0); g.add(s1);
      const s2 = s1.clone(); s2.position.x = 0.8; g.add(s2);
      // headlights (emissive) + taillights
      const hl = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 1.4 });
      const tl = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 1.0 });
      this.tlMat = tl;
      const h1 = boxMesh(0.4, 0.22, 0.16, hl); h1.position.set(-0.6, 0.62, 2.4); g.add(h1);
      const h2 = h1.clone(); h2.position.x = 0.6; g.add(h2);
      const t1 = boxMesh(0.5, 0.22, 0.12, tl); t1.position.set(-0.65, 0.7, -2.18); g.add(t1);
      const t2 = t1.clone(); t2.position.x = 0.65; g.add(t2);
      // wheels
      this.wheels = [];
      const wpos = [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]];
      for (const [wx, wz] of wpos) {
        const w = new THREE.Mesh(LIB.wheel, LIB.mWheel);
        w.rotation.z = Math.PI / 2; w.position.set(wx, 0.42, wz);
        if (quality === "high") w.castShadow = true;
        g.add(w); this.wheels.push(w);
      }
      // headlight beam (one spotlight, high quality only, used at night)
      if (quality === "high") {
        this.spot = new THREE.SpotLight(0xfff2c0, 0, 60, Math.PI / 6, 0.5, 1.2);
        this.spot.position.set(0, 1.2, 2.2);
        this.spot.target.position.set(0, 0, -30);
        g.add(this.spot); g.add(this.spot.target);
      }
      if (quality === "high") { chassis.castShadow = true; cabin.castShadow = true; }
      g.position.z = 2;
    }
    update(dt, input, speed01, night) {
      // steering
      const acc = 26;
      let dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      this.vx += dir * acc * dt;
      this.vx *= 0.86;
      this.x = clamp(this.x + this.vx * dt, -PLAYER_X_LIMIT, PLAYER_X_LIMIT);
      if ((this.x <= -PLAYER_X_LIMIT && dir < 0) || (this.x >= PLAYER_X_LIMIT && dir > 0)) this.vx = 0;
      this.group.position.x = this.x;
      // body tilt + suspension bob
      this.tilt = lerp(this.tilt, -this.vx * 0.06, 0.15);
      this.group.rotation.z = this.tilt;
      this.group.rotation.y = lerp(this.group.rotation.y, this.vx * 0.03, 0.2);
      this.susp += dt * (6 + speed01 * 20);
      this.group.position.y = Math.sin(this.susp) * 0.02 * (0.4 + speed01);
      // wheel spin
      const spin = (10 + speed01 * 60) * dt;
      for (const w of this.wheels) w.rotation.x += spin;
      // brake lights
      this.tlMat.emissiveIntensity = input.down ? 2.4 : 1.0;
      // headlights at night
      if (this.spot) this.spot.intensity = night * 2.2;
    }
    reset() { this.x = 0; this.vx = 0; this.group.position.set(0, 0, 2); this.group.rotation.set(0, 0, 0); }
  }

  // ============================================================
  //  ROAD  (static long road + pooled moving lane dashes)
  // ============================================================
  class Road {
    constructor(scene) {
      this.scene = scene; this.dashes = []; this.build();
    }
    build() {
      const s = this.scene;
      // asphalt
      const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, ROAD_LEN),
        new THREE.MeshStandardMaterial({ color: 0x22252e, roughness: 0.95 }));
      road.rotation.x = -Math.PI / 2; road.position.z = -ROAD_LEN / 2 + Z_RECYCLE; road.receiveShadow = true; s.add(road);
      this.road = road;
      // shoulders / curbs
      for (const side of [-1, 1]) {
        const curb = new THREE.Mesh(new THREE.PlaneGeometry(1.0, ROAD_LEN),
          new THREE.MeshStandardMaterial({ color: 0xd23b4a, roughness: 0.8 }));
        curb.rotation.x = -Math.PI / 2; curb.position.set(side * (ROAD_HALF + 0.5), 0.02, road.position.z); s.add(curb);
      }
      // grass both sides (large planes)
      for (const side of [-1, 1]) {
        const grass = new THREE.Mesh(new THREE.PlaneGeometry(120, ROAD_LEN),
          new THREE.MeshStandardMaterial({ color: 0x16351f, roughness: 1 }));
        grass.rotation.x = -Math.PI / 2; grass.position.set(side * (ROAD_HALF + 60), -0.05, road.position.z); grass.receiveShadow = true; s.add(grass);
      }
      // lane dashes (pooled) for 3 inner dividers
      const dashMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, emissive: 0x555555, roughness: 0.6 });
      this.dashMat = dashMat;
      const dividers = [-4, 0, 4];
      const spacing = 8;
      for (const dx of dividers) {
        for (let z = Z_RECYCLE; z > -ROAD_LEN + Z_RECYCLE; z -= spacing) {
          const d = new THREE.Mesh(LIB.box, dashMat); d.scale.set(0.22, 0.02, 3);
          d.position.set(dx, 0.03, z); this.scene.add(d); this.dashes.push(d);
        }
      }
      this._spacing = spacing;
    }
    update(dz) {
      const total = ROAD_LEN;
      for (const d of this.dashes) {
        d.position.z += dz;
        if (d.position.z > Z_RECYCLE) d.position.z -= total;
      }
    }
    setNight(n) { this.dashMat.emissive.setScalar(0.15 + n * 0.35); }
  }

  // ============================================================
  //  ENVIRONMENT  (pooled roadside scenery + clouds + mountains)
  // ============================================================
  class Environment {
    constructor(scene, quality) {
      this.scene = scene; this.items = []; this.clouds = []; this.quality = quality;
      this.mats = {
        trunk: new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 1 }),
        leaf: new THREE.MeshStandardMaterial({ color: 0x2f8f43, roughness: 1 }),
        bush: new THREE.MeshStandardMaterial({ color: 0x2b7a3c, roughness: 1 }),
        rock: new THREE.MeshStandardMaterial({ color: 0x6b6f76, roughness: 1 }),
        pole: new THREE.MeshStandardMaterial({ color: 0x888e99, roughness: 0.7 }),
        lamp: new THREE.MeshStandardMaterial({ color: 0x222, emissive: 0xffcf6b, emissiveIntensity: 0.2 }),
        sign: new THREE.MeshStandardMaterial({ color: 0x1b64c9, roughness: 0.6 }),
        b1: new THREE.MeshStandardMaterial({ color: 0x3a4256, roughness: 0.9 }),
        b2: new THREE.MeshStandardMaterial({ color: 0x4a3d5e, roughness: 0.9 }),
        b3: new THREE.MeshStandardMaterial({ color: 0x2d3b4a, roughness: 0.9 }),
        winOn: new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0xffe08a, emissiveIntensity: 0.0 }),
      };
      this.build();
      this.buildMountains();
      this.buildClouds();
    }
    makeItem() {
      const g = new THREE.Group(); g.visible = false; this.scene.add(g); return g;
    }
    setType(g, type, side) {
      // clear
      while (g.children.length) g.remove(g.children[0]);
      const m = this.mats;
      const cast = this.quality === "high";
      if (type === "tree") {
        const tr = new THREE.Mesh(LIB.cyl, m.trunk); tr.scale.set(0.5, 3, 0.5); tr.position.y = 1.5;
        const top = new THREE.Mesh(LIB.cone, m.leaf); top.scale.set(2.4, 4, 2.4); top.position.y = 4.4;
        if (cast) { tr.castShadow = true; top.castShadow = true; }
        g.add(tr); g.add(top);
      } else if (type === "bush") {
        const b = new THREE.Mesh(LIB.sphere, m.bush); b.scale.set(1.4, 1, 1.4); b.position.y = 0.7; if (cast) b.castShadow = true; g.add(b);
      } else if (type === "rock") {
        const r = new THREE.Mesh(LIB.sphere, m.rock); r.scale.set(rand(1, 2), rand(0.8, 1.4), rand(1, 2)); r.position.y = 0.5; if (cast) r.castShadow = true; g.add(r);
      } else if (type === "lamp") {
        const p = new THREE.Mesh(LIB.cyl, m.pole); p.scale.set(0.16, 6, 0.16); p.position.y = 3; g.add(p);
        const arm = new THREE.Mesh(LIB.box, m.pole); arm.scale.set(1.6, 0.14, 0.14); arm.position.set(side * -0.7, 5.9, 0); g.add(arm);
        const lamp = new THREE.Mesh(LIB.box, m.lamp.clone()); lamp.scale.set(0.5, 0.2, 0.5); lamp.position.set(side * -1.4, 5.8, 0); g.add(lamp);
        g._lamp = lamp;
      } else if (type === "sign") {
        const p = new THREE.Mesh(LIB.cyl, m.pole); p.scale.set(0.12, 4, 0.12); p.position.y = 2; g.add(p);
        const bd = new THREE.Mesh(LIB.box, m.sign); bd.scale.set(2.4, 1.6, 0.12); bd.position.y = 4; g.add(bd);
      } else { // building
        const bm = pick([m.b1, m.b2, m.b3]);
        const h = rand(10, 30), w = rand(6, 12), d = rand(6, 12);
        const bld = new THREE.Mesh(LIB.box, bm); bld.scale.set(w, h, d); bld.position.y = h / 2; if (cast) bld.castShadow = true; g.add(bld);
        const win = new THREE.Mesh(LIB.box, m.winOn); win.scale.set(w * 1.001, h * 0.9, d * 1.001); win.position.y = h / 2; g.add(win);
        g._win = win;
      }
      g._type = type;
    }
    build() {
      // create pool; alternate sides, spread along z
      const count = this.quality === "low" ? 28 : 44;
      for (let i = 0; i < count; i++) {
        const g = this.makeItem();
        const side = i % 2 === 0 ? -1 : 1;
        this.recycle(g, side, rand(Z_SPAWN, Z_RECYCLE));
        this.items.push(g);
      }
    }
    recycle(g, side, z) {
      side = side || (Math.random() < 0.5 ? -1 : 1);
      const near = Math.random() < 0.5;
      const type = near ? pick(["tree", "bush", "rock", "lamp", "sign", "tree", "tree"]) : pick(["building", "building", "tree"]);
      this.setType(g, type, side);
      const offset = type === "building" ? rand(26, 46) : (type === "lamp" ? ROAD_HALF + 1.2 : rand(ROAD_HALF + 2, ROAD_HALF + 20));
      g.position.set(side * offset, 0, z);
      g.rotation.y = rand(0, Math.PI * 2);
      g.visible = true;
      g._side = side;
    }
    buildMountains() {
      const mat = new THREE.MeshStandardMaterial({ color: 0x2a3350, roughness: 1 });
      this.mountains = [];
      for (let i = 0; i < 8; i++) {
        const mt = new THREE.Mesh(LIB.cone, mat);
        const s = rand(30, 60);
        mt.scale.set(s, s * rand(0.8, 1.4), s);
        mt.position.set(rand(-140, 140), s * 0.4 - 6, -260 - rand(0, 120));
        this.scene.add(mt); this.mountains.push(mt);
      }
    }
    buildClouds() {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, roughness: 1 });
      this.cloudMat = mat;
      for (let i = 0; i < 10; i++) {
        const c = new THREE.Group();
        for (let j = 0; j < 4; j++) { const p = new THREE.Mesh(LIB.sphere, mat); p.scale.set(rand(4, 8), rand(3, 4), rand(4, 8)); p.position.set(rand(-6, 6), rand(-1, 1), rand(-4, 4)); c.add(p); }
        c.position.set(rand(-120, 120), rand(40, 70), rand(-260, -40));
        this.scene.add(c); this.clouds.push(c);
      }
    }
    update(dz, night) {
      for (const g of this.items) {
        g.position.z += dz;
        if (g.position.z > Z_RECYCLE + 6) this.recycle(g, g._side * -1, g.position.z - ROAD_LEN);
        // windows / lamps glow at night
        if (g._win) g._win.material.emissiveIntensity = night * 0.9;
        if (g._lamp) g._lamp.material.emissiveIntensity = 0.2 + night * 1.6;
      }
      for (const c of this.clouds) { c.position.z += dz * 0.15; if (c.position.z > 40) c.position.z = -260; }
    }
  }

  // ============================================================
  //  TRAFFIC
  // ============================================================
  const TRAFFIC_TYPES = {
    car:   { w: 1.9, h: 1.2, l: 4.0, colors: [0xff5d5d, 0x5dff9d, 0xffd166, 0x8f8fff, 0xff9d3d], speed: [22, 34] },
    suv:   { w: 2.1, h: 1.7, l: 4.6, colors: [0x557a8a, 0x6b5b8a, 0x3a6b4a], speed: [20, 30] },
    truck: { w: 2.4, h: 2.6, l: 7.0, colors: [0xcfcfcf, 0x7a6b5b, 0x4a5a6a], speed: [16, 24] },
    bus:   { w: 2.4, h: 3.0, l: 9.0, colors: [0xf2a33c, 0xd94f4f, 0x3c78c2], speed: [15, 22] },
  };
  class TrafficManager {
    constructor(scene, quality) {
      this.scene = scene; this.pool = []; this.active = []; this.quality = quality;
      this.max = quality === "low" ? 8 : 12;
      for (let i = 0; i < this.max; i++) this.pool.push(this.make());
      this.spawnT = 1.2;
    }
    make() {
      const g = new THREE.Group(); g.visible = false;
      g._body = boxMesh(1, 1, 1, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.5 }));
      g.add(g._body);
      g._cab = boxMesh(1, 1, 1, LIB.mGlass); g.add(g._cab);
      // wheels
      g._wheels = [];
      for (let i = 0; i < 4; i++) { const w = new THREE.Mesh(LIB.wheel, LIB.mWheel); w.rotation.z = Math.PI / 2; g.add(w); g._wheels.push(w); }
      // taillights
      g._tl = boxMesh(1, 1, 1, new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 1.0 }));
      g.add(g._tl);
      this.scene.add(g); return g;
    }
    configure(g, type) {
      const t = TRAFFIC_TYPES[type];
      g._type = type; g._w = t.w; g._h = t.h; g._l = t.l;
      g._body.material.color.setHex(pick(t.colors));
      g._body.scale.set(t.w, t.h, t.l); g._body.position.set(0, t.h / 2 + 0.4, 0);
      const cabH = t.h * 0.6;
      g._cab.scale.set(t.w * 0.9, cabH, t.l * (type === "car" ? 0.45 : 0.7));
      g._cab.position.set(0, t.h + 0.4 - cabH * 0.1, type === "car" ? -0.2 : 0);
      g._cab.visible = type !== "truck";
      g._tl.scale.set(t.w * 0.9, 0.2, 0.12); g._tl.position.set(0, t.h * 0.6, -t.l / 2 - 0.02);
      const wx = t.w / 2 - 0.1, wz = t.l / 2 - 0.9;
      const wp = [[-wx, wz], [wx, wz], [-wx, -wz], [wx, -wz]];
      g._wheels.forEach((w, i) => w.position.set(wp[i][0], 0.42, wp[i][1]));
      if (this.quality === "high") g._body.castShadow = true;
    }
    spawn(level, playerSpeed) {
      if (!this.pool.length) return;
      const g = this.pool.pop();
      const type = pick(level > 3 ? ["car", "suv", "truck", "bus"] : level > 1 ? ["car", "suv", "truck"] : ["car", "car", "suv"]);
      this.configure(g, type);
      const t = TRAFFIC_TYPES[type];
      g._lane = randi(0, LANES.length - 1);
      g.position.set(LANES[g._lane], 0, Z_SPAWN - rand(0, 60));
      g._speed = rand(t.speed[0], t.speed[1]);
      g._targetX = LANES[g._lane]; g._changeT = rand(3, 7);
      g.rotation.y = Math.PI; // face toward camera (+z)
      g.visible = true; this.active.push(g);
    }
    update(dt, playerSpeed, level) {
      // spawn logic
      this.spawnT -= dt;
      const interval = clamp(1.6 - level * 0.12, 0.5, 1.6);
      if (this.spawnT <= 0 && this.active.length < this.max) { this.spawn(level, playerSpeed); this.spawnT = rand(interval * 0.7, interval); }
      let passed = 0;
      for (let i = this.active.length - 1; i >= 0; i--) {
        const g = this.active[i];
        // relative motion: world scrolls +z at playerSpeed; traffic moves forward (-z) at its own speed
        g.position.z += (playerSpeed - g._speed) * dt;
        // occasional lane change
        g._changeT -= dt;
        if (g._changeT <= 0) { g._changeT = rand(3, 7); const nl = clamp(g._lane + (Math.random() < 0.5 ? -1 : 1), 0, LANES.length - 1); g._lane = nl; g._targetX = LANES[nl]; }
        g.position.x = lerp(g.position.x, g._targetX, 1 - Math.pow(0.001, dt));
        for (const w of g._wheels) w.rotation.x += g._speed * dt * 2;
        if (g.position.z > Z_RECYCLE + 12) { g.visible = false; this.active.splice(i, 1); this.pool.push(g); passed++; }
      }
      return passed;
    }
    reset() { for (const g of this.active) { g.visible = false; this.pool.push(g); } this.active.length = 0; this.spawnT = 1.0; }
  }

  // ============================================================
  //  COLLECTIBLES
  // ============================================================
  class CollectibleManager {
    constructor(scene) {
      this.scene = scene; this.pool = []; this.active = [];
      this.mats = {
        coin: new THREE.MeshStandardMaterial({ color: 0xffd166, metalness: 0.7, roughness: 0.3, emissive: 0x5a3d00, emissiveIntensity: 0.5 }),
        nitro: new THREE.MeshStandardMaterial({ color: 0x00d4ff, emissive: 0x0088aa, emissiveIntensity: 0.7 }),
        shield: new THREE.MeshStandardMaterial({ color: 0x8fdfff, emissive: 0x2277aa, emissiveIntensity: 0.6, metalness: 0.4 }),
        repair: new THREE.MeshStandardMaterial({ color: 0xff5d73, emissive: 0xaa2233, emissiveIntensity: 0.6 }),
      };
      for (let i = 0; i < 14; i++) this.pool.push(this.make());
      this.spawnT = 1.5;
    }
    make() { const g = new THREE.Group(); g.visible = false; this.scene.add(g); return g; }
    setKind(g, kind) {
      while (g.children.length) g.remove(g.children[0]);
      if (kind === "coin") { const c = new THREE.Mesh(LIB.coin, this.mats.coin); c.rotation.x = Math.PI / 2; g.add(c); }
      else if (kind === "nitro") { const c = new THREE.Mesh(LIB.cyl, this.mats.nitro); c.scale.set(0.5, 1.1, 0.5); g.add(c); const t = new THREE.Mesh(LIB.cone, this.mats.nitro); t.scale.set(0.55, 0.5, 0.55); t.position.y = 0.8; g.add(t); }
      else if (kind === "shield") { const c = new THREE.Mesh(LIB.sphere, this.mats.shield); c.scale.set(0.7, 0.7, 0.7); g.add(c); }
      else { const a = boxMesh(0.9, 0.3, 0.3, this.mats.repair), b = boxMesh(0.3, 0.9, 0.3, this.mats.repair); g.add(a); g.add(b); }
      g._kind = kind;
    }
    spawn() {
      if (!this.pool.length) return;
      const g = this.pool.pop();
      const r = Math.random();
      const kind = r < 0.62 ? "coin" : r < 0.78 ? "nitro" : r < 0.9 ? "shield" : "repair";
      this.setKind(g, kind);
      const lane = LANES[randi(0, LANES.length - 1)];
      g.position.set(lane, kind === "coin" ? 1.0 : 1.1, Z_SPAWN - rand(0, 40));
      g.visible = true;
      // sometimes a row of coins
      g._row = kind === "coin" ? randi(1, 4) : 1; g._rowLane = lane;
      this.active.push(g);
    }
    update(dt, dz, onPickup, player) {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.active.length < 12) { this.spawn(); this.spawnT = rand(0.6, 1.3); }
      const px = player.x, pz = player.group.position.z;
      for (let i = this.active.length - 1; i >= 0; i--) {
        const g = this.active[i];
        g.position.z += dz;
        g.rotation.y += dt * 3;
        g.position.y += Math.sin((performance.now() / 300) + g.position.z) * 0.002;
        // pickup
        if (Math.abs(g.position.x - px) < 1.4 && Math.abs(g.position.z - pz) < 2.4) {
          onPickup(g._kind); g.visible = false; this.active.splice(i, 1); this.pool.push(g); continue;
        }
        if (g.position.z > Z_RECYCLE + 6) { g.visible = false; this.active.splice(i, 1); this.pool.push(g); }
      }
    }
    reset() { for (const g of this.active) { g.visible = false; this.pool.push(g); } this.active.length = 0; this.spawnT = 1.2; }
  }

  // ============================================================
  //  PARTICLE SYSTEM  (pooled emissive bits: impact, exhaust, nitro)
  // ============================================================
  class ParticleSystem {
    constructor(scene) {
      this.scene = scene; this.pool = []; this.active = [];
      this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      for (let i = 0; i < 120; i++) { const m = new THREE.Mesh(LIB.box, this.mat.clone()); m.visible = false; scene.add(m); this.pool.push(m); }
    }
    emit(x, y, z, n, color, spd, life) {
      for (let i = 0; i < n; i++) {
        if (!this.pool.length) break;
        const m = this.pool.pop();
        m.material.color.setHex(color);
        m.position.set(x, y, z);
        const s = rand(0.15, 0.5); m.scale.set(s, s, s);
        m._v = new THREE.Vector3(rand(-spd, spd), rand(0, spd), rand(-spd, spd));
        m._life = life * rand(0.6, 1.2); m._max = m._life;
        m.visible = true; this.active.push(m);
      }
    }
    update(dt) {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const m = this.active[i]; m._life -= dt;
        if (m._life <= 0) { m.visible = false; this.active.splice(i, 1); this.pool.push(m); continue; }
        m.position.x += m._v.x * dt; m.position.y += m._v.y * dt; m.position.z += m._v.z * dt;
        m._v.y -= 9 * dt; m._v.multiplyScalar(0.96);
        const k = m._life / m._max; m.scale.setScalar(0.5 * k + 0.05);
      }
    }
    reset() { for (const m of this.active) { m.visible = false; this.pool.push(m); } this.active.length = 0; }
  }

  // ============================================================
  //  CAMERA CONTROLLER
  // ============================================================
  class CameraController {
    constructor(camera) { this.cam = camera; this.shake = 0; this.pull = 0; this._look = new THREE.Vector3(); }
    update(dt, player, speed01, nitro) {
      const back = 9 + this.pull, height = 4.6 + this.pull * 0.4;
      const tx = player.x * 0.6;
      this.cam.position.x = lerp(this.cam.position.x, tx, 0.12);
      this.cam.position.y = lerp(this.cam.position.y, height, 0.1);
      this.cam.position.z = lerp(this.cam.position.z, player.group.position.z + back, 0.15);
      this.pull = lerp(this.pull, nitro ? 2.2 : 0, 0.1);
      // shake
      if (this.shake > 0.01) {
        this.cam.position.x += rand(-this.shake, this.shake);
        this.cam.position.y += rand(-this.shake, this.shake);
        this.shake *= 0.86;
      }
      this._look.set(player.x * 0.7, 1.2, player.group.position.z - 12);
      this.cam.lookAt(this._look);
      this.cam.rotation.z += player.vx * 0.01; // subtle turn roll
    }
    addShake(v) { this.shake = Math.min(this.shake + v, 0.9); }
    reset() { this.cam.position.set(0, 4.6, 12); this.shake = 0; this.pull = 0; }
  }

  // ============================================================
  //  SCORE MANAGER  (localStorage)
  // ============================================================
  class ScoreManager {
    constructor() {
      this.key = "racing3dScores";
      this.data = this.load();
    }
    load() {
      try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch (e) { return {}; }
    }
    best(mode) { return this.data[mode] || { score: 0, dist: 0, coins: 0 }; }
    submit(mode, score, dist, coins) {
      const b = this.best(mode); let record = false;
      const cur = { score: Math.max(b.score, score), dist: Math.max(b.dist, dist), coins: Math.max(b.coins, coins) };
      if (score > b.score) record = true;
      this.data[mode] = cur;
      try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
      return record;
    }
  }

  // ============================================================
  //  GAME  (orchestrator + state machine + loop)
  // ============================================================
  class Game {
    constructor() {
      this.state = "menu";       // menu | countdown | playing | paused | over
      this.mode = "endless";
      this.quality = localStorage.getItem("racing3dQuality") || "auto";
      this.night = 0; this.dayT = 0;
      this.audio = new AudioManager();
      this.scores = new ScoreManager();
      this.initThree();
      initLib();
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
      this.renderer.shadowMap.enabled = q === "high";
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x9fc6e0);
      this.scene.fog = new THREE.Fog(0x9fc6e0, 60, 240);

      this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 600);
      this.camera.position.set(0, 4.6, 12);

      // lights
      this.ambient = new THREE.AmbientLight(0xffffff, 0.5); this.scene.add(this.ambient);
      this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x33502f, 0.6); this.scene.add(this.hemi);
      this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
      this.sun.position.set(-30, 60, -20);
      if (q === "high") {
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);
        const d = 60; const c = this.sun.shadow.camera;
        c.left = -d; c.right = d; c.top = d; c.bottom = -d; c.near = 1; c.far = 200;
      }
      this.scene.add(this.sun); this.scene.add(this.sun.target);

      addEventListener("resize", () => this.onResize());
    }

    onResize() {
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    }

    buildWorld() {
      const q = this.effectiveQuality();
      this.road = new Road(this.scene);
      this.env = new Environment(this.scene, q);
      this.player = new PlayerCar(this.scene, q);
      this.traffic = new TrafficManager(this.scene, q);
      this.coins = new CollectibleManager(this.scene);
      this.particles = new ParticleSystem(this.scene);
      this.cameraCtl = new CameraController(this.camera);
    }

    // ---------- UI ----------
    bindUI() {
      // menu mode buttons
      document.querySelectorAll("#menuScreen .btn[data-mode]").forEach((b) =>
        b.addEventListener("click", () => { this.audio.ensure(); this.audio.click(); this.startMode(b.dataset.mode); }));
      el("scoresBtn").addEventListener("click", () => { this.audio.click(); this.showScreen("scoresScreen"); });
      el("settingsBtn").addEventListener("click", () => { this.audio.click(); this.showScreen("settingsScreen"); });
      document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => { this.audio.click(); this.showScreen("menuScreen"); }));

      el("resumeBtn").addEventListener("click", () => this.togglePause());
      el("restartBtn2").addEventListener("click", () => this.restart());
      el("menuBtn2").addEventListener("click", () => this.toMenu());
      el("againBtn").addEventListener("click", () => this.restart());
      el("menuBtn").addEventListener("click", () => this.toMenu());
      el("pauseBtn").addEventListener("click", () => this.togglePause());
      el("soundBtn").addEventListener("click", () => { const m = this.audio.toggle(); el("soundBtn").textContent = m ? "🔇" : "🔊"; });

      // settings segments
      el("qualitySeg").addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        el("qualitySeg").querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on");
        this.quality = b.dataset.q; localStorage.setItem("racing3dQuality", this.quality);
      });
      el("soundSeg").addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        el("soundSeg").querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on");
        this.audio.muted = b.dataset.s === "off"; if (this.audio.muted) this.audio.stopEngine();
        el("soundBtn").textContent = this.audio.muted ? "🔇" : "🔊";
      });
      // reflect saved quality
      el("qualitySeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.q === this.quality));
    }

    showScreen(id) {
      ["menuScreen", "scoresScreen", "settingsScreen"].forEach((s) => el(s).classList.toggle("hidden", s !== id));
    }

    showScores() {
      const modes = [["endless", "Endless"], ["timetrial", "Time Trial"], ["challenge", "Challenge"]];
      el("scoresList").innerHTML = modes.map(([k, name]) => {
        const b = this.scores.best(k);
        return `<div class="row"><span>${name}</span><b>${b.score.toLocaleString()} · ${b.dist.toFixed(1)}km</b></div>`;
      }).join("");
    }

    // ---------- game flow ----------
    startMode(mode) {
      this.mode = mode;
      this.showScreen("menuScreen");
      el("menuScreen").classList.add("hidden");
      this.beginRun();
    }

    resetRun() {
      this.score = 0; this.coinCount = 0; this.dist = 0; this.level = 1;
      this.lives = 3; this.nitro = 100; this.speed = 40; this.baseSpeed = 40; this.maxSpeed = 118;
      this.invuln = 0; this.shield = 0; this.slow = 0; this.nitroActive = false;
      this.passedCars = 0;
      this.timeLeft = 60; this.night = 0; this.dayT = 0;
      this.challengeIndex = 0; this.challengeProgress = 0; this.setChallenge();
      this.player.reset(); this.traffic.reset(); this.coins.reset(); this.particles.reset(); this.cameraCtl.reset();
      el("modeTag").textContent = this.mode === "timetrial" ? "TIME TRIAL" : this.mode === "challenge" ? "CHALLENGE" : "ENDLESS";
      el("timerVal").classList.toggle("hidden", this.mode !== "timetrial");
      el("challengeTag").classList.toggle("hidden", this.mode !== "challenge");
      this.updateHUD();
    }

    setChallenge() {
      const list = [
        { text: "Reach 2.0 KM", type: "dist", target: 2.0 },
        { text: "Collect 15 coins", type: "coins", target: 15 },
        { text: "Pass 20 vehicles", type: "pass", target: 20 },
        { text: "Reach 4.0 KM", type: "dist", target: 4.0 },
        { text: "Collect 40 coins", type: "coins", target: 40 },
      ];
      this.challenge = list[Math.min(this.challengeIndex, list.length - 1)];
      // scale after list exhausted
      if (this.challengeIndex >= list.length) { const k = this.challengeIndex - list.length + 2; this.challenge = { text: `Reach ${(4 * k).toFixed(1)} KM`, type: "dist", target: 4 * k }; }
    }

    beginRun() {
      this.audio.ensure();
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
      const record = this.scores.submit(this.mode, Math.floor(this.score), this.dist, this.coinCount);
      el("finalScore").textContent = Math.floor(this.score).toLocaleString();
      el("finalDist").textContent = this.dist.toFixed(1) + " KM";
      el("finalCoins").textContent = this.coinCount;
      el("finalBest").textContent = this.scores.best(this.mode).score.toLocaleString();
      el("newHigh").classList.toggle("hidden", !record);
      el("overTitle").textContent = this.mode === "timetrial" && this.timeLeft <= 0 ? "TIME UP" : "GAME OVER";
      el("overScreen").classList.remove("hidden");
      this.showScores();
    }

    // ---------- collisions ----------
    checkCollisions() {
      if (this.invuln > 0) return;
      const px = this.player.x, pz = this.player.group.position.z;
      const pw = 1.8, pl = 3.8;
      for (const g of this.traffic.active) {
        if (Math.abs(g.position.x - px) < (pw + g._w) / 2 - 0.25 && Math.abs(g.position.z - pz) < (pl + g._l) / 2 - 0.3) {
          this.onCrash(g); return;
        }
      }
    }

    onCrash(g) {
      if (this.shield > 0) {
        this.shield = 0; this.invuln = 1.0;
        this.particles.emit(g.position.x, 1.2, g.position.z, 18, 0x8fdfff, 8, 0.6);
        this.audio.power(); this.cameraCtl.addShake(0.3);
        return;
      }
      this.lives--; this.invuln = 1.3; this.slow = 0.9;
      this.speed = Math.max(this.baseSpeed * 0.5, this.speed * 0.45);
      this.particles.emit(this.player.x, 1.0, this.player.group.position.z, 26, 0xff9d3d, 10, 0.7);
      this.particles.emit(g.position.x, 1.0, g.position.z, 20, 0xffd166, 9, 0.6);
      this.audio.crash(); this.cameraCtl.addShake(0.7);
      el("hitFlash").classList.remove("on"); void el("hitFlash").offsetWidth; el("hitFlash").classList.add("on");
      // knock the hit car away
      g.position.z += 6;
      this.updateHUD();
      if (this.lives <= 0) this.gameOver();
    }

    onPickup(kind) {
      if (kind === "coin") { this.coinCount++; this.score += 25; this.audio.coin(); this.particles.emit(this.player.x, 1.2, this.player.group.position.z, 8, 0xffd166, 6, 0.4); }
      else if (kind === "nitro") { this.nitro = Math.min(100, this.nitro + 40); this.audio.power(); }
      else if (kind === "shield") { this.shield = 8; this.audio.power(); }
      else if (kind === "repair") { this.lives = Math.min(6, this.lives + 1); this.audio.power(); }
      if (this.mode === "challenge" && this.challenge.type === "coins") this.challengeProgress = this.coinCount;
      this.updateHUD();
    }

    // ---------- HUD ----------
    updateHUD() {
      el("scoreVal").textContent = Math.floor(this.score).toLocaleString();
      el("bestVal").textContent = this.scores.best(this.mode).score.toLocaleString();
      el("coinVal").textContent = this.coinCount;
      el("levelVal").textContent = this.level;
      el("speedVal").textContent = Math.round(this.speed * 3.6 * (this.nitroActive ? 1.7 : 1));
      el("livesVal").textContent = "❤".repeat(Math.max(0, this.lives)) + (this.shield > 0 ? " 🛡" : "");
      el("nitroFill").style.width = this.nitro + "%";
      if (this.mode === "timetrial") { el("bigInfo").innerHTML = this.dist.toFixed(1) + " <small>KM</small>"; el("timerVal").textContent = this.timeLeft.toFixed(1) + "s"; }
      else if (this.mode === "challenge") { el("bigInfo").innerHTML = this.dist.toFixed(1) + " <small>KM</small>"; el("challengeTag").textContent = "🎯 " + this.challenge.text + " (" + Math.floor(this.challengeProgress) + "/" + this.challenge.target + ")"; }
      else el("bigInfo").innerHTML = this.dist.toFixed(1) + " <small>KM</small>";
    }

    // ---------- main loop ----------
    loop(now) {
      let dt = (now - this.last) / 1000; this.last = now;
      if (dt > 0.05) dt = 0.05;
      if (this.state === "playing") this.step(dt);
      // always render (so menu shows the world moving subtly)
      if (this.state === "menu" || this.state === "countdown") this.idleScroll(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(this.loop);
    }

    idleScroll(dt) {
      const dz = 30 * dt;
      this.road.update(dz); this.env.update(dz, this.night);
      this.coins.update(dt, dz, () => {}, this.player);
      this.traffic.update(dt, 30, 1);
      this.cameraCtl.update(dt, this.player, 0.3, false);
      this.player.update(dt, { left: false, right: false, down: false }, 0.3, this.night);
    }

    step(dt) {
      const input = this.input.state;

      // speed control
      if (this.mode === "endless" || this.mode === "challenge" || this.mode === "timetrial") {
        // auto-accelerate toward target; Up/Down bias it
        const bias = (input.up ? 12 : 0) - (input.down ? 26 : 0);
        const target = clamp(this.baseSpeed + this.level * 4 + bias, 22, this.maxSpeed);
        this.speed = lerp(this.speed, target, 0.02);
      }
      if (this.slow > 0) { this.slow -= dt; this.speed *= 0.98; }

      // nitro
      this.nitroActive = false;
      if (input.nitro && this.nitro > 1) {
        this.nitroActive = true; this.nitro = Math.max(0, this.nitro - 34 * dt);
        if (!this._nitroSfxT || now() - this._nitroSfxT > 500) { this.audio.nitroSfx(); this._nitroSfxT = now(); }
        this.cameraCtl.addShake(0.04);
        this.particles.emit(this.player.x + rand(-0.5, 0.5), 0.7, this.player.group.position.z - 2.2, 2, 0x00d4ff, 3, 0.25);
      } else {
        this.nitro = Math.min(100, this.nitro + 6 * dt);
      }
      el("speedlines").classList.toggle("on", this.nitroActive);

      const effSpeed = this.speed * (this.nitroActive ? 1.7 : 1);
      const dz = effSpeed * dt;

      // distance & score
      this.dist += dz / 1000 * 3.2;    // km (arcade scale)
      this.score += dz * 0.6;

      // difficulty / level
      const newLevel = 1 + Math.floor(this.dist / 1.2);
      if (newLevel !== this.level) { this.level = newLevel; }

      // day/night cycle
      this.dayT += dt * 0.02;
      this.night = (Math.sin(this.dayT) * 0.5 + 0.5); // 0..1
      this.applyDayNight();

      // world updates
      this.road.update(dz); this.road.setNight(this.night);
      this.env.update(dz, this.night);
      this.passedCars += this.traffic.update(dt, effSpeed, this.level);
      this.coins.update(dt, dz, (k) => this.onPickup(k), this.player);
      this.particles.update(dt);

      // player + camera
      this.player.update(dt, input, effSpeed / this.maxSpeed, this.night);
      this.cameraCtl.update(dt, this.player, effSpeed / this.maxSpeed, this.nitroActive);

      // timers
      this.invuln = Math.max(0, this.invuln - dt);
      this.shield = Math.max(0, this.shield - dt);
      // blink player when invulnerable
      this.player.group.visible = !(this.invuln > 0 && (Math.floor(this.invuln * 12) % 2 === 0));

      this.checkCollisions();

      // engine sound
      this.audio.setEngine(effSpeed / this.maxSpeed, this.nitroActive);

      // mode-specific
      if (this.mode === "timetrial") {
        this.timeLeft -= dt;
        // checkpoint bonus: every ~1.5km add time
        if (!this._nextCp) this._nextCp = 1.5;
        if (this.dist >= this._nextCp) { this.timeLeft += 8; this._nextCp += 1.5; this.audio.power(); this.cameraCtl.addShake(0.1); }
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.gameOver(); }
      }
      if (this.mode === "challenge") {
        if (this.challenge.type === "dist") this.challengeProgress = this.dist;
        else if (this.challenge.type === "pass") this.challengeProgress = this.passedCars;
        else if (this.challenge.type === "coins") this.challengeProgress = this.coinCount;
        if (this.challengeProgress >= this.challenge.target) {
          this.challengeIndex++; this.level++; this.score += 500; this.setChallenge();
          this.audio.count(true); this.cameraCtl.addShake(0.2);
        }
      }

      this.updateHUD();
    }

    applyDayNight() {
      const n = this.night;
      // sky: day blue -> sunset -> night dark
      const day = new THREE.Color(0x9fc6e0), night = new THREE.Color(0x0a1026), sunset = new THREE.Color(0xffb37a);
      const c = new THREE.Color();
      if (n < 0.5) c.copy(day).lerp(sunset, n * 2 * 0.6); else c.copy(sunset).lerp(night, (n - 0.5) * 2);
      this.scene.background = c; this.scene.fog.color = c;
      this.sun.intensity = lerp(1.1, 0.1, n);
      this.ambient.intensity = lerp(0.55, 0.22, n);
      this.hemi.intensity = lerp(0.6, 0.25, n);
    }
  }
  const now = () => performance.now();

  // ============================================================
  //  BOOT
  // ============================================================
  window.addEventListener("DOMContentLoaded", () => {
    try { window._racing = new Game(); }
    catch (e) { console.error(e); el("loadMsg").textContent = "Error: " + e.message; }
  });
})();
