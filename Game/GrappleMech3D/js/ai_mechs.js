/* ============================================================
   GRAPPLE MECH 3D — ai_mechs.js
   AI opponents built on top of the shared Mech physics: Rival
   (balanced, aggressive hook-pulls), Heavy Brawler (tanky,
   close-range railgun), Sniper (long range, flees & repositions
   via grapple). Each AI decides movement/boost/weapon intent
   every frame and fires its own grapple hooks directly; weapon
   shots are returned as an intent so main.js resolves all
   hitscan combat (player & AI) through one shared code path.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const GM = (window.GM3D = window.GM3D || {});
  const { clamp, lerp, rand, pick, dist2D } = GM.util;

  const AI_PROFILES = {
    rival: {
      displayName: "Rival", preferredMin: 10, preferredMax: 28, weapon: "plasma", weaponRange: 60,
      dodgeChance: 0.5, grappleMin: 2.6, grappleMax: 5, aggressiveHook: true, fleeThreshold: 0.22, turnSpeed: 5,
    },
    heavy: {
      displayName: "Heavy Brawler", preferredMin: 3, preferredMax: 13, weapon: "railgun", weaponRange: 45,
      dodgeChance: 0.18, grappleMin: 4.5, grappleMax: 8, aggressiveHook: true, fleeThreshold: 0.1, turnSpeed: 3.2,
    },
    sniper: {
      displayName: "Sniper Mech", preferredMin: 34, preferredMax: 70, weapon: "railgun", weaponRange: 120,
      dodgeChance: 0.6, grappleMin: 1.8, grappleMax: 3.6, aggressiveHook: false, fleeThreshold: 0.4, turnSpeed: 4,
    },
  };

  class AIMech {
    constructor(scene, opts) {
      this.aiType = opts.aiType;
      this.profile = AI_PROFILES[this.aiType];
      this.mech = new GM.Mech(scene, opts);
      this.target = null;
      this.perceptionT = rand(0, 0.3);
      this.strafeDir = pick([-1, 1]);
      this.strafeT = rand(1, 2.5);
      this.wanderT = rand(1, 3);
      this.fireT = rand(0.2, 0.6);
      this.grappleT = rand(this.profile.grappleMin, this.profile.grappleMax);
      this.railChargeT = 0;
    }

    pickTarget(mechList) {
      let best = null, bestD = Infinity;
      for (const m of mechList) {
        if (m === this.mech || !m.alive) continue;
        const d = dist2D(this.mech.pos.x, this.mech.pos.z, m.pos.x, m.pos.z);
        if (d < bestD) { bestD = d; best = m; }
      }
      return best;
    }

    tryGrapple(arena, mechList, dist) {
      const hook = Math.random() < 0.5 ? this.mech.hookLeft : this.mech.hookRight;
      if (hook.state !== "idle") return;
      const origin = this.mech.handWorldPos(hook.side);
      if (this.profile.aggressiveHook && this.target && dist < hook.maxRange * 0.75 && Math.random() < 0.55) {
        const dir = new THREE.Vector3().subVectors(this.target.pos, origin).normalize();
        hook.tryFire(origin, dir, arena, mechList);
      } else {
        const anchor = arena.nearestAnchor(this.mech.pos.x, this.mech.pos.y, this.mech.pos.z, 46);
        if (anchor) {
          const dir = new THREE.Vector3(anchor.x, anchor.y, anchor.z).sub(origin).normalize();
          hook.tryFire(origin, dir, arena, mechList);
        }
      }
    }

    // returns { moveInput: {forward, strafe}, boost, wantsFire }
    decide(dt, mechList, arena) {
      const m = this.mech;
      const profile = this.profile;

      this.perceptionT -= dt;
      if (this.perceptionT <= 0) { this.perceptionT = rand(0.3, 0.55); this.target = this.pickTarget(mechList); }
      if (this.target && !this.target.alive) this.target = null;

      const moveInput = { forward: 0, strafe: 0 };
      let boost = false;
      let wantsFire = null;

      const healthFrac = (m.armor + m.shield) / (m.maxArmor + m.maxShield);
      const fleeing = healthFrac < profile.fleeThreshold;

      if (this.target) {
        const dx = this.target.pos.x - m.pos.x, dz = this.target.pos.z - m.pos.z;
        const dist = Math.hypot(dx, dz);
        const desiredYaw = Math.atan2(dx, -dz);
        m.yaw = lerp(m.yaw, desiredYaw, 1 - Math.exp(-profile.turnSpeed * dt));
        const heightDiff = this.target.pos.y - m.pos.y;
        m.pitch = clamp(Math.atan2(heightDiff, Math.max(1, dist)), -0.6, 0.6);

        if (fleeing) {
          moveInput.forward = -1;
        } else if (dist > profile.preferredMax) moveInput.forward = 1;
        else if (dist < profile.preferredMin) moveInput.forward = -0.8;
        else moveInput.forward = rand(-0.2, 0.3);

        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = rand(1, 2.4); }
        moveInput.strafe = this.strafeDir * (fleeing ? 0.3 : 0.65);

        if (Math.random() < profile.dodgeChance * dt) { this.strafeDir *= -1; boost = Math.random() < 0.45; }
        if (fleeing && Math.random() < 0.4 * dt) boost = true;

        this.grappleT -= dt;
        if (this.grappleT <= 0) {
          this.grappleT = rand(profile.grappleMin, profile.grappleMax);
          this.tryGrapple(arena, mechList, dist);
        }

        this.fireT -= dt;
        if (dist <= profile.weaponRange && this.fireT <= 0 && !fleeing) {
          this.fireT = rand(0.18, 0.4);
          wantsFire = profile.weapon;
        }
      } else {
        this.wanderT -= dt;
        if (this.wanderT <= 0) { m.yaw += rand(-1.2, 1.2); this.wanderT = rand(2, 4); }
        moveInput.forward = 0.35;
      }

      return { moveInput, boost, wantsFire };
    }
  }

  GM.AI_PROFILES = AI_PROFILES;
  GM.AIMech = AIMech;
})();
