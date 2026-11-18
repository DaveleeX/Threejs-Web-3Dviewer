import * as THREE from 'three';
import type { FeatherLook, Region, Species } from './species';
import type { Rig, Side } from './rig';
import { SIDES, sideSign } from './rig';
import type { SurfacePoint } from './loft';
import { clamp, DEG, lerp, mulberry32, noise1, type Rng, smoothstep } from './util';

// All feathers are real geometry: small cupped cards for the contour feathers
// and scales, long blades for remiges and rectrices. They are merged into
// skinned buffers; every vertex knows its feather's root and hinge so the
// vertex shader can lift the feather off the skin (ruffle) before skinning.

export const CH_NONE = 0;
export const CH_GORGET = 1;
export const CH_CROWN = 2;
export const CH_FLIGHT = 3;
export const CH_FUZZ = 4;
// wing ids, stored in the body-coordinate slot (anything above 1 samples the lift profile at its end)
export const WING_REST_L = 2;
export const WING_REST_R = 3;
export const WING_REAL_L = 4;
export const WING_REAL_R = 5;

export interface FeatherSpec {
  root: THREE.Vector3;
  /** unit shaft direction, unit feather normal */
  dir: THREE.Vector3;
  normal: THREE.Vector3;
  /** normal of whatever it lies on, for soft shading; null = use its own */
  skinNormal: THREE.Vector3 | null;
  iriNormal: THREE.Vector3;
  width: number;
  length: number;
  cols: number;
  rows: number;
  round: number;
  cup: number;
  curl: number;
  /** vane asymmetry -1…1 (flight feathers) */
  asym: number;
  /** blades: how far along the vane reaches full width (default 0.12) */
  widen?: number;
  /** a scallop: square at the root, a true semicircle at the free edge (show scales) */
  scallop?: boolean;
  base: THREE.Color;
  tip: THREE.Color;
  iri: THREE.Color;
  iri2: THREE.Color;
  iriStrength: number;
  iriPower: number;
  /** 0 crisp vane … 1 down */
  loose: number;
  /** fraction of the length hidden under the row above */
  cover: number;
  bones: [number, number, number, number];
  weights: [number, number, number, number];
  /**
   * Bind every vertex where it lies instead of the whole feather at its root: the feather
   * then bends and slides with the skin under it (the gorget, on a throat that folds).
   */
  skinAt?: (p: THREE.Vector3) => { bones: [number, number, number, number]; weights: [number, number, number, number] };
  rand: number;
  coord: number;
  gain: number;
  channel: number;
}

export class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  root: number[] = [];
  hinge: number[] = [];
  data: number[] = [];
  iriN: number[] = [];
  cBase: number[] = [];
  cTip: number[] = [];
  cIri: number[] = [];
  cIri2: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  private S = new THREE.Vector3();
  private H = new THREE.Vector3();
  private P = new THREE.Vector3();
  private Nv = new THREE.Vector3();
  private In = new THREE.Vector3();

  add(f: FeatherSpec) {
    const { cols, rows } = f;
    const S = this.S.crossVectors(f.normal, f.dir).normalize(); // across the vane
    const H = this.H.crossVectors(f.dir, f.normal).normalize(); // +angle lifts the tip
    const start = this.pos.length / 3;
    const hw = f.width / 2;
    for (let r = 0; r < rows; r++) {
      const last = r === rows - 1;
      // short cards: quill, widest point, shoulder of the tip, tip. Blades: evenly spaced.
      const v = f.scallop ? r / (rows - 1) : rows === 4 ? [0, 0.5, 0.82, 0.965][r] : Math.pow(r / (rows - 1), 0.9);
      // outline: narrow quill, widest at the middle, then a superellipse closes the tip
      const pw = lerp(1.25, 2.1, f.round);
      const tipT = clamp((v - 0.5) / 0.5, 0, 1);
      const close = Math.pow(Math.max(1 - Math.pow(tipT, pw), 0), 1 / pw);
      const prof = f.scallop ? 1 : rows === 4 ? lerp(0.5, 1, smoothstep(0, 0.5, v)) * close : lerp(0.4, 1, smoothstep(0, f.widen ?? 0.12, v)) * (last ? 0.42 : Math.pow(Math.max(1 - Math.pow(clamp((v - 0.8) / 0.2, 0, 1), 2.2), 0), 0.45));
      for (let c = 0; c < cols; c++) {
        const u = cols === 1 ? 0 : (c / (cols - 1)) * 2 - 1;
        const side = u < 0 ? 1 - f.asym : 1 + f.asym;
        let x = u * hw * prof * side;
        // the tip row bows forward so the outline reads round
        const vv = last && !f.scallop ? v + (1 - v) * (1 - u * u) : v;
        let along = vv * f.length;
        if (f.scallop) {
          // lower half a slightly waisted rectangle, upper half swept into a semicircle whose
          // rim is the last row: the rows above the middle slide from one to the other
          const k = clamp((v - 0.5) / 0.5, 0, 1);
          const al = (u * Math.PI) / 2;
          x = lerp(u * hw * lerp(0.72, 1, Math.min(v / 0.5, 1)), Math.sin(al) * hw, k);
          along = lerp(Math.min(v, 0.5) * f.length, 0.5 * f.length + Math.cos(al) * 0.5 * f.length, k);
        }
        const drop = f.cup * hw * (u * prof) * (u * prof) + f.curl * f.length * vv * vv;
        this.P.copy(f.root).addScaledVector(S, x).addScaledVector(f.dir, along).addScaledVector(f.normal, -drop);
        this.Nv.copy(f.normal).addScaledVector(S, 2 * f.cup * u * prof).addScaledVector(f.dir, 2 * f.curl * vv);
        // the platelet normal follows the curl of the vane, so a scale shades as a little dome
        this.In.copy(f.iriNormal).addScaledVector(S, 0.3 * f.cup * u * prof).addScaledVector(f.dir, 0.1 * (vv - 0.6)).normalize();
        // soft feathers shade as one coat, not as separate plates
        if (f.skinNormal) this.Nv.normalize().lerp(f.skinNormal, lerp(0.45, 0.8, Math.min(f.loose * 2, 1)));
        this.Nv.normalize();
        this.pos.push(this.P.x, this.P.y, this.P.z);
        this.nor.push(this.Nv.x, this.Nv.y, this.Nv.z);
        // scallops carry their true shape in uv (the shader draws the ridges and the rim from it)
        if (f.scallop) this.uv.push(x / hw, along / f.length);
        else this.uv.push(u, vv);
        this.root.push(f.root.x, f.root.y, f.root.z);
        this.hinge.push(H.x, H.y, H.z);
        this.data.push(f.rand, f.coord, f.gain, f.channel);
        this.iriN.push(this.In.x, this.In.y, this.In.z);
        this.cBase.push(f.base.r, f.base.g, f.base.b, f.iriStrength / 4);
        this.cTip.push(f.tip.r, f.tip.g, f.tip.b, f.loose);
        this.cIri.push(f.iri.r, f.iri.g, f.iri.b, f.iriPower / 32);
        this.cIri2.push(f.iri2.r, f.iri2.g, f.iri2.b, f.cover);
        const sk = f.skinAt ? f.skinAt(this.P) : f;
        this.si.push(...sk.bones);
        this.sw.push(...sk.weights);
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = start + r * cols + c;
        const b = a + cols;
        this.idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    const f32 = (a: number[], n: number) => new THREE.BufferAttribute(new Float32Array(a), n);
    const u16n = (a: number[], n: number) => {
      const arr = new Uint16Array(a.length);
      for (let i = 0; i < a.length; i++) arr[i] = Math.round(clamp(a[i], 0, 1) * 65535);
      return new THREE.BufferAttribute(arr, n, true);
    };
    const i16n = (a: number[], n: number) => {
      const arr = new Int16Array(a.length);
      for (let i = 0; i < a.length; i++) arr[i] = Math.round(clamp(a[i], -1, 1) * 32767);
      return new THREE.BufferAttribute(arr, n, true);
    };
    g.setAttribute('position', f32(this.pos, 3));
    g.setAttribute('normal', i16n(this.nor, 3));
    g.setAttribute('uv', f32(this.uv, 2));
    g.setAttribute('aRoot', f32(this.root, 3));
    g.setAttribute('aHinge', i16n(this.hinge, 3));
    g.setAttribute('aData', f32(this.data, 4));
    g.setAttribute('aIriN', i16n(this.iriN, 3));
    g.setAttribute('aBase', u16n(this.cBase, 4));
    g.setAttribute('aTip', u16n(this.cTip, 4));
    g.setAttribute('aIri', u16n(this.cIri, 4));
    g.setAttribute('aIri2', u16n(this.cIri2, 4));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(this.si), 4));
    g.setAttribute('skinWeight', u16n(this.sw, 4));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.4, -0.1), 2.5);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-2, -2, -2), new THREE.Vector3(2, 3, 2));
    return g;
  }
}

