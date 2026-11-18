import type { Pose } from '../pose';
import type { Rig, Side } from '../rig';
import { sideSign } from '../rig';
import * as THREE from 'three';
import type { SurfacePoint } from '../loft';
import { DEG, lerp, rand, smoothstep } from '../util';
import type { Layer, Mind } from './mind';

// Preening under a wing. The bird swings one folded wing a little out from its flank and
// turns the leading edge up, so the side under it opens toward the front. It twists, the
// neck curls round to that side and the bill goes in under the wing from the front, along
// the flank, until its tip is out of sight between wing and body. There it nibbles: bursts
// of small quick in-and-out strokes, at two or three places, drawing back once to find a new
// one. Then the bill comes out, the head goes back up, the wing closes a beat later and is
// shuffled shut, and it shakes itself into place.

/** where the bill tip works, in wing space (see Loft.wingAt): along the strip, across it */
const SPOTS: [number, number][] = [
  [0.44, -0.5],
  [0.52, -0.25],
  [0.38, -0.65],
];

export class PreenLayer implements Layer {
  readonly name = 'preen';
  /** spontaneous bouts: off until it has been looked at */
  auto = false;
  /** seconds between bouts when calm */
  every: [number, number] = [22, 55];
  /** set by the bird: true when something else has the body (a hop, a flight) */
  blocked: () => boolean = () => false;
  /** called when a bout ends, for the shake-out */
  onDone: ((m: Mind) => void) | null = null;
  active = false;

  // the shape of it, all in the body's own frame, left side (the right is mirrored)
  /** how far the wing swings out about the shoulder and turns its leading edge up, radians */
  wingOut = 0.44;
  wingTwist = 0.42;
  /** the line the bill lies along under the wing, base to tip */
  billDir = new THREE.Vector3(0.12, -0.86, -0.5).normalize();
  /** and the line it comes in from, the head already in place: tip down beside the flank, clear of the wing's edge */
  billOut = new THREE.Vector3(0.3, -0.92, 0.05).normalize();
  /** tip off the skin */
  tipOff = 0.03;
  /** the body's twist: yaw toward the wing, roll (the far shoulder drops), radians */
  bodyYaw = 0.22;
  bodyRoll = 0.1;
  bodyPitch = 0.06;
  /** the head turned about the bill while it is under the wing, from crown-up, radians */
  headRoll = 1.2;

  private t0 = 0;
  private dur = 4;
  private side: Side = 'L';
  private nextAt: number;
  private coord: number;
  private hips: THREE.Vector3;
  private headRest: THREE.Vector3;
  private spots: Record<Side, THREE.Vector3[]> = { L: [], R: [] };
  private spot = new THREE.Vector3();
  private seed = 0;
  /** when it draws back mid-bout, and the spot it goes to after */
  private tBreak = 0;
  private order = [0, 1, 2];
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private d = new THREE.Vector3();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(mind: Mind, rig: Rig, private billReach: number) {
    this.nextAt = rand(mind.rng, this.every[0] * 0.6, this.every[1] * 0.7);
    const sfc: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
    for (const sd of ['L', 'R'] as const) {
      for (const [u, v] of SPOTS) {
        const at = rig.loft.wingAt(u, v, sideSign(sd));
        rig.loft.surface(at.s, at.ang, sfc);
        this.spots[sd].push(sfc.p.clone().addScaledVector(sfc.n, this.tipOff));
      }
    }
    this.coord = rig.loft.bodyCoord(3.4);
    this.hips = rig.rest.hips.worldPos.clone();
    this.headRest = rig.rest.head.worldPos.clone();
    mind.on('startle', () => {
      // a fright ends it there and then (and lets the eyes go: don't count on another layer to)
      if (this.active) mind.gazeLock = false;
      this.active = false;
    });
  }

  start(m: Mind, side?: Side) {
    if (this.active || this.blocked() || m.eating) return false;
    this.active = true;
    this.t0 = m.t;
    this.dur = rand(m.rng, 4, 5);
    this.side = side ?? (m.rng() < 0.5 ? 'L' : 'R');
    this.seed = m.rng() * 100;
    this.tBreak = rand(m.rng, 0.42, 0.58);
    this.order = m.rng() < 0.5 ? [0, 1, 2] : [2, 0, 1];
    this.spot.copy(this.spots[this.side][this.order[0]]);
    this.nextAt = m.t + this.dur + rand(m.rng, this.every[0], this.every[1]);
    return true;
  }

