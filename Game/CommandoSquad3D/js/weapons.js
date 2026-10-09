/* ============================================================
   COMMANDO SQUAD 3D — weapons.js
   Weapon definitions, shared hitscan raycasting, muzzle flashes,
   tracer lines, hit-impact particles (blood / sparks) and
   explosion FX. Used by player.js, teammates.js and enemies.js.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const CS = (window.CS3D = window.CS3D || {});
  const { rand } = CS.util;

  // ============================================================
  //  WEAPON DEFINITIONS
  // ============================================================
  CS.WEAPONS = {
    rifle: { key: "rifle", name: "M4 RIFLE", damage: 11, fireRate: 0.11, magSize: 30, reserve: 90, spread: 0.028, auto: true, range: 90 },
    pistol: { key: "pistol", name: "M9 PISTOL", damage: 24, fireRate: 0.26, magSize: 12, reserve: 36, spread: 0.016, auto: false, range: 55 },
  };
  // AI weapons (not player-selectable, used for balance of teammates/enemies)
  CS.AI_WEAPON = { damage: 9, fireRate: 0.4, spread: 0.07, range: 60 };

  // ============================================================
  //  SHARED HITSCAN  (raycast bullet, returns first hit or null)
  // ============================================================
  const _ray = new THREE.Raycaster();
  CS.hitscan = function hitscan(origin, dir, range, objects) {
    _ray.set(origin, dir); _ray.far = range; _ray.near = 0;
    const hits = _ray.intersectObjects(objects, false);
    return hits.length ? hits[0] : null;
  };
  // apply a small random cone spread to a direction vector (returns a new vector)
  CS.applySpread = function applySpread(dir, spread) {
    const v = dir.clone();
    v.x += rand(-spread, spread); v.y += rand(-spread, spread); v.z += rand(-spread, spread);
    return v.normalize();
  };

  // ============================================================
  //  MUZZLE FLASH POOL
  // ============================================================
  class MuzzleFlashPool {
    constructor(scene) {
      this.scene = scene; this.pool = []; this.active = [];
      const mat = new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
      for (let i = 0; i < 24; i++) {
        const m = new THREE.Mesh(CS.LIB.plane, mat.clone());
        m.visible = false; m.scale.set(0.35, 0.35, 0.35);
        scene.add(m); this.pool.push(m);
      }
    }
    spawn(pos, cameraQuat) {
      if (!this.pool.length) return;
      const m = this.pool.pop();
      m.position.copy(pos);
      if (cameraQuat) m.quaternion.copy(cameraQuat);
      const s = rand(0.3, 0.5); m.scale.set(s, s, s);
      m.material.opacity = 0.95;
      m._life = 0.06;
      m.visible = true; this.active.push(m);
    }
    update(dt) {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const m = this.active[i]; m._life -= dt;
        if (m._life <= 0) { m.visible = false; this.active.splice(i, 1); this.pool.push(m); continue; }
        m.material.opacity = Math.max(0, m._life / 0.06);
      }
    }
  }

  // ============================================================
  //  TRACER POOL  (thin fading line-of-fire streaks)
  // ============================================================
  class TracerPool {
    constructor(scene) {
      this.scene = scene; this.pool = []; this.active = [];
      const mat = new THREE.MeshBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: 0.85 });
      for (let i = 0; i < 20; i++) {
        const m = new THREE.Mesh(CS.LIB.cyl, mat.clone());
        m.visible = false; scene.add(m); this.pool.push(m);
      }
    }
    spawn(from, to) {
      if (!this.pool.length) return;
      const m = this.pool.pop();
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = Math.max(0.05, dir.length());
      const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
      m.position.copy(mid);
      m.scale.set(0.02, len, 0.02);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      m.material.opacity = 0.85;
      m._life = 0.09;
      m.visible = true; this.active.push(m);
    }
    update(dt) {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const m = this.active[i]; m._life -= dt;
        if (m._life <= 0) { m.visible = false; this.active.splice(i, 1); this.pool.push(m); continue; }
        m.material.opacity = Math.max(0, (m._life / 0.09) * 0.85);
      }
    }
  }

  // ============================================================
  //  IMPACT PARTICLES  (blood on flesh hits, sparks/dust on surfaces)
  // ============================================================
  class ImpactParticles {
    constructor(scene) {
      this.scene = scene; this.pool = []; this.active = [];
      for (let i = 0; i < 160; i++) {
        const m = new THREE.Mesh(CS.LIB.box, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        m.visible = false; scene.add(m); this.pool.push(m);
      }
    }
    emit(x, y, z, n, color, spd, life) {
      for (let i = 0; i < n; i++) {
        if (!this.pool.length) break;
        const m = this.pool.pop();
        m.material.color.setHex(color);
        m.position.set(x, y, z);
        const s = rand(0.04, 0.12); m.scale.set(s, s, s);
        m._v = new THREE.Vector3(rand(-spd, spd), rand(0, spd), rand(-spd, spd));
        m._life = life * rand(0.6, 1.3); m._max = m._life;
        m.visible = true; this.active.push(m);
      }
    }
    update(dt) {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const m = this.active[i]; m._life -= dt;
        if (m._life <= 0) { m.visible = false; this.active.splice(i, 1); this.pool.push(m); continue; }
        m.position.addScaledVector(m._v, dt);
        m._v.y -= 9 * dt; m._v.multiplyScalar(0.94);
        const k = m._life / m._max; m.scale.setScalar(0.1 * k + 0.02);
      }
    }
  }

  // ============================================================
  //  FX MANAGER  (bundles the pools, exposes convenience helpers)
  // ============================================================
  class FxManager {
    constructor(scene) {
      this.muzzle = new MuzzleFlashPool(scene);
      this.tracer = new TracerPool(scene);
      this.impact = new ImpactParticles(scene);
    }
    fireFx(muzzlePos, hitPos, camQuat) {
      this.muzzle.spawn(muzzlePos, camQuat);
      this.tracer.spawn(muzzlePos, hitPos);
    }
    blood(pos) { this.impact.emit(pos.x, pos.y, pos.z, 10, 0xaa1020, 2.4, 0.4); }
    sparks(pos) { this.impact.emit(pos.x, pos.y, pos.z, 8, 0xffd98a, 2.0, 0.3); }
    update(dt) { this.muzzle.update(dt); this.tracer.update(dt); this.impact.update(dt); }
  }

  CS.FxManager = FxManager;
})();