function inRegion(r: Region, s: number, phi: number, rnd: number) {
  if (r.kind === 'band') {
    const sj = s + (r.soft ?? 0) * (rnd * 2 - 1);
    return sj >= r.s[0] && sj <= r.s[1] && phi >= r.phi[0] && phi <= r.phi[1];
  }
  if (r.kind === 'blob') {
    const a = (s - r.at[0]) / r.r[0];
    const b = (phi - r.at[1]) / r.r[1];
    const e = r.pow ?? 2;
    // a soft blob thins out toward its rim instead of ending
    return Math.pow(Math.abs(a), e) + Math.pow(Math.abs(b), e) <= 1 + (r.soft ?? 0) * (rnd * 2 - 1);
  }
  // capsule, measured in units of its radii
  const ax = r.from[0] / r.r[0];
  const ay = r.from[1] / r.r[1];
  const bx = r.to[0] / r.r[0];
  const by = r.to[1] / r.r[1];
  const px = s / r.r[0];
  const py = phi / r.r[1];
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - ax - dx * t, py - ay - dy * t) <= 1;
}

/** rnd in 0…1 decides soft tract borders; 0.5 gives the nominal outline. */
export function lookAt(species: Species, s: number, phi: number, rnd = 0.5): FeatherLook {
  let name = 'body';
  for (const t of species.tracts) if (inRegion(t.region, s, phi, rnd)) name = t.look;
  return species.looks[name];
}

const col = (hex: number) => new THREE.Color(hex);

/** bone names (Loft.skin) to skeleton indices */
const skinIdx = (rig: Rig, bones: readonly string[]) => bones.map((nm) => rig.index(nm)) as [number, number, number, number];

const aimV = new THREE.Vector3();
/** Platelet normal: n pulled toward the look's aim, plus per-feather noise when rng is given. */
function iriNormal(out: THREE.Vector3, n: THREE.Vector3, look: FeatherLook, rng?: Rng) {
  out.copy(n);
  if (look.iriAim) out.lerp(aimV.set(look.iriAim[0], look.iriAim[1], look.iriAim[2]).normalize(), look.iriAlign).normalize();
  if (!rng) return out;
  out.x += (rng() - 0.5) * look.jitter;
  out.y += (rng() - 0.5) * look.jitter;
  out.z += (rng() - 0.5) * look.jitter;
  return out.normalize();
}

/** The folded wing stands a little off the body: the coat just under its leading edge (and a touch behind it) sits in its shadow. */
function wingShadow(loft: Rig['loft'], s: number, a: number) {
  const { u, v } = loft.wingUV(s, a);
  if (u < 0.08 || u > 1.05) return 1;
  const along = smoothstep(0.08, 0.3, u) * (1 - smoothstep(0.9, 1.05, u));
  const under = smoothstep(-2.0, -1.05, v) * (1 - smoothstep(-0.75, -0.55, v));
  const behind = smoothstep(1.6, 1.0, v) * (1 - smoothstep(0.7, 0.9, -v + 1.6));
  return 1 - along * Math.max(0.62 * under, v > 0.8 ? 0.25 * behind : 0);
}

/** Pigment value, gold wash and glitter strength at a point of the coat. */
function toneAt(species: Species, look: FeatherLook, sj: number, phi: number) {
  // value: darker down the flanks and under the body, with slow mottling over it all
  const sh = species.shading;
  let shade = 1 + sh.patch * (0.6 * noise1(sj * 2.7, 5) + 0.6 * noise1(phi * 8 + sj * 1.3, 6));
  let gold = 0;
  // glitter comes in patches: whole clumps of feathers catch the light, their neighbours stay dark
  const glit = look.fine ? 1 : lerp(0.12, 1.7, smoothstep(-0.25, 0.45, 0.7 * noise1(sj * 6.1 + phi * 9, 41) + 0.6 * noise1(phi * 21 - sj * 3.3, 42)));
  if (!look.fine) {
    gold = look.iriStrength > 0 && sj < 6 ? smoothstep(0.05, 0.6, 0.7 * noise1(sj * 3.4 + phi * 5, 31) + 0.5 * noise1(phi * 13 - sj * 2, 32)) * sh.goldAmount : 0;
    const body = 1 - smoothstep(4.6, 5.6, sj);
    shade *= lerp(1, sh.flank, body * smoothstep(0.2, 0.55, phi) * (1 - smoothstep(0.72, 0.95, phi)));
    shade *= lerp(1, sh.under, smoothstep(2.6, 0.5, sj) * (1 - smoothstep(0.4, 0.7, phi)));
  }
  return { shade, gold, glit };
}

export function specFromLook(look: FeatherLook, rng: Rng, shade = 1, gold = 0, goldHex = 0x6a6420, glit = 1) {
  const j = (0.8 + rng() * 0.4) * shade;
  const iri = col(look.iri).lerp(col(look.iriGraze), rng() * rng() * 0.45);
  return {
    base: col(look.base).multiplyScalar(j),
    tip: col(look.tip).lerp(col(goldHex), gold * rng()).multiplyScalar(j),
    iri,
    iri2: col(look.iriGraze),
    iriStrength: look.iriStrength * lerp(0.75 + rng() * 0.5, 2.6 * Math.pow(rng(), 2.5), look.sparkle ?? 0) * (1 + gold * 1.5) * glit,
    iriPower: look.iriPower * (0.8 + rng() * 0.5),
    loose: look.loose ?? 0,
    round: look.round,
    cup: look.cup,
    channel: look.channel === 'gorget' ? CH_GORGET : look.channel === 'crown' ? CH_CROWN : CH_NONE,
  };
}

const sheetS = new THREE.Vector3();
const sheetA = new THREE.Vector3();
const sheetD = new THREE.Vector3();
/**
 * On the throat sheet (Loft.skin) a feather is bound vertex by vertex, each where it lies on
 * the skin, not as a whole at its root: when the head comes down the sheet shortens and
 * everything on it shortens with it, rows closing up over each other in the order they lie
 * in. No scale turns into the ones below it, lifts off them or sinks under the next tract.
 * Returns nothing off the sheet.
 */
