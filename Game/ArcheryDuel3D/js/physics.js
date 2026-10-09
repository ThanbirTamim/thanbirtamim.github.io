/* ============================================================
   ARCHERY DUEL 3D — physics.js
   Shared namespace (AD3D), math helpers, and arrow ballistics:
   gravity, atmospheric drag, wind force vectors and weather-
   specific drag (rain weighting arrows down, gusts pushing them
   sideways). Also the projectile-angle solver used to give the
   archer (and the AI) a sensible baseline elevation per distance.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const AD = (window.AD3D = window.AD3D || {});

  // ---------- small helpers shared across modules ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const el = (id) => document.getElementById(id);
  AD.util = { clamp, lerp, rand, randi, pick, el };

  // ---------- match constants ----------
  AD.DISTANCES = [30, 50, 70, 100];
  AD.WEATHER_TYPES = ["clear", "rain", "blizzard", "sandstorm"];
  AD.ARROWS_PER_TURN = 3;
  AD.ROUNDS = 3;
  AD.TARGET_RADIUS = 0.75;        // world metres (stylised FITA-style face)
  AD.SHOOT_LINE_Z = 0;             // archers stand at z = 0
  AD.EYE_HEIGHT = 1.55;

  // ============================================================
  //  BALLISTICS CONSTANTS
  // ============================================================
  const PHYS = {
    GRAVITY: 9.82,
    AIR_DRAG: 0.045,          // velocity *= (1 - AIR_DRAG*dt)
    WIND_FORCE_SCALE: 0.85,   // how strongly wind (m/s) accelerates the arrow
    RAIN_EXTRA_DROP: 1.5,     // extra downward accel (m/s^2) in rain (soaked fletching)
    BASELINE_SPEED: 58,       // m/s at "reference" draw power
  };
  AD.PHYS = PHYS;

  // ---------- projectile angle solver (low/flat trajectory root) ----------
  // Given a launch speed & horizontal distance (ignoring wind), returns the
  // shallow launch angle (radians) needed to land at that range.
  AD.solveLaunchAngle = function solveLaunchAngle(speed, distance) {
    const g = PHYS.GRAVITY;
    const raw = (g * distance) / (speed * speed);
    if (raw > 1) return Math.PI / 4; // out of range -> best-effort 45°
    return 0.5 * Math.asin(clamp(raw, -1, 1));
  };

  // ---------- arrow projectile state ----------
  AD.createArrowState = function createArrowState(pos, dirYaw, dirPitch, speed) {
    const dir = new THREE.Vector3(
      Math.sin(dirYaw) * Math.cos(dirPitch),
      Math.sin(dirPitch),
      -Math.cos(dirYaw) * Math.cos(dirPitch)
    ).normalize();
    return { pos: pos.clone(), prevPos: pos.clone(), vel: dir.multiplyScalar(speed), t: 0, alive: true };
  };

  // ---------- integrate one physics step ----------
  // wind: {x, z} in m/s. weatherType: 'clear'|'rain'|'blizzard'|'sandstorm'
  AD.stepArrow = function stepArrow(state, dt, wind, weatherType) {
    state.prevPos.copy(state.pos);
    state.vel.y -= PHYS.GRAVITY * dt;
    state.vel.x += wind.x * PHYS.WIND_FORCE_SCALE * dt;
    state.vel.z += wind.z * PHYS.WIND_FORCE_SCALE * dt;
    if (weatherType === "rain") state.vel.y -= PHYS.RAIN_EXTRA_DROP * dt;
    const dragK = 1 - PHYS.AIR_DRAG * dt;
    state.vel.multiplyScalar(Math.max(0.8, dragK));
    state.pos.addScaledVector(state.vel, dt);
    state.t += dt;
  };

  // ---------- scoring: distance from board centre (world units) -> points ----------
  AD.scoreForRadius = function scoreForRadius(radius) {
    const frac = radius / AD.TARGET_RADIUS;
    if (frac > 1) return 0;
    const band = Math.floor(frac * 10);
    return clamp(10 - band, 1, 10);
  };
})();
