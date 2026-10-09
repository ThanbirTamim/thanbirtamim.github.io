/* ============================================================
   GRAPPLE MECH 3D — mech.js
   The battle mech: low-poly rig, shared movement physics (used
   identically by the player and all AI mechs via a generic
   `input` object so behaviour never drifts between them),
   gravity/ground/lava/storm handling, thruster boost, shield &
   armor with regen, and the dual grapple hooks.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const GM = (window.GM3D = window.GM3D || {});
  const { clamp, lerp, rand } = GM.util;

  let MECH_UID = 0;

  class Mech {
    constructor(scene, opts) {
      this.scene = scene;
      this.uid = MECH_UID++;
      this.id = opts.id;
      this.name = opts.name;
      this.isPlayer = !!opts.isPlayer;
      this.color = opts.color;
      this.pos = opts.spawn.clone();
      this.vel = new THREE.Vector3();
      this.yaw = opts.yaw || 0;
      this.pitch = 0;
      this.grounded = false;
      this.radius = 1.0;
      this.height = 2.3;

      this.maxArmor = opts.maxArmor || 100;
      this.armor = this.maxArmor;
      this.maxShield = opts.maxShield || 55;
      this.shield = this.maxShield;
      this.shieldRegenDelay = 0;

      this.maxHeat = 100;
      this.heat = 0;
      this.overheated = false;
      this.boostCooldownT = 0;

      this.weaponKey = "plasma";
      this.fireCooldown = 0;
      this.railCharge = 0;
      this.railCharging = false;

      this.alive = true;
      this.kills = 0;
      this.deaths = 0;

      this.hookLeft = new GM.GrappleHook(this, "left");
      this.hookRight = new GM.GrappleHook(this, "right");
      this.hookLeft.attachToScene(scene);
      this.hookRight.attachToScene(scene);

      this._bobT = rand(0, 10);
      this.build();
    }

    build() {
      const g = new THREE.Group();
      const hull = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.45, metalness: 0.6 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.6, metalness: 0.5 });
      const glow = new THREE.MeshBasicMaterial({ color: this.color });

      const torso = new THREE.Mesh(GM.LIB.box, hull); torso.scale.set(1.3, 1.0, 0.9); torso.position.y = 1.65;
      torso.userData.mechRef = this; g.add(torso);
      const head = new THREE.Mesh(GM.LIB.box, dark); head.scale.set(0.6, 0.45, 0.6); head.position.y = 2.35;
      head.userData.mechRef = this; head.userData.headshot = true; g.add(head);
      const visor = new THREE.Mesh(GM.LIB.box, glow); visor.scale.set(0.5, 0.12, 0.05); visor.position.set(0, 2.35, -0.3); g.add(visor);
      this.visor = visor;

      for (const side of [-1, 1]) {
        const shoulder = new THREE.Mesh(GM.LIB.box, hull); shoulder.scale.set(0.5, 0.4, 0.5); shoulder.position.set(side * 0.9, 1.95, 0);
        shoulder.userData.mechRef = this; g.add(shoulder);
        const cannon = new THREE.Mesh(GM.LIB.cyl, dark); cannon.rotation.x = Math.PI / 2; cannon.scale.set(0.18, 0.18, 0.7); cannon.position.set(side * 0.9, 1.75, -0.5);
        g.add(cannon);
        const leg = new THREE.Mesh(GM.LIB.cyl, dark); leg.scale.set(0.32, 1.5, 0.32); leg.position.set(side * 0.42, 0.75, 0);
        leg.userData.mechRef = this; g.add(leg);
        const foot = new THREE.Mesh(GM.LIB.box, hull); foot.scale.set(0.55, 0.26, 0.85); foot.position.set(side * 0.42, 0.08, 0.1);
        g.add(foot);
      }
      this._hitMeshes = g.children.filter((c) => c.userData.mechRef === this);

      // floating shield ring (visible briefly, intensity reflects shield health)
      const shieldRing = new THREE.Mesh(GM.LIB.sphere, new THREE.MeshBasicMaterial({ color: 0x35d2ff, transparent: true, opacity: 0.18, wireframe: true }));
      shieldRing.scale.setScalar(1.5); shieldRing.position.y = 1.5;
      g.add(shieldRing);
      this.shieldMesh = shieldRing;

      // health bar sprite
      const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 20;
      this._barCtx = canvas.getContext("2d"); this._barTex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._barTex, depthTest: false, transparent: true }));
      sprite.scale.set(1.3, 0.32, 1); sprite.position.y = 2.75;
      g.add(sprite);
      this._drawBar();

      g.position.copy(this.pos);
      this.group = g;
      this.scene.add(g);
    }

    _drawBar() {
      const ctx = this._barCtx, w = 80, h = 20;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, w, h);
      const sp = clamp(this.shield / this.maxShield, 0, 1), ap = clamp(this.armor / this.maxArmor, 0, 1);
      ctx.fillStyle = "#35d2ff"; ctx.fillRect(2, 2, (w - 4) * sp, 7);
      ctx.fillStyle = ap > 0.5 ? "#4dffb0" : ap > 0.25 ? "#ffd166" : "#ff3b5c"; ctx.fillRect(2, 11, (w - 4) * ap, 7);
      ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      this._barTex.needsUpdate = true;
    }

    hitMeshes() { return this._hitMeshes; }
    get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
    get right() { return new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw)); }
    eyePos() { return this.pos.clone().add(new THREE.Vector3(0, 2.1, 0)); }
    aimDir() {
      return new THREE.Vector3(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * Math.cos(this.pitch)
      ).normalize();
    }
    handWorldPos(side) {
      // NOTE: must rotate by -this.yaw to match the forward/right getters above and
      // the mesh's own group.rotation.y = -this.yaw (positive this.yaw alone is the
      // wrong sign and would place the hand on the wrong side of the mech).
      const local = new THREE.Vector3(side === "left" ? -0.9 : 0.9, 1.75, -0.5);
      return local.applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw).add(this.pos);
    }

    // ---------- shared physics update (player + AI both call this) ----------
    // moveInput: { forward, strafe } each in [-1,1], relative to this.yaw
    // boost: true on the frame a boost should fire (edge-triggered by caller)
    update(dt, moveInput, boost, arena, mechList) {
      if (this.alive) {
        const fwd = this.forward, right = this.right;
        const accel = this.grounded ? 34 : 9;
        const move = new THREE.Vector3().addScaledVector(fwd, moveInput.forward || 0).addScaledVector(right, moveInput.strafe || 0);
        if (move.lengthSq() > 1) move.normalize();
        this.vel.addScaledVector(move, accel * dt);

        // boost / thruster dash
        this.boostCooldownT = Math.max(0, this.boostCooldownT - dt);
        if (!this.overheated) this.heat = Math.max(0, this.heat - dt * 14);
        if (this.heat <= 25) this.overheated = false;
        if (boost && !this.overheated && this.boostCooldownT <= 0) {
          const dir = move.lengthSq() > 0.01 ? move.clone().normalize() : fwd.clone();
          this.vel.addScaledVector(dir, 16);
          this.vel.y += 7;
          this.heat += 34;
          this.boostCooldownT = 0.35;
          if (this.heat >= this.maxHeat) { this.heat = this.maxHeat; this.overheated = true; }
        }

        // gravity / ground
        const groundY = arena.groundHeightAt(this.pos.x, this.pos.z);
        this.grounded = false;
        if (this.vel.y <= 0 && this.pos.y <= groundY + 0.05 && groundY > -Infinity) {
          this.pos.y = groundY; this.vel.y = 0; this.grounded = true;
        } else {
          this.vel.y -= GM.GRAVITY * dt;
        }

        // friction (ground only — preserve momentum in air for grapple swings)
        const friction = this.grounded ? 0.86 : 0.995;
        this.vel.x *= Math.pow(friction, dt * 60);
        this.vel.z *= Math.pow(friction, dt * 60);

        this.pos.addScaledVector(this.vel, dt);
        arena.resolveWallCollision(this.pos, this.radius);

        // lava void damage
        if (this.pos.y < GM.LAVA_Y + 2.5) {
          this.applyDamage(dt * 22);
          if (this.pos.y < GM.LAVA_Y - 2) this.pos.y = GM.LAVA_Y - 2;
          if (this.vel.y < 0) this.vel.y *= 0.9;
        }
        // storm zone damage
        if (!arena.isInSafeZone(this.pos.x, this.pos.z)) this.applyDamage(dt * 7);

        // shield regen
        this.shieldRegenDelay = Math.max(0, this.shieldRegenDelay - dt);
        if (this.shieldRegenDelay <= 0 && this.shield < this.maxShield) {
          this.shield = Math.min(this.maxShield, this.shield + dt * 12);
          this._drawBar();
        }

        // weapon timers
        this.fireCooldown = Math.max(0, this.fireCooldown - dt);

        // grapple hooks
        this.hookLeft.update(dt, this.handWorldPos("left"));
        this.hookRight.update(dt, this.handWorldPos("right"));

        this._bobT += dt * (this.vel.length() > 0.5 ? 6 : 1.5);
      }

      this.group.position.copy(this.pos);
      this.group.position.y += this.alive && this.grounded ? Math.abs(Math.sin(this._bobT)) * 0.04 : 0;
      this.group.rotation.y = -this.yaw;
      this.group.visible = this.alive;
      if (this.visor) this.visor.material.color.setHex(this.overheated ? 0xff5c3d : this.color);
      if (this.shieldMesh) this.shieldMesh.visible = this.shield > 0.5;
    }

    // ---------- combat ----------
    applyDamage(dmg) {
      if (!this.alive || dmg <= 0) return { died: false, shieldHit: false };
      this.shieldRegenDelay = 3.2;
      let shieldHit = false;
      let remaining = dmg;
      if (this.shield > 0) {
        shieldHit = true;
        const absorbed = Math.min(this.shield, remaining);
        this.shield -= absorbed; remaining -= absorbed;
      }
      if (remaining > 0) this.armor -= remaining;
      this._drawBar();
      if (this.armor <= 0) {
        this.armor = 0;
        this.alive = false;
        this.deaths++;
        return { died: true, shieldHit };
      }
      return { died: false, shieldHit };
    }

    respawn(pos) {
      this.pos.copy(pos); this.vel.set(0, 0, 0);
      this.armor = this.maxArmor; this.shield = this.maxShield;
      this.heat = 0; this.overheated = false;
      this.alive = true;
      this.hookLeft.release(); this.hookRight.release();
      this._drawBar();
      this.group.visible = true;
    }
  }

  GM.Mech = Mech;
})();