function sheetSkin(rig: Rig, s: number, a: number, root: THREE.Vector3): FeatherSpec['skinAt'] {
  const { loft } = rig;
  if (s < loft.species.throat[0] - 1.1 || Math.cos(a) < -0.5) return undefined;
  const s1 = Math.min(s + 0.02, loft.sMax);
  loft.point(s1, a, sheetS).sub(loft.point(s - 0.02, a, sheetD)).multiplyScalar(1 / (s1 - s + 0.02));
  loft.point(s, a + 0.02, sheetA).sub(loft.point(s, a - 0.02, sheetD)).multiplyScalar(1 / 0.04);
  const dS = sheetS.clone().multiplyScalar(1 / sheetS.lengthSq());
  const dA = sheetA.clone().multiplyScalar(1 / sheetA.lengthSq());
  const from = root.clone();
  const up = sheetS.clone().normalize();
  const l0 = loft.frontLength(s);
  return (p) => {
    sheetD.copy(p).sub(from);
    // how far along the body the vertex is from the root: by the skin here or, where the
    // sections crowd together (under the chin), by plain distance down the throat
    const here = sheetD.dot(dS);
    const plain = loft.frontAt(l0 + sheetD.dot(up)) - s;
    const sk = loft.skin(clamp(s + (Math.abs(plain) < Math.abs(here) ? plain : here), 0, loft.sMax), a + sheetD.dot(dA));
    return { bones: skinIdx(rig, sk.bones), weights: sk.weights };
  };
}

/**
 * Contour feathers and scales over the whole loft.
 *
 * Rows are not loft rings. Walking from the bill to the tail in fine steps, every
 * direction around the body keeps its own odometer and starts a new row each time
 * it has travelled one row pitch of whatever tract it is in. Row r is then the
 * closed curve through every direction's r-th mark: a line of equal "feathers
 * from the bill". Rows stay evenly spaced on both the inside and the outside of
 * the neck's bend, and big body feathers come round less often than small face
 * feathers. Each row is then walked sideways from the belly line, both ways,
 * dropping a feather every feather-pitch, odd rows half a pitch off: bricks,
 * exact on the throat and breast where it shows, drifting gently toward the back.
 */
