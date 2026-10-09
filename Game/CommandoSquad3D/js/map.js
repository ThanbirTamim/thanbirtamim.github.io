/* ============================================================
   COMMANDO SQUAD 3D — map.js
   Shared namespace (CS3D), utils, procedural-texture-with-fallback
   loader, shared geometry/material library, and the tropical
   coastal city battleground (buildings, ruined walls, sandbags,
   coconut/leafy trees, streets) + collision & line-of-sight helpers.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const CS = (window.CS3D = window.CS3D || {});

  // ---------- small helpers shared across modules ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const el = (id) => document.getElementById(id);
  const dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  CS.util = { clamp, lerp, rand, randi, pick, el, dist2D };

  // ---------- world constants ----------
  CS.WORLD_HALF = 90;
  CS.PLAYER_EYE_H = 1.6;

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
  function makeCamoCanvas(ctx, w, h) {
    ctx.fillStyle = "#4a5a2e"; ctx.fillRect(0, 0, w, h);
    const blobs = [["#3a4521", 0.5], ["#2a3318", 0.3], ["#6b7a3d", 0.35]];
    for (const [color, sizeF] of blobs) {
      ctx.fillStyle = color;
      for (let i = 0; i < 14; i++) {
        ctx.beginPath();
        const x = rand(0, w), y = rand(0, h), r = rand(8, w * sizeF);
        ctx.ellipse(x, y, r, r * rand(0.5, 0.9), rand(0, Math.PI), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  function makeBarkCanvas(ctx, w, h) {
    ctx.fillStyle = "#5a4226"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(30,18,8,0.5)";
    for (let i = 0; i < 18; i++) {
      ctx.lineWidth = rand(1, 3);
      ctx.beginPath(); ctx.moveTo(rand(0, w), 0); ctx.lineTo(rand(0, w), h); ctx.stroke();
    }
  }
  function makeConcreteCanvas(ctx, w, h) {
    ctx.fillStyle = "#8a8a82"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    for (let i = 0; i < 300; i++) { ctx.fillRect(rand(0, w), rand(0, h), rand(1, 3), rand(1, 3)); }
    ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 2;
    for (let y = 0; y < h; y += h / 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  }
  function makeRoadCanvas(ctx, w, h) {
    ctx.fillStyle = "#2b2b2e"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillRect(w / 2 - 3, 0, 6, h * 0.4);
    ctx.fillRect(w / 2 - 3, h * 0.6, 6, h * 0.4);
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let i = 0; i < 100; i++) ctx.fillRect(rand(0, w), rand(0, h), rand(2, 5), rand(2, 5));
  }
  function makePalmCanvas(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#2f7a33";
    ctx.beginPath(); ctx.moveTo(w * 0.5, h);
    ctx.quadraticCurveTo(w * 0.1, h * 0.5, w * 0.5, 0);
    ctx.quadraticCurveTo(w * 0.9, h * 0.5, w * 0.5, h);
    ctx.fill();
    ctx.strokeStyle = "#1f5a24"; ctx.lineWidth = 1.5;
    for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(w * 0.5, h); ctx.lineTo(w * 0.5 + (i - 3) * w * 0.06, h * (1 - i / 7)); ctx.stroke(); }
  }

  CS.TEX = {};
  CS.initTextures = function initTextures(basePath) {
    const T = CS.TEX;
    T.camo = loadWithFallback(basePath + "camo.jpg", canvasTex(makeCamoCanvas, 128), [2, 2]);
    T.bark = loadWithFallback(basePath + "bark.jpg", canvasTex(makeBarkCanvas, 64), [1, 4]);
    T.concrete = loadWithFallback(basePath + "concrete_wall.jpg", canvasTex(makeConcreteCanvas, 128), [2, 2]);
    T.road = loadWithFallback(basePath + "road.jpg", canvasTex(makeRoadCanvas, 128), [6, 40]);
    T.palm = loadWithFallback(basePath + "palm_leaf.png", canvasTex(makePalmCanvas, 64), [1, 1]);
    T.palm.wrapS = T.palm.wrapT = THREE.ClampToEdgeWrapping;
  };

  // ============================================================
  //  SHARED GEOMETRY / MATERIAL LIBRARY
  // ============================================================
  CS.LIB = {};
  CS.initLib = function initLib() {
    const LIB = CS.LIB;
    LIB.box = new THREE.BoxGeometry(1, 1, 1);
    LIB.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
    LIB.cone = new THREE.ConeGeometry(1, 1, 7);
    LIB.sphere = new THREE.SphereGeometry(1, 10, 8);
    LIB.plane = new THREE.PlaneGeometry(1, 1);
    LIB.matConcrete = new THREE.MeshStandardMaterial({ map: CS.TEX.concrete, roughness: 0.95, color: 0xffffff });
    LIB.matSandbag = new THREE.MeshStandardMaterial({ color: 0xb59a6a, roughness: 1 });
    LIB.matBark = new THREE.MeshStandardMaterial({ map: CS.TEX.bark, roughness: 1, color: 0xffffff });
    LIB.matPalm = new THREE.MeshStandardMaterial({ map: CS.TEX.palm, color: 0xffffff, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.8 });
    LIB.matLeaf = new THREE.MeshStandardMaterial({ color: 0x2f6e35, roughness: 1, flatShading: true });
    LIB.matRoad = new THREE.MeshStandardMaterial({ map: CS.TEX.road, roughness: 1, color: 0xffffff });
  };

  // ============================================================
  //  WORLD  (city battleground)
  // ============================================================
  class World {
    constructor(scene) {
      this.scene = scene;
      this.colliders = [];     // { x, z, hw, hd, h } — used for movement collision
      this.losBlockers = [];   // tall meshes used for line-of-sight raycasts
      this.coverPoints = [];   // { x, z } usable cover positions
      this.rooftops = [];      // { x, z, y } rooftop vantage positions for enemies
      this.buildMeshes = [];
      this.build();
    }

    addCollider(x, z, hw, hd, h) { this.colliders.push({ x, z, hw, hd, h }); }
    addCover(x, z) { this.coverPoints.push({ x, z }); }

    build() {
      this.buildGround();
      this.buildBuildings();
      this.buildRuins();
      this.buildSandbags();
      this.buildVegetation();
    }

    buildGround() {
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(CS.WORLD_HALF * 2.2, CS.WORLD_HALF * 2.2), CS.LIB.matRoad);
      ground.rotation.x = -Math.PI / 2;
      this.scene.add(ground);
    }

    buildBuildings() {
      const cols = 5, rows = 5, spacing = 32;
      const originX = -((cols - 1) * spacing) / 2, originZ = -((rows - 1) * spacing) / 2;
      for (let cx = 0; cx < cols; cx++) {
        for (let cz = 0; cz < rows; cz++) {
          const bx = originX + cx * spacing + rand(-3, 3);
          const bz = originZ + cz * spacing + rand(-3, 3);
          // leave the central lane + player's spawn corridor clear (south edge, +Z) for approach
          if (Math.abs(bx) < 7 && cz === rows - 1) continue;
          if (Math.random() < 0.18) continue; // occasional plaza / open lot
          const w = rand(9, 15), d = rand(9, 15), h = rand(7, 20);
          const mesh = new THREE.Mesh(CS.LIB.box, CS.LIB.matConcrete);
          mesh.scale.set(w, h, d);
          mesh.position.set(bx, h / 2, bz);
          this.scene.add(mesh);
          this.buildMeshes.push(mesh);
          this.addCollider(bx, bz, w / 2 + 0.4, d / 2 + 0.4, h);
          this.losBlockers.push(mesh);
          // roof access vantage point for enemy snipers
          this.rooftops.push({ x: bx, z: bz, y: h });
          // low parapet on the roof edge (visual + sniper cover)
          const parapet = new THREE.Mesh(CS.LIB.box, CS.LIB.matConcrete);
          parapet.scale.set(w + 0.3, 0.9, 0.4);
          parapet.position.set(bx, h + 0.45, bz - d / 2);
          this.scene.add(parapet);
          // corner cover points around the building base
          const off = 2.2;
          [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
            this.addCover(bx + sx * (w / 2 + off), bz + sz * (d / 2 + off));
          });
        }
      }
    }

    buildRuins() {
      for (let i = 0; i < 12; i++) {
        const x = rand(-CS.WORLD_HALF + 10, CS.WORLD_HALF - 10);
        const z = rand(-CS.WORLD_HALF + 10, CS.WORLD_HALF - 10);
        if (this.isNearCollider(x, z, 6)) continue;
        const w = rand(3, 6), h = rand(1.1, 2.2), d = rand(0.6, 1.0);
        const mesh = new THREE.Mesh(CS.LIB.box, CS.LIB.matConcrete);
        mesh.rotation.y = rand(0, Math.PI * 2);
        mesh.scale.set(w, h, d);
        mesh.position.set(x, h / 2, z);
        this.scene.add(mesh);
        this.addCollider(x, z, (w / 2) * Math.abs(Math.cos(mesh.rotation.y)) + (d / 2) * Math.abs(Math.sin(mesh.rotation.y)) + 0.3,
                                 (w / 2) * Math.abs(Math.sin(mesh.rotation.y)) + (d / 2) * Math.abs(Math.cos(mesh.rotation.y)) + 0.3, h);
        this.addCover(x + Math.cos(mesh.rotation.y + Math.PI / 2) * 1.6, z + Math.sin(mesh.rotation.y + Math.PI / 2) * 1.6);
      }
    }

    buildSandbags() {
      for (let i = 0; i < 16; i++) {
        const x = rand(-CS.WORLD_HALF + 8, CS.WORLD_HALF - 8);
        const z = rand(-CS.WORLD_HALF + 8, CS.WORLD_HALF - 8);
        if (this.isNearCollider(x, z, 4)) continue;
        const g = new THREE.Group();
        const rotY = rand(0, Math.PI * 2);
        const count = randi(3, 5);
        for (let j = 0; j < count; j++) {
          const bag = new THREE.Mesh(CS.LIB.sphere, CS.LIB.matSandbag);
          bag.scale.set(0.65, 0.4, 0.42);
          bag.position.set((j - count / 2) * 0.68, 0.22 + (j % 2) * 0.32, 0);
          g.add(bag);
        }
        g.rotation.y = rotY; g.position.set(x, 0, z);
        this.scene.add(g);
        this.addCollider(x, z, count * 0.4, 0.9, 0.7);
        this.addCover(x + Math.cos(rotY + Math.PI / 2) * 1.4, z + Math.sin(rotY + Math.PI / 2) * 1.4);
      }
    }

    isNearCollider(x, z, margin) {
      for (const c of this.colliders) {
        if (Math.abs(x - c.x) < c.hw + margin && Math.abs(z - c.z) < c.hd + margin) return true;
      }
      return false;
    }

    buildVegetation() {
      for (let i = 0; i < 28; i++) {
        const x = rand(-CS.WORLD_HALF + 5, CS.WORLD_HALF - 5);
        const z = rand(-CS.WORLD_HALF + 5, CS.WORLD_HALF - 5);
        if (this.isNearCollider(x, z, 1.5)) continue;
        if (Math.random() < 0.55) this.makeCoconutTree(x, z); else this.makeLeafyTree(x, z);
      }
    }

    makeCoconutTree(x, z) {
      const g = new THREE.Group();
      const segs = 7; const lean = rand(-0.22, 0.22);
      let cx = 0, cy = 0, cz = 0;
      const segH = rand(0.9, 1.2);
      for (let i = 0; i < segs; i++) {
        const t = i / segs;
        const curve = Math.sin(t * Math.PI * 0.5) * lean;
        const seg = new THREE.Mesh(CS.LIB.cyl, CS.LIB.matBark);
        seg.scale.set(lerp(0.32, 0.16, t), segH, lerp(0.32, 0.16, t));
        seg.position.set(cx, cy + segH / 2, cz);
        seg.rotation.z = curve;
        g.add(seg);
        cy += segH * Math.cos(curve);
        cx += segH * Math.sin(curve);
      }
      // fronds radiating from the crown
      const frondCount = 7;
      for (let i = 0; i < frondCount; i++) {
        const frond = new THREE.Mesh(CS.LIB.plane, CS.LIB.matPalm);
        frond.scale.set(1.0, 2.6, 1);
        frond.position.set(cx, cy + 0.6, cz);
        const ang = (i / frondCount) * Math.PI * 2;
        frond.rotation.y = ang;
        frond.rotation.x = -Math.PI / 2.6;
        g.add(frond);
      }
      // a couple of coconuts
      for (let i = 0; i < 3; i++) {
        const nut = new THREE.Mesh(CS.LIB.sphere, CS.LIB.matBark);
        nut.scale.setScalar(0.16);
        nut.position.set(cx + rand(-0.2, 0.2), cy + 0.25, cz + rand(-0.2, 0.2));
        g.add(nut);
      }
      g.position.set(x, 0, z);
      this.scene.add(g);
      this.addCollider(x, z, 0.4, 0.4, 2.0);
    }

    makeLeafyTree(x, z) {
      const g = new THREE.Group();
      const h = rand(2.2, 3.4);
      const trunk = new THREE.Mesh(CS.LIB.cyl, CS.LIB.matBark);
      trunk.scale.set(0.34, h, 0.34); trunk.position.y = h / 2;
      g.add(trunk);
      const clumps = randi(3, 5);
      for (let i = 0; i < clumps; i++) {
        const leaf = new THREE.Mesh(CS.LIB.sphere, CS.LIB.matLeaf);
        const s = rand(1.1, 1.8);
        leaf.scale.set(s, s * 0.8, s);
        leaf.position.set(rand(-0.6, 0.6), h + rand(0.2, 1.0), rand(-0.6, 0.6));
        g.add(leaf);
      }
      g.position.set(x, 0, z);
      this.scene.add(g);
      this.addCollider(x, z, 0.4, 0.4, h);
    }

    // ---- collision: push a circle (pos, radius) out of any overlapping AABB collider ----
    resolveCollision(pos, radius) {
      for (const c of this.colliders) {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const ox = c.hw + radius - Math.abs(dx);
        const oz = c.hd + radius - Math.abs(dz);
        if (ox > 0 && oz > 0) {
          if (ox < oz) pos.x += ox * Math.sign(dx || 1);
          else pos.z += oz * Math.sign(dz || 1);
        }
      }
      const b = CS.WORLD_HALF - 1;
      pos.x = clamp(pos.x, -b, b); pos.z = clamp(pos.z, -b, b);
      return pos;
    }

    // ---- line of sight: true if nothing tall blocks the segment ----
    hasLineOfSight(from, to) {
      const dir = new THREE.Vector3().subVectors(to, from);
      const dist = dir.length();
      if (dist < 0.001) return true;
      dir.normalize();
      if (!this._ray) this._ray = new THREE.Raycaster();
      this._ray.set(from, dir);
      this._ray.far = dist - 0.3;
      const hits = this._ray.intersectObjects(this.buildMeshes, false);
      return hits.length === 0;
    }

    nearestCover(x, z, awayFromX, awayFromZ, maxDist) {
      let best = null, bestScore = -Infinity;
      for (const c of this.coverPoints) {
        const d = dist2D(x, z, c.x, c.z);
        if (d > (maxDist || 40)) continue;
        // prefer cover that is close to the unit but positioned between unit and threat
        const score = -d + dist2D(c.x, c.z, awayFromX, awayFromZ) * 0.15;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return best;
    }
  }

  CS.World = World;
})();
