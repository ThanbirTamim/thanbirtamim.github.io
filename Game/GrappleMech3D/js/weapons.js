/* ============================================================
   GRAPPLE MECH 3D — weapons.js
   Weapon definitions (Plasma Cannon / Railgun), shared hitscan
   raycasting, muzzle flashes, tracers, impact & explosion
   particle FX, and a reusable screen-shake accumulator.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const GM = (window.GM3D = window.GM3D || {});
  const { rand } = GM.util;

  // ============================================================
  //  WEAPON DEFINITIONS
  // ============================================================
  GM.WEAPONS = {
    plasma: { key: "plasma", name: "PLASMA CANNON", damage: 7, fireRate: 0.11, spread: 0.032, range: 65, color: 0x7cffb0 },
    railgun: { key: "railgun", name: "RAILGUN", minDamage: 14, maxDamage: 46, chargeTime: 1.1, cooldown: 1.5, spread: 0.01, range: 130, color: 0x35d2ff },
  };
  GM.AI_WEAPON = { damage: 6, fireRate: 0.45, spread: 0.08, range: 55 };

  // ============================================================
  //  SHARED HITSCAN
  // ============================================================
  const _ray = new THREE.Raycaster();
  GM.hitscan = function hitscan(origin, dir, range, objects) {
    _ray.set(origin, dir); _ray.far = range; _ray.near = 0;
    const hits = _ray.intersectObjects(objects, false);
    return hits.length ? hits[0] : null;
  };
  GM.applySpread = function applySpread(dir, spread) {
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
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
      for (let i = 0; i < 24; i++) {
        const m = new THREE.Mesh(GM.LIB.plane, mat.clone());
        m.visible = false; scene.add(m); this.pool.push(m);
      }
    }
    spawn(pos, color, camQuat) {
      if (!this.pool.length) return;
      const m = this.pool.pop();
      m.position.copy(pos);
      if (camQuat) m.quaternion.copy(camQuat);
      m.material.color.setHex(color || 0xffffff);
      const s = rand(0.35, 0.6); m.scale.set(s, s, s);
      m.material.opacity = 0.95;
      m._life = 0.07;
      m.visible = true; this.active.push(m);
    }
    update(dt) {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const m = this.active[i]; m._life -= dt;
        if (m._life <= 0) { m.visible = false; this.active.splice(i, 1); this.pool.push(m); continue; }
        m.material.opacity = Math.max(0, m._life / 0.07);
      }
    }
  }

  // ============================================================
  //  TRACER POOL
  // ============================================================
  class TracerPool {
    constructor(scene) {
      this.scene = scene; this.pool = []; this.active = [];
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
      for (let i = 0; i < 24; i++) {
        const m = new THREE.Mesh(GM.LIB.cyl, mat.clone());
        m.visible = false; scene.add(m); this.pool.push(m);
      }
    }
    spawn(from, to, color, thickness) {
      if (!this.pool.length) return;
      const m = this.pool.pop();
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = Math.max(0.05, dir.length());
      const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
      m.position.copy(mid);
      m.scale.set(thickness || 0.03, len, thickness || 0.03);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      m.material.color.setHex(color || 0xffffff);
      m.material.opacity = 0.9;
      m._life = 0.1;
      m.visible = true; this.active.push(m);
    }
    update(dt) {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const m = this.active[i]; m._life -= dt;
        if (m._life <= 0) { m.visible = false; this.active.splice(i, 1); this.pool.push(m); continue; }
        m.material.opacity = Math.max(0, (m._life / 0.1) * 0.9);
      }
    }
  }

  // ============================================================
  //  IMPACT / EXPLOSION PARTICLES
  // ============================================================
  class ParticlePool {
    constructor(scene, count) {
      this.scene = scene; this.pool = []; this.active = [];
      for (let i = 0; i < (count || 200); i++) {
        const m = new THREE.Mesh(GM.LIB.box, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        m.visible = false; scene.add(m); this.pool.push(m);
      }
    }
    emit(x, y, z, n, color, spd, life, sizeScale) {
      for (let i = 0; i < n; i++) {
        if (!this.pool.length) break;
        const m = this.pool.pop();
        m.material.color.setHex(color);
        m.position.set(x, y, z);
        const s = rand(0.06, 0.18) * (sizeScale || 1); m.scale.set(s, s, s);
        m._v = new THREE.Vector3(rand(-spd, spd), rand(-spd * 0.3, spd), rand(-spd, spd));
        m._life = life * rand(0.6, 1.3); m._max = m._life;
        m.visible = true; this.active.push(m);
      }
    }
    update(dt) {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const m = this.active[i]; m._life -= dt;
        if (m._life <= 0) { m.visible = false; this.active.splice(i, 1); this.pool.push(m); continue; }
        m.position.addScaledVector(m._v, dt);
        m._v.y -= 8 * dt; m._v.multiplyScalar(0.95);
        const k = m._life / m._max; m.scale.setScalar(0.14 * k + 0.02);
      }
    }
  }

  // ============================================================
  //  SCREEN SHAKE  (accumulate trauma, sampled by camera each frame)
  // ============================================================
  class ScreenShake {
    constructor() { this.trauma = 0; }
    add(amount) { this.trauma = Math.min(1, this.trauma + amount); }
    update(dt) { this.trauma = Math.max(0, this.trauma - dt * 1.4); }
    sample() {
      const t = this.trauma * this.trauma;
      return {
        x: rand(-1, 1) * t * 0.35,
        y: rand(-1, 1) * t * 0.35,
        roll: rand(-1, 1) * t * 0.05,
      };
    }
  }

  // ============================================================
  //  FX MANAGER
  // ============================================================
  class FxManager {
    constructor(scene) {
      this.muzzle = new MuzzleFlashPool(scene);
      this.tracer = new TracerPool(scene);
      this.particles = new ParticlePool(scene, 260);
      this.shake = new ScreenShake();
      this._flashEls = { hit: GM.util.el("hitFlash"), kill: GM.util.el("killFlash") };
    }
    weaponFx(muzzlePos, hitPos, weaponKey, camQuat) {
      const w = GM.WEAPONS[weaponKey] || GM.AI_WEAPON;
      this.muzzle.spawn(muzzlePos, w.color || 0xffffff, camQuat);
      this.tracer.spawn(muzzlePos, hitPos, w.color || 0xffffff, weaponKey === "railgun" ? 0.07 : 0.03);
    }
    sparks(pos) { this.particles.emit(pos.x, pos.y, pos.z, 8, 0xffd98a, 2.4, 0.35); }
    shieldHit(pos) { this.particles.emit(pos.x, pos.y, pos.z, 10, 0x35d2ff, 2.8, 0.4); }
    armorHit(pos) { this.particles.emit(pos.x, pos.y, pos.z, 10, 0xff8a3d, 2.6, 0.4); this.flash("hit"); }
    explosion(pos) {
      this.particles.emit(pos.x, pos.y, pos.z, 44, 0xff7a3d, 9, 0.9, 1.6);
      this.particles.emit(pos.x, pos.y, pos.z, 24, 0x35d2ff, 7, 0.7, 1.2);
      this.shake.add(0.55);
      this.flash("kill");
    }
    flash(kind) {
      const el = this._flashEls[kind]; if (!el) return;
      el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
    }
    update(dt) { this.muzzle.update(dt); this.tracer.update(dt); this.particles.update(dt); this.shake.update(dt); }
  }

  GM.FxManager = FxManager;
})();