function addContour(b: Builder, rig: Rig, rng: Rng) {
  const { loft, species } = rig;
  const sfc: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
  const sfc2: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
  const skinN = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const iriN = new THREE.Vector3();
  const root = new THREE.Vector3();
  const eyeR = species.eye.radius;
  const TAU = Math.PI * 2;
  const phiOf = (ang: number) => {
    const a = ((ang % TAU) + TAU) % TAU;
    return a <= Math.PI ? a / Math.PI : (TAU - a) / Math.PI;
  };
  /** look and graded width at a point of the loft */
  const sizeAt = (s: number, phi: number, rnd = 0.5) => {
    const look = lookAt(species, s, phi, rnd);
    let width = look.width;
    if (!look.fine) {
      // plain contour feathers grade in size across tract borders; show scales keep theirs
      const la = lookAt(species, s - 0.45, phi);
      const lb = lookAt(species, s + 0.45, phi);
      width = (width * 2 + (la.fine ? width : la.width) + (lb.fine ? width : lb.width)) / 4;
    }
    return { look, width };
  };

  // --- pass 1: odometers. rowS[r][bin] = the s at which direction `bin` starts its r-th row
  const BINS = 240;
  const COARSE = 40;
  const acc = new Float32Array(BINS).fill(1); // everything is due a first row at the bill
  const count = new Uint16Array(BINS);
  const rowS: Float32Array[] = [];
  const cS = new Float32Array(COARSE + 1);
  const FINE = 0.001; // travel per step on the fastest side
  let s = loft.sMax - 0.015;
  while (s > 0.03) {
    let maxS = 0;
    for (let k = 0; k <= COARSE; k++) {
      const a = (k / COARSE) * TAU;
      cS[k] = loft.point(Math.min(s + 0.01, loft.sMax), a, tmpA).distanceTo(loft.point(s - 0.01, a, tmpB)) / 0.02;
      maxS = Math.max(maxS, cS[k]);
    }
    const ds = FINE / maxS;
    for (let i = 0; i < BINS; i++) {
      const f = (i / BINS) * COARSE;
      const k = Math.min(Math.floor(f), COARSE - 1);
      const { look, width } = sizeAt(s, phiOf((i / BINS) * TAU));
      const pitch = width * look.aspect * look.rowStep;
      acc[i] += lerp(cS[k], cS[k + 1], f - k) * ds;
      if (acc[i] >= pitch) {
        acc[i] = Math.min(acc[i] - pitch, pitch * 0.5);
        const r = count[i]++;
        (rowS[r] ??= new Float32Array(BINS).fill(NaN))[i] = s;
      }
    }
    s -= ds;
  }

  // --- pass 2: walk each row sideways from the belly line and plant feathers
  const P0 = new THREE.Vector3();
  const P1 = new THREE.Vector3();
  const plant = (sj: number, a: number) => {
    loft.surface(sj, a, sfc);
    for (const side of SIDES) if (sfc.p.distanceTo(rig.eyes[side].center) < eyeR * 1.02) return;
    // the folded wings are feathered separately (addRestWing); the coat stops at their edge
    const wuv = loft.wingUV(sj, a);
    // (but flank fluff drapes over its bend: soft feathers spill onto the leading edge near the wrist)
    const inWing = wuv.u > 0.04 && wuv.u < 0.97 && Math.abs(wuv.v) < 0.9;
    const drape = inWing && wuv.v < -0.3 && wuv.u < 0.5 && 0.5 + 0.5 * noise1(sj * 53 + a * 91, 77) < 0.75 * smoothstep(-0.3, -0.75, wuv.v) * (1 - smoothstep(0.32, 0.5, wuv.u));
    if (inWing && !drape) return;
    // ragged tract borders: look the feather itself up with a little jitter
    const phi = phiOf(a);
    const sized = sizeAt(sj + (rng() - 0.5) * 0.06, clamp(phi + (rng() - 0.5) * 0.012, 0, 1), rng());
    const width = sized.width;
    // the haircut: on the top and back of the head the dark feathers do not lie on the skull,
    // they stand up and back, uneven, with the crown scales glinting underneath. Strongest
    // on the hind crown, fading toward the forehead, the nape and down over the eye.
    // A gradient from front to back: flat and sleek on the forehead, rising steadily through
    // the crown, steepest and most ragged at the top-back, then lying down again on the nape.
    const rise = Math.pow(1 - smoothstep(7.1, 9.0, sj), 1.4);
    const hair = smoothstep(0.56, 0.86, phi) * rise * smoothstep(6.25, 7.0, sj);
    const sleek = smoothstep(0.5, 0.8, phi) * smoothstep(8.5, 9.2, sj);
    // so half of what would be crown scales up there are dark standing feathers instead
    const look = drape ? species.looks.flank : sized.look === species.looks.crown && sj < 8.5 && rng() < 0.5 * smoothstep(0.7, 0.9, phi) ? species.looks.head : sized.look;
    const standing = look.fine ? 0 : hair;
    // and nothing up there is regular: rows broken by gaps, clumps that lean together
    const unruly = look.fine || look === species.looks.stripe ? 0 : smoothstep(6.0, 6.7, sj) * smoothstep(0.35, 0.6, phi) * (0.35 + 0.65 * rise);
    const clump = noise1(sj * 11 + phi * 37, 51);
    if (unruly > 0 && clump > 0.45 && rng() < 0.4 * unruly) return;
    // the gorget is laid out on its own, in arcs around the chin (addGorget)
    if (look === species.looks.gorget) return;
    // and nothing beside it leans in over its edge: the feathers right along its sides are left
    // out, the next ones lie flat, so no green shows inside the purple
    const G = species.looks.gorget;
    const beside = sj > 4.6 && sj < 8.2 && phi < 0.5 ? (lookAt(species, sj, Math.max(phi - 0.035, 0)) === G ? 2 : lookAt(species, sj, Math.max(phi - 0.08, 0)) === G ? 1 : 0) : 0;
    if (beside === 2) return;
    // nor does anything under its lower rim stand up through it: the collar feathers the last
    // rows of scales lie on are pressed flat
    const under = beside === 0 && sj > 4.2 && sj < 5.6 && phi < 0.4 && lookAt(species, sj + 0.5, phi) === G;
    const sh = species.shading;
    const tone = toneAt(species, look, sj, phi);
    const { gold, glit } = tone;
    const shade = tone.shade * wingShadow(loft, sj, a);
    // tousle: every soft feather is a little off in length, lie and twist, and whole
    // patches lean together (slow noise), so there are clumps and partings
    const loose = look.loose ?? 0;
    const nA = noise1(sj * 4.3 + phi * 17, 21);
    const nB = noise1(sj * 3.1 - phi * 23, 22);
    const size = 1 + (rng() - 0.5) * lerp(0.26, 0.65, loose);
    const len = width * look.aspect * size * (1 + standing * (0.3 + 1.3 * rng() * rng()) + unruly * (rng() - 0.5) * 0.5);
    // a few strays per hundred stand off the coat at an odd angle
    const stray = rng() < 0.035 * loose + 0.14 * standing ? 1 : 0;
    let tilt = (look.tilt + (rng() - 0.5) * lerp(6, 17, loose) + nB * 7 * loose + stray * (8 + rng() * 10)) * DEG;
    const yaw = (rng() - 0.5) * lerp(0.17, 0.72, loose) + nA * 0.4 * loose + stray * (rng() - 0.5) * 0.9 + ((rng() - 0.5) * 0.9 + clump * 0.45) * unruly;
    const roll = ((rng() - 0.5) * 0.7 + nB * 0.3) * loose + ((rng() - 0.5) * 1.1 + clump * 0.5) * unruly;
    // right beside the folded wing the coat lies closer, so the wing is not sunk in a trench
    if (beside || under) tilt *= 0.35;
    if (drape) tilt += 9 * DEG;
    else if (wuv.u > 0 && wuv.u < 1 && Math.abs(wuv.v) < 1.7 && !stray) {
      const near = 1 - smoothstep(0.9, 1.7, Math.abs(wuv.v));
      tilt *= 1 - 0.6 * near;
    }
    let gain = look.lift + standing * 0.9;
    tilt = tilt * (1 - 0.55 * sleek) + standing * (14 + 30 * rng() * rng() + 9 * clump) * DEG;
    // lay the feather along the skin: aim it at the surface point under its tip, raised by the
    // tilt, so it rides over bulges and bridges hollows instead of cutting through them
    const local = loft.point(Math.min(sj + 0.01, loft.sMax), a, tmpA).distanceTo(loft.point(Math.max(sj - 0.01, 0), a, tmpB)) / 0.02;
    root.copy(sfc.p);
    skinN.copy(sfc.n);
    loft.surface(Math.max(sj - (len * 0.85) / Math.max(local, 0.02), 0), a, sfc2);
    dir.copy(sfc2.p).addScaledVector(sfc2.n, len * Math.sin(tilt)).sub(root);
    if (dir.lengthSq() < 1e-8) dir.copy(sfc.t);
    dir.normalize();
    nrm.copy(skinN).add(sfc2.n).addScaledVector(dir, -skinN.dot(dir) - sfc2.n.dot(dir)).normalize();
    dir.applyAxisAngle(nrm, yaw);
    nrm.applyAxisAngle(dir, roll);

    // platelet normal: skin-following, pulled toward the tract's aim, plus per-feather noise
    iriNormal(iriN, nrm, look, rng);

    const sk = loft.skin(sj, a);
    b.add({
      ...specFromLook(look, rng, shade, gold, sh.gold, glit),
      root,
      dir,
      normal: nrm,
      skinNormal: skinN,
      iriNormal: iriN,
      width: width * size,
      length: len,
      cols: look.fine ? 5 : 3,
      rows: 4,
      curl: lerp(0.1, 0.02 + rng() * 0.22, loose),
      asym: 0,
      bones: skinIdx(rig, sk.bones),
      weights: sk.weights,
      skinAt: sheetSkin(rig, sj, a, root),
      rand: rng(),
      coord: loft.bodyCoord(sj) * 0.8,
      gain,
      cover: clamp(1 - look.rowStep, 0.1, 0.9),
    });
  };

  for (let r = 0; r < rowS.length; r++) {
    const row = rowS[r];
    for (const sign of [1, -1]) {
      // q counts feather pitches along the row; a feather drops at every whole number
      let q = r & 1 ? 0.5 : sign > 0 ? 1 : 0;
      let broken = false;
      for (let i = 0; i < BINS / 2; i++) {
        const b0 = (((sign * i) % BINS) + BINS) % BINS;
        const b1 = (((sign * (i + 1)) % BINS) + BINS) % BINS;
        const s0 = row[b0];
        const s1 = row[b1];
        if (Number.isNaN(s0) || Number.isNaN(s1)) {
          broken = true;
          continue;
        }
        if (broken) {
          q = rng(); // a row fragment starts on its own phase
          broken = false;
        }
        const a0 = (sign * i * TAU) / BINS;
        const a1 = (sign * (i + 1) * TAU) / BINS;
        loft.point(s0, a0, P0);
        loft.point(s1, a1, P1);
        const { look, width } = sizeAt((s0 + s1) / 2, phiOf((a0 + a1) / 2));
        const span = P0.distanceTo(P1) / (width * (look.spacing ?? 0.6));
        // feathers falling inside this span
        while (q + span >= 1) {
          const f = (1 - q) / span;
          const jitterS = ((rng() - 0.5) * 0.25 * width * look.aspect * look.rowStep) / 0.11;
          const lj = lerp(0.12, 0.5, look.loose ?? 0) * (look.fine ? 1 : 1 + 1.8 * smoothstep(6.0, 6.7, (s0 + s1) / 2));
          plant(clamp(lerp(s0, s1, f) + jitterS * (1 + 2 * (look.loose ?? 0)), 0.02, loft.sMax), lerp(a0, a1, f) + ((rng() - 0.5) * lj * width) / 0.15);
          q -= 1;
        }
        q += span;
      }
    }
  }
}

/**
 * The gorget. Its scales are not on the body's rows: they lie in concentric arcs around
 * the chin, like fish scales radiating from the base of the bill, each pointing straight
 * away from that centre, small at the chin and growing toward the rim, where the last arc
 * makes the gorget's scalloped lower edge. Hue runs with the same distance: indigo at the
 * chin, the look's own violet through the middle, magenta at the rim.
 */
