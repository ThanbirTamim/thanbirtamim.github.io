/* ============================================================
   ARCHERY DUEL 3D — weather.js
   Dynamic weather: Clear Sunset, Heavy Rain & Thunderstorm,
   Mountain Blizzard, Desert Sandstorm. Drives scene fog/sky,
   pooled particle FX (rain/snow/sand), lightning flashes and
   the real-time wind vector (direction + fluctuating speed).
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const AD = (window.AD3D = window.AD3D || {});
  const { clamp, lerp, rand, randi } = AD.util;

  const SKY = {
    clear: { sky: 0xffb871, fogColor: 0xffb871, fogNear: 60, fogFar: 220, ambient: 0.75, sun: 1.1 },
    rain: { sky: 0x3a4250, fogColor: 0x3a4250, fogNear: 20, fogFar: 110, ambient: 0.45, sun: 0.5 },
    blizzard: { sky: 0xcfd9e0, fogColor: 0xcfd9e0, fogNear: 12, fogFar: 85, ambient: 0.65, sun: 0.55 },
    sandstorm: { sky: 0xc9a05f, fogColor: 0xc9a05f, fogNear: 14, fogFar: 95, ambient: 0.6, sun: 0.6 },
  };
  const WIND_RANGE = { // km/h bounds per weather, converted to m/s internally
    clear: [5, 14], rain: [10, 24], blizzard: [14, 30], sandstorm: [12, 30],
  };

  class WeatherManager {
    constructor(scene, lights) {
      this.scene = scene; this.lights = lights;
      this.type = "clear";
      this.windAngle = rand(0, Math.PI * 2);
      this.windSpeedKmh = 10;
      this.windTargetKmh = 10;
      this.gustT = rand(0, 10);
      this.lightningT = rand(2, 6);
      this.onThunder = null;
      this._buildRain();
      this._buildSnow();
      this._buildSand();
      this._buildFogVolume();
    }

    _buildRain() {
      const n = 900;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = rand(-40, 40); pos[i * 3 + 1] = rand(0, 30); pos[i * 3 + 2] = rand(-110, 20); }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0xaecbe8, size: 0.14, transparent: true, opacity: 0.75 });
      this.rain = new THREE.Points(geo, mat);
      this.rain.visible = false;
      this.scene.add(this.rain);
    }

    _buildSnow() {
      const n = 500;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = rand(-40, 40); pos[i * 3 + 1] = rand(0, 30); pos[i * 3 + 2] = rand(-110, 20); }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, transparent: true, opacity: 0.9 });
      this.snow = new THREE.Points(geo, mat);
      this.snow.visible = false;
      this.scene.add(this.snow);
    }

    _buildSand() {
      const n = 600;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = rand(-40, 40); pos[i * 3 + 1] = rand(0, 12); pos[i * 3 + 2] = rand(-110, 20); }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0xcaa35f, size: 0.26, transparent: true, opacity: 0.65 });
      this.sand = new THREE.Points(geo, mat);
      this.sand.visible = false;
      this.scene.add(this.sand);
    }

    _buildFogVolume() {
      // a soft ground-hugging haze plane used for blizzard/sandstorm/rain depth cueing
      const geo = new THREE.PlaneGeometry(140, 140);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false });
      this.haze = new THREE.Mesh(geo, mat);
      this.haze.rotation.x = -Math.PI / 2;
      this.haze.position.y = 3;
      this.haze.position.z = -40;
      this.scene.add(this.haze);
    }

    setType(type) {
      this.type = type;
      const s = SKY[type];
      this.scene.background = new THREE.Color(s.sky);
      this.scene.fog = new THREE.Fog(s.fogColor, s.fogNear, s.fogFar);
      this.lights.ambient.intensity = s.ambient;
      this.lights.sun.intensity = s.sun;
      this.haze.material.color.setHex(s.fogColor);
      this.haze.material.opacity = type === "clear" ? 0 : type === "rain" ? 0.1 : 0.22;
      this.rain.visible = type === "rain";
      this.snow.visible = type === "blizzard";
      this.sand.visible = type === "sandstorm";
      const [lo, hi] = WIND_RANGE[type];
      this.windSpeedKmh = rand(lo, hi);
      this.windTargetKmh = this.windSpeedKmh;
      this.windAngle = rand(0, Math.PI * 2);
      this.lightningT = rand(2, 5);
    }

    // ---------- wind: {speedKmh, angle, vector (m/s, world X/Z)} ----------
    getWind() {
      const speedMs = this.windSpeedKmh / 3.6;
      return {
        speedKmh: this.windSpeedKmh,
        angle: this.windAngle,
        x: Math.sin(this.windAngle) * speedMs,
        z: -Math.cos(this.windAngle) * speedMs,
      };
    }

    update(dt) {
      // wind fluctuation: drift toward a new random target speed, gustier in storms
      this.gustT -= dt;
      if (this.gustT <= 0) {
        const [lo, hi] = WIND_RANGE[this.type];
        this.windTargetKmh = rand(lo, hi);
        this.gustT = rand(1.5, 4);
      }
      this.windSpeedKmh = lerp(this.windSpeedKmh, this.windTargetKmh, 1 - Math.exp(-1.2 * dt));
      this.windAngle += Math.sin(performance.now() * 0.0003) * dt * 0.15;

      // lightning (rain/thunderstorm only)
      if (this.type === "rain") {
        this.lightningT -= dt;
        if (this.lightningT <= 0) {
          this.lightningT = rand(4, 9);
          this.flash();
        }
      }

      this._updateParticles(dt, this.rain, 26, true, false);
      this._updateParticles(dt, this.snow, 3.2, false, false);
      this._updateParticles(dt, this.sand, 0.4, false, true);
    }

    flash() {
      const el = AD.util.el("lightningFx");
      el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
      const prevIntensity = this.lights.sun.intensity;
      this.lights.sun.intensity = prevIntensity + 2.2;
      setTimeout(() => { this.lights.sun.intensity = prevIntensity; }, 180);
      if (this.onThunder) setTimeout(() => this.onThunder(), rand(250, 700));
    }

    _updateParticles(dt, points, fallSpeed, isRain, isSand) {
      if (!points.visible) return;
      const wind = this.getWind();
      const pos = points.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - fallSpeed * dt;
        let x = pos.getX(i) + wind.x * dt * (isSand ? 1.6 : 0.5);
        let z = pos.getZ(i) + wind.z * dt * (isSand ? 1.6 : 0.5);
        if (y < 0) { y = rand(14, 30); x = rand(-40, 40); z = rand(-110, 20); }
        if (x > 45) x = -45; if (x < -45) x = 45;
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }
  }

  AD.WeatherManager = WeatherManager;
})();
