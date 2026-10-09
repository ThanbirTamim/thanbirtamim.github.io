/* ============================================================
   CYBER RIDER 3D — hoverbike.js
   The player's low-poly neon hoverbike: mesh, lane/free-roam
   steering physics, thruster glow & light-trail FX.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const CR = (window.CR3D = window.CR3D || {});
  const { clamp, lerp, rand } = CR.util;

  class Hoverbike {
    constructor(scene) {
      this.group = new THREE.Group();
      this.x = 0; this.vx = 0; this.tilt = 0; this.hoverT = 0;
      this.bob = 0;
      this.trailPoints = [];
      this.build();
      scene.add(this.group);
    }

    build() {
      const g = this.group;
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b1030, metalness: 0.7, roughness: 0.25, emissive: 0x2a0a4a, emissiveIntensity: 0.4 });
      const neonCyan = new THREE.MeshBasicMaterial({ color: 0x00fff0 });
      const neonPink = new THREE.MeshBasicMaterial({ color: 0xff2bd6 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0818, roughness: 0.6, metalness: 0.4 });

      // main body (sleek elongated hull)
      const hull = new THREE.Mesh(CR.LIB.cyl, bodyMat);
      hull.rotation.x = Math.PI / 2; hull.scale.set(0.5, 0.5, 2.6); hull.position.y = 0.62;
      g.add(hull);
      const nose = new THREE.Mesh(CR.LIB.cone, darkMat);
      nose.rotation.x = -Math.PI / 2; nose.scale.set(0.42, 1.0, 0.42); nose.position.set(0, 0.62, -1.5);
      g.add(nose);

      // cockpit glass
      const glass = new THREE.Mesh(CR.LIB.sphere, new THREE.MeshStandardMaterial({ color: 0x0a1a2a, metalness: 0.7, roughness: 0.15 }));
      glass.scale.set(0.32, 0.26, 0.55); glass.position.set(0, 0.92, -0.2);
      g.add(glass);

      // side neon strips
      for (const side of [-1, 1]) {
        const strip = new THREE.Mesh(CR.LIB.box, neonCyan);
        strip.scale.set(0.05, 0.06, 2.2); strip.position.set(side * 0.34, 0.5, 0);
        g.add(strip);
      }

      // rear thruster housings + glow cores
      this.thrusters = [];
      for (const side of [-0.42, 0.42]) {
        const housing = new THREE.Mesh(CR.LIB.cyl, darkMat);
        housing.rotation.x = Math.PI / 2; housing.scale.set(0.26, 0.26, 0.5); housing.position.set(side, 0.5, 1.5);
        g.add(housing);
        const core = new THREE.Mesh(CR.LIB.cyl, neonPink.clone());
        core.rotation.x = Math.PI / 2; core.scale.set(0.16, 0.16, 0.12); core.position.set(side, 0.5, 1.78);
        g.add(core);
        this.thrusters.push(core);
      }

      // small wing fins
      const finMat = new THREE.MeshStandardMaterial({ color: 0x1b1030, metalness: 0.6, roughness: 0.3 });
      for (const side of [-1, 1]) {
        const fin = new THREE.Mesh(CR.LIB.box, finMat);
        fin.scale.set(0.08, 0.3, 0.9); fin.position.set(side * 0.5, 0.55, 0.9); fin.rotation.z = side * 0.25;
        g.add(fin);
      }

      // handlebar lights (front)
      const headlight = new THREE.Mesh(CR.LIB.box, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      headlight.scale.set(0.5, 0.1, 0.08); headlight.position.set(0, 0.62, -2.05);
      g.add(headlight);

      g.position.set(0, 0, 2);

      // light trail ribbon (dynamic geometry behind the bike)
      this.trailMat = new THREE.MeshBasicMaterial({ color: 0x00fff0, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
      this.trailGeo = new THREE.BufferGeometry();
      this.trailMaxPts = 18;
      this.trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.trailMaxPts * 2 * 3), 3));
      this.trailMesh = new THREE.Mesh(this.trailGeo, this.trailMat);
      this.trailMesh.frustumCulled = false;
    }

    attachTrail(scene) { scene.add(this.trailMesh); }

    update(dt, input, speed01, boosting) {
      const limit = CR.ROAD_HALF - 0.9;
      const accel = 46;
      let dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      this.vx += dir * accel * dt;
      this.vx *= 0.86;
      this.x = clamp(this.x + this.vx * dt, -limit, limit);
      if ((this.x <= -limit && dir < 0) || (this.x >= limit && dir > 0)) this.vx = 0;
      this.group.position.x = this.x;

      // bank tilt + yaw into the turn
      this.tilt = lerp(this.tilt, -this.vx * 0.055, 0.15);
      this.group.rotation.z = this.tilt;
      this.group.rotation.y = lerp(this.group.rotation.y, this.vx * 0.028, 0.2);

      // hover bob + thruster flicker
      this.hoverT += dt * (5 + speed01 * 10);
      this.bob = Math.sin(this.hoverT) * 0.045;
      this.group.position.y = 0.08 + this.bob;

      for (const core of this.thrusters) {
        core.material.color.setHex(boosting ? 0xffe14d : 0xff2bd6);
        const s = boosting ? rand(0.22, 0.34) : rand(0.14, 0.2);
        core.scale.set(0.16, 0.16, s);
      }

      this.updateTrail(boosting);
    }

    updateTrail(boosting) {
      const p = this.trailPoints;
      p.unshift({ x: this.group.position.x, y: this.group.position.y + 0.5, z: this.group.position.z + 1.8 });
      if (p.length > this.trailMaxPts) p.pop();
      const pos = this.trailGeo.attributes.position;
      const w = boosting ? 0.5 : 0.22;
      for (let i = 0; i < this.trailMaxPts; i++) {
        const pt = p[i] || p[p.length - 1] || { x: this.x, y: 0.5, z: this.group.position.z + 1.8 };
        const k = 1 - i / this.trailMaxPts;
        pos.setXYZ(i * 2, pt.x - w * k, pt.y, pt.z);
        pos.setXYZ(i * 2 + 1, pt.x + w * k, pt.y, pt.z);
      }
      pos.needsUpdate = true;
      const idx = [];
      for (let i = 0; i < this.trailMaxPts - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
      this.trailGeo.setIndex(idx);
      this.trailMat.opacity = boosting ? 0.85 : 0.4;
      this.trailMat.color.setHex(boosting ? 0xffe14d : 0x00fff0);
    }

    reset() {
      this.x = 0; this.vx = 0; this.group.position.set(0, 0.08, 2); this.group.rotation.set(0, 0, 0);
      this.trailPoints.length = 0;
    }

    bbox() {
      // simple bounding box approximation around the bike for collisions
      return { minX: this.x - 0.7, maxX: this.x + 0.7, minZ: this.group.position.z - 1.6, maxZ: this.group.position.z + 1.6 };
    }
  }
  CR.Hoverbike = Hoverbike;
})();
