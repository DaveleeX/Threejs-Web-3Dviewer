import * as THREE from 'three';
import type { Rig } from './rig';
import { SIDES, sideSign } from './rig';
import { DEG, mulberry32, smoothstep } from './util';

// A hummingbird's wings in flight beat far faster than a frame: what you see is
// a translucent smear over the arc they sweep, denser where the wing turns
// round at either end, streaked, never the same two frames running. This is
// that smear: a shallow fan per wing on the chest bone, drawn instead of the
// real blades while the bird flies.

export interface WingBlur {
  /** amount 0 (hidden) … 1, tilt = how far the stroke plane leans (0 level, + = back edge up); call every frame while it shows */
  set(amount: number, tilt?: number): void;
  dispose(): void;
}

export function createWingBlur(rig: Rig): WingBlur {
  const W = rig.species.wing;
  const R = W.hand + W.primaryLen[1] * 0.92;
  const rng = mulberry32(rig.species.seed + 501);
  // streaks: bands along the radius, a few of them sharp (the wing caught for an instant)
  const TW = 64;
  const TH = 4;
  const data = new Uint8Array(TW * TH * 4);
  for (let x = 0; x < TW; x++) {
    const v = 0.45 + 0.55 * Math.pow(rng(), 2.2) + (rng() < 0.12 ? 0.6 : 0);
    for (let y = 0; y < TH; y++) data.set([255, Math.min(255, v * 200), 255, 255], (y * TW + x) * 4);
  }
  const streaks = new THREE.DataTexture(data, TW, TH);
  streaks.wrapS = THREE.RepeatWrapping;
  streaks.magFilter = streaks.minFilter = THREE.LinearFilter;
  streaks.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(W.color).multiplyScalar(1.6),
    alphaMap: streaks,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity: 0,
  });
  const meshes: THREE.Mesh[] = [];
  const chest = rig.rest.chest.worldPos;
  for (const side of SIDES) {
    const sg = sideSign(side);
    const pos: number[] = [];
    const colr: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const NA = 28;
    const NR = 6;
    // three shallow cones: the stroke is not flat, the tip draws a figure of eight
    for (const elev of [-24, -8, 8, 24]) {
      const start = pos.length / 3;
      for (let i = 0; i <= NA; i++) {
        const a = i / NA;
        const phi = (-98 + 172 * a) * DEG; // from behind the back to in front of the breast
        for (let j = 0; j <= NR; j++) {
          const r = j / NR;
          const y = Math.tan(elev * DEG) * r * R * (0.6 + 0.4 * Math.cos((a - 0.5) * Math.PI * 2));
          pos.push(sg * Math.cos(phi) * r * R, y + 0.04 * r, Math.sin(phi) * r * R);
          // thin at the root (the arm barely moves) and off the tip, heavy at both ends of the stroke
          const env = smoothstep(0.05, 0.4, r) * (1 - smoothstep(0.8, 1, r)) * (0.5 + 0.9 * Math.pow(Math.abs(a * 2 - 1), 2.5)) * smoothstep(0, 0.06, a) * (1 - smoothstep(0.94, 1, a));
          colr.push(1, 1, 1, env * (Math.abs(elev) < 10 ? 0.5 : 0.36));
          uv.push(a * 2.2, r);
        }
      }
      for (let i = 0; i < NA; i++) {
        for (let j = 0; j < NR; j++) {
          const p0 = start + i * (NR + 1) + j;
          const p1 = p0 + NR + 1;
          idx.push(p0, p1, p0 + 1, p1, p1 + 1, p0 + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, material);
    m.name = `bird.wingBlur.${side}`;
    m.frustumCulled = false;
    m.visible = false;
    m.renderOrder = 2;
    m.position.copy(rig.rest[`shoulder.${side}`].worldPos).sub(chest);
    rig.bones.chest.add(m);
    meshes.push(m);
  }
  return {
    set(amount, tilt = 0.6) {
      const on = amount > 0.004;
      for (const m of meshes) {
        m.visible = on;
        // the arc itself shivers: no two frames catch the same sweep
        m.rotation.set(tilt + (Math.random() - 0.5) * 0.16, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.12);
      }
      if (!on) return;
      material.opacity = amount * (0.8 + 0.45 * Math.random());
      streaks.offset.x = Math.random();
    },
    dispose() {
      for (const m of meshes) {
        m.removeFromParent();
        m.geometry.dispose();
      }
      material.dispose();
      streaks.dispose();
    },
  };
}

