/* ============================================================
   GRAPPLE MECH 3D — grapple.js
   The dual energy grapple hook: fires a tether at arena anchors,
   walls, or enemy mechs. Attaching to a structure pulls the
   owner toward it for a swing/slingshot; attaching to an enemy
   mech pulls THEM toward the owner and triggers a melee strike
   once close enough. Renders a live cable + glowing tip.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const GM = (window.GM3D = window.GM3D || {});
  const { clamp, rand } = GM.util;

  class GrappleHook {
    constructor(owner, side) {
      this.owner = owner;
      this.side = side; // 'left' | 'right'
      this.state = "idle"; // idle | attached
      this.anchorPoint = null;   // THREE.Vector3 (structure target)
      this.targetMech = null;    // live enemy mech reference
      this.maxRange = 55;
      this.pullForce = 50;
      this.minDist = 2.4;
      this.meleeRange = 3.4;
      this.meleeDamage = 16;
      this.meleeCooldownT = 0;
      this.cooldownT = 0;
      this.cooldownMax = 0.45;
      this.pendingMelee = null; // { target, damage } — polled & applied by main.js
      this._pts = [new THREE.Vector3(), new THREE.Vector3()];
      this.buildVisual();
    }

    buildVisual() {
      const mat = new THREE.LineBasicMaterial({ color: this.side === "left" ? 0x35d2ff : 0xc767ff, linewidth: 2 });
      const geo = new THREE.BufferGeometry().setFromPoints(this._pts);
      this.line = new THREE.Line(geo, mat);
      this.line.visible = false;
      const tipMat = new THREE.MeshBasicMaterial({ color: this.side === "left" ? 0x35d2ff : 0xc767ff });
      this.tip = new THREE.Mesh(GM.LIB.sphere, tipMat);
      this.tip.scale.setScalar(0.22);
      this.tip.visible = false;
    }

    attachToScene(scene) { scene.add(this.line); scene.add(this.tip); }

    isActive() { return this.state === "attached"; }
    cooldownFrac() { return clamp(this.cooldownT / this.cooldownMax, 0, 1); }

    // collidables: array of raycastable meshes (walls + anchor meshes + enemy hit meshes)
    tryFire(originPos, dir, arena, mechList) {
      if (this.state !== "idle" || this.cooldownT > 0) return false;
      const collidables = arena.wallMeshes.concat(arena.anchors.map((a) => a.mesh));
      for (const mech of mechList) {
        if (mech === this.owner || !mech.alive) continue;
        collidables.push(...mech.hitMeshes());
      }
      const hit = GM.hitscan(originPos, dir, this.maxRange, collidables);
      if (!hit) return false;
      const enemyMech = hit.object.userData && hit.object.userData.mechRef;
      this.state = "attached";
      if (enemyMech) { this.targetMech = enemyMech; this.anchorPoint = null; }
      else { this.anchorPoint = hit.point.clone(); this.targetMech = null; }
      this.line.visible = true; this.tip.visible = true;
      return true;
    }

    release() {
      if (this.state === "attached") this.cooldownT = this.cooldownMax;
      this.state = "idle";
      this.anchorPoint = null; this.targetMech = null;
      this.line.visible = false; this.tip.visible = false;
    }

    currentTargetPos() {
      if (this.targetMech) return this.targetMech.pos;
      return this.anchorPoint;
    }

    update(dt, handWorldPos) {
      this.cooldownT = Math.max(0, this.cooldownT - dt);
      this.meleeCooldownT = Math.max(0, this.meleeCooldownT - dt);
      if (this.state !== "attached") return;

      if (this.targetMech && !this.targetMech.alive) { this.release(); return; }
      const targetPos = this.currentTargetPos();
      const toTarget = new THREE.Vector3().subVectors(targetPos, this.owner.pos);
      const dist = toTarget.length();
      if (dist > this.maxRange * 1.5) { this.release(); return; }
      const dir = dist > 0.001 ? toTarget.clone().normalize() : new THREE.Vector3(0, 0, -1);

      if (this.targetMech) {
        this.targetMech.vel.addScaledVector(dir, -this.pullForce * dt);
        if (dist < this.meleeRange && this.meleeCooldownT <= 0) {
          this.meleeCooldownT = 0.55;
          this.pendingMelee = { target: this.targetMech, damage: this.meleeDamage };
        }
      } else {
        this.owner.vel.addScaledVector(dir, this.pullForce * dt);
        if (dist < this.minDist) this.release();
      }

      if (this.line.visible) {
        this._pts[0].copy(handWorldPos);
        this._pts[1].copy(targetPos);
        this.line.geometry.setFromPoints(this._pts);
        this.tip.position.copy(targetPos);
      }
    }
  }

  GM.GrappleHook = GrappleHook;
})();
