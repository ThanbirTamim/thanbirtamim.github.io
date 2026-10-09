/* ============================================================
   COMMANDO SQUAD 3D — teammates.js
   The 4-member AI squad (Heavy / Medic / Sniper / Demolitions):
   tactical follow formation, hold position, fire-at-will,
   automatic cover-seeking when under fire, and engagement of
   spotted enemies with muzzle flashes & tracers.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const CS = (window.CS3D = window.CS3D || {});
  const { clamp, lerp, rand, dist2D } = CS.util;

  const ROLE_INFO = {
    Heavy: { color: 0xcc3333, hp: 150, fireRate: 0.18, damage: 8, spread: 0.08, range: 42 },
    Medic: { color: 0xe8e8e8, hp: 100, fireRate: 0.3, damage: 9, spread: 0.07, range: 40 },
    Sniper: { color: 0x2f5a33, hp: 90, fireRate: 0.9, damage: 34, spread: 0.015, range: 75 },
    Demolitions: { color: 0xe8922e, hp: 110, fireRate: 0.35, damage: 10, spread: 0.075, range: 38 },
  };
  const FORMATION = [
    { x: -1.5, z: 2.1 }, { x: 1.5, z: 2.1 },
    { x: -2.8, z: 4.1 }, { x: 2.8, z: 4.1 },
  ];

  class Teammate {
    constructor(scene, world, fx, slot, role) {
      this.scene = scene; this.world = world; this.fx = fx;
      this.slot = slot; this.role = role;
      this.info = ROLE_INFO[role];
      this.id = "A" + (slot + 1);
      this.pos = new THREE.Vector3();
      this.yaw = 0;
      this.maxHealth = this.info.hp; this.health = this.maxHealth;
      this.alive = true; this.state = "follow";
      this.holdPos = null; this.coverTarget = null;
      this.target = null; this.fireCooldown = rand(0, 0.4);
      this.perceptionT = rand(0, 0.3);
      this.tookFireT = 0;
      this.radius = 0.4;
      this.build();
    }

    build() {
      const g = new THREE.Group();
      const camo = new THREE.MeshStandardMaterial({ map: CS.TEX.camo, roughness: 0.9, color: 0xffffff });
      const skin = new THREE.MeshStandardMaterial({ color: 0xbd8c66, roughness: 0.8 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
      const accent = new THREE.MeshStandardMaterial({ color: this.info.color, roughness: 0.6 });

      const torso = new THREE.Mesh(CS.LIB.box, camo); torso.scale.set(0.46, 0.62, 0.28); torso.position.y = 1.15; g.add(torso);
      const hips = new THREE.Mesh(CS.LIB.box, camo); hips.scale.set(0.4, 0.22, 0.26); hips.position.y = 0.78; g.add(hips);
      const head = new THREE.Mesh(CS.LIB.sphere, skin); head.scale.set(0.2, 0.22, 0.2); head.position.y = 1.62; g.add(head);
      const helmet = new THREE.Mesh(CS.LIB.sphere, accent); helmet.scale.set(0.23, 0.15, 0.23); helmet.position.y = 1.72; g.add(helmet);
      const band = new THREE.Mesh(CS.LIB.box, accent); band.scale.set(0.47, 0.08, 0.29); band.position.y = 1.32; g.add(band);
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(CS.LIB.cyl, dark); leg.scale.set(0.14, 0.72, 0.14); leg.position.set(side * 0.13, 0.36, 0); g.add(leg);
        const arm = new THREE.Mesh(CS.LIB.cyl, camo); arm.scale.set(0.11, 0.55, 0.11); arm.position.set(side * 0.32, 1.15, 0.05); arm.rotation.z = side * 0.18; g.add(arm);
      }
      const gun = new THREE.Mesh(CS.LIB.box, dark); gun.scale.set(0.08, 0.1, this.role === "Sniper" ? 0.9 : 0.6); gun.position.set(0.22, 1.08, -0.3); g.add(gun);

      // floating health bar (billboard sprite so it always faces the camera)
      const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 16;
      this._barCanvas = canvas; this._barCtx = canvas.getContext("2d");
      const barTex = new THREE.CanvasTexture(canvas);
      this._barTex = barTex;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: barTex, depthTest: false, transparent: true }));
      sprite.scale.set(0.9, 0.22, 1); sprite.position.y = 2.05;
      g.add(sprite); this._drawBar();

      this.group = g;
      this.scene.add(g);
    }

    _drawBar() {
      const ctx = this._barCtx, w = 64, h = 16;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, w, h);
      const pct = clamp(this.health / this.maxHealth, 0, 1);
      ctx.fillStyle = pct > 0.5 ? "#8fd13f" : pct > 0.25 ? "#ffd166" : "#ff3b3b";
      ctx.fillRect(2, 2, (w - 4) * pct, h - 4);
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      this._barTex.needsUpdate = true;
    }

    spawnAt(x, z) { this.pos.set(x, 0, z); this.group.position.set(x, 0, z); }

    formationWorldPos(player) {
      const f = FORMATION[this.slot];
      return player.pos.clone().addScaledVector(player.right, f.x).addScaledVector(player.forward, -f.z);
    }

    setCommand(cmd) {
      if (!this.alive) return;
      this.state = cmd;
      if (cmd === "hold") this.holdPos = { x: this.pos.x, z: this.pos.z };
      if (cmd === "follow") this.coverTarget = null;
    }

    update(dt, player, enemies, fx) {
      if (!this.alive) return;
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
      this.tookFireT = Math.max(0, this.tookFireT - dt);
      this.perceptionT -= dt;

      // ---- perception: pick nearest visible enemy periodically ----
      if (this.perceptionT <= 0) {
        this.perceptionT = rand(0.25, 0.4);
        this.target = this.findTarget(enemies);
      } else if (this.target && (!this.target.alive || dist2D(this.pos.x, this.pos.z, this.target.pos.x, this.target.pos.z) > this.info.range * 1.3)) {
        this.target = null;
      }

      // ---- decide destination ----
      let dest = null;
      if (this.tookFireT > 0 || (this.target && this.state !== "follow")) {
        const threat = this.target ? this.target.pos : player.pos;
        if (!this.coverTarget || rand(0, 1) < 0.01) {
          this.coverTarget = this.world.nearestCover(this.pos.x, this.pos.z, threat.x, threat.z, 26);
        }
        dest = this.coverTarget;
      }
      if (!dest) {
        if (this.state === "follow") dest = this.formationWorldPos(player);
        else if (this.state === "hold") dest = this.holdPos || { x: this.pos.x, z: this.pos.z };
        else dest = { x: this.pos.x, z: this.pos.z }; // fire-at-will: hold ground, engage
      }

      // ---- move toward destination ----
      const dx = dest.x - this.pos.x, dz = dest.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3) {
        const spd = 3.6;
        this.pos.x += (dx / d) * Math.min(spd * dt, d);
        this.pos.z += (dz / d) * Math.min(spd * dt, d);
        this.world.resolveCollision(this.pos, this.radius);
        this.yaw = Math.atan2(dx, -dz);
      }

      // ---- face & engage target ----
      if (this.target) {
        const tdx = this.target.pos.x - this.pos.x, tdz = this.target.pos.z - this.pos.z;
        this.yaw = Math.atan2(tdx, -tdz);
        if (this.fireCooldown <= 0) this.shoot(this.target, fx);
      }

      this.group.position.set(this.pos.x, 0, this.pos.z);
      this.group.rotation.y = -this.yaw;
    }

    findTarget(enemies) {
      let best = null, bestD = this.info.range;
      const eye = this.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
      for (const e of enemies) {
        if (!e.alive) continue;
        const d = dist2D(this.pos.x, this.pos.z, e.pos.x, e.pos.z);
        if (d > bestD) continue;
        const eEye = e.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
        if (!this.world.hasLineOfSight(eye, eEye)) continue;
        bestD = d; best = e;
      }
      return best;
    }

    shoot(enemy, fx) {
      this.fireCooldown = this.info.fireRate * rand(0.85, 1.2);
      const muzzle = this.pos.clone().add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(this.forward, 0.5);
      const aim = enemy.pos.clone().add(new THREE.Vector3(0, rand(1.0, 1.5), 0));
      const dir = CS.applySpread(new THREE.Vector3().subVectors(aim, muzzle).normalize(), this.info.spread);
      const dist = muzzle.distanceTo(aim);
      // simple accuracy roll based on distance so misses look plausible without a full raycast each shot
      const hitChance = clamp(1.15 - dist / (this.info.range * 1.1), 0.18, 0.95);
      const hit = Math.random() < hitChance;
      const endPoint = muzzle.clone().addScaledVector(dir, dist);
      fx.fireFx(muzzle, endPoint, null);
      if (hit) {
        enemy.takeDamage(this.info.damage, this.pos);
        fx.blood(endPoint);
      }
    }

    get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

    takeDamage(dmg) {
      if (!this.alive) return;
      this.health = clamp(this.health - dmg, 0, this.maxHealth);
      this.tookFireT = 3.0;
      this._drawBar();
      if (this.health <= 0) { this.alive = false; this.die(); }
    }

    die() {
      this.group.rotation.x = Math.PI / 2;
      this.group.position.y = 0.15;
    }

    reset(x, z) {
      this.health = this.maxHealth; this.alive = true; this.state = "follow";
      this.holdPos = null; this.coverTarget = null; this.target = null;
      this.group.rotation.set(0, 0, 0);
      this.spawnAt(x, z);
      this._drawBar();
    }
  }

  class Squad {
    constructor(scene, world, fx) {
      this.members = ["Heavy", "Medic", "Sniper", "Demolitions"].map((role, i) => new Teammate(scene, world, fx, i, role));
    }
    spawnNear(player) {
      this.members.forEach((m) => { const p = m.formationWorldPos(player); m.reset(p.x, p.z); });
    }
    setCommand(cmd) { for (const m of this.members) m.setCommand(cmd); }
    update(dt, player, enemies, fx) { for (const m of this.members) m.update(dt, player, enemies, fx); }
    aliveCount() { return this.members.filter((m) => m.alive).length; }
    allDead() { return this.aliveCount() === 0; }
  }

  CS.Squad = Squad;
})();