function addGorget(b: Builder, rig: Rig, rng: Rng) {
  const { loft, species } = rig;
  const look = species.looks.gorget;
  if (!look) return;
  const sfc: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
  // the centre: under the base of the bill
  // Sample the tract and give every sample polar coordinates about the chin, measured on
  // the throat unrolled flat: distance down the midline from the chin, and distance round
  // the neck from the midline. (Straight-line distances fold where the chin turns under.)
  interface Sample { s: number; a: number; x: number; y: number }
  const samples: Sample[] = [];
  const d = new THREE.Vector3();
  const e = new THREE.Vector3();
  // the arcs' centre sits a little above the top of the tract, on the midline, so the arcs
  // cross the throat as shallow bows instead of closing into rings round the chin
  let sTop = loft.sMax;
  while (sTop > 4.3 && lookAt(species, sTop, 0) !== look) sTop -= 0.02;
  const sC = Math.min(sTop + 0.5, loft.sMax - 0.3);
  let rhoMax = 0;
  let rhoMin = Infinity;
  const DS = 0.02;
  const DA = 0.02;
  // distance down the midline, by section
  const downAt = new Map<number, number>();
  {
    let acc = 0;
    for (let i = 0; ; i++) {
      const s = sC - i * DS;
      if (s < 4.3) break;
      if (i > 0) acc += loft.point(s, 0, d).distanceTo(loft.point(s + DS, 0, e));
      downAt.set(i, acc);
    }
    acc = 0;
    for (let i = -1; ; i--) {
      const s = sC - i * DS;
      if (s > loft.sMax - 0.05) break;
      acc -= loft.point(s, 0, d).distanceTo(loft.point(s - DS, 0, e));
      downAt.set(i, acc);
    }
  }
  for (const [i, y] of downAt) {
    const s = sC - i * DS;
    let lat = 0;
    for (let j = 0; j * DA <= 1.3; j++) {
      const a = j * DA;
      if (j > 0) lat += loft.point(s, a, d).distanceTo(loft.point(s, a - DA, e));
      if (lookAt(species, s, a / Math.PI) !== look) continue;
      for (const sg of j === 0 ? [1] : [1, -1]) samples.push({ s, a: a * sg, x: lat * sg, y });
      rhoMax = Math.max(rhoMax, Math.hypot(lat, y));
      rhoMin = Math.min(rhoMin, Math.hypot(lat, y));
    }
  }
  if (!samples.length) return;
  const nearest = (x: number, y: number) => {
    let best = samples[0];
    let bd = Infinity;
    for (const q of samples) {
      const e = (q.x - x) * (q.x - x) + (q.y - y) * (q.y - y);
      if (e < bd) {
        bd = e;
        best = q;
      }
    }
    return { q: best, miss: Math.sqrt(bd) };
  };
  const lat = new THREE.Vector3();
  const root = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const iriN = new THREE.Vector3();

  const indigo = new THREE.Color(0x3a34ff);
  const magenta = new THREE.Color(0xd62cc8);
  const spacing = look.spacing ?? 0.8;
  let rho = Math.max(rhoMin, look.width * 0.3);
  let row = 0;
  while (rho <= rhoMax + look.width * 0.3) {
    const t = clamp((rho - rhoMin) / (rhoMax - rhoMin), 0, 1);
    const w = look.width * lerp(0.6, 1.3, t);
    const len = w * look.aspect;
    const n = Math.max(1, Math.round((Math.PI * 2 * rho) / (w * spacing)));
    for (let j = 0; j < n; j++) {
      const th = ((j + (row % 2 ? 0.5 : 0)) / n) * Math.PI * 2 - Math.PI + (rng() - 0.5) * 0.12 * (w / Math.max(rho, w));
      const { q, miss } = nearest(rho * Math.sin(th), rho * Math.cos(th));
      if (miss > 0.03) continue; // outside the tract
      // the top of the gorget has no scale lying over it: those show their whole disc
      const exposed = nearest(rho * Math.sin(th), rho * Math.cos(th) - len * 0.7).miss > 0.02;
      loft.surface(q.s, q.a, sfc);
      // down the throat: straight down on the midline, leaning outward toward the sides of
      // the gorget but never more than ~35 degrees off the fall line (not radially: a scale
      // beside the chin would point sideways)
      const thd = Math.sign(th) * Math.min(Math.abs(th) * 0.5, 0.6) + (rng() - 0.5) * 0.14;
      const tilt = (look.tilt + (rng() - 0.5) * 3) * DEG;
      root.copy(sfc.p);
      lat.crossVectors(sfc.n, sfc.t);
      if (lat.x < 0) lat.multiplyScalar(-1);
      dir.copy(sfc.t).multiplyScalar(Math.cos(thd)).addScaledVector(lat, Math.sin(thd)).normalize();
      nrm.copy(sfc.n).multiplyScalar(Math.cos(tilt)).addScaledVector(dir, -Math.sin(tilt));
      dir.multiplyScalar(Math.cos(tilt)).addScaledVector(sfc.n, Math.sin(tilt));
      iriNormal(iriN, nrm, look, rng);
      const sp = specFromLook(look, rng);
      // hue by distance from the chin, with a little scatter from scale to scale
      const h = clamp(t + (rng() - 0.5) * 0.16, 0, 1);
      if (h < 0.45) sp.iri.lerp(indigo, (1 - h / 0.45) * 0.85);
      else sp.iri.lerp(magenta, ((h - 0.45) / 0.55) * 0.8);
      const skinAt = sheetSkin(rig, q.s, q.a, root);
      const sk = loft.skin(q.s, q.a);
      const size = 0.94 + rng() * 0.12;
      b.add({
        ...sp,
        root,
        dir,
        normal: nrm,
        skinNormal: sfc.n,
        iriNormal: iriN,
        width: w * size,
        length: len * size,
        cols: 9,
        rows: 6,
        scallop: true,
        cup: 0.16,
        curl: 0.05,
        asym: 0,
        bones: skinIdx(rig, sk.bones),
        weights: sk.weights,
        skinAt,
        rand: rng(),
        coord: loft.bodyCoord(q.s) * 0.8,
        gain: look.lift,
        cover: exposed ? 0.25 : clamp(1 - look.rowStep, 0.1, 0.9),
      });
    }
    rho += w * look.aspect * look.rowStep;
    row++;
  }
}

