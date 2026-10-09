/* ============================================================
   GRAPPLE MECH 3D — arena.js
   Shared namespace (GM3D), utils, procedural-texture-with-
   fallback loader, shared geometry/material library, and the
   multi-tiered floating combat arena over a lava void: landing
   platforms, grapple-anchor pillars & floating rings, wall
   structures, and the shrinking plasma-surge safe zone.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const GM = (window.GM3D = window.GM3D || {});

  // ---------- small helpers shared across modules ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const el = (id) => document.getElementById(id);
  const dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  GM.util = { clamp, lerp, rand, randi, pick, el, dist2D };

  // ---------- match constants ----------
  GM.KILL_TARGET = 5;
  GM.LAVA_Y = -10;
  GM.GRAVITY = 20;

  // ============================================================
  //  TEXTURES  (real files if present in /textures, else procedural
  //  canvas fallback generated instantly so the game never breaks)
  // ============================================================
  function canvasTex(draw, size) {
    const c = document.createElement("canvas"); c.width = c.height = size || 128;
    draw(c.getContext("2d"), c.width, c.height);
    return new THREE.CanvasTexture(c);
  }
  function loadWithFallback(url, fallbackTex, repeat) {
    const tex = fallbackTex;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (repeat) tex.repeat.set(repeat[0], repeat[1]);
    const img = new Image();
    img.onload = () => { tex.image = img; tex.needsUpdate = true; };
    img.onerror = () => {};
    img.src = url;
    return tex;
  }
  function makePlateCanvas(ctx, w, h) {
    ctx.fillStyle = "#2a3542"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(53,210,255,0.35)"; ctx.lineWidth = 2;
    for (let x = 0; x <= w; x += w / 4) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += h / 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    for (let i = 0; i < 80; i++) ctx.fillRect(rand(0, w), rand(0, h), rand(2, 6), rand(2, 6));
  }
  function makeLavaCanvas(ctx, w, h) {
    ctx.fillStyle = "#2a0a04"; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = pick(["#ff6a1a", "#ff3d0d", "#ffb13d"]);
      ctx.globalAlpha = rand(0.2, 0.5);
      ctx.beginPath(); ctx.ellipse(rand(0, w), rand(0, h), rand(8, 26), rand(6, 16), rand(0, Math.PI), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function makeGridCanvas(ctx, w, h) {
    ctx.fillStyle = "#0a1018"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(53,210,255,0.5)"; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  }

  GM.TEX = {};
  GM.initTextures = function initTextures(basePath) {
    const T = GM.TEX;
    T.plate = loadWithFallback(basePath + "mech_plate.jpg", canvasTex(makePlateCanvas, 128), [6, 6]);
    T.lava = loadWithFallback(basePath + "lava_flow.jpg", canvasTex(makeLavaCanvas, 128), [8, 8]);
    T.grid = loadWithFallback(basePath + "neon_grid.png", canvasTex(makeGridCanvas, 128), [10, 10]);
    T.cable = loadWithFallback(basePath + "grapple_cable.png", canvasTex(makeGridCanvas, 32), [1, 1]);
  };

  // ============================================================
  //  SHARED GEOMETRY / MATERIAL LIBRARY
  // ============================================================
  GM.LIB = {};
  GM.initLib = function initLib() {
    const LIB = GM.LIB;
    LIB.box = new THREE.BoxGeometry(1, 1, 1);
    LIB.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
    LIB.cone = new THREE.ConeGeometry(1, 1, 10);
    LIB.sphere = new THREE.SphereGeometry(1, 14, 12);
    LIB.ring = new THREE.TorusGeometry(1, 0.08, 8, 24);
    LIB.plane = new THREE.PlaneGeometry(1, 1);
    LIB.matDeck = new THREE.MeshStandardMaterial({ map: GM.TEX.plate, roughness: 0.75, metalness: 0.5, color: 0xffffff });
    LIB.matHull = new THREE.MeshStandardMaterial({ color: 0x2a3542, roughness: 0.55, metalness: 0.6 });
    LIB.matLava = new THREE.MeshStandardMaterial({ map: GM.TEX.lava, emissive: 0xff5a1a, emissiveIntensity: 0.9, roughness: 1 });
    LIB.matAnchor = new THREE.MeshBasicMaterial({ color: 0x35d2ff });
    LIB.matAnchorWarn = new THREE.MeshBasicMaterial({ color: 0xffd166 });
  };

  // ============================================================
  //  ARENA  (platforms, anchors, walls, lava void, safe zone)
  // ============================================================
  class Arena {
    constructor(scene) {
      this.scene = scene;
      this.pads = [];        // { x, z, r, y } landing platforms
      this.walls = [];       // { x, z, hw, hd, h, rotY } collidable panels
      this.anchors = [];     // { x, y, z, mesh } grapple targets
      this.wallMeshes = [];  // raycastable wall meshes (also grapple targets)
      this.maxRadius = 46;
      this.minRadius = 17;
      this.safeRadius = this.maxRadius;
      this.displayRadius = this.maxRadius;
      this.stormT = rand(22, 30);
      this.stormWarnT = 0;
      this.stormWarning = false;
      this.build();
    }

    addPad(x, z, r, y) { this.pads.push({ x, z, r, y }); }
    addAnchor(x, y, z, mesh) { this.anchors.push({ x, y, z, mesh }); }

    build() {
      this.buildLava();
      this.buildPlatforms();
      this.buildPillars();
      this.buildFloatingRings();
      this.buildWalls();
      this.buildSafeZoneRing();
    }

    buildLava() {
      const lava = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), GM.LIB.matLava);
      lava.rotation.x = -Math.PI / 2;
      lava.position.y = GM.LAVA_Y;
      this.scene.add(lava);
      this.lavaMesh = lava;
    }

    _deckMesh(radius, height, y, segments) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.96, height, segments || 24), GM.LIB.matDeck);
      mesh.position.y = y - height / 2;
      return mesh;
    }

    buildPlatforms() {
      // main central deck
      this.addPad(0, 0, 26, 0);
      this.scene.add(this._deckMesh(26, 1.2, 0, 28));
      const rim = new THREE.Mesh(GM.LIB.ring, new THREE.MeshBasicMaterial({ color: 0x35d2ff }));
      rim.rotation.x = Math.PI / 2; rim.scale.setScalar(26); rim.position.y = 0.05;
      this.scene.add(rim);

      // 4 mid platforms around the deck
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const x = Math.cos(ang) * 24, z = Math.sin(ang) * 24;
        this.addPad(x, z, 8, 7);
        const mesh = this._deckMesh(8, 1, 7, 18);
        mesh.position.set(x, 7 - 0.5, z);
        this.scene.add(mesh);
      }

      // 2 high sniper platforms
      for (let i = 0; i < 2; i++) {
        const ang = i * Math.PI + Math.PI / 2;
        const x = Math.cos(ang) * 15, z = Math.sin(ang) * 15;
        this.addPad(x, z, 6, 14);
        const mesh = this._deckMesh(6, 1, 14, 16);
        mesh.position.set(x, 14 - 0.5, z);
        this.scene.add(mesh);
      }

      // central high spire (grapple-only focal point)
      this.addPad(0, 0, 4.5, 20);
      const spireBase = this._deckMesh(4.5, 1, 20, 12);
      this.scene.add(spireBase);
      const spireCol = new THREE.Mesh(GM.LIB.cyl, GM.LIB.matHull);
      spireCol.scale.set(1.4, 20, 1.4); spireCol.position.set(0, 10, 0);
      this.scene.add(spireCol);
    }

    buildPillars() {
      const pillarPositions = [];
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        pillarPositions.push({ x: Math.cos(ang) * 34, z: Math.sin(ang) * 34 });
      }
      for (const p of pillarPositions) {
        const h = rand(14, 22);
        const col = new THREE.Mesh(GM.LIB.cyl, GM.LIB.matHull);
        col.scale.set(1.1, h, 1.1); col.position.set(p.x, h / 2 + GM.LAVA_Y + 2, p.z);
        this.scene.add(col);
        const topY = h + GM.LAVA_Y + 2;
        const collar = new THREE.Mesh(GM.LIB.ring, GM.LIB.matAnchor);
        collar.rotation.x = Math.PI / 2; collar.scale.setScalar(1.3); collar.position.set(p.x, topY, p.z);
        this.scene.add(collar);
        this.addAnchor(p.x, topY, p.z, collar);
      }
    }

    buildFloatingRings() {
      for (let i = 0; i < 7; i++) {
        const ang = rand(0, Math.PI * 2);
        const dist = rand(10, 30);
        const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
        const y = rand(9, 19);
        const ring = new THREE.Mesh(GM.LIB.ring, GM.LIB.matAnchor.clone());
        ring.scale.setScalar(1.1);
        ring.position.set(x, y, z);
        ring.rotation.x = rand(0, Math.PI);
        ring.rotation.y = rand(0, Math.PI);
        ring.userData.spin = rand(0.3, 0.8);
        ring.userData.isFloatingRing = true;
        this.scene.add(ring);
        this.addAnchor(x, y, z, ring);
      }
      this.floatingRings = this.anchors.filter((a) => a.mesh.userData.isFloatingRing).map((a) => a.mesh);
    }

    buildWalls() {
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x33424f, roughness: 0.6, metalness: 0.4, emissive: 0x0b2a33, emissiveIntensity: 0.3 });
      const defs = [
        { x: 24, z: 24, hw: 4, hd: 0.4, h: 8, rotY: Math.PI / 4 },
        { x: -24, z: 24, hw: 4, hd: 0.4, h: 8, rotY: -Math.PI / 4 },
        { x: 24, z: -24, hw: 4, hd: 0.4, h: 8, rotY: -Math.PI / 4 },
        { x: -24, z: -24, hw: 4, hd: 0.4, h: 8, rotY: Math.PI / 4 },
      ];
      for (const d of defs) {
        const mesh = new THREE.Mesh(GM.LIB.box, wallMat);
        mesh.scale.set(d.hw * 2, d.h, d.hd * 2);
        mesh.position.set(d.x, GM.LAVA_Y + 2 + d.h / 2, d.z);
        mesh.rotation.y = d.rotY;
        this.scene.add(mesh);
        this.wallMeshes.push(mesh);
        this.walls.push({ x: d.x, z: d.z, hw: d.hw, hd: d.hd, h: d.h, rotY: d.rotY, y0: GM.LAVA_Y + 2, y1: GM.LAVA_Y + 2 + d.h });
      }
    }

    buildSafeZoneRing() {
      const ring = new THREE.Mesh(GM.LIB.ring, new THREE.MeshBasicMaterial({ color: 0x35d2ff, transparent: true, opacity: 0.55 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.3;
      ring.scale.setScalar(this.safeRadius);
      this.scene.add(ring);
      this.zoneRing = ring;
    }

    // ---------- queries ----------
    groundHeightAt(x, z) {
      let best = -Infinity;
      for (const p of this.pads) {
        if (dist2D(x, z, p.x, p.z) <= p.r && p.y > best) best = p.y;
      }
      return best;
    }

    // circle-vs-rotated-box push-out: work in the wall's local (unrotated) space, then
    // rotate the resolved local offset back into world space.
    resolveWallCollision(pos, radius) {
      for (const w of this.walls) {
        if (pos.y > w.y1 + 0.5 || pos.y < w.y0 - 0.5) continue;
        const dx = pos.x - w.x, dz = pos.z - w.z;
        const cosR = Math.cos(-w.rotY), sinR = Math.sin(-w.rotY);
        const lx = dx * cosR - dz * sinR, lz = dx * sinR + dz * cosR;
        const ox = w.hw + radius - Math.abs(lx);
        const oz = w.hd + radius - Math.abs(lz);
        if (ox <= 0 || oz <= 0) continue;
        let nlx = lx, nlz = lz;
        if (ox < oz) nlx = Math.sign(lx || 1) * (w.hw + radius);
        else nlz = Math.sign(lz || 1) * (w.hd + radius);
        const cosF = Math.cos(w.rotY), sinF = Math.sin(w.rotY);
        pos.x = w.x + (nlx * cosF - nlz * sinF);
        pos.z = w.z + (nlx * sinF + nlz * cosF);
      }
      return pos;
    }

    isInSafeZone(x, z) { return dist2D(x, z, 0, 0) <= this.safeRadius; }

    nearestAnchor(x, y, z, maxDist) {
      let best = null, bestD = maxDist || 60;
      for (const a of this.anchors) {
        const d = Math.hypot(x - a.x, y - a.y, z - a.z);
        if (d < bestD) { bestD = d; best = a; }
      }
      return best;
    }

    update(dt, onStormShrink) {
      if (this.floatingRings) for (const r of this.floatingRings) r.rotation.y += dt * (r.userData.spin || 0.4);

      this.stormT -= dt;
      if (this.stormT <= 0 && !this.stormWarning && this.safeRadius > this.minRadius) {
        this.stormWarning = true;
        this.stormWarnT = 5;
      }
      if (this.stormWarning) {
        this.stormWarnT -= dt;
        if (this.stormWarnT <= 0) {
          this.stormWarning = false;
          this.safeRadius = Math.max(this.minRadius, this.safeRadius - 9);
          this.stormT = rand(26, 36);
          if (onStormShrink) onStormShrink();
        }
      }
      this.displayRadius = lerp(this.displayRadius, this.safeRadius, 1 - Math.exp(-2.4 * dt));
      this.zoneRing.scale.setScalar(this.displayRadius);
      const warnPulse = this.stormWarning ? 0.5 + Math.sin(performance.now() * 0.02) * 0.3 : 0.5;
      this.zoneRing.material.color.setHex(this.stormWarning ? 0xff5c3d : 0x35d2ff);
      this.zoneRing.material.opacity = clamp(warnPulse, 0.2, 0.9);
    }
  }

  GM.Arena = Arena;
})();
