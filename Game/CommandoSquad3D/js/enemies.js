/* ============================================================
   COMMANDO SQUAD 3D — enemies.js
   Hostile forces: rooftop snipers, street patrols and wall
   guards. Detection by sight (FOV + line-of-sight raycast) or by
   taking fire, simple patrol/alert/combat state machine, cover
   seeking, hitscan engagement, health bars and death handling.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const CS = (window.CS3D = window.CS3D || {});
  const { clamp, rand, randi, pick, dist2D } = CS.util;

  const FOV_COS = Math.cos(THREE.MathUtils.degToRad(65)); // half-angle field of view
  const ALWAYS_SEE_DIST = 9; // surprise-proof close range regardless of facing

  class Enemy {
    constructor(scene, world, fx, kind, pos, patrol) {
      this.scene = scene; this.world = world; this.fx = fx;
      this.kind = kind; // 'rooftop' | 'street' | 'wall'
      this.pos = pos.clone();
      this.baseY = kind === "rooftop" ? pos.y : 0;
      this.yaw = rand(0, Math.PI * 2);
      this.maxHealth = kind === "rooftop" ? 85 : 65;
      this.health = this.maxHealth;
      this.alive = true;
      this.state = "patrol";
      this.patrol = patrol && patrol.length ? patrol : [{ x: pos.x, z: pos.z }];
      this.patrolIdx = 0;
      this.visionRange = kind === "rooftop" ? 55 : 34;
      this.fireRange = kind === "rooftop" ? 60 : 32;
      this.damage = kind === "rooftop" ? 12 : 8;
      this.fireRate = kind === "rooftop" ? 0.85 : 0.5;
      this.spread = kind === "rooftop" ? 0.02 : 0.065;
      this.fireCooldown = rand(0, 0.6);
      this.perceptionT = rand(0, 0.3);
      this.alertT = 0;
      this.target = null; this.targetKind = null;
      this.lastKnownPos = null;
      this.coverTarget = null;
      this.radius = 0.4;
      this.build();
    }

    build() {
      const g = new THREE.Group();
      const uniform = new THREE.MeshStandardMaterial({ map: CS.TEX.camo, color: 0xcf6b5c, roughness: 0.9 });
      const skin = new THREE.MeshStandardMaterial({ color: 0x9a6a46, roughness: 0.8 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x1a0d0d, roughness: 0.6 });

      const torso = new THREE.Mesh(CS.LIB.box, uniform); torso.scale.set(0.46, 0.62, 0.28); torso.position.y = 1.15;
      torso.userData.enemyRef = this; g.add(torso);
      const hips = new THREE.Mesh(CS.LIB.box, uniform); hips.scale.set(0.4, 0.22, 0.26); hips.position.y = 0.78;
      hips.userData.enemyRef = this; g.add(hips);
      const head = new THREE.Mesh(CS.LIB.sphere, skin); head.scale.set(0.2, 0.22, 0.2); head.position.y = 1.62;
      head.userData.enemyRef = this; head.userData.headshot = true; g.add(head);
      const helmet = new THREE.Mesh(CS.LIB.sphere, dark); helmet.scale.set(0.23, 0.14, 0.23); helmet.position.y = 1.72; g.add(helmet);
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(CS.LIB.cyl, dark); leg.scale.set(0.14, 0.72, 0.14); leg.position.set(side * 0.13, 0.36, 0);
        leg.userData.enemyRef = this; g.add(leg);
        const arm = new THREE.Mesh(CS.LIB.cyl, uniform); arm.scale.set(0.11, 0.55, 0.11); arm.position.set(side * 0.32, 1.15, 0.05); arm.rotation.z = side * 0.18;
        arm.userData.enemyRef = this; g.add(arm);
      }
      const gun = new THREE.Mesh(CS.LIB.box, dark); gun.scale.set(0.08, 0.1, this.kind === "rooftop" ? 0.9 : 0.6); gun.position.set(0.22, 1.08, -0.3); g.add(gun);
      this._hitMeshes = [torso, hips, head];

      const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 16;
      this._barCtx = canvas.getContext("2d"); this._barTex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._barTex, depthTest: false, transparent: true }));
      sprite.scale.set(0.9, 0.22, 1); sprite.position.y = 2.05; g.add(sprite);
      this._drawBar();

      g.position.set(this.pos.x, this.baseY, this.pos.z);
      this.group = g;
      this.scene.add(g);
    }

    _drawBar() {
      const ctx = this._barCtx, w = 64, h = 16;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, w, h);
      const pct = clamp(this.health / this.maxHealth, 0, 1);
      ctx.fillStyle = "#ff3b3b"; ctx.fillRect(2, 2, (w - 4) * pct, h - 4);
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      this._barTex.needsUpdate = true;
    }

    hitMeshes() { return this._hitMeshes; }
    get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
    eyePos() { return new THREE.Vector3(this.pos.x, this.baseY + (this.kind === "rooftop" ? 1.6 : 1.4), this.pos.z); }

    update(dt, player, teammates, fx) {
      if (!this.alive) return;
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
      this.perceptionT -= dt;
      this.alertT = Math.max(0, this.alertT - dt);

      if (this.perceptionT <= 0) {
        this.perceptionT = rand(0.22, 0.38);
        const found = this.scanForTargets(player, teammates);
        if (found) {
          this.target = found.unit; this.targetKind = found.kind;
          this.lastKnownPos = { x: found.unit.pos.x, z: found.unit.pos.z };
          this.alertT = 5.5; this.state = "combat";
        } else if (this.target) {
          this.target = null;
        }
      }
      if (this.target && !this.target.alive) { this.target = null; }
      if (!this.target) this.state = this.alertT > 0 ? "alert" : "patrol";

      if (this.state === "patrol") this.updatePatrol(dt);
      else if (this.state === "alert") this.updateAlert(dt);
      else this.updateCombat(dt, fx);

      if (this.kind !== "rooftop") this.world.resolveCollision(this.pos, this.radius);
      this.group.position.set(this.pos.x, this.baseY, this.pos.z);
      this.group.rotation.y = -this.yaw;
    }

    updatePatrol(dt) {
      if (this.kind === "wall") { this.yaw += Math.sin(performance.now() * 0.0006) * dt * 0.4; return; }
      const wp = this.patrol[this.patrolIdx];
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.6) { this.patrolIdx = (this.patrolIdx + 1) % this.patrol.length; return; }
      const spd = this.kind === "rooftop" ? 1.1 : 1.8;
      this.pos.x += (dx / d) * spd * dt; this.pos.z += (dz / d) * spd * dt;
      this.yaw = Math.atan2(dx, -dz);
    }

    updateAlert(dt) {
      if (!this.lastKnownPos) { this.state = "patrol"; return; }
      const dx = this.lastKnownPos.x - this.pos.x, dz = this.lastKnownPos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 1.0 && this.kind !== "wall") {
        const spd = 2.2;
        this.pos.x += (dx / d) * spd * dt; this.pos.z += (dz / d) * spd * dt;
        this.yaw = Math.atan2(dx, -dz);
      } else {
        this.yaw += Math.sin(performance.now() * 0.001) * dt * 0.6;
      }
    }

    updateCombat(dt, fx) {
      const t = this.target;
      const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      this.yaw = Math.atan2(dx, -dz);

      if (this.kind !== "rooftop" && this.kind !== "wall") {
        if (!this.coverTarget || rand(0, 1) < 0.008) {
          this.coverTarget = this.world.nearestCover(this.pos.x, this.pos.z, t.pos.x, t.pos.z, 22);
        }
        if (this.coverTarget) {
          const cx = this.coverTarget.x - this.pos.x, cz = this.coverTarget.z - this.pos.z, cd = Math.hypot(cx, cz);
          if (cd > 0.8) { const spd = 2.4; this.pos.x += (cx / cd) * spd * dt; this.pos.z += (cz / cd) * spd * dt; }
        } else if (dist > this.fireRange * 0.75) {
          this.pos.x += (dx / dist) * 1.8 * dt; this.pos.z += (dz / dist) * 1.8 * dt;
        }
      }

      if (dist <= this.fireRange && this.fireCooldown <= 0) this.shoot(t, fx);
    }

    scanForTargets(player, teammates) {
      const eye = this.eyePos();
      const fwd = this.forward;
      const candidates = [];
      if (player.alive) candidates.push({ unit: player, kind: "player" });
      for (const m of teammates) if (m.alive) candidates.push({ unit: m, kind: "teammate" });
      let best = null, bestD = this.visionRange;
      for (const c of candidates) {
        const d = dist2D(this.pos.x, this.pos.z, c.unit.pos.x, c.unit.pos.z);
        if (d > bestD) continue;
        if (d > ALWAYS_SEE_DIST) {
          const toC = new THREE.Vector3(c.unit.pos.x - this.pos.x, 0, c.unit.pos.z - this.pos.z).normalize();
          const dot = fwd.x * toC.x + fwd.z * toC.z;
          if (dot < FOV_COS) continue;
        }
        const cEye = c.unit.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
        if (!this.world.hasLineOfSight(eye, cEye)) continue;
        bestD = d; best = c;
      }
      return best;
    }

    shoot(target, fx) {
      this.fireCooldown = this.fireRate * rand(0.85, 1.2);
      const muzzle = new THREE.Vector3(this.pos.x, this.baseY + 1.1, this.pos.z).addScaledVector(this.forward, 0.5);
      const aim = target.pos.clone().add(new THREE.Vector3(0, rand(0.9, 1.5), 0));
      const dist = muzzle.distanceTo(aim);
      const dir = CS.applySpread(new THREE.Vector3().subVectors(aim, muzzle).normalize(), this.spread);
      const hitChance = clamp(1.05 - dist / (this.fireRange * 1.15), 0.12, 0.85);
      const hit = Math.random() < hitChance;
      const endPoint = muzzle.clone().addScaledVector(dir, dist);
      fx.fireFx(muzzle, endPoint, null);
      if (hit) {
        target.takeDamage(this.damage, this.pos);
        fx.blood(endPoint);
      }
    }

    takeDamage(dmg, fromPos) {
      if (!this.alive) return;
      this.health = clamp(this.health - dmg, 0, this.maxHealth);
      this._drawBar();
      if (fromPos && !this.target) { this.lastKnownPos = { x: fromPos.x, z: fromPos.z }; this.alertT = 6; this.state = "alert"; }
      if (this.health <= 0) this.die();
    }

    die() {
      this.alive = false;
      this.fx.blood(new THREE.Vector3(this.pos.x, this.baseY + 1.2, this.pos.z));
      this.group.rotation.x = Math.PI / 2;
      this.group.position.y = this.baseY + 0.15;
    }
  }

  // ============================================================
  //  ENEMY MANAGER  (spawns the sector's hostile forces)
  // ============================================================
  class EnemyManager {
    constructor(scene, world, fx) {
      this.scene = scene; this.world = world; this.fx = fx;
      this.list = [];
    }

    spawnSector() {
      this.list.length = 0;
      const world = this.world;

      // rooftop snipers — on a subset of building rooftops
      const roofs = world.rooftops.slice().sort(() => Math.random() - 0.5).slice(0, Math.min(4, world.rooftops.length));
      for (const r of roofs) {
        const pos = new THREE.Vector3(r.x + rand(-2, 2), r.y + 0.9, r.z + rand(-2, 2));
        const patrol = [
          { x: r.x - 2.5, z: r.z - 2 }, { x: r.x + 2.5, z: r.z - 2 }, { x: r.x, z: r.z + 2 },
        ];
        this.list.push(new Enemy(this.scene, world, this.fx, "rooftop", pos, patrol));
      }

      // street patrols — roam small loops through the city
      for (let i = 0; i < 7; i++) {
        let x, z, tries = 0;
        do {
          x = rand(-CS.WORLD_HALF + 10, CS.WORLD_HALF - 10);
          z = rand(-CS.WORLD_HALF + 10, 20);
          tries++;
        } while (world.isNearCollider(x, z, 1.2) && tries < 20);
        const patrol = [];
        const legs = randi(2, 3);
        for (let j = 0; j < legs; j++) patrol.push({ x: x + rand(-10, 10), z: z + rand(-10, 10) });
        this.list.push(new Enemy(this.scene, world, this.fx, "street", new THREE.Vector3(x, 0, z), patrol));
      }

      // wall / barricade guards — stationary near cover points
      const covers = world.coverPoints.slice().sort(() => Math.random() - 0.5).slice(0, 4);
      for (const c of covers) {
        this.list.push(new Enemy(this.scene, world, this.fx, "wall", new THREE.Vector3(c.x, 0, c.z), [{ x: c.x, z: c.z }]));
      }
    }

    update(dt, player, teammates, fx) {
      for (const e of this.list) e.update(dt, player, teammates, fx);
    }

    aliveList() { return this.list.filter((e) => e.alive); }
    allDead() { return this.list.every((e) => !e.alive); }
    totalCount() { return this.list.length; }
    aliveCount() { return this.aliveList().length; }

    collidableHitMeshes() {
      const arr = [];
      for (const e of this.list) if (e.alive) arr.push(...e.hitMeshes());
      return arr;
    }
  }

  CS.Enemy = Enemy;
  CS.EnemyManager = EnemyManager;
})();
