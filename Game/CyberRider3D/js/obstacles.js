/* ============================================================
   CYBER RIDER 3D — obstacles.js
   Pooled hazards (laser gates, drone mines, barricades),
   collectibles (energy orbs, nitro crystals) and the neon
   particle explosion system.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const CR = (window.CR3D = window.CR3D || {});
  const { clamp, lerp, rand, randi, pick } = CR.util;

  const boxMesh = (w, h, d, mat) => { const m = new THREE.Mesh(CR.LIB.box, mat); m.scale.set(w, h, d); return m; };

  // ============================================================
  //  HAZARD MANAGER  (laser gates / drone mines / barricades)
  // ============================================================
  const HAZARD_TYPES = ["laser", "drone", "barricade"];

  class HazardManager {
    constructor(scene, quality) {
      this.scene = scene; this.pool = []; this.active = []; this.quality = quality;
      this.max = quality === "low" ? 7 : 10;
      for (let i = 0; i < this.max; i++) this.pool.push(this.make());
      this.spawnT = 1.6;
    }
    make() {
      const g = new THREE.Group(); g.visible = false;
      this.scene.add(g); return g;
    }
    configure(g, type) {
      while (g.children.length) g.remove(g.children[0]);
      g._type = type;
      if (type === "laser") {
        const mat = new THREE.MeshBasicMaterial({ color: 0xff3b5c, transparent: true, opacity: 0.85 });
        const beam = boxMesh(3.2, 1.6, 0.14, mat); beam.position.y = 1.0; g.add(beam);
        const postMat = new THREE.MeshStandardMaterial({ color: 0x1a0a20, metalness: 0.6, roughness: 0.4 });
        const p1 = boxMesh(0.2, 2.2, 0.2, postMat); p1.position.set(-1.6, 1.1, 0); g.add(p1);
        const p2 = boxMesh(0.2, 2.2, 0.2, postMat); p2.position.set(1.6, 1.1, 0); g.add(p2);
        g._hw = 1.6; g._hh = 0.9; g._hd = 0.3; g._cy = 1.0;
      } else if (type === "drone") {
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x241233, metalness: 0.7, roughness: 0.25, emissive: 0x3a0a4a, emissiveIntensity: 0.5 });
        const core = new THREE.Mesh(CR.LIB.sphere, bodyMat); core.scale.set(0.55, 0.4, 0.55); core.position.y = 1.6; g.add(core);
        const eye = new THREE.Mesh(CR.LIB.sphere, new THREE.MeshBasicMaterial({ color: 0xff3b5c })); eye.scale.set(0.18, 0.18, 0.18); eye.position.set(0, 1.6, -0.4); g.add(eye);
        const ring = new THREE.Mesh(CR.LIB.ring, new THREE.MeshBasicMaterial({ color: 0x00fff0 })); ring.scale.set(1.1, 1.1, 1.1); ring.rotation.x = Math.PI / 2; ring.position.y = 1.6; g.add(ring);
        g._ring = ring; g._bobT = rand(0, Math.PI * 2);
        g._hw = 0.7; g._hh = 0.7; g._hd = 0.7; g._cy = 1.6;
      } else { // barricade
        const mat = new THREE.MeshStandardMaterial({ color: 0x241233, metalness: 0.5, roughness: 0.5, emissive: 0x4a0a2a, emissiveIntensity: 0.3 });
        const base = boxMesh(2.0, 1.1, 0.7, mat); base.position.y = 0.55; g.add(base);
        const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffe14d });
        for (let i = -1; i <= 1; i += 2) { const s = boxMesh(2.02, 0.16, 0.72, stripeMat); s.position.set(0, 0.55 + i * 0.3, 0); s.rotation.z = 0.0; g.add(s); }
        g._hw = 1.0; g._hh = 0.55; g._hd = 0.4; g._cy = 0.55;
      }
    }
    spawn(level) {
      if (!this.pool.length) return;
      const g = this.pool.pop();
      const type = pick(level > 3 ? HAZARD_TYPES : level > 1 ? ["laser", "barricade", "laser"] : ["barricade", "laser"]);
      this.configure(g, type);
      const lane = CR.LANES[randi(0, CR.LANES.length - 1)];
      g.position.set(lane, 0, CR.Z_SPAWN - rand(0, 60));
      g.visible = true; this.active.push(g);
    }
    update(dt, dz, level) {
      this.spawnT -= dt;
      const interval = clamp(2.2 - level * 0.12, 0.85, 2.2);
      if (this.spawnT <= 0 && this.active.length < this.max) { this.spawn(level); this.spawnT = rand(interval * 0.7, interval); }
      for (let i = this.active.length - 1; i >= 0; i--) {
        const g = this.active[i];
        g.position.z += dz;
        if (g._type === "drone") {
          g._bobT += dt * 2.4;
          g.position.y = Math.sin(g._bobT) * 0.3;
          g._ring.rotation.z += dt * 3;
        }
        if (g.position.z > CR.Z_RECYCLE + 6) { g.visible = false; this.active.splice(i, 1); this.pool.push(g); }
      }
    }
    reset() { for (const g of this.active) { g.visible = false; this.pool.push(g); } this.active.length = 0; this.spawnT = 1.4; }
  }

  // ============================================================
  //  COLLECTIBLE MANAGER  (energy orbs + nitro crystals)
  // ============================================================
  class CollectibleManager {
    constructor(scene) {
      this.scene = scene; this.pool = []; this.active = [];
      this.mats = {
        orb: new THREE.MeshStandardMaterial({ color: 0x00fff0, emissive: 0x00fff0, emissiveIntensity: 1.1, metalness: 0.3, roughness: 0.2 }),
        nitro: new THREE.MeshStandardMaterial({ color: 0xffe14d, emissive: 0xffe14d, emissiveIntensity: 1.1, metalness: 0.3, roughness: 0.2 }),
      };
      for (let i = 0; i < 16; i++) this.pool.push(this.make());
      this.spawnT = 1.0;
    }
    make() { const g = new THREE.Group(); g.visible = false; this.scene.add(g); return g; }
    setKind(g, kind) {
      while (g.children.length) g.remove(g.children[0]);
      if (kind === "orb") {
        const c = new THREE.Mesh(CR.LIB.icosa, this.mats.orb); c.scale.setScalar(0.42); g.add(c);
        const ring = new THREE.Mesh(CR.LIB.ring, new THREE.MeshBasicMaterial({ color: 0x00fff0 })); ring.scale.setScalar(0.7); ring.rotation.x = Math.PI / 2.4; g.add(ring);
      } else {
        const c = new THREE.Mesh(CR.LIB.octa, this.mats.nitro); c.scale.setScalar(0.46); g.add(c);
      }
      g._kind = kind;
    }
    spawn() {
      if (!this.pool.length) return;
      const g = this.pool.pop();
      const kind = Math.random() < 0.78 ? "orb" : "nitro";
      this.setKind(g, kind);
      const lane = CR.LANES[randi(0, CR.LANES.length - 1)];
      g.position.set(lane, 1.1, CR.Z_SPAWN - rand(0, 50));
      g.visible = true; this.active.push(g);
    }
    update(dt, dz, onPickup, bike) {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.active.length < 14) { this.spawn(); this.spawnT = rand(0.5, 1.1); }
      const px = bike.x, pz = bike.group.position.z;
      for (let i = this.active.length - 1; i >= 0; i--) {
        const g = this.active[i];
        g.position.z += dz;
        g.rotation.y += dt * 2.6;
        g.position.y = 1.1 + Math.sin(performance.now() / 260 + g.position.z) * 0.12;
        if (Math.abs(g.position.x - px) < 1.1 && Math.abs(g.position.z - pz) < 2.0) {
          onPickup(g._kind, g.position); g.visible = false; this.active.splice(i, 1); this.pool.push(g); continue;
        }
        if (g.position.z > CR.Z_RECYCLE + 6) { g.visible = false; this.active.splice(i, 1); this.pool.push(g); }
      }
    }
    reset() { for (const g of this.active) { g.visible = false; this.pool.push(g); } this.active.length = 0; this.spawnT = 0.8; }
  }

  // ============================================================
  //  COLLISION HELPER  (AABB-ish check vs hazard footprint)
  // ============================================================
  function hitsHazard(bike, g) {
    const dz = Math.abs(bike.group.position.z - g.position.z);
    const dx = Math.abs(bike.x - g.position.x);
    return dz < (g._hd + 1.1) && dx < (g._hw + 0.55);
  }
  CR.hitsHazard = hitsHazard;

  // ============================================================
  //  PARTICLE SYSTEM  (pooled neon bits: impact, pickup, thruster)
  // ============================================================
  class ParticleSystem {
    constructor(scene) {
      this.scene = scene; this.pool = []; this.active = [];
      for (let i = 0; i < 140; i++) {
        const m = new THREE.Mesh(CR.LIB.box, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        m.visible = false; scene.add(m); this.pool.push(m);
      }
    }
    emit(x, y, z, n, color, spd, life) {
      for (let i = 0; i < n; i++) {
        if (!this.pool.length) break;
        const m = this.pool.pop();
        m.material.color.setHex(color);
        m.position.set(x, y, z);
        const s = rand(0.12, 0.42); m.scale.set(s, s, s);
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
        m._v.y -= 7 * dt; m._v.multiplyScalar(0.95);
        const k = m._life / m._max; m.scale.setScalar(0.42 * k + 0.04);
      }
    }
    reset() { for (const m of this.active) { m.visible = false; this.pool.push(m); } this.active.length = 0; }
  }

  CR.HazardManager = HazardManager;
  CR.CollectibleManager = CollectibleManager;
  CR.ParticleSystem = ParticleSystem;
})();
