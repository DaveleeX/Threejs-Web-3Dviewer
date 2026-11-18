import * as THREE from 'three';
import type { Rig } from './rig';
import { SIDES, sideSign } from './rig';
import { buildSkinGeometry } from './plumageGeometry';
import { DEG, lerp, smoothstep } from './util';

// The hard and bare parts: skin under the feathers, bill, eyes, eyelids,
// nictitating membranes, legs and toes. Each is authored in its bone's local
// space and baked to bind space, weighted to that single bone.

class PartBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  constructor(private rig: Rig) {}

  /**
   * Add a geometry authored in `bone` space. `pick` may send a vertex to another bone and
   * `tint` may give it another colour, both from its position in the authoring space.
   */
  add(g: THREE.BufferGeometry, bone: string, color: THREE.Color, pick?: ((p: THREE.Vector3) => string) | null, tint?: (p: THREE.Vector3) => THREE.Color | null) {
    const r = this.rig.rest[bone];
    const m = new THREE.Matrix4().compose(r.worldPos, r.worldQuat, new THREE.Vector3(1, 1, 1));
    const gg = g.index ? g.toNonIndexed() : g.clone();
    const lp = gg.getAttribute('position').clone();
    gg.applyMatrix4(m);
    const p = gg.getAttribute('position');
    const n = gg.getAttribute('normal');
    const uv = gg.getAttribute('uv');
    const start = this.pos.length / 3;
    const bi = this.rig.index(bone);
    const q = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      q.fromBufferAttribute(lp, i);
      const c = tint?.(q) ?? color;
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      this.si.push(pick ? this.rig.index(pick(q)) : bi, 0, 0, 0);
      this.sw.push(1, 0, 0, 0);
      this.idx.push(start + i);
    }
    gg.dispose();
    g.dispose();
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.4, 0), 2.5);
    return g;
  }
}