/** Remiges and wing coverts, built in the folded rest pose. */
function addWing(b: Builder, rig: Rig, side: Side, rng: Rng) {
  const W = rig.species.wing;
  const wr = rig.wings[side];
  const sg = sideSign(side);
  const base = col(W.color);
  const sheen = col(W.sheen);
  const X = new THREE.Vector3();
  const Y = new THREE.Vector3();
  const Z = new THREE.Vector3();
  const blade = (bone: THREE.Bone, length: number, width: number, asym: number) => {
    const r = rig.rest[bone.name];
    new THREE.Matrix4().makeRotationFromQuaternion(r.worldQuat).extractBasis(X, Y, Z);
    // no two blades lie quite alike
    Z.applyAxisAngle(Y, (rng() - 0.5) * 0.02);
    Y.applyAxisAngle(Z, (rng() - 0.5) * 0.12);
    const i = rig.index(bone.name);
    const j = 0.7 + rng() * 0.6;
    b.add({
      root: r.worldPos,
      dir: Z,
      normal: Y,
      skinNormal: null,
      iriNormal: Y,
      width,
      length,
      cols: 3,
      rows: 9,
      round: 0.75,
      cup: 0.12,
      curl: 0.012,
      // bone +X is the trailing edge on the left wing and the leading edge on the right
      asym: asym * sg,
      base: base.clone().multiplyScalar(j),
      tip: base.clone().multiplyScalar(j * 0.8),
      iri: sheen,
      iri2: sheen,
      iriStrength: 0.22,
      iriPower: 2.5,
      loose: 0,
      widen: 0.3,
      bones: [i, 0, 0, 0],
      weights: [1, 0, 0, 0],
      rand: rng(),
      // coord doubles as a wing id for the shader: REAL_L/REAL_R blades stay folded away
      // inside the body until the wing spreads
      coord: sg > 0 ? WING_REAL_L : WING_REAL_R,
      gain: 0,
      // for blades the cover slot says which edge is the leading one
      cover: sg > 0 ? 0.2 : 0.8,
      channel: CH_FLIGHT,
    });
  };
  wr.primaries.forEach((bone, i) => {
    const f = i / (wr.primaries.length - 1);
    blade(bone, lerp(W.primaryLen[0], W.primaryLen[1], Math.pow(f, 0.75)), W.primaryWidth * lerp(1.15, 0.8, f), lerp(0.2, 0.5, f));
  });
  wr.secondaries.forEach((bone, j) => {
    const f = j / (wr.secondaries.length - 1);
    blade(bone, lerp(W.secondaryLen[0], W.secondaryLen[1], f), W.secondaryWidth, 0.15);
  });

  // coverts on the arm bones, for the spread wing only: rows shingled over the remex bases
  const look = rig.species.looks.covert;
  const hand = rig.rest[`hand.${side}`];
  const fore = rig.rest[`forearm.${side}`];
  new THREE.Matrix4().makeRotationFromQuaternion(hand.worldQuat).extractBasis(X, Y, Z);
  const trail = X.clone().multiplyScalar(sg); // world-space trailing direction, either side
  const N = Y.clone();
  const hd = Z.clone();
  const tipOfHand = hand.worldPos.clone().addScaledVector(hd, W.hand);
  const rowsDef = [
    { off: -0.02, len: 0.075, w: 0.034, lift: 0.006, n: 15 },
    { off: 0.0, len: 0.1, w: 0.04, lift: 0.008, n: 14 },
    { off: 0.024, len: 0.13, w: 0.046, lift: 0.01, n: 14 },
    { off: 0.05, len: 0.17, w: 0.05, lift: 0.012, n: 13 },
  ];
  const p = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (const rw of rowsDef) {
    for (let k = 0; k < rw.n; k++) {
      // a runs elbow(−0.5) → wrist(0) → along the hand(1)
      const a = lerp(-0.55, 0.9, (k + rng() * 0.7) / rw.n);
      if (a < 0) p.copy(hand.worldPos).lerp(fore.worldPos, -a / 0.5);
      else p.copy(hand.worldPos).lerp(tipOfHand, a);
      p.addScaledVector(trail, rw.off + (rng() - 0.5) * 0.016).addScaledVector(N, rw.lift);
      const tilt = 0.06 + rng() * 0.08;
      dir.copy(hd).applyAxisAngle(N, sg * (0.1 + rng() * 0.3 + (a < 0 ? 0.25 : 0)));
      nrm.copy(N).multiplyScalar(Math.cos(tilt)).addScaledVector(dir, -Math.sin(tilt));
      dir.multiplyScalar(Math.cos(tilt)).addScaledVector(N, Math.sin(tilt));
      const bi = rig.index(a < 0 ? `forearm.${side}` : `hand.${side}`);
      const size = 0.8 + rng() * 0.4;
      b.add({
        ...specFromLook(look, rng, 0.8 + 0.3 * rng()),
        root: p,
        dir,
        normal: nrm,
        skinNormal: N,
        iriNormal: nrm,
        width: rw.w * size,
        length: rw.len * size,
        cols: 3,
        rows: 4,
        curl: 0.04 + rng() * 0.1,
        asym: 0,
        bones: [bi, 0, 0, 0],
        weights: [1, 0, 0, 0],
        rand: rng(),
        coord: sg > 0 ? WING_REAL_L : WING_REAL_R,
        gain: 0,
        cover: 0.55,
      });
    }
  }
}

/**
 * The wing you see at rest. It is not on the wing bones at all: it is a set of tracts
 * planted on the wing strip of the body and skinned to the spine like every contour
 * feather, so it cannot come away from the body from any angle. From the shoulder down:
 * rows of coverts (lesser, median, greater), then the remiges as long blades lying flat,
 * inner over outer, the two wingtips crossing over the tail. The shader lifts these
 * feathers a little for a wing flick and folds them away as the real wing spreads.
 */