  update(m: Mind, p: Pose) {
    if (!this.active) {
      if (this.auto && !m.quiet && m.t >= this.nextAt) {
        if (m.arousal < 0.5 && m.freeze <= 0 && !m.focus && !m.saccading) this.start(m);
        else this.nextAt = m.t + 2;
      }
      if (!this.active) return;
    }
    const tau = m.t - this.t0;
    const D = this.dur;
    if (tau >= D || this.blocked()) {
      this.active = false;
      m.gazeLock = false;
      if (tau >= D) this.onDone?.(m);
      return;
    }
    m.gazeLock = true;
    const sg = sideSign(this.side);
    const ss = (a: number, b: number) => smoothstep(a, b, tau);

    // --- the order of things: wing, body, head round, bill in … bill out, head back, wing shut
    const tOut = D - 1.3; // the bill starts to come out
    const wing = ss(0, 0.42) * (1 - ss(D - 0.6, D - 0.1));
    const twist = ss(0.12, 0.7) * (1 - ss(D - 0.95, D - 0.25));
    const turn = ss(0.22, 0.8) * (1 - ss(tOut + 0.2, tOut + 0.9));
    const reach = ss(0.5, 0.95) * (1 - ss(tOut + 0.18, tOut + 0.65));
    // in under the wing, drawn back once in the middle, and out
    const tA = 0.95;
    const tB = lerp(tA + 0.3, tOut, this.tBreak);
    let ins = ss(tA - 0.1, tA + 0.22) * (1 - ss(tOut, tOut + 0.24));
    ins *= 1 - 0.75 * ss(tB - 0.16, tB) * (1 - ss(tB + 0.08, tB + 0.3));
    // the spot changes while the bill is drawn back, and once more on the way
    const tC = lerp(tB, tOut, 0.55);
    const k = this.order[tau < tB ? 0 : tau < tC ? 1 : 2];
    this.spot.lerp(this.spots[this.side][k], 1 - Math.exp(-m.dt * (tau < tB + 0.3 ? 14 : 7)));
    // nibbling: bursts of quick small strokes, only while the bill is well in
    const work = smoothstep(0.8, 1, ins);
    const ph = tau * 9.5 * Math.PI * 2 + this.seed;
    const burst = smoothstep(-0.15, 0.35, Math.sin(tau * 5.1 + this.seed) + 0.6 * Math.sin(tau * 2.3 + this.seed * 1.7));
    const nib = Math.sin(ph) * work * burst;
    const nib2 = Math.sin(ph * 0.5 + 1.3) * work * burst;

    // --- the body twists toward the wing; everything under the wing goes with it
    const yaw = sg * this.bodyYaw * twist;
    const roll = sg * this.bodyRoll * twist;
    const pitch = this.bodyPitch * twist;
    p.bodyYaw += yaw;
    p.bodyRoll += roll;
    p.bodyPitch += pitch;
    p.bodyShift.x += sg * 0.012 * twist;
    p.tailYaw += -sg * 0.14 * twist;
    p.tailFan += 0.12 * twist;
    this.e.set(p.bodyPitch, p.bodyYaw, p.bodyRoll, 'YXZ');
    this.q.setFromEuler(this.e);
    const toRoot = (v: THREE.Vector3) => v.sub(this.hips).applyQuaternion(this.q).add(this.hips).add(p.bodyShift);

    // --- the wing off the flank; the bill working under it jostles it
    const w = p.wing[this.side];
    w.out += wing * this.wingOut + nib * 0.012 + 0.03 * work * Math.sin(tau * 3.1 + this.seed);
    w.twist += wing * this.wingTwist + nib2 * 0.015;
    w.lift += wing * 0.05;
    // the other wing hitches a little for balance
    p.wing[this.side === 'L' ? 'R' : 'L'].lift += 0.05 * twist;

    // --- the bill: along its line under the wing, tip on the spot, or drawn back along the line
    // (the head stays where the spot wants it; the bill swings in under the wing's raised edge from the front)
    const d = this.d.copy(this.billDir);
    d.x *= sg;
    const a = this.a.copy(this.spot).addScaledVector(d, -this.billReach);
    this.b.copy(this.billOut);
    this.b.x *= sg;
    d.lerp(this.b, 1 - ins).normalize();
    a.addScaledVector(d, this.billReach + nib * 0.014);
    a.z += nib2 * 0.006;
    a.y += nib2 * 0.005;
    toRoot(a);
    d.applyQuaternion(this.q);
    p.reachTarget.copy(a);
    p.reachDir.copy(d);
    p.reachPin = 1;
    // (the head lies over on its side, crown outward: that way the neck has the least to twist)
    p.reachRoll = sg * (this.headRoll + 0.05 * nib2);
    p.reachWeight = reach;
    // until the reach takes over, the head turns round that side and tips down: it has to go
    // the outside way, never through the breast
    p.headYaw = lerp(p.headYaw, sg * 100 * DEG + p.bodyYaw, turn);
    p.headPitch = lerp(p.headPitch, -52 * DEG, turn);
    p.headRoll = lerp(p.headRoll, sg * 0.15, turn);
    // and moves out over the shoulder, toward where the reach will want it
    const hb = this.b.copy(this.spot).addScaledVector(this.d.copy(this.billDir).setX(this.billDir.x * sg), -this.billReach);
    toRoot(hb).sub(this.headRest);
    p.headShift.addScaledVector(hb, turn * 0.8);
    p.headStabil = lerp(p.headStabil, 0.3, turn);

    p.jaw += (0.1 + 0.16 * (0.5 + 0.5 * Math.sin(ph + 0.6))) * work * burst;
    // eyes half shut while it works
    p.nict += 0.45 * work;
    p.lidLower += 0.3 * work;
    p.lidUpper += 0.15 * work;
    // the flank feathers by the bill stand up a little
    p.addLift(this.coord, 0.09, work * (0.08 + 0.04 * Math.abs(nib)));
    // and it is loose all over while it preens, most of all round the stretched neck
    p.fluff += 0.04 * twist;
  }
}