/** Tube along a path with a per-point radius and an elliptical section. */
function tube(points: THREE.Vector3[], radius: (t: number) => [number, number], up: THREE.Vector3, segs = 10) {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = points.length;
  const T = new THREE.Vector3();
  const X = new THREE.Vector3();
  const Y = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    T.copy(points[Math.min(i + 1, n - 1)]).sub(points[Math.max(i - 1, 0)]).normalize();
    X.crossVectors(up, T).normalize();
    Y.crossVectors(T, X);
    const [rx, ry] = radius(i / (n - 1));
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(
        points[i].x + X.x * Math.cos(a) * rx + Y.x * Math.sin(a) * ry,
        points[i].y + X.y * Math.cos(a) * rx + Y.y * Math.sin(a) * ry,
        points[i].z + X.z * Math.cos(a) * rx + Y.z * Math.sin(a) * ry,
      );
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Patch of a sphere: alpha sweeps around X (0 = +Z, toward +Y), beta is the latitude toward ±X. */
function lidShell(r: number, a0: number, a1: number, beta: number, aboutY = false) {
  const na = 12;
  const nb = 12;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= na; i++) {
    const a = lerp(a0, a1, i / na);
    for (let j = 0; j <= nb; j++) {
      const b = lerp(-beta, beta, j / nb);
      let x = Math.sin(b);
      let y = Math.cos(b) * Math.sin(a);
      const z = Math.cos(b) * Math.cos(a);
      if (aboutY) {
        // same patch, but sweeping around Y (toward +X)
        const t = x;
        x = y;
        y = t;
      }
      pos.push(x * r, y * r, z * r);
      nor.push(x, y, z);
    }
  }
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      const a = i * (nb + 1) + j;
      const b = a + nb + 1;
      if (aboutY) idx.push(a, b, a + 1, b, b + 1, a + 1);
      else idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export interface Parts {
  meshes: THREE.SkinnedMesh[];
  dispose(): void;
}

/** Lid travel, shared with the pose solver. Angles in radians around the eye's X axis. */
export const LID = {
  upperOpen: 62 * DEG,
  lowerOpen: -72 * DEG,
  nictOpen: 150 * DEG,
};

export function buildParts(rig: Rig): Parts {
  const sp = rig.species;
  const R = sp.eye.radius;
  const skinCol = new THREE.Color(sp.skin);
  const up = new THREE.Vector3(0, 1, 0);

  // --- skin: loft + lids + orbital ring + legs ---------------------------------
  const skinB = new PartBuilder(rig);
  // Eye surround. The opening is not round: it is a lemon, long front to back with pointed
  // corners (the one toward the bill sharper), cut in a low raised ring of bare slate skin
  // whose outer edge is beaded with the tiniest feathers. The lids are shells under that
  // ring, so a blink closes along the same lemon.
  const lidCol = new THREE.Color(0x24262b);
  const ringCol = new THREE.Color(0x77777c);
  const beadCol = new THREE.Color(0x08080a);
  for (const side of SIDES) {
    // which way the bill is along the eye's X axis (see buildRig: +X is back on the left eye)
    const front = side === 'L' ? -1 : 1;
    const SEG = 96;
    const RINGS = 7;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    for (let i = 0; i <= SEG; i++) {
      const phi = (i / SEG) * Math.PI * 2;
      const cx = Math.cos(phi);
      const sy = Math.sin(phi);
      // lemon: a superellipse with an exponent under 2, lower still toward the bill
      const pw = cx * front > 0 ? 1.3 : 1.6;
      const inner = 1 / Math.pow(Math.pow(Math.abs(cx) / (43 * DEG), pw) + Math.pow(Math.abs(sy) / (29 * DEG), pw), 1 / pw);
      const outer = 56 * DEG;
      for (let j = 0; j <= RINGS; j++) {
        const t = j / RINGS;
        const th = lerp(inner, outer, t);
        // a rounded lip at the opening, beads along the outer edge of the bare ring
        // only a thin lip at the opening is raised and grey; the rest is face-dark skin lying
        // low, for the face feathers to overlap
        // (the lip is pale grey and wide enough to outline the dark eye against the dark face)
        const lip = Math.pow(Math.sin(Math.PI * Math.min(t / 0.5, 1)), 0.6);
        const bead = Math.max(0, Math.sin(phi * 38)) * smoothstep(0.12, 0.2, t) * (1 - smoothstep(0.22, 0.32, t));
        const r = R * (1.05 + 0.02 * lip + 0.004 * bead - 0.035 * smoothstep(0.5, 1, t));
        pos.push(Math.sin(th) * cx * r, Math.sin(th) * sy * r, Math.cos(th) * r);
        c.copy(ringCol).multiplyScalar(0.55 + 0.5 * lip).lerp(beadCol, Math.max(bead * 0.35, smoothstep(0.4, 0.6, t)));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < RINGS; j++) {
        const a0 = i * (RINGS + 1) + j;
        const b0 = a0 + RINGS + 1;
        idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
      }
    }
    const rim = new THREE.BufferGeometry();
    rim.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rim.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    rim.setIndex(idx);
    rim.computeVertexNormals();
    const flat = rim.toNonIndexed();
    const flatCol = flat.getAttribute('color');
    let k = 0;
    skinB.add(flat, `eye.${side}`, ringCol, null, () => c.fromBufferAttribute(flatCol, k++).clone());
    skinB.add(lidShell(R * 1.04, 12 * DEG, 112 * DEG, 78 * DEG), `lidUpper.${side}`, lidCol);
    skinB.add(lidShell(R * 1.036, -106 * DEG, 16 * DEG, 78 * DEG), `lidLower.${side}`, lidCol);
  }
  // legs
  const legCol = new THREE.Color(sp.legs.color);
  const Rp = sp.legs.perchRadius;
  for (const side of SIDES) {
    const sg = sideSign(side);
    const len = rig.tarsusLength;
    skinB.add(
      tube([0, 0.25, 0.5, 0.75, 1, 1.15].map((t) => new THREE.Vector3(0, 0, t * len)), (t) => [lerp(0.011, 0.017, t), lerp(0.011, 0.017, t)], up, 8),
      `tarsus.${side}`,
      legCol,
    );
    // toes wrap the perch: theta 0 = top, positive forward
    const rt = 0.0085;
    const toe = (i: number, th0: number, th1: number, x0: number, x1: number) => {
      const pts: THREE.Vector3[] = [];
      const N = 14;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const th = lerp(th0, th1, t);
        // the claw hooks in past the pad
        const hook = smoothstep(0.78, 1, t) * 0.012;
        const lift = (1 - smoothstep(0, 0.2, t)) * 0.012;
        const rr = Rp + rt * 0.9 - hook + lift;
        pts.push(new THREE.Vector3(lerp(x0, x1, t), -Rp + rr * Math.cos(th), rr * Math.sin(th)));
      }
      skinB.add(
        tube(pts, (t) => {
          const taper = t > 0.78 ? lerp(0.75, 0.08, (t - 0.78) / 0.22) : 1 + 0.12 * Math.sin(t * 22);
          return [rt * taper, rt * taper * 0.9];
        }, new THREE.Vector3(1, 0, 0), 7),
        `toe.${side}.${i}`,
        // every other toe a shade darker
        legCol.clone().multiplyScalar(1 - (i % 2) * 0.12),
      );
    };
    const fwd = sp.legs.toe / (Rp + rt);
    toe(1, -0.12, fwd * 0.95, 0, -0.03 * sg);
    toe(2, -0.12, fwd * 1.1, 0, 0.002 * sg);
    toe(3, -0.12, fwd * 0.98, 0, 0.034 * sg);
    toe(4, 0.05, -fwd * 0.8, 0, -0.006 * sg);
  }
  const loftGeo = buildSkinGeometry(rig);
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, envMapIntensity: 0.4, side: THREE.DoubleSide });
  // (the body under the feathers: nearly black and dead matte, so wherever the coat parts it reads as the shadow between feathers, not as a surface)
  // (both faces: with the head turned right round to preen, the skin of the neck is wrung like a cloth and shows its inside)
  const loftMat = new THREE.MeshStandardMaterial({ color: skinCol.clone().multiplyScalar(0.5), roughness: 1, envMapIntensity: 0.15, side: THREE.DoubleSide });
  const loftMesh = new THREE.SkinnedMesh(loftGeo, loftMat);
  loftMesh.name = 'bird.skin';
  const bare = new THREE.SkinnedMesh(skinB.build(), skinMat);
  bare.name = 'bird.bare';

  // --- bill ------------------------------------------------------------------------
  const billB = new PartBuilder(rig);
  const B = sp.bill;
  const billCol = new THREE.Color(B.color);
  // Two closed shells, upper on `bill`, lower on `jaw`, meeting along the cutting edge so
  // that shut they read as one slightly decurved needle and open they come apart cleanly.
  // The faces that meet are the mouth: dark, a little red. A web of skin joins them at the
  // gape and stretches as the jaw drops. All authored in bill space.
  const mouthCol = new THREE.Color(0x260e10);
  const taperAt = (tt: number) => lerp(1, 0.17, Math.pow(tt, 0.8)) * (tt > 0.95 ? lerp(1, 0.05, (tt - 0.95) / 0.05) : 1);
  const mandible = (yOff: number, ry: number, rx: number, lenK: number) => {
    const pts: THREE.Vector3[] = [];
    const N = 26;
    for (let k = 0; k <= N; k++) {
      const z = lerp(-0.07, B.length * lenK, k / N);
      const tt = Math.max(z / B.length, 0);
      pts.push(new THREE.Vector3(0, yOff * B.radius * taperAt(tt) - B.droop * tt * tt, z));
    }
    return tube(pts, (t) => {
      const tt = Math.max((t * (B.length * lenK + 0.07) - 0.07) / B.length, 0);
      return [B.radius * rx * taperAt(tt), B.radius * ry * taperAt(tt)];
    }, up, 12);
  };
  /** y of the cutting edge at z, in bill space */
  const seamY = (z: number) => {
    const tt = Math.max(z / B.length, 0);
    return -B.droop * tt * tt;
  };
  billB.add(mandible(0.4, 0.58, 1, 1), 'bill', billCol, null, (p) => (p.y < seamY(p.z) + 0.1 * B.radius * taperAt(Math.max(p.z / B.length, 0)) ? mouthCol : null));
  billB.add(mandible(-0.36, 0.5, 0.9, 0.985), 'bill', billCol, () => 'jaw', (p) => (p.y > seamY(p.z) - 0.1 * B.radius * taperAt(Math.max(p.z / B.length, 0)) ? mouthCol : null));
  // gape web: one quad per side, top edge on the upper mandible, bottom edge on the lower
  for (const sx of [1, -1]) {
    const web = new THREE.BufferGeometry();
    const x0 = sx * B.radius * 0.8;
    const x1 = sx * B.radius * 0.72;
    // (upper edge is nudged up a hair so the two edges can be told apart when binding)
    web.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0.0002, -0.05, x1, 0.0002, 0.09, x0, -0.0002, -0.05, x1, 0.0002, 0.09, x1, -0.0002, 0.09, x0, -0.0002, -0.05], 3));
    web.setAttribute('normal', new THREE.Float32BufferAttribute([sx, 0, 0, sx, 0, 0, sx, 0, 0, sx, 0, 0, sx, 0, 0, sx, 0, 0], 3));
    billB.add(web, 'bill', new THREE.Color(0x060203), (p) => (p.y > 0 ? 'bill' : 'jaw'));
  }
  // tongue: a pale, wet ribbon about as wide as the bill is at its tip, split at the end; lies
  // inside the bill and slides out. Its own mesh: glossy where the bill is matte.
  const tongueB = new PartBuilder(rig);
  {
    const tongueCol = new THREE.Color(0xf3d3d2);
    const z0 = 0.04;
    const z1 = B.length * 0.8;
    const seg = (p: THREE.Vector3) => (p.z < B.length * 0.5 ? 'tongue.1' : p.z < B.length * 0.7 ? 'tongue.2' : 'tongue.3');
    const line = (xa: number, xb: number, za: number, zb: number) => {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 14; k++) {
        const z = lerp(za, zb, k / 14);
        const tt = z / B.length;
        // (the last quarter sags a little: hidden inside the lower mandible at rest, a soft droop when out)
        const sag = Math.max((tt - 0.55) / 0.25, 0);
        pts.push(new THREE.Vector3(lerp(xa, xb, k / 14), -0.0008 * (1 - tt * 0.7) - B.droop * tt * tt - 0.0028 * sag * sag, z));
      }
      return pts;
    };
    tongueB.add(tube(line(0, 0, z0, z1 - 0.012), (t) => [lerp(0.0036, 0.0027, t), lerp(0.0024, 0.002, t)], up, 8), 'bill', tongueCol, seg);
    // the two rounded lobes of the tip
    for (const sx of [1, -1]) {
      tongueB.add(tube(line(sx * 0.0011, sx * 0.0015, z1 - 0.02, z1), (t) => [0.0015 * Math.sqrt(1 - t * t * 0.92), 0.0014 * Math.sqrt(1 - t * t * 0.92)], up, 6), 'bill', tongueCol, seg);
    }
  }
  const tongueMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: 0xffe4e0, emissive: 0x4a3634, envMapIntensity: 1.1, side: THREE.DoubleSide });
  const tongue = new THREE.SkinnedMesh(tongueB.build(), tongueMat);
  tongue.name = 'bird.tongue';
  const billMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.68, envMapIntensity: 0.35, side: THREE.DoubleSide });
  const bill = new THREE.SkinnedMesh(billB.build(), billMat);
  bill.name = 'bird.bill';

  // --- eyes ------------------------------------------------------------------------
  const eyeB = new PartBuilder(rig);
  for (const side of SIDES) {
    const g = new THREE.SphereGeometry(R, 40, 28);
    g.rotateX(Math.PI / 2); // pole on +Z, the eye's outward axis
    // cornea bulge
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i) / R;
      const k = 1 + 0.028 * smoothstep(0.55, 1, z);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    // uv.x = cos of the angle from the eye axis, for the iris
    const uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) / R, 0);
    eyeB.add(g, `eye.${side}`, new THREE.Color(1, 1, 1));
  }
  const eyeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.35,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.1,
    specularIntensity: 0.12,
    ior: 1.4,
  });
  eyeMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vEyeCos;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvEyeCos = uv.x;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEyeCos;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
{
  // a near-black eye: pupil, a very dark umber iris you only catch in strong light, dark limbus
  float iris = smoothstep(0.93, 0.86, vEyeCos) * smoothstep(0.55, 0.7, vEyeCos);
  diffuseColor.rgb = mix(vec3(0.0006, 0.0007, 0.0012), vec3(0.003, 0.0035, 0.006), iris);
}`,
      )
      .replace(
        '#include <aomap_fragment>',
        /* glsl */ `#include <aomap_fragment>
{
  // What a wet black eye shows is the world: mostly the environment map, plus the canopy
  // overhead as a few pale irregular gaps of sky between leaves (the env map is too soft to
  // carry those), bent by the cornea. No painted catchlight.
  vec3 R = reflect(-geometryViewDir, normal);
  vec3 Rw = normalize((vec4(R, 0.0) * viewMatrix).xyz);
  vec2 q = Rw.xz / (Rw.y + 0.45) * 2.6 + vec2(1.7, 0.4);
  vec2 qi = floor(q), qf = fract(q);
  float gaps = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 h = fract(sin(vec2(dot(qi + g, vec2(127.1, 311.7)), dot(qi + g, vec2(269.5, 183.3)))) * 43758.5453);
    vec2 d = (g + h - qf) * vec2(1.0, 0.6 + 0.8 * h.y);
    gaps = max(gaps, (1.0 - smoothstep(0.08, 0.3 * h.x + 0.12, length(d))) * step(0.45, h.x));
  }
  float up = smoothstep(0.15, 0.6, Rw.y);
  totalEmissiveRadiance += vec3(0.8, 0.95, 0.85) * gaps * up * 0.55;
  // a mirror-sharp highlight of the sun is thousands of nits on one pixel; a depth-of-field
  // pass turns that into a dotted disc. Keep the glints bright but finite.
  reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(1.6));
  #ifdef USE_CLEARCOAT
  clearcoatSpecularDirect = min(clearcoatSpecularDirect, vec3(2.2));
  clearcoatSpecularIndirect = min(clearcoatSpecularIndirect, vec3(2.2));
  #endif
}`,
      );
  };
  const eyes = new THREE.SkinnedMesh(eyeB.build(), eyeMaterial);
  eyes.name = 'bird.eyes';

  // --- nictitating membranes ---------------------------------------------------
  const nictB = new PartBuilder(rig);
  for (const side of SIDES) nictB.add(lidShell(R * 1.045, -100 * DEG, 100 * DEG, 80 * DEG, true), `nict.${side}`, new THREE.Color(0x8ea4c8));
  const nictMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.45, transparent: true, opacity: 0.3, clearcoat: 0.2, side: THREE.DoubleSide, depthWrite: false });
  const nict = new THREE.SkinnedMesh(nictB.build(), nictMat);
  nict.name = 'bird.nict';
  nict.renderOrder = 2;

  const meshes = [loftMesh, bare, bill, tongue, eyes, nict];
  for (const m of meshes) {
    m.frustumCulled = false;
    m.bind(rig.skeleton, new THREE.Matrix4());
  }
  loftMesh.castShadow = true;
  bill.castShadow = true;
  bare.castShadow = true;
  bare.receiveShadow = true;
  bill.receiveShadow = true;
  return {
    meshes,
    dispose() {
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
  };
}

