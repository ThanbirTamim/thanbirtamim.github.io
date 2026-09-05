/* ============================================================
   MY FIVE DAILY SALAH
   A peaceful 3D educational game that helps children learn about
   the five daily prayers (Salah), Wudu, Qiblah and prayer
   preparation — through a calm interactive neighbourhood.
   ------------------------------------------------------------
   Three.js (r128 UMD global) + Vanilla JS. Static, no backend,
   no accounts, no data collection. Models & sounds are generated
   procedurally. Progress saved in localStorage.

   RESPECTFUL DESIGN: no depiction of Allah, prophets, angels or
   companions; worship is never gamified or scored; the game
   clearly reminds children that real Salah is performed in real
   life. Religious facts (rak'ah counts, prayer times) are kept
   accurate and no scripture is fabricated.
   (c) 2025 Sheikh Thanbir Alam.
   ============================================================ */
(function () {
  "use strict";
  if (!window.THREE) { document.getElementById("loadMsg").textContent = "Could not load 3D engine (WebGL/Three.js)."; return; }
  const THREE = window.THREE;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const el = (id) => document.getElementById(id);
  const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  // ============================================================
  //  ACCURATE SALAH DATA
  // ============================================================
  const SALAH = [
    { key: "fajr", name: "Fajr", icon: "☀", when: "Before sunrise (dawn)", fard: 2, badge: "Fajr Explorer",
      meaning: "The dawn prayer, prayed in the early morning before the sun rises." },
    { key: "dhuhr", name: "Dhuhr", icon: "🌞", when: "After midday", fard: 4, badge: "Dhuhr Learner",
      meaning: "The midday prayer, prayed after the sun passes its highest point." },
    { key: "asr", name: "Asr", icon: "🌤", when: "Late afternoon", fard: 4, badge: "Asr Learner",
      meaning: "The afternoon prayer, prayed in the later part of the day." },
    { key: "maghrib", name: "Maghrib", icon: "🌅", when: "Just after sunset", fard: 3, badge: "Maghrib Learner",
      meaning: "The evening prayer, prayed just after the sun sets." },
    { key: "isha", name: "Isha", icon: "🌙", when: "Night", fard: 4, badge: "Isha Learner",
      meaning: "The night prayer, prayed after the twilight has disappeared." },
  ];

  // Basic physical positions of Salah (educational, respectful)
  const POSITIONS = [
    { name: "Standing (Qiyam)", desc: "Stand up straight, calm and quiet." },
    { name: "Takbir", desc: "Raise the hands and begin the prayer." },
    { name: "Ruku (Bowing)", desc: "Bow down with hands on the knees." },
    { name: "Stand up again", desc: "Rise back to standing." },
    { name: "Sujud (Prostration)", desc: "Place the forehead gently on the ground." },
    { name: "Sitting", desc: "Sit calmly between prostrations." },
    { name: "Sujud again", desc: "Prostrate once more." },
  ];

  // Wudu steps (simplified, common order)
  const WUDU = [
    "Begin with intention (say Bismillah)",
    "Wash both hands",
    "Rinse the mouth",
    "Rinse the nose",
    "Wash the face",
    "Wash the arms up to the elbows",
    "Wipe the head",
    "Wipe the ears",
    "Wash the feet up to the ankles",
  ];

  const ENCYCLOPEDIA = [
    { t: "What is Salah?", b: "Salah is the Muslim prayer. Muslims pray five times a day at different times. It is a special way to remember Allah and take a peaceful break during the day." },
    { t: "The Five Daily Salah", b: "The five prayers are Fajr, Dhuhr, Asr, Maghrib and Isha. Each has its own time of day, from early morning until night." },
    { t: "Fajr", b: "Fajr is prayed before sunrise. It has 2 obligatory (fard) rak'ahs." },
    { t: "Dhuhr", b: "Dhuhr is prayed after midday. It has 4 obligatory (fard) rak'ahs." },
    { t: "Asr", b: "Asr is prayed in the late afternoon. It has 4 obligatory (fard) rak'ahs." },
    { t: "Maghrib", b: "Maghrib is prayed just after sunset. It has 3 obligatory (fard) rak'ahs." },
    { t: "Isha", b: "Isha is prayed at night. It has 4 obligatory (fard) rak'ahs." },
    { t: "Wudu", b: "Wudu is washing in a special order before prayer — hands, mouth, nose, face, arms, head, ears and feet — so we are clean for Salah." },
    { t: "Qiblah", b: "The Qiblah is the direction Muslims face when praying. Muslims all around the world face the Ka'bah in Makkah." },
    { t: "Prayer Preparation", b: "Before Salah we make sure we are clean, perform Wudu, wear clean clothes, find a clean place, and face the Qiblah." },
    { t: "Basic Salah Positions", b: "Salah includes standing, bowing (ruku), and prostrating (sujud), with sitting in between — done calmly and respectfully." },
    { t: "Good to remember", b: "Actual prayer times change with your location and the date and season. Ask your family or a local mosque for the correct times where you live." },
  ];

  // ============================================================
  //  AUDIO MANAGER (gentle synthesized ambience + cues)
  // ============================================================
  class AudioManager {
    constructor() { this.ac = null; this.muted = false; }
    ensure() { if (!this.ac) { try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this.ac && this.ac.state === "suspended") this.ac.resume(); return this.ac; }
    tone(f, d, type = "sine", vol = 0.12, slide = null) {
      if (this.muted) return; const c = this.ensure(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, c.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + d);
      g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + d);
    }
    click() { this.tone(520, 0.06, "sine", 0.08); }
    step() { this.tone(170, 0.05, "sine", 0.025); }
    good() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.14, "sine", 0.11), i * 90)); }
    badge() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, "triangle", 0.11), i * 110)); }
    chime() { this.tone(880, 0.5, "sine", 0.1, 660); }
    gentle() { this.tone(392, 0.18, "sine", 0.09, 330); }
    toggle() { this.muted = !this.muted; return this.muted; }
  }

  // ============================================================
  //  SAVE SYSTEM
  // ============================================================
  class SaveSystem {
    constructor() { this.key = "fiveSalahSave"; this.data = this.load(); }
    load() { const base = { learned: [], tutorialDone: false, wuduDone: false, char: null, quality: "auto", completed: false }; try { return Object.assign(base, JSON.parse(localStorage.getItem(this.key)) || {}); } catch (e) { return base; } }
    save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {} }
    reset() { this.data = { learned: [], tutorialDone: false, wuduDone: false, char: this.data.char, quality: this.data.quality, completed: false }; this.save(); }
  }

  // ============================================================
  //  INPUT MANAGER
  // ============================================================
  class InputManager {
    constructor(game) {
      this.game = game; this.keys = {}; this.move = { x: 0, y: 0 };
      this.yaw = 0; this.drag = { on: false, x: 0, id: null }; this.jump = false;
      this.bindKeys(); this.bindPointer(); this.bindJoystick();
    }
    bindKeys() {
      addEventListener("keydown", (e) => {
        this.game.audio.ensure(); this.keys[e.code] = true;
        if (e.code === "KeyE") { e.preventDefault(); this.game.interaction.trigger(); }
        if (e.code === "Escape") { e.preventDefault(); this.game.togglePause(); }
        if (e.code === "Space") { e.preventDefault(); this.jump = true; }
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      });
      addEventListener("keyup", (e) => { this.keys[e.code] = false; });
    }
    keyMove() { let x = 0, y = 0; if (this.keys.KeyW || this.keys.ArrowUp) y -= 1; if (this.keys.KeyS || this.keys.ArrowDown) y += 1; if (this.keys.KeyA || this.keys.ArrowLeft) x -= 1; if (this.keys.KeyD || this.keys.ArrowRight) x += 1; return { x, y }; }
    running() { return !!(this.keys.ShiftLeft || this.keys.ShiftRight); }
    bindPointer() {
      const cv = el("scene");
      let md = false, lx = 0;
      cv.addEventListener("mousedown", (e) => { md = true; lx = e.clientX; });
      addEventListener("mousemove", (e) => { if (md) { this.yaw -= (e.clientX - lx) * 0.006; lx = e.clientX; } });
      addEventListener("mouseup", () => { md = false; });
      document.addEventListener("touchmove", (e) => { if (this.game.state === "playing") e.preventDefault(); }, { passive: false });
    }
    // Floating joystick on the LEFT half; RIGHT half rotates the camera.
    bindJoystick() {
      const j = el("joystick"), k = el("joyKnob"), cv = el("scene"); if (!j) return; const R = 44;
      let joyId = null, jcx = 0, jcy = 0, camId = null, camX = 0;
      const showJoy = (x, y) => { j.style.left = x + "px"; j.style.top = y + "px"; j.classList.add("floating"); jcx = x; jcy = y; };
      const hideJoy = () => { j.classList.remove("floating"); k.style.transform = "translate(-50%,-50%)"; this.move.x = 0; this.move.y = 0; };
      const setKnob = (dx, dy) => { const d = Math.hypot(dx, dy) || 1, cl = Math.min(d, R), nx = dx / d * cl, ny = dy / d * cl; k.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`; this.move.x = nx / R; this.move.y = ny / R; };
      cv.addEventListener("touchstart", (e) => { this.game.audio.ensure(); document.body.classList.add("touch-mode"); for (const t of e.changedTouches) { if (t.clientX < innerWidth * 0.5 && joyId === null) { joyId = t.identifier; showJoy(t.clientX, t.clientY); setKnob(0, 0); } else if (camId === null) { camId = t.identifier; camX = t.clientX; } } }, { passive: true });
      cv.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) { if (t.identifier === joyId) setKnob(t.clientX - jcx, t.clientY - jcy); else if (t.identifier === camId) { this.yaw -= (t.clientX - camX) * 0.006; camX = t.clientX; } } }, { passive: true });
      const end = (e) => { for (const t of e.changedTouches) { if (t.identifier === joyId) { joyId = null; hideJoy(); } if (t.identifier === camId) camId = null; } };
      cv.addEventListener("touchend", end, { passive: true }); cv.addEventListener("touchcancel", end, { passive: true });
      addEventListener("touchstart", () => document.body.classList.add("touch-mode"), { once: true });
      el("btnInteract").addEventListener("touchstart", (e) => { e.preventDefault(); this.game.audio.ensure(); this.game.interaction.trigger(); }, { passive: false });
      el("btnInteract").addEventListener("click", () => this.game.interaction.trigger());
      el("btnJump").addEventListener("touchstart", (e) => { e.preventDefault(); this.jump = true; }, { passive: false });
      el("btnJump").addEventListener("click", () => { this.jump = true; });
    }
    moveVec() { const km = this.keyMove(); let x = km.x + this.move.x, y = km.y + this.move.y; const d = Math.hypot(x, y); if (d > 1) { x /= d; y /= d; } return { x, y, moving: d > 0.08, mag: Math.min(d, 1) }; }
  }

  // ============================================================
  //  GEOMETRY / MATERIAL LIBRARY
  // ============================================================
  const G = {}, M = {};
  function initLib() {
    G.box = new THREE.BoxGeometry(1, 1, 1);
    G.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    G.cone = new THREE.ConeGeometry(0.5, 1, 16);
    G.sph = new THREE.SphereGeometry(0.5, 16, 12);
    G.half = new THREE.SphereGeometry(0.5, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    G.torus = new THREE.TorusGeometry(0.45, 0.12, 8, 18);
    M.eye = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.6 });
  }
  const box = (w, h, d, mat) => { const m = new THREE.Mesh(G.box, mat); m.scale.set(w, h, d); return m; };
  const std = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });

  const SKIN = [0xf3c9a0, 0xe0ac82, 0xc68642, 0x8d5524, 0xffe0bd, 0xa56b46];
  const CLOTH = [0x2fae8f, 0x4a86e8, 0xe0555f, 0xf4a261, 0x9b6ade, 0x3ea0a0, 0xe9c46a, 0x6b8e23];

  function buildChild(opt, shadow) {
    opt = opt || {};
    const skin = std(opt.skin != null ? opt.skin : SKIN[0]);
    const cloth = std(opt.cloth != null ? opt.cloth : CLOTH[0]);
    const g = new THREE.Group();
    const legMat = std(0x3a3f4a);
    const l1 = box(0.26, 0.66, 0.26, legMat); l1.position.set(-0.16, 0.33, 0); g.add(l1);
    const l2 = box(0.26, 0.66, 0.26, legMat); l2.position.set(0.16, 0.33, 0); g.add(l2);
    g._legs = [l1, l2];
    let body; if (opt.scarf) { body = new THREE.Mesh(G.cone, cloth); body.scale.set(1.0, 1.2, 1.0); body.position.y = 1.15; } else { body = box(0.8, 0.85, 0.46, cloth); body.position.y = 1.1; }
    g.add(body);
    const a1 = box(0.18, 0.66, 0.22, cloth); a1.position.set(-0.52, 1.14, 0); g.add(a1);
    const a2 = box(0.18, 0.66, 0.22, cloth); a2.position.set(0.52, 1.14, 0); g.add(a2); g._arms = [a1, a2];
    const head = new THREE.Mesh(G.sph, skin); head.scale.set(0.58, 0.62, 0.58); head.position.y = 1.85; g.add(head);
    const e1 = new THREE.Mesh(G.sph, M.eye); e1.scale.set(0.08, 0.11, 0.06); e1.position.set(-0.13, 1.88, 0.28); g.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.13; g.add(e2);
    const smile = new THREE.Mesh(G.torus, M.eye); smile.scale.set(0.26, 0.26, 0.12); smile.position.set(0, 1.76, 0.26); smile.rotation.x = Math.PI * 0.62; g.add(smile);
    if (opt.scarf) { const sm = std(opt.scarfColor != null ? opt.scarfColor : CLOTH[4]); const hood = new THREE.Mesh(G.sph, sm); hood.scale.set(0.68, 0.7, 0.68); hood.position.y = 1.88; g.add(hood); const drape = box(0.74, 0.5, 0.2, sm); drape.position.set(0, 1.5, -0.16); g.add(drape); const fo = new THREE.Mesh(G.sph, skin); fo.scale.set(0.46, 0.5, 0.4); fo.position.set(0, 1.86, 0.14); g.add(fo); e1.position.z = e2.position.z = 0.32; smile.position.z = 0.3; }
    else { const hairMat = std(opt.hair != null ? opt.hair : 0x2a2118); const cap = new THREE.Mesh(G.half, hairMat); cap.scale.set(0.66, 0.5, 0.66); cap.position.y = 1.9; g.add(cap); if (opt.cap) { const tk = new THREE.Mesh(G.cyl, std(0xffffff)); tk.scale.set(0.5, 0.35, 0.5); tk.position.y = 2.16; g.add(tk); } }
    if (shadow) g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g._body = body;
    return g;
  }

  // ============================================================
  //  WORLD  (neighbourhood + mosque + garden + wudu + colliders)
  // ============================================================
  class World {
    constructor(scene, quality) { this.scene = scene; this.quality = quality; this.colliders = []; this.bound = 60; this.build(); }
    addCol(x, z, hw, hd) { this.colliders.push({ x, z, hw, hd }); }
    build() {
      const s = this.scene;
      this.ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), std(0x6fbf5a, 1));
      this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true; s.add(this.ground);
      // path (from home to mosque)
      const path = new THREE.Mesh(new THREE.PlaneGeometry(6, 90), std(0xdcc9a0, 1)); path.rotation.x = -Math.PI / 2; path.position.set(0, 0.02, -5); s.add(path);
      const plaza = new THREE.Mesh(new THREE.CircleGeometry(10, 28), std(0xe6d7b0, 1)); plaza.rotation.x = -Math.PI / 2; plaza.position.set(0, 0.03, -30); s.add(plaza);

      this.mosque(0, -44);
      this.home(0, 22);
      this.houses();
      this.wuduArea(-20, -30);
      this.learningPedestals(0, -30);
      this.prayerMat(0, -22);
      this.garden(22, 6);
      this.decor();

      // boundaries
      this.addCol(0, -this.bound - 2, this.bound + 4, 2); this.addCol(0, this.bound + 2, this.bound + 4, 2);
      this.addCol(-this.bound - 2, 0, 2, this.bound + 4); this.addCol(this.bound + 2, 0, 2, this.bound + 4);
    }
    labelSprite(text, x, y, z, color) {
      const cv = document.createElement("canvas"); cv.width = 512; cv.height = 96; const c = cv.getContext("2d");
      c.font = "bold 40px Trebuchet MS, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = "rgba(255,255,255,0.92)"; rr(c, 6, 18, 500, 60, 20); c.fill();
      c.fillStyle = color || "#123c4a"; c.fillText(text, 256, 50);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
      sp.scale.set(8, 1.5, 1); sp.position.set(x, y, z); return sp;
    }
    mosque(x, z) {
      const g = new THREE.Group();
      const wall = std(0xf3ead2), dome = std(0x2fae8f), gold = std(0xe9c46a);
      const body = box(20, 9, 15, wall); body.position.y = 4.5; if (this.quality !== "low") body.castShadow = true; g.add(body);
      const d = new THREE.Mesh(G.half, dome); d.scale.set(7, 7.5, 7); d.position.y = 9; g.add(d);
      const fin = new THREE.Mesh(G.sph, gold); fin.scale.set(0.5, 0.8, 0.5); fin.position.y = 12.8; g.add(fin);
      const cr = new THREE.Mesh(G.torus, gold); cr.scale.set(0.9, 0.9, 0.3); cr.position.y = 13.8; g.add(cr);
      const min = new THREE.Mesh(G.cyl, wall); min.scale.set(1.5, 16, 1.5); min.position.set(-11, 8, -5); g.add(min);
      const mt = new THREE.Mesh(G.cone, dome); mt.scale.set(2, 3, 2); mt.position.set(-11, 17, -5); g.add(mt);
      // arched windows (glow at night)
      this.mosqueLights = [];
      for (const wx of [-6, 0, 6]) { const win = box(2, 3.5, 0.3, new THREE.MeshStandardMaterial({ color: 0x2a4a5a, emissive: 0xffd98a, emissiveIntensity: 0 })); win.position.set(wx, 4, 7.6); g.add(win); this.mosqueLights.push(win.material); }
      const arch = box(4, 5.5, 1, gold); arch.position.set(0, 2.7, 7.4); g.add(arch);
      const door = box(3, 4.5, 0.4, std(0x5b3a1e)); door.position.set(0, 2.2, 7.8); g.add(door);
      const court = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), std(0xe4dcc4, 1)); court.rotation.x = -Math.PI / 2; court.position.set(0, 0.04, 11); g.add(court);
      g.add(this.labelSprite("🕌 Mosque", 0, 15, 7, "#1d6f7a"));
      g.position.set(x, 0, z); s_add(this.scene, g);
      this.addCol(x, z, 10.5, 8); this.addCol(x - 11, z - 5, 1.4, 1.4);
    }
    home(x, z) {
      const g = new THREE.Group();
      const body = box(9, 6, 8, std(0xf0a5a5)); body.position.y = 3; if (this.quality !== "low") body.castShadow = true; g.add(body);
      const roof = new THREE.Mesh(G.cone, std(0x9a3a3a)); roof.scale.set(8, 4, 8); roof.rotation.y = Math.PI / 4; roof.position.y = 7.5; g.add(roof);
      const door = box(1.8, 3, 0.3, std(0x5b3a1e)); door.position.set(0, 1.5, 4.05); g.add(door);
      g.add(this.labelSprite("🏠 Home", 0, 8.5, 4, "#9a3a3a"));
      g.position.set(x, 0, z); s_add(this.scene, g); this.addCol(x, z, 4.8, 4.3);
      this.homePos = { x, z: z - 5 };
    }
    houses() {
      const specs = [[-24, 10, 0x88b0e0], [24, 22, 0xa5e0c0], [-26, -6, 0xc9a0e0], [26, -14, 0xf0d080]];
      for (const [x, z, c] of specs) { const g = new THREE.Group(); const b = box(8, 6, 8, std(c)); b.position.y = 3; if (this.quality !== "low") b.castShadow = true; g.add(b); const r = new THREE.Mesh(G.cone, std(0x7a5a3a)); r.scale.set(7.4, 3.6, 7.4); r.rotation.y = Math.PI / 4; r.position.y = 7.2; g.add(r); g.position.set(x, 0, z); s_add(this.scene, g); this.addCol(x, z, 4.3, 4.3); }
    }
    wuduArea(x, z) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(G.cyl, std(0xbfc7cf)); base.scale.set(5, 0.6, 5); base.position.y = 0.3; g.add(base);
      const water = new THREE.Mesh(G.cyl, std(0x5ec8e3, 0.3)); water.scale.set(4.2, 0.4, 4.2); water.position.y = 0.5; g.add(water);
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; const tap = new THREE.Mesh(G.cyl, std(0x888e99)); tap.scale.set(0.16, 1.4, 0.16); tap.position.set(Math.cos(a) * 2, 1, Math.sin(a) * 2); g.add(tap); }
      g.add(this.labelSprite("💧 Wudu Area", 0, 3.4, 0, "#1d6f7a"));
      g.position.set(x, 0, z); s_add(this.scene, g); this.addCol(x, z, 2.5, 2.5);
      this.wuduPos = { x, z: z + 6 };
    }
    learningPedestals(x, z) {
      this.pedestals = [];
      const spread = 8;
      SALAH.forEach((sp, i) => {
        const px = x + (i - 2) * spread, pz = z;
        const g = new THREE.Group();
        const ped = new THREE.Mesh(G.cyl, std(0xe9c46a)); ped.scale.set(1.5, 1.4, 1.5); ped.position.y = 0.7; g.add(ped);
        const orb = new THREE.Mesh(G.sph, new THREE.MeshStandardMaterial({ color: 0x2fae8f, emissive: 0x1d6f7a, emissiveIntensity: 0.4 })); orb.scale.set(1.1, 1.1, 1.1); orb.position.y = 2; g.add(orb);
        g.add(this.labelSprite(sp.icon + " " + sp.name, 0, 3.4, 0, "#1d6f7a"));
        g.position.set(px, 0, pz); s_add(this.scene, g);
        this.pedestals.push({ x: px, z: pz, group: g, orb, salah: sp });
      });
    }
    prayerMat(x, z) {
      const g = new THREE.Group();
      const mat = box(3, 0.1, 4.5, std(0x2fae8f)); mat.position.y = 0.06; g.add(mat);
      const trim = box(3.2, 0.08, 4.7, std(0xe9c46a)); trim.position.y = 0.04; g.add(trim);
      // little arch pattern at the top
      const arch = new THREE.Mesh(G.half, std(0xe9c46a)); arch.scale.set(1, 1, 0.1); arch.position.set(0, 0.12, -1.6); arch.rotation.x = -Math.PI / 2; g.add(arch);
      g.position.set(x, 0, z); s_add(this.scene, g); this.matGroup = g; this.matPos = { x, z };
    }
    tree() { const t = new THREE.Group(); const tr = new THREE.Mesh(G.cyl, std(0x6b4423)); tr.scale.set(0.5, 2.4, 0.5); tr.position.y = 1.2; t.add(tr); const top = new THREE.Mesh(G.sph, std(0x3a9a4a)); top.scale.set(2.2, 2.4, 2.2); top.position.y = 3.4; if (this.quality === "high") top.castShadow = true; t.add(top); return t; }
    garden(x, z) {
      const g = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.CircleGeometry(12, 24), std(0x7fd06a, 1)); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.03; g.add(pad);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const t = this.tree(); t.position.set(Math.cos(a) * 8, 0, Math.sin(a) * 8); g.add(t); }
      // flower dots
      for (let i = 0; i < 14; i++) { const f = new THREE.Mesh(G.sph, std(pick([0xff8fab, 0xffd166, 0x9b6ade]))); f.scale.set(0.3, 0.3, 0.3); f.position.set(rand(-9, 9), 0.3, rand(-9, 9)); g.add(f); }
      g.add(this.labelSprite("🌳 Garden", 0, 6, 0, "#2a7a3a"));
      g.position.set(x, 0, z); s_add(this.scene, g);
    }
    decor() {
      for (let i = 0; i < 16; i++) { const side = i % 2 ? 1 : -1; const along = -44 + i * 6; const t = this.tree(); t.position.set(side * 5, 0, along); s_add(this.scene, t); this.addCol(side * 5, along, 0.9, 0.9); }
      // lamp posts (glow at night)
      this.lampMats = [];
      for (let i = 0; i < 6; i++) { const g = new THREE.Group(); const p = new THREE.Mesh(G.cyl, std(0x888e99)); p.scale.set(0.18, 5, 0.18); p.position.y = 2.5; g.add(p); const b = new THREE.Mesh(G.sph, new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffcf6b, emissiveIntensity: 0 })); b.scale.set(0.4, 0.4, 0.4); b.position.y = 5; g.add(b); g.position.set((i % 2 ? 1 : -1) * 4, 0, -40 + i * 14); s_add(this.scene, g); this.lampMats.push(b.material); }
      // clouds
      this.clouds = []; const cm = std(0xffffff, 1);
      for (let i = 0; i < 7; i++) { const c = new THREE.Group(); for (let j = 0; j < 3; j++) { const p = new THREE.Mesh(G.sph, cm); p.scale.set(rand(4, 7), rand(3, 4), rand(4, 7)); p.position.set(rand(-5, 5), rand(-1, 1), rand(-4, 4)); c.add(p); } c.position.set(rand(-55, 55), rand(26, 40), rand(-55, 55)); s_add(this.scene, c); this.clouds.push(c); }
      this.cloudMat = cm;
    }
    resolve(nx, nz, r) {
      let x = nx, z = nz;
      for (const c of this.colliders) {
        const minX = c.x - c.hw - r, maxX = c.x + c.hw + r, minZ = c.z - c.hd - r, maxZ = c.z + c.hd + r;
        if (x > minX && x < maxX && z > minZ && z < maxZ) { const oL = x - minX, oR = maxX - x, oT = z - minZ, oB = maxZ - z, m = Math.min(oL, oR, oT, oB); if (m === oL) x = minX; else if (m === oR) x = maxX; else if (m === oT) z = minZ; else z = maxZ; }
      }
      const b = this.bound; return { x: clamp(x, -b, b), z: clamp(z, -b, b) };
    }
    setNight(n) { const e = n * 1.4; for (const m of this.mosqueLights) m.emissiveIntensity = e; for (const m of this.lampMats) m.emissiveIntensity = e; for (const p of this.pedestals) p.orb.material.emissiveIntensity = 0.3 + n * 0.5; }
    update(dt) { for (const c of this.clouds) { c.position.x += dt * 0.5; if (c.position.x > 60) c.position.x = -60; } }
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function s_add(scene, o) { scene.add(o); }

  // ============================================================
  //  PLAYER
  // ============================================================
  class Player {
    constructor(scene, char, quality) {
      this.group = buildChild(char, quality !== "low"); this.group.position.set(0, 0, 17); scene.add(this.group);
      this.x = 0; this.z = 17; this.facing = Math.PI; this.walk = 0; this.vy = 0; this.y = 0; this.onGround = true; this.pose = null; this.poseT = 0;
    }
    update(dt, mv, camYaw, world, running, jumpReq) {
      let moving = mv.moving;
      if (!this.pose) {
        if (moving) {
          const s = Math.sin(camYaw), c = Math.cos(camYaw);
          let dx = mv.x * c - mv.y * s, dz = mv.x * s + mv.y * c; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
          const spd = (running ? 9.5 : 5.5) * mv.mag;
          const r = world.resolve(this.x + dx * spd * dt, this.z + dz * spd * dt, 0.5); this.x = r.x; this.z = r.z;
          this.facing = Math.atan2(dx, dz); this.walk += dt * (running ? 16 : 11);
        } else this.walk *= 0.8;
        // jump
        if (jumpReq && this.onGround) { this.vy = 6.4; this.onGround = false; }
        this.vy -= 18 * dt; this.y += this.vy * dt; if (this.y <= 0) { this.y = 0; this.vy = 0; this.onGround = true; }
      }
      this.group.position.set(this.x, this.y + (this.pose ? 0 : Math.abs(Math.sin(this.walk)) * (moving ? 0.05 : 0)), this.z);
      this.group.rotation.y = lerp(this.group.rotation.y, this.facing, 0.2);
      const sw = Math.sin(this.walk) * (moving && !this.pose ? 0.5 : 0);
      if (this.group._legs) { this.group._legs[0].rotation.x = sw; this.group._legs[1].rotation.x = -sw; }
      if (this.group._arms && !this.pose) { this.group._arms[0].rotation.x = -sw; this.group._arms[1].rotation.x = sw; }
      return moving;
    }
    // respectful pose demonstration (educational)
    setPose(name) {
      this.pose = name; const g = this.group;
      g.rotation.x = 0; g.position.y = this.y; if (g._arms) { g._arms[0].rotation.x = 0; g._arms[1].rotation.x = 0; }
      if (g._legs) { g._legs[0].rotation.x = 0; g._legs[1].rotation.x = 0; }
      if (!name) return;
      if (/Ruku/.test(name)) { g.rotation.x = 1.1; if (g._arms) { g._arms[0].rotation.x = 0.6; g._arms[1].rotation.x = 0.6; } }
      else if (/Sujud/.test(name)) { g.rotation.x = 1.5; g.position.y = this.y - 0.2; }
      else if (/Sitting/.test(name)) { g.position.y = this.y - 0.3; if (g._legs) { g._legs[0].rotation.x = 1.4; g._legs[1].rotation.x = 1.4; } }
      else if (/Takbir/.test(name)) { if (g._arms) { g._arms[0].rotation.x = -1.4; g._arms[1].rotation.x = -1.4; } }
    }
  }

  // ============================================================
  //  CAMERA
  // ============================================================
  class CameraController {
    constructor(cam, input) { this.cam = cam; this.input = input; this._t = new THREE.Vector3(); }
    update(dt, p) {
      const yaw = this.input.yaw, D = 9.5, H = 6;
      this.cam.position.x = lerp(this.cam.position.x, p.x - Math.sin(yaw) * D, 0.12);
      this.cam.position.z = lerp(this.cam.position.z, p.z - Math.cos(yaw) * D, 0.12);
      this.cam.position.y = lerp(this.cam.position.y, p.y + H, 0.1);
      this._t.set(p.x, p.y + 1.7, p.z); this.cam.lookAt(this._t);
    }
  }

  // ============================================================
  //  INTERACTION SYSTEM
  // ============================================================
  class InteractionSystem {
    constructor(game) { this.game = game; this.items = []; this.current = null; }
    register(it) { this.items.push(it); return it; }
    update(p) {
      let best = null, bd = Infinity;
      for (const it of this.items) { const d = dist2(it.x, it.z, p.x, p.z); if (d < it.radius * it.radius && d < bd) { best = it; bd = d; } }
      this.current = best;
      const pr = el("interactPrompt");
      if (best && this.game.state === "playing") { el("promptText").textContent = best.label; pr.classList.remove("hidden"); } else pr.classList.add("hidden");
    }
    trigger() { if (this.game.state !== "playing") return; if (this.current && this.current.onInteract) { this.game.audio.click(); this.current.onInteract(); } }
  }

  // ============================================================
  //  UI MANAGER  (generic modal + HUD)
  // ============================================================
  class UIManager {
    constructor(game) { this.game = game; this.modal = el("modal"); this.content = el("modalContent"); }
    hud() {
      const sp = SALAH[this.game.prayerIndex];
      el("prayerIcon").textContent = sp.icon; el("prayerName").textContent = sp.name; el("prayerTime").textContent = sp.when;
      el("progressText").textContent = this.game.save.data.learned.length + " / 5";
    }
    toast(msg) { const t = el("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(this._t); this._t = setTimeout(() => t.classList.remove("show"), 2400); }
    open(html) { this.content.innerHTML = html; this.modal.classList.remove("hidden"); this.game.state = "modal"; }
    close() { this.modal.classList.add("hidden"); if (this.game.state === "modal") this.game.state = "playing"; }
    // helper: build buttons wiring by data-action
    wire(map) { this.content.querySelectorAll("[data-act]").forEach((b) => { b.onclick = () => { this.game.audio.click(); const fn = map[b.dataset.act]; if (fn) fn(b); }; }); }
  }

  // ============================================================
  //  GAME
  // ============================================================
  class Game {
    constructor() {
      this.state = "menu"; this.prayerIndex = 0; this.nightTarget = 0; this.night = 0;
      this.audio = new AudioManager(); this.save = new SaveSystem();
      this.quality = this.save.data.quality || "auto";
      this.char = this.save.data.char || { gender: "boy", skin: SKIN[0], cloth: CLOTH[0], scarf: false, hair: 0x2a2118 };
      initLib(); this.initThree();
      this.ui = new UIManager(this); this.input = new InputManager(this); this.camCtl = new CameraController(this.camera, this.input);
      this.interaction = new InteractionSystem(this); this.built = false;
      this.bindMenu();
      this.last = performance.now(); this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop); el("loadScreen").classList.add("hidden");
    }
    effQ() { if (this.quality !== "auto") return this.quality; const m = matchMedia("(hover:none) and (pointer:coarse)").matches || innerWidth < 760; return m ? "low" : "high"; }
    initThree() {
      const q = this.effQ();
      this.renderer = new THREE.WebGLRenderer({ canvas: el("scene"), antialias: q !== "low", powerPreference: "high-performance" });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === "high" ? 2 : q === "medium" ? 1.5 : 1));
      this.renderer.setSize(innerWidth, innerHeight);
      this.renderer.shadowMap.enabled = q === "high"; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x9fd8f0); this.scene.fog = new THREE.Fog(0x9fd8f0, 70, 150);
      this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400); this.camera.position.set(0, 6, 26);
      this.hemi = new THREE.HemisphereLight(0xcfefff, 0x6a8a5a, 0.85); this.scene.add(this.hemi);
      this.amb = new THREE.AmbientLight(0xffffff, 0.4); this.scene.add(this.amb);
      this.sun = new THREE.DirectionalLight(0xfff2d0, 1.0); this.sun.position.set(30, 50, 20);
      if (q === "high") { this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024); const c = this.sun.shadow.camera, d = 60; c.left = -d; c.right = d; c.top = d; c.bottom = -d; c.near = 1; c.far = 160; }
      this.scene.add(this.sun); this.scene.add(this.sun.target);
      // sun & moon meshes + stars
      this.sunMesh = new THREE.Mesh(G.sph, new THREE.MeshBasicMaterial({ color: 0xfff2b0 })); this.sunMesh.scale.setScalar(6); this.scene.add(this.sunMesh);
      this.moonMesh = new THREE.Mesh(G.sph, new THREE.MeshBasicMaterial({ color: 0xdfe8ff })); this.moonMesh.scale.setScalar(4); this.scene.add(this.moonMesh);
      const sg = new THREE.BufferGeometry(); const pts = []; for (let i = 0; i < 220; i++) { const r = 130, th = rand(0, Math.PI * 2), ph = rand(0.1, 1.2); pts.push(Math.cos(th) * Math.sin(ph) * r, Math.abs(Math.cos(ph)) * r + 10, Math.sin(th) * Math.sin(ph) * r); } sg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, transparent: true, opacity: 0 })); this.scene.add(this.stars);
      addEventListener("resize", () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); });
    }

    // ---------------- environment per prayer ----------------
    envFor(i) {
      // sky color, night factor 0..1, sun/moon angle
      const table = [
        { sky: 0x2a3b6a, night: 0.7, sun: 0.08 },   // Fajr — dark blue toward dawn
        { sky: 0x8fd0f0, night: 0.0, sun: 0.5 },    // Dhuhr — bright midday
        { sky: 0xbfd6e0, night: 0.1, sun: 0.72 },   // Asr — warm afternoon
        { sky: 0xf0a05a, night: 0.35, sun: 0.9 },   // Maghrib — orange sunset
        { sky: 0x0e1836, night: 1.0, sun: 1.05 },   // Isha — night
      ];
      return table[i];
    }
    applyEnv(dt) {
      const e = this.envFor(this.prayerIndex);
      this.nightTarget = e.night;
      this.night = lerp(this.night, this.nightTarget, dt ? clamp(dt * 2, 0, 1) : 1);
      const sky = new THREE.Color(e.sky);
      // ease current bg toward target
      if (!this._sky) this._sky = new THREE.Color(e.sky);
      this._sky.lerp(sky, dt ? clamp(dt * 2, 0, 1) : 1);
      this.scene.background = this._sky; this.scene.fog.color = this._sky;
      this.sun.intensity = lerp(1.15, 0.12, this.night); this.amb.intensity = lerp(0.5, 0.2, this.night); this.hemi.intensity = lerp(0.9, 0.28, this.night);
      this.sun.color.setHex(this.prayerIndex === 3 ? 0xffb066 : 0xfff2d0);
      // sun/moon arc across sky based on prayer
      const ang = e.sun * Math.PI; const R = 90;
      this.sunMesh.position.set(Math.cos(ang) * R, Math.sin(ang) * 70 + 4, -40);
      this.sun.position.set(Math.cos(ang) * 40, Math.max(6, Math.sin(ang) * 55), 20); this.sun.target.position.set(0, 0, -20);
      this.sunMesh.visible = this.night < 0.85;
      this.moonMesh.position.set(-Math.cos(ang) * R, Math.sin(ang) * 60 + 20, -40); this.moonMesh.visible = this.night > 0.4;
      this.stars.material.opacity = clamp((this.night - 0.4) / 0.6, 0, 1);
      if (this.world) this.world.setNight(this.night);
    }

    // ---------------- build world + interactions ----------------
    buildWorld() {
      if (this.built) return; this.built = true; const q = this.effQ();
      this.world = new World(this.scene, q);
      this.player = new Player(this.scene, this.char, q);
      // learning pedestals (five salah)
      for (const ped of this.world.pedestals) {
        this.interaction.register({ x: ped.x, z: ped.z + 2, radius: 3, label: "Learn " + ped.salah.name, onInteract: () => this.openPrayerLesson(ped.salah) });
      }
      // wudu
      this.interaction.register({ x: this.world.wuduPos.x, z: this.world.wuduPos.z, radius: 4, label: "Perform Wudu", onInteract: () => this.startWudu() });
      // prayer mat / qiblah + positions
      this.interaction.register({ x: this.world.matPos.x, z: this.world.matPos.z, radius: 3.5, label: "Prayer area (Qiblah)", onInteract: () => this.startQiblah() });
      // mosque etiquette
      this.interaction.register({ x: 0, z: -33, radius: 4, label: "Mosque courtyard", onInteract: () => this.openEtiquette() });
      // home
      this.interaction.register({ x: this.world.homePos.x, z: this.world.homePos.z, radius: 3.5, label: "Home", onInteract: () => this.ui.open(`<div class="big-emoji">🏠</div><h2 class="title small">Home</h2><p class="lead">This is where the day begins. Explore the neighbourhood and visit the mosque to learn the five daily Salah!</p><div class="modal-btns"><button class="btn primary" data-act="close">Okay</button></div>`) || this.ui.wire({ close: () => this.ui.close() }) });
    }

    // ---------------- lessons ----------------
    openPrayerLesson(sp) {
      const learned = this.save.data.learned.includes(sp.key);
      this.ui.open(`
        <div class="big-emoji">${sp.icon}</div>
        <h2 class="title small">${sp.name}</h2>
        <p class="lead">${esc(sp.meaning)}</p>
        <div class="fact-grid">
          <div class="fact"><span>WHEN</span><b>${esc(sp.when)}</b></div>
          <div class="fact"><span>OBLIGATORY (FARD)</span><b>${sp.fard} rak'ahs</b></div>
        </div>
        <p class="note">Besides the obligatory (fard) rak'ahs, there are also optional Sunnah prayers. Actual prayer times change with your location and the date — ask your family or local mosque.</p>
        <div class="modal-btns">
          <button class="btn primary" data-act="learn">${learned ? "Review the lesson" : "Start the lesson"}</button>
          <button class="btn ghost" data-act="close">Back</button>
        </div>`);
      this.ui.wire({ close: () => this.ui.close(), learn: () => this.beginLessonFlow(sp) });
    }
    beginLessonFlow(sp) {
      // If wudu never done, gently suggest it first (but allow continue)
      if (!this.save.data.wuduDone) { this.startWudu(() => this.startPositions(sp)); }
      else this.startQiblah(() => this.startPositions(sp), sp);
    }

    // ---- Wudu mini-game ----
    startWudu(onDone) {
      let order = 0; const self = this;
      const render = () => {
        const stepsHtml = WUDU.map((s, i) => `<div class="step ${i < order ? "done" : i === order ? "next" : ""}" data-act="step" data-i="${i}"><span class="s-num">${i + 1}</span>${esc(s)}</div>`).join("");
        this.ui.open(`
          <div class="big-emoji">💧</div>
          <h2 class="title small">Wudu — Getting Clean</h2>
          <p class="lead">Tap each step <b>in order</b> to learn how we make Wudu before Salah.</p>
          <div class="steps">${stepsHtml}</div>
          <div class="modal-btns"><button class="btn ghost" data-act="skip">Skip for now</button></div>`);
        this.ui.wire({
          skip: () => { this.ui.close(); if (onDone) onDone(); },
          step: (b) => {
            const i = +b.dataset.i;
            if (i === order) { this.audio.step(); order++; if (order >= WUDU.length) { this.audio.good(); this.save.data.wuduDone = true; this.save.save(); this.ui.open(`<div class="big-emoji">✨</div><h2 class="title small">Wudu Complete!</h2><p class="lead">Great! Now you are clean and ready to learn Salah.</p><div class="badge-pop">🏅 Wudu Helper</div><div class="modal-btns"><button class="btn primary" data-act="next">Continue</button></div>`); this.ui.wire({ next: () => { this.ui.close(); if (onDone) onDone(); } }); } else render(); }
            else { this.audio.gentle(); this.ui.toast("Let's try that step again. 🙂"); }
          },
        });
      };
      render();
    }

    // ---- Qiblah ----
    startQiblah(onDone, sp) {
      let angle = rand(60, 300); const target = 0; // target at top (0deg)
      const self = this;
      const render = () => {
        const aligned = Math.abs(((angle % 360) + 360) % 360) < 18 || Math.abs(((angle % 360) + 360) % 360) > 342;
        this.ui.open(`
          <div class="big-emoji">🧭</div>
          <h2 class="title small">Face the Qiblah</h2>
          <p class="lead">Muslims around the world face the Ka'bah in Makkah during Salah. Turn the mat so the arrow points to the Qiblah 🕋.</p>
          <div class="qiblah-wrap"><div class="qiblah-dial"></div><div class="qiblah-target">🕋</div><div class="qiblah-arrow" style="transform:translate(-50%,-100%) rotate(${angle}deg)"></div></div>
          <div class="modal-btns row"><button class="btn" data-act="left">⟲ Left</button><button class="btn" data-act="right">Right ⟳</button></div>
          <div class="modal-btns"><button class="btn ${aligned ? "primary" : "ghost"}" data-act="confirm">${aligned ? "Perfect — Face Qiblah ✓" : "Keep turning…"}</button></div>`);
        this.ui.wire({
          left: () => { angle -= 20; this.audio.click(); render(); },
          right: () => { angle += 20; this.audio.click(); render(); },
          confirm: () => { if (aligned) { this.audio.good(); this.world.matGroup.rotation.y = 0; this.ui.close(); if (onDone) onDone(); else this.ui.toast("You faced the Qiblah! 🧭"); } else { this.audio.gentle(); this.ui.toast("Turn the arrow toward 🕋 at the top."); } },
        });
      };
      render();
    }

    // ---- Salah positions demo (respectful, no scoring) ----
    startPositions(sp) {
      // move player to mat & face qiblah
      this.player.x = this.world.matPos.x; this.player.z = this.world.matPos.z + 1.2; this.player.facing = Math.PI; this.player.group.rotation.y = Math.PI;
      let i = 0; const self = this;
      const show = () => {
        const pos = POSITIONS[i]; this.player.setPose(pos.name);
        // translucent overlay so the character stays visible behind
        this.ui.open(`
          <div class="big-emoji">🧎</div>
          <div class="pose-cap">${esc(pos.name)}</div>
          <p class="lead">${esc(pos.desc)}</p>
          <p class="disclaimer">A fictional child is shown learning the positions. This is for learning only — real Salah is performed in real life.</p>
          <div class="modal-btns"><button class="btn primary" data-act="next">${i < POSITIONS.length - 1 ? "Next position →" : "Finish lesson"}</button></div>`);
        this.modalTranslucent(true);
        this.ui.wire({ next: () => { this.audio.step(); i++; if (i >= POSITIONS.length) { this.modalTranslucent(false); this.player.setPose(null); this.finishLesson(sp); } else show(); } });
      };
      show();
    }
    modalTranslucent(on) { el("modal").style.background = on ? "rgba(10,30,36,0.35)" : ""; }

    finishLesson(sp) {
      const first = !this.save.data.learned.includes(sp.key);
      if (first) { this.save.data.learned.push(sp.key); this.save.save(); this.audio.badge(); }
      this.ui.open(`
        <div class="big-emoji">🌟</div>
        <h2 class="title small">${first ? "You learned it!" : "Nice review!"}</h2>
        <p class="lead">You learned about <b>${sp.name}</b> — ${sp.fard} obligatory rak'ahs, prayed ${esc(sp.when.toLowerCase())}.</p>
        <div class="badge-pop">🏅 ${esc(sp.badge)}</div>
        <p class="note">Great! You remember the sequence: standing, bowing, and prostrating — done calmly and respectfully.</p>
        <div class="modal-btns"><button class="btn primary" data-act="ok">Continue</button></div>`);
      this.ui.wire({ ok: () => { this.ui.close(); this.ui.hud(); this.refreshPedestals(); if (this.save.data.learned.length >= 5 && !this.save.data.completed) this.showCompletion(); } });
    }
    refreshPedestals() { for (const p of this.world.pedestals) { const done = this.save.data.learned.includes(p.salah.key); p.orb.material.color.setHex(done ? 0xe9c46a : 0x2fae8f); } }

    openEtiquette() {
      this.ui.open(`
        <div class="big-emoji">🕌</div>
        <h2 class="title small">Mosque Manners</h2>
        <p class="lead">Near the mosque we walk calmly, speak quietly, keep the area clean, and remove our shoes before entering the prayer area. Being respectful is a beautiful habit. 🤍</p>
        <div class="modal-btns"><button class="btn primary" data-act="ok">I'll be respectful 🤍</button></div>`);
      this.ui.wire({ ok: () => this.ui.close() });
    }

    // ---------------- Encyclopedia ----------------
    openEncyclopedia() {
      const list = ENCYCLOPEDIA.map((e, i) => `<button class="topic" data-act="topic" data-i="${i}">📗 ${esc(e.t)}</button>`).join("");
      this.ui.open(`<div class="big-emoji">📖</div><h2 class="title small">Learn Salah</h2><div class="topic-list">${list}</div><div class="modal-btns"><button class="btn ghost" data-act="close">Back</button></div>`);
      this.ui.wire({ close: () => this.fromMenuOrPlay(), topic: (b) => { const e = ENCYCLOPEDIA[+b.dataset.i]; this.ui.open(`<div class="big-emoji">📗</div><h2 class="title small">${esc(e.t)}</h2><p class="lead">${esc(e.b)}</p><div class="modal-btns"><button class="btn primary" data-act="back">← Topics</button></div>`); this.ui.wire({ back: () => this.openEncyclopedia() }); } });
    }
    fromMenuOrPlay() { if (this.built && this.state === "modal" && el("hud").classList.contains("hidden") === false) this.ui.close(); else if (!this.built) { this.ui.close(); this.showMenu(); } else this.ui.close(); }

    // ---------------- Map ----------------
    openMap() {
      this.ui.open(`
        <div class="big-emoji">🗺️</div><h2 class="title small">Neighbourhood Map</h2>
        <div class="board">
          <div class="board-row" data-act="go" data-x="0" data-z="-33"><span class="b-ico">🕌</span><span class="b-name">Mosque & Learning Area</span><span class="b-status">Go →</span></div>
          <div class="board-row" data-act="go" data-x="-20" data-z="-24"><span class="b-ico">💧</span><span class="b-name">Wudu Area</span><span class="b-status">Go →</span></div>
          <div class="board-row" data-act="go" data-x="0" data-z="-20"><span class="b-ico">🧎</span><span class="b-name">Prayer Area (Qiblah)</span><span class="b-status">Go →</span></div>
          <div class="board-row" data-act="go" data-x="22" data-z="6"><span class="b-ico">🌳</span><span class="b-name">Garden</span><span class="b-status">Go →</span></div>
          <div class="board-row" data-act="go" data-x="0" data-z="16"><span class="b-ico">🏠</span><span class="b-name">Home</span><span class="b-status">Go →</span></div>
        </div>
        <div class="modal-btns"><button class="btn ghost" data-act="close">Back</button></div>`);
      this.ui.wire({ close: () => this.ui.close(), go: (b) => { this.player.x = +b.dataset.x; this.player.z = +b.dataset.z; this.ui.close(); this.ui.toast("You travelled there ✨"); } });
    }

    // ---------------- Progress board ----------------
    // (accessible via Learn button on play -> shows board + encyclopedia entry)
    openLearnHub() {
      const rows = SALAH.map((sp) => { const done = this.save.data.learned.includes(sp.key); return `<div class="board-row ${done ? "done" : ""}"><span class="b-ico">${sp.icon}</span><span class="b-name">${sp.name}</span><span class="b-status ${done ? "" : "no"}">${done ? "✓ Learned" : "○ Not yet"}</span></div>`; }).join("");
      this.ui.open(`
        <div class="big-emoji">🕌</div><h2 class="title small">Today's Salah</h2>
        <div class="board">${rows}</div>
        <div class="modal-btns"><button class="btn primary" data-act="enc">📖 Learn Salah (Encyclopedia)</button><button class="btn" data-act="how">🧭 How to learn each one</button><button class="btn ghost" data-act="close">Close</button></div>`);
      this.ui.wire({ close: () => this.ui.close(), enc: () => this.openEncyclopedia(), how: () => { this.ui.open(`<div class="big-emoji">💡</div><h2 class="title small">How to learn</h2><p class="lead">Walk to the mosque courtyard and step onto a glowing <b>pedestal</b> for each prayer. First make <b>Wudu</b> 💧, face the <b>Qiblah</b> 🧭, then learn the <b>positions</b> 🧎. Each one you learn earns a badge!</p><div class="modal-btns"><button class="btn primary" data-act="ok">Got it</button></div>`); this.ui.wire({ ok: () => this.openLearnHub() }); } });
    }

    // ---------------- Completion ----------------
    showCompletion() {
      this.save.data.completed = true; this.save.save(); this.audio.badge();
      const rows = SALAH.map((sp) => `<div class="board-row done"><span class="b-ico">${sp.icon}</span><span class="b-name">${sp.name}</span><span class="b-status">✓</span></div>`).join("");
      this.ui.open(`
        <div class="big-emoji">🌟</div><h2 class="title small">You learned all five!</h2>
        <div class="board">${rows}</div>
        <p class="note">A game can teach you about Salah, but real Salah is performed in real life. Ask your family to help you learn and pray. 💛</p>
        <p class="lead"><b>Free Exploration unlocked!</b> 🗺️</p>
        <div class="modal-btns"><button class="btn primary" data-act="explore">Keep Exploring</button></div>`);
      this.ui.wire({ explore: () => this.ui.close() });
    }

    // ---------------- Menu wiring ----------------
    bindMenu() {
      el("playBtn").onclick = () => { this.audio.ensure(); this.audio.click(); this.openCharSelect(); };
      el("learnMenuBtn").onclick = () => { this.audio.click(); this.openEncyclopedia(); };
      el("howBtn").onclick = () => { this.audio.click(); this.openHow(); };
      el("settingsBtn").onclick = () => { this.audio.click(); this.openSettings(); };
      el("learnBtn").onclick = () => { this.audio.click(); this.openLearnHub(); };
      el("mapBtn").onclick = () => { this.audio.click(); this.openMap(); };
      el("advanceBtn").onclick = () => { this.audio.click(); this.advanceTime(); };
      el("pauseBtn").onclick = () => this.togglePause();
      el("soundBtn").onclick = () => { const m = this.audio.toggle(); el("soundBtn").textContent = m ? "🔇" : "🔊"; };
    }
    showMenu() { this.state = "menu"; el("menuScreen").classList.remove("hidden"); el("hud").classList.add("hidden"); }
    openHow() {
      this.ui.open(`<div class="big-emoji">🎮</div><h2 class="title small">How to Play</h2>
        <div class="how-list"><div><b>Move</b><span>W A S D / Arrows / joystick</span></div><div><b>Run</b><span>Shift</span></div><div><b>Camera</b><span>Drag mouse / screen</span></div><div><b>Interact</b><span>E / ✋ button</span></div><div><b>Jump</b><span>Space / ⤒</span></div><div><b>Pause</b><span>Esc / ⏸</span></div></div>
        <p class="lead">Explore the town, visit the <b>mosque</b> 🕌, make <b>Wudu</b> 💧, face the <b>Qiblah</b> 🧭, and learn each of the five daily prayers.</p>
        <div class="modal-btns"><button class="btn primary" data-act="close">Back</button></div>`);
      this.ui.wire({ close: () => { this.ui.close(); if (!this.built) this.showMenu(); } });
    }
    openSettings() {
      const q = this.quality;
      this.ui.open(`<div class="big-emoji">⚙</div><h2 class="title small">Settings</h2>
        <div class="row-line"><span>Graphics</span><div class="seg" id="qseg">${["low", "medium", "high", "auto"].map((x) => `<button data-act="q" data-q="${x}" class="${x === q ? "on" : ""}">${x[0].toUpperCase() + x.slice(1)}</button>`).join("")}</div></div>
        <div class="row-line"><span>Sound</span><div class="seg">${["on", "off"].map((x) => `<button data-act="s" data-s="${x}" class="${(x === "off") === this.audio.muted ? "on" : ""}">${x.toUpperCase()}</button>`).join("")}</div></div>
        <button class="btn ghost" data-act="reset">↺ Reset progress</button>
        <div class="modal-btns"><button class="btn primary" data-act="close">Back</button></div>`);
      this.ui.wire({
        close: () => { this.ui.close(); if (!this.built) this.showMenu(); },
        q: (b) => { this.quality = b.dataset.q; this.save.data.quality = this.quality; this.save.save(); localStorage.setItem("fiveSalahQ", this.quality); this.content.querySelectorAll("#qseg button").forEach((x) => x.classList.toggle("on", x.dataset.q === this.quality)); this.ui.toast("Applies next time you start"); },
        s: (b) => { this.audio.muted = b.dataset.s === "off"; el("soundBtn").textContent = this.audio.muted ? "🔇" : "🔊"; this.openSettings(); },
        reset: () => { this.save.reset(); this.ui.toast("Progress reset"); if (this.built) this.refreshPedestals(), this.ui.hud(); },
      });
    }
    openCharSelect() {
      const skinSw = SKIN.map((c) => `<div class="swatch ${this.char.skin === c ? "on" : ""}" data-act="skin" data-c="${c}" style="background:#${c.toString(16).padStart(6, "0")}"></div>`).join("");
      const clothSw = CLOTH.map((c) => `<div class="swatch ${this.char.cloth === c ? "on" : ""}" data-act="cloth" data-c="${c}" style="background:#${c.toString(16).padStart(6, "0")}"></div>`).join("");
      this.ui.open(`
        <h2 class="title small">Choose Your Character</h2>
        <div class="char-preview" id="cp">${this.char.gender === "girl" ? (this.char.scarf ? "🧕" : "👧") : "🧒"}</div>
        <div class="row-line"><span>Look</span><div class="seg">${["boy", "girl"].map((g) => `<button data-act="g" data-g="${g}" class="${this.char.gender === g ? "on" : ""}">${g[0].toUpperCase() + g.slice(1)}</button>`).join("")}</div></div>
        <div class="row-line"><span>Skin</span><div class="swatches">${skinSw}</div></div>
        <div class="row-line"><span>Clothes</span><div class="swatches">${clothSw}</div></div>
        <div class="row-line ${this.char.gender === "girl" ? "" : "hidden"}" id="scarfRow"><span>Headscarf</span><div class="seg">${["on", "off"].map((s) => `<button data-act="scarf" data-s="${s}" class="${(s === "on") === !!this.char.scarf ? "on" : ""}">${s.toUpperCase()}</button>`).join("")}</div></div>
        <div class="modal-btns"><button class="btn primary" data-act="start">▶ Start Adventure</button><button class="btn ghost" data-act="back">Back</button></div>`);
      const upd = () => { el("cp").textContent = this.char.gender === "girl" ? (this.char.scarf ? "🧕" : "👧") : "🧒"; };
      this.ui.wire({
        back: () => { this.ui.close(); this.showMenu(); },
        g: (b) => { this.char.gender = b.dataset.g; if (this.char.gender !== "girl") this.char.scarf = false; this.openCharSelect(); },
        skin: (b) => { this.char.skin = +b.dataset.c; this.openCharSelect(); },
        cloth: (b) => { this.char.cloth = +b.dataset.c; this.openCharSelect(); },
        scarf: (b) => { this.char.scarf = b.dataset.s === "on"; upd(); this.openCharSelect(); },
        start: () => { this.save.data.char = this.char; this.save.save(); this.beginGame(); },
      });
    }

    beginGame() {
      this.buildWorld();
      el("menuScreen").classList.add("hidden"); this.ui.close(); el("hud").classList.remove("hidden");
      this.refreshPedestals(); this.ui.hud(); this.applyEnv(0); this.state = "playing";
      // intro
      this.ui.open(`<div class="big-emoji">🌅</div><h2 class="title small">A New Day Begins</h2><p class="lead">There are five daily Salah:<br><b>Fajr · Dhuhr · Asr · Maghrib · Isha</b>.</p><p class="lead">Let's learn them together! Walk to the mosque 🕌 and step on a glowing pedestal to begin.</p><div class="modal-btns"><button class="btn primary" data-act="go">Let's go!</button></div>`);
      this.ui.wire({ go: () => this.ui.close() });
    }

    advanceTime() {
      this.prayerIndex = (this.prayerIndex + 1) % 5;
      this.ui.hud(); this.audio.chime();
      const sp = SALAH[this.prayerIndex];
      this.ui.toast(sp.icon + " " + sp.name + " — " + sp.when);
    }

    togglePause() {
      if (this.state === "playing") { this.state = "paused"; this.ui.open(`<div class="big-emoji">⏸</div><h2 class="title small">Paused</h2><div class="modal-btns"><button class="btn primary" data-act="resume">▶ Resume</button><button class="btn" data-act="learn">📖 Learn Salah</button><button class="btn ghost" data-act="menu">☰ Main Menu</button></div>`); el("modal").dataset.pause = "1"; this.ui.wire({ resume: () => { el("modal").dataset.pause = ""; this.ui.close(); this.state = "playing"; }, learn: () => this.openEncyclopedia(), menu: () => { el("modal").dataset.pause = ""; this.ui.close(); this.showMenu(); } }); }
      else if (this.state === "modal" && el("modal").dataset.pause) { el("modal").dataset.pause = ""; this.ui.close(); this.state = "playing"; }
      else if (this.state === "paused") { this.ui.close(); this.state = "playing"; }
    }

    loop(now) {
      let dt = (now - this.last) / 1000; this.last = now; if (dt > 0.05) dt = 0.05;
      if (this.built) this.applyEnv(dt);
      if (this.state === "playing") {
        const mv = this.input.moveVec();
        const jr = this.input.jump; this.input.jump = false;
        const moving = this.player.update(dt, mv, this.input.yaw, this.world, this.input.running(), jr);
        if (moving && (this._stepT = (this._stepT || 0) + dt) > 0.34) { this._stepT = 0; this.audio.step(); }
        this.world.update(dt);
        this.interaction.update(this.player);
      }
      if (this.built) this.camCtl.update(dt, this.player);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(this.loop);
    }
  }

  window.addEventListener("DOMContentLoaded", () => { try { window._fiveSalah = new Game(); } catch (e) { console.error(e); el("loadMsg").textContent = "Error: " + e.message; } });
})();
