/* ============================================================
   CYBER RIDER 3D — track.js
   Shared geometry/material library + the infinite neon highway,
   synthwave skybox (wireframe sun, distant towers, billboards).
   Exposes everything under the global CR3D namespace so the
   other plain <script> files (hoverbike.js, obstacles.js, main.js)
   can share it without any bundler/module system.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const CR = (window.CR3D = window.CR3D || {});

  // ---------- small helpers shared across modules ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const el = (id) => document.getElementById(id);
  CR.util = { clamp, lerp, rand, randi, pick, el };

  // ---------- world / lane constants ----------
  CR.LANES = [-3.6, 0, 3.6];
  CR.ROAD_HALF = 6.2;          // playable half-width (bike clamps inside this)
  CR.ROAD_EDGE = 7.4;          // neon guard-rail position
  CR.Z_SPAWN = -340;           // far spawn depth for pooled objects
  CR.Z_RECYCLE = 22;           // behind camera -> recycle
  CR.ROAD_LEN = 400;

  // ============================================================
  //  SHARED GEOMETRY / MATERIAL LIBRARY  (reused -> few allocations)
  // ============================================================
  CR.LIB = {};
  CR.initLib = function initLib() {
    const LIB = CR.LIB;
    LIB.box = new THREE.BoxGeometry(1, 1, 1);
    LIB.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
    LIB.cone = new THREE.ConeGeometry(1, 1, 8);
    LIB.sphere = new THREE.SphereGeometry(1, 12, 10);
    LIB.icosa = new THREE.IcosahedronGeometry(1, 0);
    LIB.octa = new THREE.OctahedronGeometry(1, 0);
    LIB.ring = new THREE.TorusGeometry(1, 0.08, 8, 20);
    LIB.plane = new THREE.PlaneGeometry(1, 1);
    LIB.matNeonCyan = new THREE.MeshBasicMaterial({ color: 0x00fff0 });
    LIB.matNeonPink = new THREE.MeshBasicMaterial({ color: 0xff2bd6 });
  };

  // ============================================================
  //  HIGHWAY  (grid road + neon borders + lane glow strips)
  // ============================================================
  class Track {
    constructor(scene) {
      this.scene = scene;
      this.dashes = [];
      this.pylons = [];
      this.build();
      this.buildSkybox();
    }

    build() {
      const s = this.scene;
      const half = CR.ROAD_HALF;

      // ---- road surface with emissive grid lines (procedural canvas texture) ----
      const tex = this.makeGridTexture();
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(3, 40);
      this.gridTex = tex;
      const roadMat = new THREE.MeshStandardMaterial({
        color: 0x0c0820, emissive: 0x2a1a55, emissiveIntensity: 0.6,
        emissiveMap: tex, map: tex, roughness: 0.65, metalness: 0.2,
      });
      const road = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, CR.ROAD_LEN, 1, 1), roadMat);
      road.rotation.x = -Math.PI / 2; road.position.z = -CR.ROAD_LEN / 2 + CR.Z_RECYCLE;
      s.add(road); this.road = road;

      // ---- neon guard-rails (both sides) ----
      this.railMat = new THREE.MeshBasicMaterial({ color: 0x00fff0 });
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, CR.ROAD_LEN), this.railMat);
        rail.position.set(side * CR.ROAD_EDGE, 0.45, road.position.z);
        s.add(rail);
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, CR.ROAD_LEN), new THREE.MeshBasicMaterial({ color: 0xff2bd6 }));
        base.position.set(side * CR.ROAD_EDGE, 0.02, road.position.z);
        s.add(base);
      }

      // ---- glowing lane divider dashes (pooled, recycled like traffic) ----
      const dashMat = new THREE.MeshBasicMaterial({ color: 0x00fff0 });
      this.dashMat = dashMat;
      const dividers = [-1.8, 1.8];
      const spacing = 9;
      for (const dx of dividers) {
        for (let z = CR.Z_RECYCLE; z > -CR.ROAD_LEN + CR.Z_RECYCLE; z -= spacing) {
          const d = new THREE.Mesh(CR.LIB.box, dashMat);
          d.scale.set(0.18, 0.02, 3.4);
          d.position.set(dx, 0.035, z);
          s.add(d); this.dashes.push(d);
        }
      }

      // ---- roadside glow pylons (pooled) ----
      const pylonMat = new THREE.MeshBasicMaterial({ color: 0xff2bd6 });
      const pylonSpacing = 26;
      for (let z = CR.Z_RECYCLE; z > -CR.ROAD_LEN + CR.Z_RECYCLE; z -= pylonSpacing) {
        for (const side of [-1, 1]) {
          const p = new THREE.Mesh(CR.LIB.cyl, pylonMat);
          p.scale.set(0.18, rand(3, 7), 0.18);
          p.position.set(side * (CR.ROAD_EDGE + 1.2), p.scale.y / 2, z);
          s.add(p); this.pylons.push(p);
        }
      }
    }

    makeGridTexture() {
      const c = document.createElement("canvas"); c.width = 128; c.height = 256;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#0a0620"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = "rgba(0,255,240,0.9)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 1); ctx.lineTo(c.width, 1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, c.height - 1); ctx.lineTo(c.width, c.height - 1); ctx.stroke();
      ctx.strokeStyle = "rgba(255,43,214,0.55)"; ctx.lineWidth = 2;
      for (let x = 0; x <= c.width; x += c.width / 3) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke(); }
      return new THREE.CanvasTexture(c);
    }

    // ---- synthwave backdrop: gradient sky handled by Fog/Scene.background in main.js;
    //      here we add the wireframe sun, distant skyscraper silhouettes & billboards ----
    buildSkybox() {
      const s = this.scene;

      // Wireframe synthwave sun
      const sunGroup = new THREE.Group();
      const sunGeo = new THREE.CircleGeometry(60, 32);
      const sunMat = new THREE.MeshBasicMaterial({ color: 0xff2bd6, transparent: true, opacity: 0.9, fog: false });
      const sunDisc = new THREE.Mesh(sunGeo, sunMat);
      sunGroup.add(sunDisc);
      const wireMat = new THREE.MeshBasicMaterial({ color: 0x0a0620, wireframe: false, transparent: true, opacity: 0.95, fog: false });
      for (let i = 1; i <= 5; i++) {
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(130, 2.4), wireMat);
        bar.position.set(0, -60 + i * 9, 0.2);
        sunGroup.add(bar);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(60, 0.6, 8, 48), new THREE.MeshBasicMaterial({ color: 0x00fff0, fog: false }));
      sunGroup.add(ring);
      sunGroup.position.set(0, 90, -650);
      s.add(sunGroup); this.sun = sunGroup;

      // Distant skyscraper silhouettes (instanced boxes, two rows far back)
      const towerMat = new THREE.MeshBasicMaterial({ color: 0x140a33, fog: false });
      const towerEdgeMat = new THREE.LineBasicMaterial({ color: 0xff2bd6, transparent: true, opacity: 0.55, fog: false });
      this.towers = new THREE.Group();
      for (let i = 0; i < 46; i++) {
        const w = rand(14, 34), h = rand(40, 180), d = w;
        const side = i % 2 === 0 ? -1 : 1;
        const tower = new THREE.Mesh(CR.LIB.box, towerMat);
        tower.scale.set(w, h, d);
        tower.position.set(side * rand(90, 420), h / 2 - 4, rand(-760, -140));
        this.towers.add(tower);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), towerEdgeMat);
        edges.scale.copy(tower.scale); edges.position.copy(tower.position);
        this.towers.add(edges);
        // occasional window glow strip
        if (Math.random() < 0.6) {
          const glow = new THREE.Mesh(CR.LIB.box, new THREE.MeshBasicMaterial({ color: pick([0x00fff0, 0xff2bd6, 0x8b2bff]), fog: false }));
          glow.scale.set(w * 1.01, h * rand(0.05, 0.14), d * 1.01);
          glow.position.set(tower.position.x, h * rand(0.2, 0.85) - 4, tower.position.z);
          this.towers.add(glow);
        }
      }
      s.add(this.towers);

      // Floating billboards beside the highway
      this.billboards = [];
      const bbColors = [0x00fff0, 0xff2bd6, 0xffe14d, 0x8b2bff];
      for (let i = 0; i < 10; i++) {
        const g = new THREE.Group();
        const panel = new THREE.Mesh(CR.LIB.box, new THREE.MeshBasicMaterial({ color: pick(bbColors), transparent: true, opacity: 0.85, fog: false }));
        panel.scale.set(rand(6, 10), rand(3, 5), 0.3);
        g.add(panel);
        const pole = new THREE.Mesh(CR.LIB.cyl, new THREE.MeshBasicMaterial({ color: 0x1a1030, fog: false }));
        pole.scale.set(0.3, panel.scale.y * 2.4, 0.3);
        pole.position.y = -panel.scale.y * 1.7;
        g.add(pole);
        const side = Math.random() < 0.5 ? -1 : 1;
        g.position.set(side * rand(16, 30), rand(14, 26), -rand(40, 300));
        g.rotation.y = side * 0.35;
        s.add(g); this.billboards.push(g);
      }
    }

    update(dz, speedRatio) {
      // scroll grid texture for a sense of forward motion
      this.gridTex.offset.y += dz * 0.012;
      // recycle dashes / pylons
      for (const d of this.dashes) { d.position.z += dz; if (d.position.z > CR.Z_RECYCLE) d.position.z -= CR.ROAD_LEN; }
      for (const p of this.pylons) { p.position.z += dz; if (p.position.z > CR.Z_RECYCLE) p.position.z -= CR.ROAD_LEN; }
      this.road.position.z += 0; // road is one long static strip, texture scroll gives motion
      // parallax background
      this.towers.position.z += dz * 0.08;
      if (this.towers.position.z > 400) this.towers.position.z -= 400;
      for (const b of this.billboards) {
        b.position.z += dz * 0.35;
        if (b.position.z > CR.Z_RECYCLE + 20) { b.position.z -= 340; const side = Math.random() < 0.5 ? -1 : 1; b.position.x = side * rand(16, 30); }
      }
      this.dashMat.color.setHSL(0.5, 1, 0.5 + Math.sin(performance.now() * 0.004) * 0.1);
    }
  }
  CR.Track = Track;
})();
