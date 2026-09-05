/* ============================================================
   JOURNEY OF GOOD DEEDS
   A gentle 3D children's adventure — explore a friendly town,
   help people, make kind choices, and learn good manners &
   Islamic values through play.
   ------------------------------------------------------------
   Three.js (r128 UMD global) + Vanilla JS. No build step, no
   backend, no accounts, no data collection. All models & sounds
   are generated procedurally. Progress saved in localStorage.
   (c) 2025 Sheikh Thanbir Alam.
   ============================================================ */
(function () {
  "use strict";
  if (!window.THREE) { document.getElementById("loadMsg").textContent = "Could not load 3D engine."; return; }
  const THREE = window.THREE;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const el = (id) => document.getElementById(id);
  const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };

  // ============================================================
  //  AUDIO MANAGER  (gentle synthesized sounds)
  // ============================================================
  class AudioManager {
    constructor() { this.ac = null; this.muted = false; }
    ensure() { if (!this.ac) { try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this.ac && this.ac.state === "suspended") this.ac.resume(); return this.ac; }
    tone(f, d, type = "sine", vol = 0.13, slide = null) {
      if (this.muted) return; const c = this.ensure(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, c.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + d);
      g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + d);
    }
    click() { this.tone(520, 0.06, "sine", 0.09); }
    step() { this.tone(180, 0.05, "sine", 0.03); }
    collect() { this.tone(880, 0.08, "sine", 0.11, 1320); }
    good() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.14, "sine", 0.12), i * 90)); }
    achieve() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, "triangle", 0.12), i * 110)); }
    talk() { this.tone(420, 0.05, "sine", 0.06); }
    gentle() { this.tone(392, 0.18, "sine", 0.1, 330); }
    toggle() { this.muted = !this.muted; return this.muted; }
  }

  // ============================================================
  //  SAVE SYSTEM  (localStorage only)
  // ============================================================
  class SaveSystem {
    constructor() { this.key = "journeyGoodDeeds"; this.data = this.load(); }
    load() {
      const base = { points: 0, completed: [], achievements: [], values: [], playSeconds: 0, char: null };
      try { return Object.assign(base, JSON.parse(localStorage.getItem(this.key)) || {}); } catch (e) { return base; }
    }
    save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {} }
    reset() { this.data = { points: 0, completed: [], achievements: [], values: [], playSeconds: 0, char: this.data.char }; this.save(); }
  }

  // ============================================================
  //  INPUT MANAGER
  // ============================================================
  class InputManager {
    constructor(game) {
      this.game = game;
      this.keys = {}; this.move = { x: 0, y: 0 };
      this.camDrag = { active: false, lastX: 0, id: null };
      this.yaw = 0;
      this.bindKeys(); this.bindPointer(); this.bindJoystick();
    }
    bindKeys() {
      addEventListener("keydown", (e) => {
        this.game.audio.ensure();
        this.keys[e.code] = true;
        if (e.code === "KeyE") { e.preventDefault(); this.game.interaction.trigger(); }
        if (e.code === "Escape") { e.preventDefault(); this.game.togglePause(); }
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
      });
      addEventListener("keyup", (e) => { this.keys[e.code] = false; });
    }
    keyMove() {
      let x = 0, y = 0;
      if (this.keys.KeyW || this.keys.ArrowUp) y -= 1;
      if (this.keys.KeyS || this.keys.ArrowDown) y += 1;
      if (this.keys.KeyA || this.keys.ArrowLeft) x -= 1;
      if (this.keys.KeyD || this.keys.ArrowRight) x += 1;
      return { x, y };
    }
    bindPointer() {
      const cv = el("scene");
      const start = (x, id) => { this.camDrag.active = true; this.camDrag.lastX = x; this.camDrag.id = id; };
      const moveTo = (x) => { if (!this.camDrag.active) return; const dx = x - this.camDrag.lastX; this.camDrag.lastX = x; this.yaw -= dx * 0.006; };
      const end = () => { this.camDrag.active = false; this.camDrag.id = null; };
      cv.addEventListener("mousedown", (e) => start(e.clientX, "m"));
      addEventListener("mousemove", (e) => moveTo(e.clientX));
      addEventListener("mouseup", end);
      cv.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; start(t.clientX, t.identifier); }, { passive: true });
      cv.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) if (t.identifier === this.camDrag.id) moveTo(t.clientX); }, { passive: true });
      cv.addEventListener("touchend", end); cv.addEventListener("touchcancel", end);
      document.addEventListener("touchmove", (e) => { if (this.game.state === "playing") e.preventDefault(); }, { passive: false });
    }
    bindJoystick() {
      const j = el("joystick"), k = el("joyKnob"); if (!j) return;
      let id = null, cx = 0, cy = 0, R = 46;
      const set = (dx, dy) => { const d = Math.hypot(dx, dy) || 1; const cl = Math.min(d, R); const nx = dx / d * cl, ny = dy / d * cl; k.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`; this.move.x = nx / R; this.move.y = ny / R; };
      const reset = () => { id = null; k.style.transform = "translate(-50%,-50%)"; this.move.x = 0; this.move.y = 0; };
      j.addEventListener("touchstart", (e) => { this.game.audio.ensure(); const t = e.changedTouches[0]; id = t.identifier; const r = j.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; set(t.clientX - cx, t.clientY - cy); e.preventDefault(); }, { passive: false });
      j.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) if (t.identifier === id) { set(t.clientX - cx, t.clientY - cy); } e.preventDefault(); }, { passive: false });
      j.addEventListener("touchend", reset); j.addEventListener("touchcancel", reset);
      addEventListener("touchstart", () => document.body.classList.add("touch-mode"), { once: true });
      el("touchInteract").addEventListener("touchstart", (e) => { e.preventDefault(); this.game.audio.ensure(); this.game.interaction.trigger(); }, { passive: false });
      el("touchInteract").addEventListener("click", () => this.game.interaction.trigger());
    }
    getMoveVector() {
      const km = this.keyMove();
      let x = km.x + this.move.x, y = km.y + this.move.y;
      const d = Math.hypot(x, y); if (d > 1) { x /= d; y /= d; }
      return { x, y, moving: d > 0.08 };
    }
  }

  // ============================================================
  //  SHARED GEOMETRY / MATERIAL LIBRARY
  // ============================================================
  const G = {}, M = {};
  function initLib() {
    G.box = new THREE.BoxGeometry(1, 1, 1);
    G.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    G.cyl6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
    G.cone = new THREE.ConeGeometry(0.5, 1, 14);
    G.sph = new THREE.SphereGeometry(0.5, 14, 12);
    G.halfSph = new THREE.SphereGeometry(0.5, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    G.oct = new THREE.OctahedronGeometry(0.35);
    G.torus = new THREE.TorusGeometry(0.45, 0.12, 8, 16);
    M.eye = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.6 });
    M.white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  }
  const box = (w, h, d, mat) => { const m = new THREE.Mesh(G.box, mat); m.scale.set(w, h, d); return m; };
  const stdMat = (color, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough });

  // ============================================================
  //  CHARACTER FACTORY  (low-poly, cute, cartoon proportions)
  // ============================================================
  const SKIN = [0xf3c9a0, 0xe0ac82, 0xc68642, 0x8d5524, 0xffe0bd, 0xa56b46];
  const CLOTH = [0x2fae8f, 0x4a86e8, 0xe0555f, 0xf4a63c, 0x9b6ade, 0x3ea0a0, 0xff8fab, 0x6b8e23];
  const HAIR = [0x2a2118, 0x3d2b1f, 0x5b3a1e, 0x111111, 0x6e4a2f];

  function buildCharacter(opt) {
    opt = opt || {};
    const skin = stdMat(opt.skin != null ? opt.skin : pick(SKIN));
    const cloth = stdMat(opt.cloth != null ? opt.cloth : pick(CLOTH));
    const g = new THREE.Group();
    // legs
    const legMat = stdMat(0x3a3f4a);
    const l1 = box(0.28, 0.7, 0.28, legMat); l1.position.set(-0.18, 0.35, 0); g.add(l1);
    const l2 = box(0.28, 0.7, 0.28, legMat); l2.position.set(0.18, 0.35, 0); g.add(l2);
    g._legs = [l1, l2];
    // body (dress-ish for scarf option, else torso)
    let body;
    if (opt.scarf) { body = new THREE.Mesh(G.cone, cloth); body.scale.set(1.05, 1.25, 1.05); body.position.y = 1.25; }
    else { body = box(0.85, 0.9, 0.5, cloth); body.position.y = 1.15; }
    g.add(body);
    // arms
    const a1 = box(0.2, 0.72, 0.24, cloth); a1.position.set(-0.56, 1.2, 0); g.add(a1);
    const a2 = box(0.2, 0.72, 0.24, cloth); a2.position.set(0.56, 1.2, 0); g.add(a2);
    g._arms = [a1, a2];
    // hands
    const h1 = new THREE.Mesh(G.sph, skin); h1.scale.set(0.22, 0.22, 0.22); h1.position.set(-0.56, 0.86, 0); g.add(h1);
    const h2 = h1.clone(); h2.position.x = 0.56; g.add(h2);
    // head
    const head = new THREE.Mesh(G.sph, skin); head.scale.set(0.62, 0.66, 0.62); head.position.y = 1.95; g.add(head);
    // face — eyes + smile
    const e1 = new THREE.Mesh(G.sph, M.eye); e1.scale.set(0.09, 0.12, 0.06); e1.position.set(-0.14, 1.98, 0.3); g.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.14; g.add(e2);
    const smile = new THREE.Mesh(G.torus, M.eye); smile.scale.set(0.28, 0.28, 0.14); smile.position.set(0, 1.85, 0.28); smile.rotation.x = Math.PI * 0.62; g.add(smile);
    // hair or scarf
    if (opt.scarf) {
      const scarfMat = stdMat(opt.scarfColor != null ? opt.scarfColor : pick(CLOTH));
      const hood = new THREE.Mesh(G.sph, scarfMat); hood.scale.set(0.72, 0.74, 0.72); hood.position.y = 1.98; g.add(hood);
      const drape = box(0.8, 0.5, 0.2, scarfMat); drape.position.set(0, 1.6, -0.18); g.add(drape);
      // face opening (skin already drawn under; move face slightly forward already)
      const fo = new THREE.Mesh(G.sph, skin); fo.scale.set(0.5, 0.55, 0.4); fo.position.set(0, 1.95, 0.16); g.add(fo);
      e1.position.z = e2.position.z = 0.36; smile.position.z = 0.34;
      g.add(e1); // keep order (already added)
    } else {
      const hairMat = stdMat(opt.hair != null ? opt.hair : pick(HAIR));
      const style = opt.hairStyle != null ? opt.hairStyle : (Math.random() * 3) | 0;
      const cap = new THREE.Mesh(G.halfSph, hairMat); cap.scale.set(0.7, 0.55, 0.7); cap.position.y = 2.02; g.add(cap);
      if (style === 1) { const back = box(0.6, 0.35, 0.2, hairMat); back.position.set(0, 1.8, -0.24); g.add(back); }
      if (style === 2) { const b1 = new THREE.Mesh(G.sph, hairMat); b1.scale.set(0.24, 0.24, 0.24); b1.position.set(-0.34, 1.98, -0.1); g.add(b1); const b2 = b1.clone(); b2.position.x = 0.34; g.add(b2); }
    }
    // accessory
    if (opt.accessory === "apron") { const ap = box(0.7, 0.6, 0.06, M.white); ap.position.set(0, 1.05, 0.27); g.add(ap); }
    if (opt.accessory === "hat") { const hat = new THREE.Mesh(G.cyl, stdMat(0xffffff)); hat.scale.set(0.5, 0.4, 0.5); hat.position.y = 2.35; g.add(hat); }
    if (opt.accessory === "glasses") { const gl = box(0.4, 0.08, 0.04, M.eye); gl.position.set(0, 1.98, 0.34); g.add(gl); }
    g.traverse((o) => { if (o.isMesh && opt.shadow) { o.castShadow = true; } });
    g.scale.setScalar(opt.scale || 1);
    return g;
  }

  // ============================================================
  //  PLAYER
  // ============================================================
  class Player {
    constructor(scene, char, quality) {
      this.group = buildCharacter(Object.assign({ shadow: quality !== "low" }, char));
      this.group.position.set(0, 0, 6);
      scene.add(this.group);
      this.x = 0; this.z = 6; this.facing = Math.PI; this.walkPhase = 0; this.speed = 6.4;
    }
    update(dt, moveVec, camYaw, world) {
      let moving = moveVec.moving;
      if (moving) {
        // move relative to camera yaw
        const s = Math.sin(camYaw), c = Math.cos(camYaw);
        let dx = moveVec.x * c - moveVec.y * s;
        let dz = moveVec.x * s + moveVec.y * c;
        const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
        const nx = this.x + dx * this.speed * dt;
        const nz = this.z + dz * this.speed * dt;
        const r = world.resolve(nx, nz, this.x, this.z, 0.55);
        this.x = r.x; this.z = r.z;
        this.facing = Math.atan2(dx, dz);
        this.walkPhase += dt * 10;
      } else { this.walkPhase *= 0.8; }
      this.group.position.x = this.x; this.group.position.z = this.z;
      this.group.rotation.y = lerp(this.group.rotation.y, this.facing, 0.2);
      // limb swing + suspension bob
      const sw = Math.sin(this.walkPhase) * (moving ? 0.5 : 0);
      if (this.group._legs) { this.group._legs[0].rotation.x = sw; this.group._legs[1].rotation.x = -sw; }
      if (this.group._arms) { this.group._arms[0].rotation.x = -sw; this.group._arms[1].rotation.x = sw; }
      this.group.position.y = Math.abs(Math.sin(this.walkPhase)) * (moving ? 0.06 : 0);
      return moving;
    }
  }

  // ============================================================
  //  WORLD  (town, mosque, park, collision boxes)
  // ============================================================
  class World {
    constructor(scene, quality) {
      this.scene = scene; this.quality = quality; this.colliders = []; this.bound = 78;
      this.build();
    }
    addCollider(x, z, hw, hd) { this.colliders.push({ x, z, hw, hd }); }
    build() {
      const s = this.scene;
      // grass ground
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), stdMat(0x7ec86a, 1));
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);
      // roads (cross plaza)
      const roadMat = stdMat(0x9a9a9a, 1);
      const r1 = new THREE.Mesh(new THREE.PlaneGeometry(10, 160), roadMat); r1.rotation.x = -Math.PI / 2; r1.position.y = 0.02; s.add(r1);
      const r2 = new THREE.Mesh(new THREE.PlaneGeometry(160, 10), roadMat); r2.rotation.x = -Math.PI / 2; r2.position.y = 0.02; s.add(r2);
      const plaza = new THREE.Mesh(new THREE.CircleGeometry(11, 24), stdMat(0xd9cdb0, 1)); plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.03; s.add(plaza);

      // buildings around plaza
      const buildings = [
        { x: -22, z: -20, w: 12, h: 8, d: 12, c: 0xe8a06a, label: "Bakery", roof: 0x9a4a2a },
        { x: 22, z: -20, w: 12, h: 9, d: 12, c: 0x88b0e0, label: "Grocery", roof: 0x35507a },
        { x: -22, z: 20, w: 13, h: 10, d: 12, c: 0xc9a0e0, label: "Library", roof: 0x6a3a8a },
        { x: 22, z: 20, w: 14, h: 9, d: 13, c: 0xf0d080, label: "School", roof: 0xb08a2a },
        { x: -40, z: -2, w: 10, h: 7, d: 10, c: 0xf0a5a5, label: "House", roof: 0x9a3a3a },
        { x: 40, z: -2, w: 10, h: 7, d: 10, c: 0xa5e0c0, label: "House", roof: 0x2a7a5a },
        { x: -40, z: 26, w: 11, h: 8, d: 10, c: 0xbfd0e8, label: "Community Center", roof: 0x40608a },
      ];
      for (const b of buildings) this.house(b);

      // Mosque (respectful) — far end
      this.mosque(0, -46);

      // Park (right-back): trees, benches, fountain, playground
      this.park(0, 40);

      // scattered trees / bushes / rocks / street lights / signs / clouds
      this.decor();

      // world boundary hedges (invisible colliders on edges)
      this.addCollider(0, -this.bound - 2, this.bound + 4, 2);
      this.addCollider(0, this.bound + 2, this.bound + 4, 2);
      this.addCollider(-this.bound - 2, 0, 2, this.bound + 4);
      this.addCollider(this.bound + 2, 0, 2, this.bound + 4);
    }
    house(b) {
      const g = new THREE.Group();
      const body = box(b.w, b.h, b.d, stdMat(b.c)); body.position.y = b.h / 2; if (this.quality !== "low") body.castShadow = true; g.add(body);
      const roof = new THREE.Mesh(G.cone, stdMat(b.roof)); roof.scale.set(b.w * 0.92, b.h * 0.5, b.d * 0.92); roof.rotation.y = Math.PI / 4; roof.position.y = b.h + b.h * 0.25; g.add(roof);
      // door + windows
      const door = box(2, 3, 0.2, stdMat(0x5b3a1e)); door.position.set(0, 1.5, b.d / 2 + 0.05); g.add(door);
      const winMat = stdMat(0xbfe3ff, 0.4);
      for (const wx of [-b.w / 3, b.w / 3]) { const w = box(1.8, 1.8, 0.2, winMat); w.position.set(wx, b.h * 0.6, b.d / 2 + 0.05); g.add(w); }
      // sign board
      const sign = box(b.label.length * 0.55 + 1, 1.2, 0.2, stdMat(0x2fae8f)); sign.position.set(0, b.h + 0.2, b.d / 2 + 0.2);
      g.add(this.textPlate(b.label, b.w));
      g.position.set(b.x, 0, b.z);
      this.scene.add(g);
      this.addCollider(b.x, b.z, b.w / 2 + 0.3, b.d / 2 + 0.3);
    }
    textPlate(text, w) {
      const cv = document.createElement("canvas"); cv.width = 256; cv.height = 64;
      const c = cv.getContext("2d"); c.fillStyle = "#1a7f6b"; c.fillRect(0, 0, 256, 64);
      c.fillStyle = "#fff"; c.font = "bold 34px Trebuchet MS, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(text, 128, 34);
      const tex = new THREE.CanvasTexture(cv);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w * 0.8, 6), 1.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      plate.position.set(0, 5.6, (w ? 6.1 : 6.1));
      return plate;
    }
    mosque(x, z) {
      const g = new THREE.Group();
      const wallMat = stdMat(0xf3ead2), domeMat = stdMat(0x3ea0a0), trimMat = stdMat(0xffcf5c);
      const body = box(20, 9, 16, wallMat); body.position.y = 4.5; if (this.quality !== "low") body.castShadow = true; g.add(body);
      // dome
      const dome = new THREE.Mesh(G.halfSph, domeMat); dome.scale.set(7, 7, 7); dome.position.y = 9; g.add(dome);
      const finial = new THREE.Mesh(G.sph, trimMat); finial.scale.set(0.6, 0.9, 0.6); finial.position.y = 12.6; g.add(finial);
      const crescent = new THREE.Mesh(G.torus, trimMat); crescent.scale.set(0.9, 0.9, 0.3); crescent.position.y = 13.6; g.add(crescent);
      // minaret
      const min = new THREE.Mesh(G.cyl, wallMat); min.scale.set(1.6, 16, 1.6); min.position.set(-11, 8, -6); g.add(min);
      const minTop = new THREE.Mesh(G.cone, domeMat); minTop.scale.set(2, 3, 2); minTop.position.set(-11, 17.2, -6); g.add(minTop);
      // arched entrance
      const arch = box(4, 5, 1, trimMat); arch.position.set(0, 2.5, 8.1); g.add(arch);
      const door = box(3, 4, 0.4, stdMat(0x5b3a1e)); door.position.set(0, 2, 8.4); g.add(door);
      // courtyard tiles
      const court = new THREE.Mesh(new THREE.PlaneGeometry(26, 12), stdMat(0xe4dcc4, 1)); court.rotation.x = -Math.PI / 2; court.position.set(0, 0.04, 12); g.add(court);
      g.add(this.labelSprite("🕌 Community Mosque", 0, 15, 8, "#3ea0a0"));
      g.position.set(x, 0, z);
      this.scene.add(g);
      this.addCollider(x, z, 10.5, 8.5);
      this.addCollider(x - 11, z - 6, 1.4, 1.4);
      this.mosquePos = { x, z: z + 12 };
    }
    labelSprite(text, x, y, z, color) {
      const cv = document.createElement("canvas"); cv.width = 512; cv.height = 96;
      const c = cv.getContext("2d"); c.font = "bold 40px Trebuchet MS, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = "rgba(255,255,255,0.9)"; roundRectC(c, 6, 18, 500, 60, 20); c.fill();
      c.fillStyle = color || "#1a7f6b"; c.fillText(text, 256, 50);
      const tex = new THREE.CanvasTexture(cv);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      sp.scale.set(8, 1.5, 1); sp.position.set(x, y, z);
      return sp;
    }
    park(x, z) {
      const g = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.CircleGeometry(16, 24), stdMat(0x6fbf5a, 1)); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.03; g.add(pad);
      // fountain
      const base = new THREE.Mesh(G.cyl, stdMat(0xbfc7cf)); base.scale.set(4, 0.6, 4); base.position.y = 0.3; g.add(base);
      const water = new THREE.Mesh(G.cyl, stdMat(0x5ec8e3, 0.3)); water.scale.set(3.4, 0.4, 3.4); water.position.y = 0.5; g.add(water);
      const pillar = new THREE.Mesh(G.cyl, stdMat(0xbfc7cf)); pillar.scale.set(0.8, 2, 0.8); pillar.position.y = 1.3; g.add(pillar);
      // benches
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const bx = Math.cos(a) * 11, bz = Math.sin(a) * 11;
        const bench = box(3, 0.4, 1, stdMat(0x8a5a2a)); bench.position.set(bx, 0.6, bz); g.add(bench);
      }
      // trees
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const t = this.tree(); t.position.set(Math.cos(a) * 15, 0, Math.sin(a) * 15); g.add(t); }
      // playground (slide + swing frame)
      const slide = box(1.4, 0.3, 4, stdMat(0xff8fab)); slide.position.set(-6, 1.6, 6); slide.rotation.x = 0.5; g.add(slide);
      const frame = box(0.3, 3, 0.3, stdMat(0x4a86e8)); frame.position.set(6, 1.5, 6); g.add(frame);
      g.add(this.labelSprite("🌳 Park", 0, 7, 0, "#2a7a3a"));
      g.position.set(x, 0, z);
      this.scene.add(g);
      this.addCollider(x, z, 4, 4); // fountain block
      this.parkPos = { x, z };
    }
    tree() {
      const t = new THREE.Group();
      const trunk = new THREE.Mesh(G.cyl, stdMat(0x6b4423)); trunk.scale.set(0.5, 2.4, 0.5); trunk.position.y = 1.2; t.add(trunk);
      const top = new THREE.Mesh(G.sph, stdMat(0x3a9a4a)); top.scale.set(2.2, 2.4, 2.2); top.position.y = 3.4; if (this.quality === "high") top.castShadow = true; t.add(top);
      return t;
    }
    decor() {
      const s = this.scene;
      // roadside trees & lamps & bushes
      for (let i = 0; i < 22; i++) {
        const side = i % 2 ? 1 : -1; const along = -70 + (i * 7) % 140;
        const t = this.tree(); t.position.set(side * (7 + rand(0, 2)), 0, along); s.add(t);
        this.addCollider(side * 7, along, 1, 1);
      }
      for (let i = 0; i < 8; i++) {
        const lamp = new THREE.Group();
        const pole = new THREE.Mesh(G.cyl, stdMat(0x888e99)); pole.scale.set(0.2, 5, 0.2); pole.position.y = 2.5; lamp.add(pole);
        const bulb = new THREE.Mesh(G.sph, new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffcf6b, emissiveIntensity: 0.6 })); bulb.scale.set(0.4, 0.4, 0.4); bulb.position.y = 5; lamp.add(bulb);
        lamp.position.set((i % 2 ? 1 : -1) * 6, 0, -60 + i * 16); s.add(lamp);
      }
      // clouds
      this.clouds = [];
      const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
      for (let i = 0; i < 8; i++) {
        const c = new THREE.Group();
        for (let j = 0; j < 3; j++) { const p = new THREE.Mesh(G.sph, cloudMat); p.scale.set(rand(4, 7), rand(3, 4), rand(4, 7)); p.position.set(rand(-5, 5), rand(-1, 1), rand(-4, 4)); c.add(p); }
        c.position.set(rand(-70, 70), rand(28, 42), rand(-70, 70)); s.add(c); this.clouds.push(c);
      }
      // distant mountains
      const mMat = stdMat(0x8fa9c9);
      for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(G.cone, mMat); const sc = rand(24, 44); m.scale.set(sc, sc, sc); m.position.set(rand(-90, 90), sc * 0.35 - 6, -95 - rand(0, 30)); s.add(m); }
    }
    // circle-vs-box resolution; returns adjusted position
    resolve(nx, nz, ox, oz, r) {
      let x = nx, z = nz;
      for (const c of this.colliders) {
        const minX = c.x - c.hw - r, maxX = c.x + c.hw + r, minZ = c.z - c.hd - r, maxZ = c.z + c.hd + r;
        if (x > minX && x < maxX && z > minZ && z < maxZ) {
          // push out along the smallest overlap axis using previous pos
          const overL = x - minX, overR = maxX - x, overT = z - minZ, overB = maxZ - z;
          const m = Math.min(overL, overR, overT, overB);
          if (m === overL) x = minX; else if (m === overR) x = maxX; else if (m === overT) z = minZ; else z = maxZ;
        }
      }
      const b = this.bound; x = clamp(x, -b, b); z = clamp(z, -b, b);
      return { x, z };
    }
    update(dt) { for (const c of this.clouds) { c.position.x += dt * 0.6; if (c.position.x > 90) c.position.x = -90; } }
  }
  function roundRectC(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // ============================================================
  //  NPC MANAGER
  // ============================================================
  class NPCManager {
    constructor(scene, quality) { this.scene = scene; this.quality = quality; this.npcs = []; }
    add(id, x, z, char, name, avatar) {
      const g = buildCharacter(Object.assign({ shadow: this.quality !== "low" }, char));
      g.position.set(x, 0, z); g.rotation.y = Math.atan2(-x, -z);
      this.scene.add(g);
      // mission marker (bobbing gold "!")
      const marker = new THREE.Mesh(G.oct, new THREE.MeshStandardMaterial({ color: 0xffcf5c, emissive: 0xffa500, emissiveIntensity: 0.6 }));
      marker.position.y = 3.1; marker.visible = false; g.add(marker);
      const npc = { id, x, z, group: g, marker, name, avatar, char, t: rand(0, 6) };
      this.npcs.push(npc); return npc;
    }
    update(dt, playerPos) {
      for (const n of this.npcs) {
        n.t += dt;
        if (n.marker.visible) { n.marker.position.y = 3.1 + Math.sin(n.t * 3) * 0.15; n.marker.rotation.y += dt * 2; }
        // gently face the player when close
        const d2 = dist2(n.x, n.z, playerPos.x, playerPos.z);
        if (d2 < 64) { const target = Math.atan2(playerPos.x - n.x, playerPos.z - n.z); n.group.rotation.y = lerp(n.group.rotation.y, target, 0.08); }
      }
    }
  }

  // ============================================================
  //  DIALOGUE SYSTEM
  // ============================================================
  class DialogueSystem {
    constructor(game) { this.game = game; this.box = el("dialogue"); this.open = false; }
    show(cfg) {
      this.open = true;
      el("dlgAvatar").textContent = cfg.avatar || "🙂";
      el("dlgName").textContent = cfg.name || "";
      el("dlgText").textContent = cfg.text || "";
      const cont = el("dlgChoices"); cont.innerHTML = "";
      (cfg.choices || [{ label: "OK" }]).forEach((ch) => {
        const b = document.createElement("button"); b.textContent = ch.label;
        b.addEventListener("click", () => { this.game.audio.click(); if (ch.onPick) ch.onPick(); else this.close(); });
        cont.appendChild(b);
      });
      this.box.classList.remove("hidden");
      this.game.audio.talk();
    }
    close() { this.open = false; this.box.classList.add("hidden"); }
  }

  // ============================================================
  //  GOOD DEED SYSTEM  (points + ranks)
  // ============================================================
  const RANKS = [
    { p: 0, name: "🌱 Beginner" }, { p: 50, name: "🤝 Kind Helper" }, { p: 100, name: "😊 Helpful Friend" },
    { p: 200, name: "🏘️ Community Helper" }, { p: 500, name: "🏆 Good Deed Champion" },
  ];
  class GoodDeedSystem {
    constructor(game) { this.game = game; }
    get points() { return this.game.save.data.points; }
    rank() { let r = RANKS[0]; for (const x of RANKS) if (this.points >= x.p) r = x; return r.name; }
    add(n, values) {
      this.game.save.data.points += n;
      (values || []).forEach((v) => { if (!this.game.save.data.values.includes(v)) this.game.save.data.values.push(v); });
      this.game.save.save();
      this.game.ui.updateHUD();
    }
  }

  // ============================================================
  //  INTERACTION SYSTEM
  // ============================================================
  class InteractionSystem {
    constructor(game) { this.game = game; this.items = []; this.current = null; }
    register(item) { this.items.push(item); return item; } // {x,z,radius,label,onInteract,enabled}
    clearMarkers() { }
    update(playerPos) {
      let best = null, bestD = Infinity;
      for (const it of this.items) {
        if (it.enabled === false) continue;
        const d = dist2(it.x, it.z, playerPos.x, playerPos.z);
        if (d < it.radius * it.radius && d < bestD) { best = it; bestD = d; }
      }
      this.current = best;
      const prompt = el("interactPrompt");
      if (best && this.game.state === "playing" && !this.game.dialogue.open) { el("promptText").textContent = best.label || "Interact"; prompt.classList.remove("hidden"); }
      else prompt.classList.add("hidden");
    }
    trigger() { if (this.game.state !== "playing") return; if (this.game.dialogue.open) return; if (this.current && this.current.onInteract) this.current.onInteract(); }
  }

  // ============================================================
  //  PICKUP MANAGER  (walk-over collectibles for missions)
  // ============================================================
  class PickupManager {
    constructor(scene) { this.scene = scene; this.items = []; }
    spawn(kind, x, z) {
      const g = new THREE.Group();
      let mesh, y = 0.6;
      if (kind === "grocery") { mesh = box(0.6, 0.6, 0.6, stdMat(pick([0xe0555f, 0xf4a63c, 0x6b8e23]))); }
      else if (kind === "litter") { mesh = box(0.4, 0.5, 0.4, stdMat(pick([0x88b0e0, 0xcfcfcf, 0xf0d080]))); }
      else if (kind === "book") { mesh = box(0.5, 0.7, 0.15, stdMat(pick([0x9b6ade, 0x3ea0a0, 0xe0555f]))); }
      else if (kind === "water") { mesh = new THREE.Mesh(G.cyl, stdMat(0x5ec8e3)); mesh.scale.set(0.3, 0.7, 0.3); }
      else mesh = new THREE.Mesh(G.sph, stdMat(0xffcf5c));
      mesh.position.y = y; g.add(mesh);
      // sparkle ring
      const ring = new THREE.Mesh(G.torus, new THREE.MeshStandardMaterial({ color: 0xffcf5c, emissive: 0xffa500, emissiveIntensity: 0.5 }));
      ring.scale.set(1.1, 1.1, 0.4); ring.rotation.x = Math.PI / 2; ring.position.y = 0.1; g.add(ring);
      g.position.set(x, 0, z); this.scene.add(g);
      const item = { kind, x, z, group: g, mesh, collected: false, t: rand(0, 6) };
      this.items.push(item); return item;
    }
    update(dt, playerPos, onCollect) {
      for (const it of this.items) {
        if (it.collected) continue;
        it.t += dt; it.mesh.rotation.y += dt * 2; it.mesh.position.y = 0.6 + Math.sin(it.t * 3) * 0.12;
        if (dist2(it.x, it.z, playerPos.x, playerPos.z) < 1.5) { it.collected = true; it.group.visible = false; onCollect(it); }
      }
    }
    clear() { for (const it of this.items) this.scene.remove(it.group); this.items.length = 0; }
  }

  // ============================================================
  //  CAMERA CONTROLLER  (third-person orbit-follow)
  // ============================================================
  class CameraController {
    constructor(cam, input) { this.cam = cam; this.input = input; this.shake = 0; this._t = new THREE.Vector3(); }
    update(dt, player) {
      const yaw = this.input.yaw; const distB = 10, height = 6.5;
      const tx = player.x - Math.sin(yaw) * distB;
      const tz = player.z - Math.cos(yaw) * distB;
      this.cam.position.x = lerp(this.cam.position.x, tx, 0.12);
      this.cam.position.z = lerp(this.cam.position.z, tz, 0.12);
      this.cam.position.y = lerp(this.cam.position.y, height, 0.1);
      if (this.shake > 0.01) { this.cam.position.x += rand(-this.shake, this.shake); this.cam.position.y += rand(-this.shake, this.shake); this.shake *= 0.85; }
      this._t.set(player.x, 1.8, player.z);
      this.cam.lookAt(this._t);
    }
    addShake(v) { this.shake = Math.min(this.shake + v, 0.6); }
  }

  // ============================================================
  //  ACHIEVEMENTS
  // ============================================================
  const ACHIEVEMENTS = [
    { id: "first", icon: "🏆", name: "First Good Deed", desc: "Complete your first helpful mission." },
    { id: "kind", icon: "🤝", name: "Kind Helper", desc: "Complete 5 missions." },
    { id: "animal", icon: "🐱", name: "Animal Friend", desc: "Care for an animal." },
    { id: "clean", icon: "🧹", name: "Clean Community", desc: "Clean up the park." },
    { id: "share", icon: "🎁", name: "Sharing Star", desc: "Complete the sharing mission." },
    { id: "honest", icon: "💛", name: "Honest Heart", desc: "Complete the honesty mission." },
    { id: "neighbor", icon: "🏘️", name: "Helpful Neighbor", desc: "Complete every mission." },
  ];
  class AchievementSystem {
    constructor(game) { this.game = game; }
    has(id) { return this.game.save.data.achievements.includes(id); }
    unlock(id) {
      if (this.has(id)) return; this.game.save.data.achievements.push(id); this.game.save.save();
      const a = ACHIEVEMENTS.find((x) => x.id === id); if (!a) return;
      this.game.audio.achieve(); this.game.ui.toast(`🏆 Achievement: ${a.name}`);
    }
  }

  // ============================================================
  //  UI MANAGER
  // ============================================================
  class UIManager {
    constructor(game) { this.game = game; this._toastT = 0; }
    updateHUD() {
      el("pointsVal").textContent = this.game.deeds.points;
      el("rankBadge").textContent = this.game.deeds.rank();
    }
    toast(msg) {
      const t = el("toast"); t.textContent = msg; t.classList.add("show");
      clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove("show"), 2200);
    }
    area(name) { el("areaTag").textContent = name; }
    card(cfg) {
      el("cardEmoji").textContent = cfg.emoji || "🌟";
      el("cardTitle").textContent = cfg.title || "MISSION COMPLETE!";
      el("cardBody").textContent = cfg.body || "";
      const pts = el("cardPoints");
      if (cfg.points) { pts.textContent = "+" + cfg.points + " ⭐"; pts.classList.remove("hidden"); } else pts.classList.add("hidden");
      const les = el("cardLesson"); if (cfg.lesson) { les.textContent = cfg.lesson; les.style.display = ""; } else les.style.display = "none";
      el("cardScreen").classList.remove("hidden");
      this.game.state = "card";
      el("cardContinue").onclick = () => { this.game.audio.click(); el("cardScreen").classList.add("hidden"); this.game.state = "playing"; if (cfg.onContinue) cfg.onContinue(); };
    }
  }

  // ============================================================
  //  MISSION SYSTEM
  // ============================================================
  class MissionSystem {
    constructor(game) { this.game = game; this.missions = []; this.completedCount = 0; }
    isDone(id) { return this.game.save.data.completed.includes(id); }
    markDone(id) { if (!this.isDone(id)) { this.game.save.data.completed.push(id); this.game.save.save(); } }
    define(m) { this.missions.push(m); return m; }

    // choice-based mission runner
    runChoice(m) {
      const done = this.isDone(m.id);
      const askChoices = m.choices.map((ch) => ({
        label: ch.label,
        onPick: () => {
          if (ch.good) {
            this.game.dialogue.close();
            this.complete(m, done);
          } else {
            // gentle retry
            this.game.audio.gentle();
            this.game.dialogue.show({ name: m.giver.name, avatar: m.giver.avatar, text: "That's okay — let's try another choice. 🙂", choices: askChoices });
          }
        },
      }));
      this.game.dialogue.show({ name: m.giver.name, avatar: m.giver.avatar, text: m.prompt, choices: askChoices });
    }

    complete(m, alreadyDone) {
      const first = !this.isDone(m.id);
      this.markDone(m.id);
      if (first) {
        this.game.deeds.add(m.points, m.values);
        this.completedCount++;
        this.game.audio.good();
      }
      // achievements
      const ach = this.game.ach;
      if (first) ach.unlock("first");
      if (m.ach) ach.unlock(m.ach);
      const totalDone = this.game.save.data.completed.length;
      if (totalDone >= 5) ach.unlock("kind");
      if (this.missions.every((x) => this.isDone(x.id))) ach.unlock("neighbor");
      // marker off
      if (m.npc) m.npc.marker.visible = false;
      this.refreshMarkers();
      // area unlock feel
      this.game.checkAreaUnlocks();
      // learning card
      this.game.ui.card({
        emoji: m.emoji || "🌟",
        title: alreadyDone ? "THANK YOU!" : "MISSION COMPLETE!",
        body: m.cardBody,
        points: first ? m.points : 0,
        lesson: m.lesson,
        onContinue: () => { if (this.missions.every((x) => this.isDone(x.id)) && !this.game._completedShown) this.game.showCompletion(); },
      });
    }

    refreshMarkers() {
      for (const m of this.missions) if (m.npc) m.npc.marker.visible = !this.isDone(m.id);
    }
  }

  // ============================================================
  //  GAME  (orchestrator + loop + state)
  // ============================================================
  class Game {
    constructor() {
      this.state = "menu";
      this.quality = localStorage.getItem("jgdQuality") || "auto";
      this.audio = new AudioManager();
      this.save = new SaveSystem();
      if (this.save.data.char) this.char = this.save.data.char; else this.char = { gender: "boy", skin: SKIN[0], cloth: CLOTH[0], scarf: false, hairStyle: 0, hair: HAIR[0] };
      initLib();
      this.initThree();
      this.deeds = new GoodDeedSystem(this);
      this.ui = new UIManager(this);
      this.ach = new AchievementSystem(this);
      this.input = new InputManager(this);
      this.camCtl = new CameraController(this.camera, this.input);
      this.dialogue = new DialogueSystem(this);
      this.interaction = new InteractionSystem(this);
      this.missionSys = new MissionSystem(this);
      this.built = false;
      this.bindUI();
      this.last = performance.now();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
      el("loadScreen").classList.add("hidden");
    }

    effQuality() { if (this.quality !== "auto") return this.quality; const mobile = matchMedia("(hover:none) and (pointer:coarse)").matches || innerWidth < 760; return mobile ? "low" : "high"; }

    initThree() {
      const q = this.effQuality();
      this.renderer = new THREE.WebGLRenderer({ canvas: el("scene"), antialias: q !== "low", powerPreference: "high-performance" });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === "high" ? 2 : q === "medium" ? 1.5 : 1));
      this.renderer.setSize(innerWidth, innerHeight);
      this.renderer.shadowMap.enabled = q === "high";
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x9fd8f0);
      this.scene.fog = new THREE.Fog(0x9fd8f0, 90, 180);
      this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);
      this.camera.position.set(0, 6.5, 16);
      // lights (warm daytime)
      this.scene.add(new THREE.HemisphereLight(0xcfefff, 0x6a8a5a, 0.85));
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
      this.sun = new THREE.DirectionalLight(0xfff2d0, 1.0); this.sun.position.set(30, 50, 20);
      if (q === "high") { this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024); const c = this.sun.shadow.camera, d = 70; c.left = -d; c.right = d; c.top = d; c.bottom = -d; c.near = 1; c.far = 160; }
      this.scene.add(this.sun); this.scene.add(this.sun.target);
      addEventListener("resize", () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); });
    }

    // ---------------- world + missions ----------------
    buildWorld() {
      if (this.built) return; this.built = true;
      const q = this.effQuality();
      this.world = new World(this.scene, q);
      this.player = new Player(this.scene, this.char, q);
      this.npcs = new NPCManager(this.scene, q);
      this.pickups = new PickupManager(this.scene);
      this.setupMissions();
      this.missionSys.refreshMarkers();
    }

    setupMissions() {
      const N = this.npcs, MS = this.missionSys, self = this;

      // --- NPCs (fictional ordinary townspeople) ---
      const elder = N.add("m1", -10, -8, { skin: SKIN[3], cloth: 0x9b6ade, accessory: "glasses", scale: 1.0 }, "Grandma Amina", "👵");
      const childA = N.add("m3", 12, 8, { gender: "boy", skin: SKIN[1], cloth: 0x4a86e8, hairStyle: 2 }, "Yusuf", "🧒");
      const parent = N.add("m6", -16, 6, { scarf: true, skin: SKIN[2], cloth: 0x2fae8f, scarfColor: 0xe0555f }, "Mama Khadija", "👩");
      const kidB = N.add("m7", 6, -12, { gender: "girl", scarf: true, skin: SKIN[0], cloth: 0xff8fab, scarfColor: 0x9b6ade }, "Sara", "👧");
      const baker = N.add("m8", -20, -18, { skin: SKIN[4], cloth: 0xffffff, accessory: "apron", accessory2: true }, "Baker Idris", "🧑‍🍳");
      const gardener = N.add("m9", 16, 34, { skin: SKIN[2], cloth: 0x6b8e23, accessory: "hat" }, "Gardener Bilal", "🧑‍🌾");
      const teacher = N.add("m10", 18, 16, { scarf: true, skin: SKIN[1], cloth: 0x4a86e8, scarfColor: 0xffcf5c }, "Teacher Fatima", "👩‍🏫");
      const librarian = N.add("m6b", -18, 22, { skin: SKIN[5], cloth: 0x3ea0a0, accessory: "glasses" }, "Librarian Zaid", "🧑");

      // small fictional cat near the park
      const cat = this.buildCat(); cat.position.set(8, 0, 30); this.scene.add(cat); this.catObj = cat;

      // ---- M1: Lost Grocery Bag (collect 3) ----
      const m1 = MS.define({ id: "m1", npc: elder, giver: { name: "Grandma Amina", avatar: "👵" }, emoji: "🛍️", points: 10,
        values: ["Kindness", "Helping others"], lesson: "Helping others is a beautiful act of kindness.",
        cardBody: "You helped Grandma Amina collect her groceries." });
      this.interaction.register({ x: elder.x, z: elder.z + 1.5, radius: 3, label: "Talk to Grandma Amina", onInteract: () => {
        if (MS.isDone("m1")) { this.dialogue.show({ name: "Grandma Amina", avatar: "👵", text: "Thank you again, dear child. May you always be kind! 😊", choices: [{ label: "You're welcome!" }] }); return; }
        if (this._m1active) { this.dialogue.show({ name: "Grandma Amina", avatar: "👵", text: "Please pick up the fallen groceries around me. 🛍️", choices: [{ label: "On it!" }] }); return; }
        this.dialogue.show({ name: "Grandma Amina", avatar: "👵", text: "Oh dear! I dropped my groceries. Could you help me collect them?", choices: [
          { label: "Yes, I'll help! 🛍️", onPick: () => { this.dialogue.close(); this.startGrocery(elder, m1); } },
          { label: "Maybe later", onPick: () => { this.dialogue.show({ name: "Grandma Amina", avatar: "👵", text: "That's okay — come back if you'd like to help. 🙂", choices: [{ label: "Okay" }] }); } },
        ] });
      } });

      // ---- M2: Honesty (coin on the ground) ----
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0xffcf5c, metalness: 0.6, roughness: 0.3, emissive: 0x5a3d00, emissiveIntensity: 0.4 }));
      coin.rotation.x = Math.PI / 2; coin.position.set(-4, 0.5, 14); this.scene.add(coin); this.coinObj = coin;
      const m2 = MS.define({ id: "m2", giver: { name: "You found a coin", avatar: "🪙" }, emoji: "🪙", points: 10, ach: "honest",
        values: ["Honesty", "Trustworthiness"], lesson: "Muslims are encouraged to be honest and trustworthy.",
        cardBody: "You chose to be honest about the coin you found.",
        prompt: "You found a shiny coin on the ground. What should you do?",
        choices: [ { label: "🔎 Look for its owner", good: true }, { label: "🏪 Give it to a trusted adult", good: true }, { label: "🪙 Keep it quietly", good: false } ] });
      this.interaction.register({ x: -4, z: 14, radius: 2.5, label: "Check the coin", onInteract: () => { if (MS.isDone("m2")) { this.ui.toast("You already did the honest thing here. 💛"); return; } MS.runChoice(m2); } });

      // ---- M3: Sharing ----
      const m3 = MS.define({ id: "m3", npc: childA, giver: { name: "Yusuf", avatar: "🧒" }, emoji: "🎁", points: 8, ach: "share",
        values: ["Sharing", "Generosity"], lesson: "Sharing with others makes everyone happy.",
        cardBody: "You shared your snack with Yusuf.",
        prompt: "You have snacks and Yusuf forgot his. What will you do?",
        choices: [ { label: "🎁 Share with him", good: true }, { label: "🍪 Give him one", good: true }, { label: "🙅 Keep them all", good: false } ] });
      this.interaction.register({ x: childA.x, z: childA.z + 1.5, radius: 3, label: "Talk to Yusuf", onInteract: () => { MS.isDone("m3") ? this.dialogue.show({ name: "Yusuf", avatar: "🧒", text: "Thanks for sharing earlier! You're a great friend. 😄", choices: [{ label: "🙂" }] }) : MS.runChoice(m3); } });

      // ---- M4: Caring for animals (cat) ----
      const m4 = MS.define({ id: "m4", giver: { name: "A little cat", avatar: "🐱" }, emoji: "🐱", points: 8, ach: "animal",
        values: ["Kindness to animals"], lesson: "Being kind to animals is a good deed.",
        cardBody: "You gave the thirsty little cat some water.",
        prompt: "A little cat looks thirsty. What will you do?",
        choices: [ { label: "💧 Give it water", good: true }, { label: "🐾 Pet it gently", good: true }, { label: "🏃 Chase it away", good: false } ] });
      this.interaction.register({ x: 8, z: 30, radius: 3, label: "Help the cat", onInteract: () => { MS.isDone("m4") ? this.ui.toast("The cat purrs happily. 🐱") : MS.runChoice(m4); } });

      // ---- M5: Clean park (collect litter) ----
      const m5 = MS.define({ id: "m5", npc: gardener, giver: { name: "Gardener Bilal", avatar: "🧑‍🌾" }, emoji: "🧹", points: 12, ach: "clean",
        values: ["Cleanliness", "Caring for the environment"], lesson: "Keeping our surroundings clean is a good habit.",
        cardBody: "You cleaned up all the litter in the park." });
      this.interaction.register({ x: gardener.x, z: gardener.z + 1.5, radius: 3, label: "Talk to Gardener Bilal", onInteract: () => {
        if (MS.isDone("m5")) { this.dialogue.show({ name: "Gardener Bilal", avatar: "🧑‍🌾", text: "The park looks wonderful now. Thank you! 🌿", choices: [{ label: "🙂" }] }); return; }
        if (this._m5active) { this.dialogue.show({ name: "Gardener Bilal", avatar: "🧑‍🌾", text: "Please pop the litter into the bins around the park!", choices: [{ label: "Okay!" }] }); return; }
        this.dialogue.show({ name: "Gardener Bilal", avatar: "🧑‍🌾", text: "The park has some litter. Could you help me clean it up?", choices: [
          { label: "Yes! 🧹", onPick: () => { this.dialogue.close(); this.startCleanup(m5); } }, { label: "Maybe later", onPick: () => this.dialogue.close() } ] });
      } });

      // ---- M6: Respect parents ----
      const m6 = MS.define({ id: "m6", npc: parent, giver: { name: "Mama Khadija", avatar: "👩" }, emoji: "📚", points: 8,
        values: ["Respect", "Helping family"], lesson: "We should treat our parents with kindness and respect.",
        cardBody: "You politely helped bring the book for Mama Khadija.",
        prompt: "Mama Khadija asks: \"Could you please bring this book?\"",
        choices: [ { label: "😊 Yes, of course!", good: true }, { label: "🙂 Sure, right away", good: true }, { label: "😒 Ugh, do I have to?", good: false } ] });
      this.interaction.register({ x: parent.x, z: parent.z + 1.5, radius: 3, label: "Talk to Mama Khadija", onInteract: () => { MS.isDone("m6") ? this.dialogue.show({ name: "Mama Khadija", avatar: "👩", text: "You're such a helpful child, mashaAllah. 💛", choices: [{ label: "🙂" }] }) : MS.runChoice(m6); } });

      // ---- M7: Salam ----
      const m7 = MS.define({ id: "m7", npc: kidB, giver: { name: "Sara", avatar: "👧" }, emoji: "👋", points: 5,
        values: ["Good manners", "Greeting others"], lesson: "Salam is a beautiful way to greet others. \"As-salamu alaykum\" means \"peace be upon you\".",
        cardBody: "You greeted Sara with a warm Salam.",
        prompt: "You meet Sara on the path. What do you say?",
        choices: [ { label: "👋 As-salamu alaykum!", good: true }, { label: "😶 Walk past quietly", good: false } ] });
      this.interaction.register({ x: kidB.x, z: kidB.z + 1.5, radius: 3, label: "Meet Sara", onInteract: () => { MS.isDone("m7") ? this.dialogue.show({ name: "Sara", avatar: "👧", text: "Wa alaykum as-salam! Nice to see you again. 😊", choices: [{ label: "🙂" }] }) : MS.runChoice(m7); } });

      // ---- M8: Patience (bakery queue) ----
      const m8 = MS.define({ id: "m8", npc: baker, giver: { name: "Baker Idris", avatar: "🧑‍🍳" }, emoji: "🥖", points: 8,
        values: ["Patience"], lesson: "Patience is an important and beautiful quality.",
        cardBody: "You waited patiently in the bakery queue.",
        prompt: "There's a queue at the bakery. What will you do?",
        choices: [ { label: "🧍 Wait patiently in line", good: true }, { label: "😤 Push to the front", good: false } ] });
      this.interaction.register({ x: baker.x, z: baker.z + 1.5, radius: 3, label: "Talk to Baker Idris", onInteract: () => { MS.isDone("m8") ? this.dialogue.show({ name: "Baker Idris", avatar: "🧑‍🍳", text: "Fresh bread for my patient friend! 🥖", choices: [{ label: "Thank you!" }] }) : MS.runChoice(m8); } });

      // ---- M9: Gratitude ----
      const m9 = MS.define({ id: "m9", npc: librarian, giver: { name: "Librarian Zaid", avatar: "🧑" }, emoji: "🙏", points: 5,
        values: ["Gratitude", "Good manners"], lesson: "Saying thank you shows gratitude and good manners.",
        cardBody: "You thanked Librarian Zaid for his help.",
        prompt: "Librarian Zaid helped you find a lovely book. What do you say?",
        choices: [ { label: "🙏 Thank you so much!", good: true }, { label: "🚶 Walk away", good: false } ] });
      this.interaction.register({ x: librarian.x, z: librarian.z + 1.5, radius: 3, label: "Talk to Librarian Zaid", onInteract: () => { MS.isDone("m9") ? this.dialogue.show({ name: "Librarian Zaid", avatar: "🧑", text: "Happy to help anytime! 📚", choices: [{ label: "🙂" }] }) : MS.runChoice(m9); } });

      // ---- M10: Good Choice Quiz (Teacher Fatima) ----
      const m10 = MS.define({ id: "m10", npc: teacher, giver: { name: "Teacher Fatima", avatar: "👩‍🏫" }, emoji: "🧩", points: 15,
        values: ["Good character", "Reflection"], lesson: "Every small good choice helps build a kind heart.",
        cardBody: "You finished the Good Choice quiz — well done!" });
      this.interaction.register({ x: teacher.x, z: teacher.z + 1.5, radius: 3, label: "Talk to Teacher Fatima", onInteract: () => {
        if (MS.isDone("m10")) { this.dialogue.show({ name: "Teacher Fatima", avatar: "👩‍🏫", text: "You have a very kind heart, mashaAllah! 🌟", choices: [{ label: "🙂" }] }); return; }
        this.dialogue.show({ name: "Teacher Fatima", avatar: "👩‍🏫", text: "Shall we play a little Good Choice game together?", choices: [
          { label: "Yes! 🧩", onPick: () => { this.dialogue.close(); this.startQuiz(m10); } }, { label: "Maybe later", onPick: () => this.dialogue.close() } ] });
      } });

      // mosque etiquette info spot (no worship gameplay — just manners)
      this.interaction.register({ x: this.world.mosquePos.x, z: this.world.mosquePos.z, radius: 5, label: "Mosque courtyard", onInteract: () => {
        this.dialogue.show({ name: "Mosque Etiquette", avatar: "🕌", text: "Near the mosque we walk calmly, speak quietly, keep the area clean, and remove our shoes before entering. Being respectful is a good habit. 🤍", choices: [{ label: "I'll be respectful 🤍", onPick: () => { this.dialogue.close(); if (!this._mosqueSeen) { this._mosqueSeen = true; this.deeds.add(4, ["Respect", "Cleanliness"]); this.ui.toast("+4 ⭐ Good manners!"); } } }] });
      } });
    }

    buildCat() {
      const g = new THREE.Group(); const fur = stdMat(0xd9a05b);
      const body = new THREE.Mesh(G.sph, fur); body.scale.set(0.6, 0.45, 0.9); body.position.y = 0.5; g.add(body);
      const head = new THREE.Mesh(G.sph, fur); head.scale.set(0.42, 0.42, 0.42); head.position.set(0, 0.7, 0.55); g.add(head);
      const e1 = box(0.14, 0.2, 0.1, fur); e1.position.set(-0.18, 1.0, 0.5); e1.rotation.z = 0.3; g.add(e1);
      const e2 = e1.clone(); e2.position.x = 0.18; e2.rotation.z = -0.3; g.add(e2);
      const tail = new THREE.Mesh(G.cyl, fur); tail.scale.set(0.12, 0.7, 0.12); tail.position.set(0, 0.6, -0.6); tail.rotation.x = 0.8; g.add(tail);
      const marker = new THREE.Mesh(G.oct, new THREE.MeshStandardMaterial({ color: 0xffcf5c, emissive: 0xffa500, emissiveIntensity: 0.6 }));
      marker.position.y = 1.7; g.add(marker); g._marker = marker; g._t = 0;
      return g;
    }

    // ---- collection missions ----
    startGrocery(elder, m1) {
      this._m1active = true;
      this._m1items = [];
      const spots = [[-8, -6], [-12, -9], [-9, -11], ];
      for (const [x, z] of spots) this._m1items.push(this.pickups.spawn("grocery", x, z));
      this.ui.toast("Pick up the 3 grocery bags 🛍️");
    }
    startCleanup(m5) {
      this._m5active = true; this._m5items = [];
      const px = this.world.parkPos.x, pz = this.world.parkPos.z;
      for (let i = 0; i < 5; i++) { const a = rand(0, Math.PI * 2), r = rand(6, 14); this._m5items.push(this.pickups.spawn("litter", px + Math.cos(a) * r, pz + Math.sin(a) * r)); }
      this.ui.toast("Collect all 5 pieces of litter 🧹");
    }

    // ---- quiz mini-game ----
    startQuiz(m10) {
      const qs = [
        { q: "Your friend is sad. What do you do?", ch: [["Say something kind", true], ["Ignore them", false], ["Laugh at them", false]] },
        { q: "You see rubbish on the floor. What's best?", ch: [["Put it in the bin", true], ["Leave it", false]] },
        { q: "Someone gives you a gift. You say…", ch: [["JazakAllah / Thank you!", true], ["Nothing", false]] },
      ];
      let idx = 0, correct = 0; const self = this;
      this.state = "quiz"; el("quizScreen").classList.remove("hidden");
      function render() {
        el("quizQ").textContent = qs[idx].q; el("quizFeedback").textContent = "";
        const cont = el("quizChoices"); cont.innerHTML = "";
        qs[idx].ch.forEach(([label, good]) => {
          const b = document.createElement("button"); b.textContent = label;
          b.onclick = () => {
            self.audio.click();
            if (good) { b.classList.add("good"); correct++; el("quizFeedback").textContent = "Great choice! 🌟"; self.audio.good(); setTimeout(next, 750); }
            else { b.classList.add("try"); el("quizFeedback").textContent = "Let's try another choice. 🙂"; self.audio.gentle(); }
          };
          cont.appendChild(b);
        });
      }
      function next() { idx++; if (idx >= qs.length) { el("quizScreen").classList.add("hidden"); self.state = "playing"; self.missionSys.complete(m10, self.missionSys.isDone("m10")); } else render(); }
      render();
    }

    // ---------------- UI wiring ----------------
    bindUI() {
      el("playBtn").onclick = () => { this.audio.ensure(); this.audio.click(); this.openCharSelect(); };
      el("howBtn").onclick = () => { this.audio.click(); this.showOnly("howScreen"); };
      el("parentBtn").onclick = () => { this.audio.click(); this.showParent(); };
      el("parentBtn2").onclick = () => { this.audio.click(); this.showParent(); };
      el("settingsBtn").onclick = () => { this.audio.click(); this.showOnly("settingsScreen"); };
      document.querySelector("[data-close-how]").onclick = () => { this.audio.click(); this.showOnly("menuScreen"); };
      document.querySelector("[data-close-settings]").onclick = () => { this.audio.click(); this.showOnly(this.built && this.state !== "menu" ? null : "menuScreen"); if (this.built && this._returnPause) { this._returnPause = false; el("pauseScreen").classList.remove("hidden"); } };
      document.querySelector("[data-close-parent]").onclick = () => { this.audio.click(); el("parentScreen").classList.add("hidden"); if (this._parentFromPause) { this._parentFromPause = false; el("pauseScreen").classList.remove("hidden"); } else this.showOnly("menuScreen"); };

      el("resumeBtn").onclick = () => this.togglePause();
      el("menuBtn").onclick = () => this.toMenu();
      el("againBtn").onclick = () => { this.audio.click(); this.save.reset(); location.reload(); };
      el("exploreBtn").onclick = () => { this.audio.click(); el("completeScreen").classList.add("hidden"); this.state = "playing"; };
      el("pauseBtn").onclick = () => this.togglePause();
      el("soundBtn").onclick = () => { const m = this.audio.toggle(); el("soundBtn").textContent = m ? "🔇" : "🔊"; };
      el("resetBtn").onclick = () => { if (confirm("Reset all progress on this device?")) { this.save.reset(); this.ui.updateHUD(); this.ui.toast("Progress reset"); } };

      // char select
      el("genderSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; el("genderSeg").querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); this.char.gender = b.dataset.g; el("scarfRow").classList.toggle("hidden", this.char.gender !== "girl"); if (this.char.gender !== "girl") this.char.scarf = false; this.renderCharPreview(); };
      el("scarfSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; el("scarfSeg").querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); this.char.scarf = b.dataset.s === "on"; this.renderCharPreview(); };
      this.buildSwatches("skinSwatches", SKIN, "skin");
      this.buildSwatches("clothSwatches", CLOTH, "cloth");
      el("startBtn").onclick = () => { this.audio.click(); this.save.data.char = this.char; this.save.save(); this.beginGame(); };

      // settings segments
      el("qualitySeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; el("qualitySeg").querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); this.quality = b.dataset.q; localStorage.setItem("jgdQuality", this.quality); };
      el("qualitySeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.q === this.quality));
      el("soundSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; el("soundSeg").querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); this.audio.muted = b.dataset.s === "off"; el("soundBtn").textContent = this.audio.muted ? "🔇" : "🔊"; };
    }
    buildSwatches(id, arr, key) {
      const cont = el(id); cont.innerHTML = "";
      arr.forEach((col, i) => { const s = document.createElement("div"); s.className = "swatch" + (this.char[key] === col ? " on" : ""); s.style.background = "#" + col.toString(16).padStart(6, "0"); s.onclick = () => { this.char[key] = col; cont.querySelectorAll(".swatch").forEach((x) => x.classList.remove("on")); s.classList.add("on"); this.renderCharPreview(); }; cont.appendChild(s); });
    }
    renderCharPreview() { el("charPreview").textContent = this.char.gender === "girl" ? (this.char.scarf ? "🧕" : "👧") : "🧒"; }

    showOnly(id) { ["menuScreen", "howScreen", "settingsScreen", "parentScreen", "charScreen"].forEach((s) => el(s).classList.toggle("hidden", s !== id)); }
    openCharSelect() { this.renderCharPreview(); el("scarfRow").classList.toggle("hidden", this.char.gender !== "girl"); this.showOnly("charScreen"); }

    showParent() {
      const d = this.save.data;
      el("parentStats").innerHTML = [
        ["Good Deed Points", d.points], ["Missions completed", d.completed.length + " / " + (this.missionSys.missions.length || 10)],
        ["Rank", this.deeds.rank()], ["Play time", Math.floor(d.playSeconds / 60) + " min"],
      ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
      const allValues = ["Honesty", "Kindness", "Sharing", "Patience", "Respect", "Cleanliness", "Gratitude", "Kindness to animals", "Good manners"];
      el("valuesLearned").innerHTML = allValues.map((v) => `<span class="value-chip ${d.values.includes(v) ? "" : "locked"}">${d.values.includes(v) ? "✓ " : ""}${v}</span>`).join("");
      el("achievementsList").innerHTML = ACHIEVEMENTS.map((a) => `<div class="ach ${d.achievements.includes(a.id) ? "" : "locked"}"><span class="a-ico">${a.icon}</span><span class="a-txt"><b>${a.name}</b>${a.desc}</span></div>`).join("");
      if (this.state === "paused") { this._parentFromPause = true; el("pauseScreen").classList.add("hidden"); }
      el("menuScreen").classList.add("hidden");
      el("parentScreen").classList.remove("hidden");
    }

    beginGame() {
      this.buildWorld();
      this.showOnly(null);
      ["charScreen", "menuScreen"].forEach((s) => el(s).classList.add("hidden"));
      el("hud").classList.remove("hidden");
      this.ui.updateHUD();
      this.state = "playing";
      this.checkAreaUnlocks(true);
    }

    togglePause() {
      if (this.state === "playing") { this.state = "paused"; el("pauseScreen").classList.remove("hidden"); }
      else if (this.state === "paused") { el("pauseScreen").classList.add("hidden"); this.state = "playing"; }
    }
    toMenu() { this.state = "menu"; el("pauseScreen").classList.add("hidden"); el("hud").classList.add("hidden"); el("interactPrompt").classList.add("hidden"); this.showOnly("menuScreen"); }

    checkAreaUnlocks(silent) {
      const p = this.deeds.points;
      let area = "🏠 Neighborhood";
      if (p >= 200) area = "🕌 Community Area"; else if (p >= 100) area = "📚 Library District"; else if (p >= 50) area = "🌳 Park & Market";
      if (this._area !== area) { const first = this._area != null; this._area = area; this.ui.area(area); if (first && !silent) this.ui.toast("🔓 New area feel: " + area); }
    }

    showCompletion() {
      this._completedShown = true;
      const vals = ["Kindness", "Honesty", "Patience", "Sharing", "Respect", "Gratitude"];
      el("completeValues").innerHTML = vals.map((v) => `<span class="value-chip">✓ ${v}</span>`).join("");
      this.state = "complete"; el("completeScreen").classList.remove("hidden"); this.audio.achieve();
    }

    // ---------------- loop ----------------
    loop(now) {
      let dt = (now - this.last) / 1000; this.last = now; if (dt > 0.05) dt = 0.05;
      if (this.state === "playing") {
        this.save.data.playSeconds += dt;
        const mv = this.input.getMoveVector();
        const moving = this.player.update(dt, mv, this.input.yaw, this.world);
        if (moving && (this._stepT = (this._stepT || 0) + dt) > 0.32) { this._stepT = 0; this.audio.step(); }
        this.world.update(dt);
        this.npcs.update(dt, this.player);
        // cat marker bob
        if (this.catObj && this.catObj._marker) { this.catObj._t += dt; this.catObj._marker.visible = !this.missionSys.isDone("m4"); this.catObj._marker.position.y = 1.7 + Math.sin(this.catObj._t * 3) * 0.15; }
        if (this.coinObj) { this.coinObj.visible = !this.missionSys.isDone("m2"); this.coinObj.rotation.z += dt * 2; }
        // pickups
        this.pickups.update(dt, this.player, (it) => this.onPickupCollected(it));
        this.interaction.update(this.player);
      }
      if (this.built) this.camCtl.update(dt, this.player);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(this.loop);
    }

    onPickupCollected(it) {
      this.audio.collect();
      if (it.kind === "grocery") {
        const left = this._m1items.filter((x) => !x.collected).length;
        if (left === 0) { this._m1active = false; const m = this.missionSys.missions.find((x) => x.id === "m1"); this.missionSys.complete(m, this.missionSys.isDone("m1")); }
        else this.ui.toast(left + " grocery bag" + (left > 1 ? "s" : "") + " left 🛍️");
      } else if (it.kind === "litter") {
        const left = this._m5items.filter((x) => !x.collected).length;
        if (left === 0) { this._m5active = false; const m = this.missionSys.missions.find((x) => x.id === "m5"); this.missionSys.complete(m, this.missionSys.isDone("m5")); }
        else this.ui.toast(left + " piece" + (left > 1 ? "s" : "") + " of litter left 🧹");
      }
    }
  }

  window.addEventListener("DOMContentLoaded", () => { try { window._journey = new Game(); } catch (e) { console.error(e); el("loadMsg").textContent = "Error: " + e.message; } });
})();