function addRestWing(b: Builder, rig: Rig, side: Side, rng: Rng) {
  const { loft, species } = rig;
  const W = species.wing;
  const sg = sideSign(side);
  const id = sg > 0 ? WING_REST_L : WING_REST_R;
  const sfc: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
  const sfc2: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
  const at = (u: number, v: number, out: SurfacePoint) => {
    const q = loft.wingAt(u, v, sg);
    loft.surface(clamp(q.s, 0.02, loft.sMax), q.ang, out);
    return q;
  };
  // length of the strip, to turn feather lengths into steps of u
  at(0, 0, sfc);
  at(1, 0, sfc2);
  const span = sfc.p.distanceTo(sfc2.p);
  const root = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const base = col(W.color);
  const sheen = col(W.sheen);
  const covert = species.looks.wingCovert;

  /** Plant one feather at (u, v) lying along the strip; v drifts by dv over its length. */
  const lay = (u: number, v: number, len: number, dv: number, lift: number, tiltDeg: number) => {
    const q = at(u, v, sfc);
    at(u + len / span, v + dv, sfc2);
    root.copy(sfc.p).addScaledVector(sfc.n, lift);
    dir.copy(sfc2.p).addScaledVector(sfc2.n, lift + len * Math.sin(tiltDeg * DEG)).sub(root).normalize();
    nrm.copy(sfc.n).add(sfc2.n).addScaledVector(dir, -sfc.n.dot(dir) - sfc2.n.dot(dir)).normalize();
    const sk = loft.skin(clamp(q.s, 0.02, loft.sMax), q.ang);
    return { bones: skinIdx(rig, sk.bones), weights: sk.weights };
  };

  // --- coverts: lesser at the shoulder, growing toward the greater coverts
  const rows = 7;
  for (let r = 0; r < rows; r++) {
    const f = r / (rows - 1);
    const u = lerp(0.03, 0.3, f * f * 0.4 + f * 0.6);
    const w = lerp(0.024, 0.05, f);
    const len = w * lerp(2.2, 3.4, f);
    const half = lerp(W.rest.width[0], W.rest.width[1], smoothstep(0, 0.35, u));
    const n = Math.max(3, Math.round((2 * half) / (w * 0.62)));
    for (let k = 0; k < n; k++) {
      const v = clamp(-0.98 + (2 * (k + (r % 2 ? 0.5 : 0) + (rng() - 0.5) * 0.3)) / n, -1.02, 1.02);
      const size = 0.85 + rng() * 0.3;
      const skin = lay(u + (rng() - 0.5) * 0.012, v, len * size, -v * 0.12 + (rng() - 0.5) * 0.1, 0.004 + f * 0.004, 7 + rng() * 5);
      b.add({
        ...specFromLook(covert, rng, 0.8 + 0.4 * rng()),
        root,
        dir,
        normal: nrm,
        skinNormal: sfc.n,
        iriNormal: nrm,
        width: w * size,
        length: len * size,
        cols: 3,
        rows: 4,
        curl: 0.05 + rng() * 0.08,
        asym: 0,
        ...skin,
        rand: rng(),
        coord: id,
        gain: 0,
        cover: clamp(1 - covert.rowStep, 0.1, 0.9),
      });
    }
  }

  // --- a few plain dark feathers along the lower strip, under the blades, so no skin shows
  // beside them near the rump
  for (let u = 0.42; u < 0.98; u += 0.04) {
    for (const v0 of [-0.82, -0.3, 0.3, 0.82]) {
      const size = 0.85 + rng() * 0.3;
      const skin = lay(u + (rng() - 0.5) * 0.02, v0 + (rng() - 0.5) * 0.2, 0.085 * size, -v0 * 0.1, 0.002, 4);
      b.add({
        ...specFromLook(covert, rng, 0.7 + 0.3 * rng()),
        root,
        dir,
        normal: nrm,
        skinNormal: sfc.n,
        iriNormal: nrm,
        width: 0.05 * size,
        length: 0.085 * size,
        cols: 3,
        rows: 4,
        curl: 0.04,
        asym: 0,
        ...skin,
        rand: rng(),
        coord: id,
        gain: 0,
        cover: 0.5,
      });
    }
  }

  // --- remiges: real full-length blades. Each is rooted on the strip under the coverts and
  // runs straight (a feather does not bend round the body) down and back: the secondaries a
  // short fan on the back side, the primaries long, the outer ones longest, all converging on
  // the point over the tail where the two wingtips cross. A straight blade over a rounded
  // body would cut through it, so each is swung out until it clears the surface: the
  // wingtip ends up standing off the rump, with a shadowed gap under the wing.
  const grid: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
  for (let i = 0; i <= 26; i++) {
    for (let j = 0; j <= 14; j++) {
      at(i / 20, lerp(-2.2, 2.2, j / 14), sfc);
      grid.push({ p: sfc.p.clone(), n: sfc.n.clone() });
    }
  }
  const P = new THREE.Vector3();
  const clearance = (pt: THREE.Vector3) => {
    let best = grid[0];
    let bd = Infinity;
    for (const g of grid) {
      const d = g.p.distanceToSquared(pt);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return P.copy(pt).sub(best.p).dot(best.n);
  };
  const T = species.tail;
  const ta = T.droop * DEG;
  const tailDir = new THREE.Vector3(0, -Math.sin(ta), -Math.cos(ta));
  const tailUp = new THREE.Vector3(0, Math.cos(ta), -Math.sin(ta));
  const meet = loft.center(species.spine.tail, new THREE.Vector3()).addScaledVector(tailDir, T.length[1] * W.rest.cross[0]).addScaledVector(tailUp, 0.035);
  // (the two wingtips cross over the tail: the left one lies on top)
  meet.x = W.rest.cross[1] * sg;
  if (sg > 0) meet.addScaledVector(tailUp, 0.014);
  const tip = new THREE.Vector3();
  const out = new THREE.Vector3();
  const blades: { u: number; v: number; w: number; reach: number; to: THREE.Vector3 | null; len: number; dv: number; asym: number }[] = [];
  for (let j = 0; j < W.secondaries; j++) {
    const f = j / (W.secondaries - 1);
    blades.push({ u: lerp(0.2, 0.3, f), v: lerp(0.82, 0.3, f), w: 0.066, reach: 1, to: null, len: lerp(0.19, 0.27, f), dv: -0.3, asym: 0.15 });
  }
  for (let i = 0; i < W.primaries; i++) {
    const f = i / (W.primaries - 1);
    // the outer primaries are the long ones; they also sit a little further down the strip
    blades.push({ u: lerp(0.3, 0.42, f), v: lerp(0.25, -0.8, f), w: lerp(0.068, 0.05, f), reach: lerp(0.52, 1, Math.pow(f, 0.8)), to: meet.clone().addScaledVector(tailUp, (1 - f) * 0.05).addScaledVector(tailDir, -(1 - f) * 0.02), len: 0, dv: 0, asym: lerp(0.2, 0.45, f) });
  }
  blades.forEach((bl, k) => {
    const q = at(bl.u, bl.v, sfc);
    const lift = 0.016 - k * 0.0007;
    root.copy(sfc.p).addScaledVector(sfc.n, lift);
    out.copy(sfc.n);
    let len = bl.len;
    if (bl.to) {
      tip.copy(bl.to);
      len = tip.distanceTo(root) * bl.reach;
    } else {
      at(bl.u + len / span, bl.v + bl.dv, sfc2);
      tip.copy(sfc2.p).addScaledVector(sfc2.n, lift);
      out.add(sfc2.n).normalize();
    }
    const curl = 0.035;
    for (let it = 0; it < 60; it++) {
      dir.copy(tip).sub(root).normalize();
      nrm.copy(out).addScaledVector(dir, -out.dot(dir)).normalize();
      let ok = true;
      for (const t of [0.25, 0.45, 0.65, 0.85, 1]) {
        P.copy(root).addScaledVector(dir, t * len).addScaledVector(nrm, -curl * len * t * t);
        if (clearance(P.clone()) < 0.005 + 0.012 * t - k * 0.0003) {
          ok = false;
          break;
        }
      }
      if (ok) break;
      tip.addScaledVector(out, 0.005);
    }
    const sk = loft.skin(clamp(q.s, 0.02, loft.sMax), q.ang);
    const j = 0.75 + rng() * 0.5;
    b.add({
      root,
      dir,
      normal: nrm,
      skinNormal: null,
      iriNormal: nrm,
      width: bl.w,
      length: len,
      cols: 3,
      rows: 9,
      round: 0.75,
      cup: 0.1,
      curl,
      asym: bl.asym * sg,
      base: base.clone().multiplyScalar(j),
      tip: base.clone().multiplyScalar(j * 0.8),
      iri: sheen,
      iri2: sheen,
      iriStrength: 0.22,
      iriPower: 2.5,
      loose: 0,
      widen: 0.2,
      bones: skinIdx(rig, sk.bones),
      weights: sk.weights,
      rand: rng(),
      coord: id,
      gain: 0,
      cover: sg > 0 ? 0.2 : 0.8,
      channel: CH_FLIGHT,
    });
  });
}

function addTail(b: Builder, rig: Rig, rng: Rng) {
  const T = rig.species.tail;
  const base = col(T.color);
  const sheen = col(0x46546c);
  const X = new THREE.Vector3();
  const Y = new THREE.Vector3();
  const Z = new THREE.Vector3();
  for (const r of rig.rectrices) {
    const rest = rig.rest[r.bone.name];
    new THREE.Matrix4().makeRotationFromQuaternion(rest.worldQuat).extractBasis(X, Y, Z);
    const f = (Math.abs(r.k) - 0.5) / Math.max(T.rectrices - 1, 1);
    const j = 0.85 + rng() * 0.3;
    b.add({
      root: rest.worldPos,
      dir: Z,
      normal: Y,
      skinNormal: null,
      iriNormal: Y,
      width: T.width,
      length: lerp(T.length[0], T.length[1], Math.pow(f, 1.4)),
      cols: 5,
      rows: 14,
      round: 1,
      cup: 0.06,
      curl: 0.01,
      asym: 0.12 * Math.sign(r.k),
      base: base.clone().multiplyScalar(j),
      tip: base.clone().multiplyScalar(j * 0.8),
      // the central pair, uppermost on the closed tail, carries a little of the back's green
      iri: f < 0.1 ? col(0x1f6a58) : sheen,
      iri2: sheen,
      iriStrength: f < 0.1 ? 0.13 : 0.2,
      iriPower: 3,
      loose: 0,
      widen: 0.45,
      bones: [rig.index(r.bone.name), 0, 0, 0],
      weights: [1, 0, 0, 0],
      rand: rng(),
      coord: 1,
      gain: 0,
      cover: r.k > 0 ? 0.8 : 0.2,
      channel: CH_FLIGHT,
    });
  }
}

/**
 * Fuzz: a few shells of the loft, just above and between the contour feathers, that the
 * shader fills with fine hairs running the way the feathers lie. It is what makes the
 * coat read as fur instead of as leaves, and it frays the silhouette. Same vertex layout
 * as the feathers, so the same material draws it (channel CH_FUZZ):
 *   uv      = hair columns round the body, distance from the bill
 *   aTip.a  = how thickly this tract is fuzzed, aIri2.a = which shell (0 inner … 1 outer)
 */
function buildFuzz(rig: Rig, layers = 3, rings = 120, segs = 80) {
  const { loft, species } = rig;
  const b = new Builder();
  const sfc: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
  const P = new THREE.Vector3();
  const prev = new Float32Array(segs + 1);
  const pts: THREE.Vector3[] = Array.from({ length: segs + 1 }, () => new THREE.Vector3());
  const iriN = new THREE.Vector3();
  const rng = mulberry32(species.seed + 99);
  const COLUMNS = 560;
  const sTop = loft.sMax - 0.12;
  interface V { p: THREE.Vector3; n: THREE.Vector3; d: number; s: number; a: number }
  const grid: V[] = [];
  for (let i = 0; i <= rings; i++) {
    const s = sTop - (i / rings) * (sTop - 0.05);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      loft.surface(s, a, sfc);
      if (i > 0) prev[j] += pts[j].distanceTo(sfc.p);
      pts[j].copy(sfc.p);
      grid.push({ p: sfc.p.clone(), n: sfc.n.clone(), d: prev[j], s, a });
    }
  }
  for (let L = 0; L < layers; L++) {
    const lf = layers > 1 ? L / (layers - 1) : 0;
    const height = lerp(0.008, 0.03, lf);
    const start = b.pos.length / 3;
    for (let k = 0; k < grid.length; k++) {
      const g = grid[k];
      const j = k % (segs + 1);
      const phi = g.a <= Math.PI ? g.a / Math.PI : (2 * Math.PI - g.a) / Math.PI;
      const look = lookAt(species, g.s, phi);
      const tone = toneAt(species, look, g.s, phi);
      const { gold, glit } = tone;
      const shade = tone.shade * wingShadow(loft, g.s, g.a);
      let fuzz = look.fuzz ?? Math.min(0.55 + (look.loose ?? 0) * 0.6, 1);
      // keep the eyes and the root of the bill clear
      for (const side of SIDES) fuzz *= smoothstep(species.eye.radius * 1.25, species.eye.radius * 2.1, g.p.distanceTo(rig.eyes[side].center));
      fuzz *= 1 - smoothstep(loft.sMax - 0.7, loft.sMax - 0.2, g.s);
      // no body fuzz on the folded wings
      {
        const wuv = loft.wingUV(g.s, g.a);
        if (wuv.u > 0.02 && wuv.u < 0.99) fuzz *= smoothstep(0.85, 1.15, Math.abs(wuv.v));
      }
      const sp = specFromLook(look, rng, shade, gold, species.shading.gold, glit);
      iriNormal(iriN, g.n, look);
      // small feathers, short fuzz: the head must not wear a halo
      P.copy(g.p).addScaledVector(g.n, height * (0.5 + 0.5 * Math.min(fuzz * 2, 1)) * clamp(look.width / 0.03, 0.4, 1));
      const sk = loft.skin(g.s, g.a);
      b.pos.push(P.x, P.y, P.z);
      b.nor.push(g.n.x, g.n.y, g.n.z);
      b.uv.push((j / segs) * COLUMNS, g.d);
      b.root.push(P.x, P.y, P.z);
      b.hinge.push(1, 0, 0);
      b.data.push(lf, loft.bodyCoord(g.s) * 0.8, look.lift, CH_FUZZ);
      b.iriN.push(iriN.x, iriN.y, iriN.z);
      // fuzz over the show scales stays dark: the scales do the shining
      b.cBase.push(sp.base.r, sp.base.g, sp.base.b, look.fine ? 0 : (look.iriStrength * glit * (1 + gold)) / 4);
      b.cTip.push(sp.tip.r, sp.tip.g, sp.tip.b, fuzz);
      b.cIri.push(sp.iri.r, sp.iri.g, sp.iri.b, look.iriPower / 32);
      b.cIri2.push(sp.iri2.r, sp.iri2.g, sp.iri2.b, lf);
      b.si.push(...skinIdx(rig, sk.bones));
      b.sw.push(...sk.weights);
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = start + i * (segs + 1) + j;
        const c = a + segs + 1;
        // rings run bill → tail, so this winding faces out
        b.idx.push(a, c, a + 1, c, c + 1, a + 1);
      }
    }
  }
  return b;
}

