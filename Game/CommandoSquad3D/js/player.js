/* ============================================================
   COMMANDO SQUAD 3D — player.js
   The player-controlled commando: low-poly soldier mesh, WASD
   movement with building collision, mouse-look over-the-shoulder
   chase camera (with wall clipping avoidance), weapon handling
   (rifle/pistol, ammo, reload) and hitscan shooting.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const CS = (window.CS3D = window.CS3D || {});
  const { clamp, lerp, rand } = CS.util;

  class Player {
    constructor(scene, world, fx) {
      this.scene = scene; this.world = world; this.fx = fx;
      this.pos = new THREE.Vector3(0, 0, 62);
      this.yaw = 0; this.pitch = 0.05;
      this.radius = 0.42;
      this.speed = 5.4; this.sprintMul = 1.6;
      this.health = 100; this.maxHealth = 100; this.alive = true;
      this.weaponKey = "rifle";
      this.ammo = {
        rifle: { mag: CS.WEAPONS.rifle.magSize, reserve: CS.WEAPONS.rifle.reserve },
        pistol: { mag: CS.WEAPONS.pistol.magSize, reserve: CS.WEAPONS.pistol.reserve },
      };
      this.reloading = false; this.reloadT = 0;
      this.fireCooldown = 0;
      this.camDist = 4.4; this.camHeight = 1.85; this.camShoulder = 0.62;
      this._camPos = new THREE.Vector3();
      this.aimDir = new THREE.Vector3(0, 0, -1);
      this.lastFireTime = -10;
      this.build();
    }

    build() {
      const g = new THREE.Group();
      const camo = new THREE.MeshStandardMaterial({ map: CS.TEX.camo, roughness: 0.9, color: 0xffffff });
      const skin = new THREE.MeshStandardMaterial({ color: 0xc89570, roughness: 0.8 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });

      const torso = new THREE.Mesh(CS.LIB.box, camo); torso.scale.set(0.46, 0.62, 0.28); torso.position.y = 1.15; g.add(torso);
      const hips = new THREE.Mesh(CS.LIB.box, camo); hips.scale.set(0.4, 0.22, 0.26); hips.position.y = 0.78; g.add(hips);
      const head = new THREE.Mesh(CS.LIB.sphere, skin); head.scale.set(0.2, 0.22, 0.2); head.position.y = 1.62; g.add(head);
      const helmet = new THREE.Mesh(CS.LIB.sphere, camo); helmet.scale.set(0.23, 0.15, 0.23); helmet.position.y = 1.72; g.add(helmet);
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(CS.LIB.cyl, dark); leg.scale.set(0.14, 0.72, 0.14); leg.position.set(side * 0.13, 0.36, 0); g.add(leg);
        const arm = new THREE.Mesh(CS.LIB.cyl, camo); arm.scale.set(0.11, 0.55, 0.11); arm.position.set(side * 0.32, 1.15, 0.05); arm.rotation.z = side * 0.18; g.add(arm);
      }
      // held weapon (visual only — swapped by setWeaponVisual)
      const gun = new THREE.Mesh(CS.LIB.box, dark); gun.scale.set(0.08, 0.1, 0.7); gun.position.set(0.22, 1.08, -0.3); g.add(gun);
      this.gunMesh = gun;
      this.muzzleLocal = new THREE.Vector3(0.22, 1.08, -0.68);

      this.group = g;
      this.scene.add(g);
    }

    get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
    get right() { return new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw)); }
    get weapon() { return CS.WEAPONS[this.weaponKey]; }
    get eyePos() { return this.pos.clone().add(new THREE.Vector3(0, CS.PLAYER_EYE_H, 0)); }
    muzzleWorldPos() { return this.muzzleLocal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw).add(this.pos); }

    reset() {
      this.pos.set(0, 0, 62); this.yaw = 0; this.pitch = 0.05;
      this.health = this.maxHealth; this.alive = true;
      this.weaponKey = "rifle";
      this.ammo.rifle = { mag: CS.WEAPONS.rifle.magSize, reserve: CS.WEAPONS.rifle.reserve };
      this.ammo.pistol = { mag: CS.WEAPONS.pistol.magSize, reserve: CS.WEAPONS.pistol.reserve };
      this.reloading = false; this.reloadT = 0; this.fireCooldown = 0;
      this.group.visible = true;
    }

    switchWeapon() {
      if (this.reloading) return;
      this.weaponKey = this.weaponKey === "rifle" ? "pistol" : "rifle";
      this.gunMesh.scale.set(0.08, 0.1, this.weaponKey === "rifle" ? 0.7 : 0.34);
    }

    startReload() {
      const a = this.ammo[this.weaponKey];
      if (this.reloading || a.mag >= this.weapon.magSize || a.reserve <= 0) return;
      this.reloading = true; this.reloadT = 1.5;
    }

    update(dt, input, camera) {
      if (!this.alive) { this.updateCamera(camera, dt); return; }

      // ---- movement (yaw-relative, ground plane only) ----
      const fIn = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
      const rIn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const move = new THREE.Vector3();
      if (fIn || rIn) {
        move.addScaledVector(this.forward, fIn).addScaledVector(this.right, rIn);
        move.normalize();
      }
      const spd = this.speed * (input.sprint ? this.sprintMul : 1);
      this.pos.addScaledVector(move, spd * dt);
      this.world.resolveCollision(this.pos, this.radius);
      this.moving = move.lengthSq() > 0.001;

      this.group.position.copy(this.pos);
      this.group.rotation.y = -this.yaw;
      // subtle walk bob
      this._bobT = (this._bobT || 0) + (this.moving ? dt * spd * 1.8 : 0);
      this.group.position.y = this.pos.y + (this.moving ? Math.abs(Math.sin(this._bobT)) * 0.04 : 0);

      // ---- weapon timers ----
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
      if (this.reloading) {
        this.reloadT -= dt;
        if (this.reloadT <= 0) {
          const a = this.ammo[this.weaponKey], w = this.weapon;
          const need = w.magSize - a.mag; const take = Math.min(need, a.reserve);
          a.mag += take; a.reserve -= take;
          this.reloading = false;
        }
      }
      // auto-reload when empty
      if (this.ammo[this.weaponKey].mag <= 0 && !this.reloading && this.ammo[this.weaponKey].reserve > 0) this.startReload();

      this.updateCamera(camera, dt);
    }

    updateCamera(camera, dt) {
      const pivot = this.pos.clone().add(new THREE.Vector3(0, this.camHeight, 0));
      const lookDir = new THREE.Vector3(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * Math.cos(this.pitch)
      ).normalize();
      this.aimDir = lookDir;
      const back = lookDir.clone().multiplyScalar(-this.camDist);
      const desired = pivot.clone().add(back).addScaledVector(this.right, this.camShoulder);
      desired.y += 0.15;

      // avoid clipping into buildings: shorten the camera distance if something blocks the way
      const toDesired = new THREE.Vector3().subVectors(desired, pivot);
      const distWanted = toDesired.length();
      if (distWanted > 0.05 && this.world.buildMeshes.length) {
        const ray = new THREE.Raycaster(pivot, toDesired.clone().normalize(), 0.1, distWanted);
        const hits = ray.intersectObjects(this.world.buildMeshes, false);
        if (hits.length) {
          const safeDist = Math.max(0.6, hits[0].distance - 0.3);
          desired.copy(pivot).addScaledVector(toDesired.normalize(), safeDist);
        }
      }
      const t = 1 - Math.exp(-14 * dt);
      camera.position.lerp(desired, t);
      camera.lookAt(pivot.clone().addScaledVector(lookDir, 10));
      // use the camera's true resulting forward vector for hitscan so shots always
      // land exactly where the (screen-center) crosshair is pointing
      camera.getWorldDirection(this.aimDir);
      this._camPos.copy(camera.position);
    }

    // ---- shooting ----
    canFire() { return this.alive && !this.reloading && this.fireCooldown <= 0 && this.ammo[this.weaponKey].mag > 0; }

    fire(camera, collidables, onHitEnemy) {
      if (!this.canFire()) return false;
      const w = this.weapon;
      this.fireCooldown = w.fireRate;
      this.ammo[this.weaponKey].mag--;
      this.lastFireTime = performance.now();

      const origin = camera.position.clone();
      const dir = CS.applySpread(this.aimDir.clone(), w.spread);
      const hit = CS.hitscan(origin, dir, w.range, collidables);
      const muzzle = this.muzzleWorldPos();
      let hitPoint = origin.clone().addScaledVector(dir, w.range);
      let hitSomething = false, didHitEnemy = false;
      if (hit) {
        hitPoint = hit.point;
        hitSomething = true;
        const enemy = hit.object.userData && hit.object.userData.enemyRef;
        if (enemy) {
          didHitEnemy = true;
          const dmg = w.damage * (hit.object.userData.headshot ? 2.2 : 1);
          onHitEnemy && onHitEnemy(enemy, dmg, hit.point);
        } else {
          this.fx.sparks(hit.point);
        }
      }
      this.fx.fireFx(muzzle, hitPoint, camera.quaternion);
      return { hitSomething, didHitEnemy };
    }

    takeDamage(dmg) {
      if (!this.alive) return;
      this.health = clamp(this.health - dmg, 0, this.maxHealth);
      if (this.health <= 0) { this.alive = false; }
    }
  }

  CS.Player = Player;
})();
