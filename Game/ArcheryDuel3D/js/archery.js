/* ============================================================
   ARCHERY DUEL 3D — archery.js
   Shared geometry/material library, the shooting range (ground,
   backdrop, shooting line), the low-poly Archer+Bow rig with a
   draw/aim animation, the Arrow projectile visual, and the
   traditional ringed TargetBoard with scoring + stuck arrows.
   ============================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  const AD = (window.AD3D = window.AD3D || {});
  const { clamp, lerp, rand, randi, pick } = AD.util;

  // ============================================================
  //  SHARED GEOMETRY / MATERIAL LIBRARY
  // ============================================================
  AD.LIB = {};
  AD.initLib = function initLib() {
    const LIB = AD.LIB;
    LIB.box = new THREE.BoxGeometry(1, 1, 1);
    LIB.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
    LIB.cone = new THREE.ConeGeometry(1, 1, 8);
    LIB.sphere = new THREE.SphereGeometry(1, 12, 10);
    LIB.plane = new THREE.PlaneGeometry(1, 1);
  };

  // ============================================================
  //  RANGE  (ground, backdrop treeline, shooting line)
  // ============================================================
  class Range {
    constructor(scene) {
      this.scene = scene;
      this.build();
    }
    _grassTexture() {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#3c6b35"; ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      for (let i = 0; i < 260; i++) ctx.fillRect(rand(0, 128), rand(0, 128), rand(1, 3), rand(4, 10));
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      for (let i = 0; i < 160; i++) ctx.fillRect(rand(0, 128), rand(0, 128), rand(1, 2), rand(2, 5));
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(16, 40);
      return tex;
    }
    build() {
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(130, 260), new THREE.MeshStandardMaterial({ map: this._grassTexture(), roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.z = -60;
      this.scene.add(ground);

      // shooting line marker
      const line = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
      line.rotation.x = -Math.PI / 2; line.position.set(0, 0.02, 0.6);
      this.scene.add(line);

      // backdrop treeline (simple silhouettes for depth)
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 1 });
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x24492a, roughness: 1, flatShading: true });
      this.trees = new THREE.Group();
      for (let i = 0; i < 46; i++) {
        const x = rand(-60, 60), z = rand(-150, -40);
        if (Math.abs(x) < 3 && z > -90) continue;
        const h = rand(4, 9);
        const trunk = new THREE.Mesh(AD.LIB.cyl, trunkMat); trunk.scale.set(0.35, h * 0.4, 0.35); trunk.position.set(x, h * 0.2, z);
        const leaf = new THREE.Mesh(AD.LIB.cone, leafMat); leaf.scale.set(h * 0.45, h, h * 0.45); leaf.position.set(x, h * 0.55 + h * 0.35, z);
        this.trees.add(trunk); this.trees.add(leaf);
      }
      this.scene.add(this.trees);

      // distant mountains silhouette
      const mMat = new THREE.MeshBasicMaterial({ color: 0x6b5a6e });
      this.mountains = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const m = new THREE.Mesh(AD.LIB.cone, mMat);
        const s = rand(30, 55);
        m.scale.set(s, s * rand(0.7, 1.1), s);
        m.position.set(rand(-120, 120), s * 0.35 - 6, -220 - rand(0, 100));
        this.mountains.add(m);
      }
      this.scene.add(this.mountains);
    }
  }

  // ============================================================
  //  ARROW  (visual projectile mesh) — defined before Archer, which
  //  nocks one onto the bow string while aiming.
  // ============================================================
  class Arrow {
    constructor() {
      const g = new THREE.Group();
      const shaftMat = new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.7 });
      const tipMat = new THREE.MeshStandardMaterial({ color: 0xb9bec7, metalness: 0.7, roughness: 0.3 });
      const fletchMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.8, side: THREE.DoubleSide });

      const shaft = new THREE.Mesh(AD.LIB.cyl, shaftMat); shaft.rotation.x = Math.PI / 2; shaft.scale.set(0.018, 0.018, 0.72); shaft.position.z = -0.1;
      g.add(shaft);
      const tip = new THREE.Mesh(AD.LIB.cone, tipMat); tip.rotation.x = -Math.PI / 2; tip.scale.set(0.03, 0.09, 0.03); tip.position.z = -0.47;
      g.add(tip);
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(AD.LIB.plane, fletchMat); f.scale.set(0.05, 0.1, 1);
        f.position.z = 0.28; f.rotation.z = (i / 3) * Math.PI * 2; f.rotation.y = Math.PI / 2;
        g.add(f);
      }
      this.group = g;
      this.state = null; // physics state once in flight
    }
    orientToVelocity(vel) {
      const dir = vel.clone().normalize();
      this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    }
  }

  // ============================================================
  //  ARCHER  (low-poly body + bow with draw/aim animation)
  // ============================================================
  class Archer {
    constructor(scene, xOffset, uniformColor) {
      this.scene = scene; this.xOffset = xOffset;
      this.yaw = 0; this.pitch = 0.08; this.draw = 0;
      this.build(uniformColor);
    }
    build(color) {
      const g = new THREE.Group();
      const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
      const skin = new THREE.MeshStandardMaterial({ color: 0xc89570, roughness: 0.8 });
      const wood = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.6 });

      const legs = new THREE.Mesh(AD.LIB.cyl, cloth); legs.scale.set(0.4, 0.9, 0.3); legs.position.y = 0.45; g.add(legs);
      const torso = new THREE.Mesh(AD.LIB.box, cloth); torso.scale.set(0.5, 0.65, 0.3); torso.position.y = 1.22; g.add(torso);
      const head = new THREE.Mesh(AD.LIB.sphere, skin); head.scale.set(0.22, 0.24, 0.22); head.position.y = 1.72; g.add(head);

      // bow: two curved limbs (half-torus arcs) joined by a vertical riser
      const bowGroup = new THREE.Group();
      const riser = new THREE.Mesh(AD.LIB.cyl, wood); riser.scale.set(0.05, 0.5, 0.05); riser.position.y = 0; bowGroup.add(riser);
      const limbGeo = new THREE.TorusGeometry(0.55, 0.025, 6, 16, Math.PI * 0.62);
      const limbTop = new THREE.Mesh(limbGeo, wood); limbTop.position.y = 0.5; limbTop.rotation.z = Math.PI * 0.5 + Math.PI * 0.19; bowGroup.add(limbTop);
      const limbBot = new THREE.Mesh(limbGeo, wood); limbBot.position.y = -0.5; limbBot.rotation.z = -Math.PI * 0.5 - Math.PI * 0.19; bowGroup.add(limbBot);
      bowGroup.position.set(0.32, 1.25, -0.25);
      bowGroup.rotation.y = -0.25;
      g.add(bowGroup);
      this.bowGroup = bowGroup;

      // bow string (two static anchor points + a dynamic nock point, updated on draw)
      const stringMat = new THREE.LineBasicMaterial({ color: 0xe8e4d8 });
      const stringGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.98, 0), new THREE.Vector3(0, 0, 0.1), new THREE.Vector3(0, -0.98, 0)]);
      this.string = new THREE.Line(stringGeo, stringMat);
      bowGroup.add(this.string);
      this.stringTop = new THREE.Vector3(0, 0.98, 0);
      this.stringBot = new THREE.Vector3(0, -0.98, 0);

      // nocked arrow (visual only while aiming; released arrows are separate Arrow instances)
      this.nockedArrow = new Arrow();
      this.nockedArrow.group.scale.setScalar(0.9);
      bowGroup.add(this.nockedArrow.group);

      g.position.set(this.xOffset, 0, 0.5);
      this.group = g;
      this.scene.add(g);
    }

    setAimVisual(yaw, pitch, draw) {
      this.yaw = yaw; this.pitch = pitch; this.draw = draw;
      this.group.rotation.y = -yaw * 0.4;
      this.bowGroup.rotation.x = pitch * 0.5;
      const pull = draw * 0.42;
      this.string.geometry.setFromPoints([this.stringTop, new THREE.Vector3(0, 0, 0.1 + pull), this.stringBot]);
      this.nockedArrow.group.position.set(0, 0, pull);
    }

    showNockedArrow(v) { this.nockedArrow.group.visible = v; }

    // approximate world-space release point (front of the bow, chest height)
    getLaunchPoint() {
      const p = new THREE.Vector3(0.1, 0, -0.55);
      p.applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw * 0.4);
      p.add(new THREE.Vector3(this.xOffset, 1.3, 0.5));
      return p;
    }
  }

  AD.Arrow = Arrow;
  AD.Archer = Archer;
  AD.Range = Range;

  // ============================================================
  //  TARGET BOARD  (traditional ringed face + stand + scoring)
  // ============================================================
  const RING_COLORS = ["#ffd700", "#ffd700", "#d8263a", "#d8263a", "#1c5fa8", "#1c5fa8", "#1a1a1a", "#1a1a1a", "#f4f1e6", "#f4f1e6"];
  class TargetBoard {
    constructor(scene) {
      this.scene = scene;
      this.group = new THREE.Group();
      this.stuckArrows = [];
      this.build();
      scene.add(this.group);
    }
    _faceTexture() {
      const size = 512;
      const c = document.createElement("canvas"); c.width = c.height = size;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#f4f1e6"; ctx.fillRect(0, 0, size, size);
      const cx = size / 2, cy = size / 2, R = size / 2 - 4;
      for (let i = 10; i >= 1; i--) {
        ctx.beginPath();
        ctx.arc(cx, cy, (i / 10) * R, 0, Math.PI * 2);
        ctx.fillStyle = RING_COLORS[10 - i];
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 2;
      for (let i = 1; i <= 10; i++) { ctx.beginPath(); ctx.arc(cx, cy, (i / 10) * R, 0, Math.PI * 2); ctx.stroke(); }
      return new THREE.CanvasTexture(c);
    }
    build() {
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.8 });
      const legA = new THREE.Mesh(AD.LIB.cyl, woodMat); legA.scale.set(0.06, 1.8, 0.06); legA.position.set(-0.3, 0.9, 0.35); legA.rotation.x = -0.35; this.group.add(legA);
      const legB = new THREE.Mesh(AD.LIB.cyl, woodMat); legB.scale.set(0.06, 1.8, 0.06); legB.position.set(0.3, 0.9, 0.35); legB.rotation.x = -0.35; this.group.add(legB);
      const legC = new THREE.Mesh(AD.LIB.cyl, woodMat); legC.scale.set(0.06, 1.8, 0.06); legC.position.set(0, 0.9, -0.35); legC.rotation.x = 0.35; this.group.add(legC);

      const faceMat = new THREE.MeshStandardMaterial({ map: this._faceTexture(), roughness: 0.95 });
      const face = new THREE.Mesh(new THREE.CylinderGeometry(AD.TARGET_RADIUS, AD.TARGET_RADIUS, 0.12, 40), faceMat);
      face.rotation.x = Math.PI / 2;
      face.position.y = 1.35;
      this.group.add(face);
      this.face = face;
      this.center = new THREE.Vector3();
    }
    setPosition(distance) {
      this.group.position.set(0, 0, -distance);
      this.group.updateMatrixWorld(true);
      this.face.getWorldPosition(this.center);
      for (const a of this.stuckArrows) this.group.remove(a);
      this.stuckArrows.length = 0;
    }
    // world point (already known to be ~on the board's Z plane) -> score info
    evaluateHit(worldPoint) {
      const dx = worldPoint.x - this.center.x;
      const dy = worldPoint.y - this.center.y;
      const r = Math.hypot(dx, dy);
      const points = AD.scoreForRadius(r);
      return { points, dx, dy, r, onBoard: r <= AD.TARGET_RADIUS };
    }
    stickArrowVisual(worldPoint, approachDir) {
      const stub = new THREE.Group();
      const shaftMat = new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.7 });
      const fletchMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.8, side: THREE.DoubleSide });
      const shaft = new THREE.Mesh(AD.LIB.cyl, shaftMat); shaft.rotation.x = Math.PI / 2; shaft.scale.set(0.018, 0.018, 0.5); shaft.position.z = 0.15;
      stub.add(shaft);
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(AD.LIB.plane, fletchMat); f.scale.set(0.05, 0.09, 1);
        f.position.z = 0.4; f.rotation.z = (i / 3) * Math.PI * 2; f.rotation.y = Math.PI / 2;
        stub.add(f);
      }
      const invQuat = this.group.quaternion.clone().invert();
      stub.position.copy(this.group.worldToLocal(worldPoint.clone()));
      stub.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), approachDir.clone().normalize().applyQuaternion(invQuat));
      this.group.add(stub);
      this.stuckArrows.push(stub);
      if (this.stuckArrows.length > 9) { const old = this.stuckArrows.shift(); this.group.remove(old); }
    }
  }
  AD.TargetBoard = TargetBoard;
})();
