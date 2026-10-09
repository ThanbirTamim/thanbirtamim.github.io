/* ============================================================
   ARCHERY DUEL 3D — ai_rival.js
   The computer rival's shot planner: calibrates elevation from
   the ballistics solver, estimates lateral wind drift and
   compensates for it, then adds skill-scaled aiming error with
   simple shot-to-shot self-correction so the AI "learns" within
   a turn. Difficulty: easy | medium | hard.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const AD = (window.AD3D = window.AD3D || {});
  const { clamp, lerp, rand } = AD.util;

  const SKILL = {
    easy: { aimErr: 0.1, pitchErr: 0.05, powerErr: 0.14, windComp: 0.45, correction: 0.2 },
    medium: { aimErr: 0.05, pitchErr: 0.028, powerErr: 0.07, windComp: 0.78, correction: 0.45 },
    hard: { aimErr: 0.02, pitchErr: 0.012, powerErr: 0.03, windComp: 1.0, correction: 0.7 },
  };

  class AIRival {
    constructor(difficulty) {
      this.difficulty = SKILL[difficulty] ? difficulty : "medium";
      this.lastMiss = { x: 0, y: 0 };
    }

    setDifficulty(d) { this.difficulty = SKILL[d] ? d : "medium"; this.lastMiss = { x: 0, y: 0 }; }

    // archerPos/targetCenter: THREE.Vector3 world positions. wind: {x,z} m/s.
    // Returns { yaw, pitch, power, speed } ready to launch.
    computeShot(archerPos, targetCenter, distance, wind) {
      const skill = SKILL[this.difficulty];
      const power = clamp(0.84 + rand(-skill.powerErr, skill.powerErr), 0.4, 1);
      const speed = AD.PHYS.BASELINE_SPEED * lerp(0.5, 1.25, power);
      const pitchBase = AD.solveLaunchAngle(speed, distance);

      const dir = new THREE.Vector3().subVectors(targetCenter, archerPos);
      const yawBase = Math.atan2(dir.x, -dir.z);

      // estimate lateral drift from crosswind over the (approximate) flight time, and
      // steer into the wind to compensate — scaled by skill (weaker AIs under/over-correct)
      const flightTime = distance / Math.max(8, speed * Math.cos(pitchBase));
      const drift = wind.x * AD.PHYS.WIND_FORCE_SCALE * 0.5 * flightTime * flightTime;
      const yawComp = Math.atan2(-drift, distance) * skill.windComp;

      // self-correction from the previous arrow's miss (crude closed-loop aiming)
      const corrYaw = -this.lastMiss.x * skill.correction * 0.9;
      const corrPitch = -this.lastMiss.y * skill.correction * 0.9;

      const yaw = yawBase + yawComp + corrYaw + rand(-skill.aimErr, skill.aimErr);
      const pitch = pitchBase + corrPitch + rand(-skill.pitchErr, skill.pitchErr);

      return { yaw, pitch, power, speed };
    }

    // dx/dy = how far the previous arrow landed from centre on the target plane (world units)
    recordResult(dx, dy) { this.lastMiss = { x: dx, y: dy }; }
  }

  AD.AIRival = AIRival;
})();