export interface PlumageGeometry {
  contour: THREE.BufferGeometry;
  flight: THREE.BufferGeometry;
  fuzz: THREE.BufferGeometry;
}

export function buildPlumageGeometry(rig: Rig): PlumageGeometry {
  const rng = mulberry32(rig.species.seed);
  const contour = new Builder();
  addContour(contour, rig, rng);
  addGorget(contour, rig, rng);
  const flight = new Builder();
  for (const side of SIDES) {
    addWing(flight, rig, side, rng);
    addRestWing(flight, rig, side, rng);
  }
  addTail(flight, rig, rng);
  const fuzz = buildFuzz(rig);
  return {
    contour: contour.build(),
    flight: flight.build(),
    fuzz: fuzz.build(),
  };
}

/** The skin under the feathers: the loft itself, skinned to the spine. */
export function buildSkinGeometry(rig: Rig, rings = 64, segs = 36, inset = 0.007) {
  const sfc: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
  const { loft } = rig;
  const pos: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const s = (i / rings) * loft.sMax;
    for (let j = 0; j <= segs; j++) {
      const ang = (j / segs) * Math.PI * 2;
      const sk = loft.skin(s, ang);
      loft.surface(s, ang, sfc);
      // (deeper under the neck and throat: when the head turns far round, the skin there must not
      // bulge out between the feathers)
      p.copy(sfc.p).addScaledVector(sfc.n, -inset);
      pos.push(p.x, p.y, p.z);
      si.push(...skinIdx(rig, sk.bones));
      sw.push(...sk.weights);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      // no skin under the throat and the front of the neck: when the head comes down onto the
      // breast the feathers there slide over each other, but skin stretched straight from chin
      // to chest would stand out in front of them as a sheet (the scales there are a closed coat anyway)
      const sMid = ((i + 0.5) / rings) * loft.sMax;
      if (sMid > 4.3 && sMid < 9.0 && Math.cos(((j + 0.5) / segs) * Math.PI * 2) > -0.25) continue;
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

