import * as THREE from 'three';
import type { Rig, Side } from './rig';
import { basisQuat, SIDES, sideSign } from './rig';
import type { PlumageUniforms } from './plumageMaterial';
import { LID } from './parts';
import { clamp, DEG, lerp, smoothstep } from './util';

// The pose is the seam between motion and rig. Behaviour layers never touch
// bones: they add to these channels, and applyPose() turns the channels into
// bone transforms and feather uniforms. A new behaviour (flight, preening)
// writes the same channels, or adds its own and teaches the solver about it.

export interface WingPose {
  /** 0 folded … 1 spread */
  spread: number;
  /** wing swung away from the body, radians */
  lift: number;
  /** wingtips lowered, radians */
  droop: number;
  /** spread wing only: swung forward (+) or back (−) about the body's long axis, and raised (+), radians */
  sweep: number;
  raise: number;
  /**
   * Folded wing held off the flank (preening under it): out swings the whole resting wing away
   * from the body about the shoulder (the tip leaves the rump), twist turns its leading edge up
   * off the flank, radians.
   */
  out: number;
  twist: number;
}

const REST_WING: WingPose = { spread: 0, lift: 0, droop: 0, sweep: 0, raise: 0, out: 0, twist: 0 };

export class Pose {
  // gaze: where the bill points, in root space. yaw + = bird's left, pitch + = up.
  headYaw = 0;
  headPitch = 0;
  headRoll = 0;
  /** extra head translation, root space */
  headShift = new THREE.Vector3();
  /** 1 = head position fully held against body motion */
  headStabil = 0.85;

  /**
   * Reach: put the bill TIP on this root-space point. weight 0 = ignore, 1 = exactly there.
   * The solver aims the head so the bill points along the line to the target and slides the
   * head along that line (unfolding or tucking the neck) until the tip arrives.
   */
  reachTarget = new THREE.Vector3();
  reachWeight = 0;
  /**
   * Reach along a given line: with reachPin 1 the bill lies along reachDir (unit, root space,
   * base to tip) with its tip on the target, wherever that puts the head; the neck gives what
   * it takes. For working the bill into a place it can only enter one way (under a wing).
   * reachRoll turns the head about the bill, radians.
   */
  reachDir = new THREE.Vector3(0, 0, 1);
  reachPin = 0;
  reachRoll = 0;

  // body (hips)
  bodyYaw = 0;
  bodyPitch = 0; // + = lean forward
  bodyRoll = 0;
  bodyShift = new THREE.Vector3();
  chestPitch = 0;

  /** -1 … 1, drives the sternum */
  breath = 0;

  // feathers
  fluff = 0; // radians of lift, global
  lift = new Float32Array(8); // extra lift along the body: [0] bill … [7] tail
  gorget = 0;
  crest = 0;

  // eyes: 0 open … 1 closed
  lidUpper = 0;
  lidLower = 0;
  nict = 0;
  // feet: the perch's slope under them (radians, + = rising to the bird's left), its
  // thickness relative to the rest perch, and how closed the toes are (1 gripping … 0 open)
  feetSlope = 0;
  feetScale = 1;
  grip = 1;

  /** 0 shut … 1 wide open (about 18 degrees) */
  jaw = 0;
  /** 0 inside the bill … 1 as far out past the tip as it goes */
  tongueOut = 0;
  /** tip curled down (+) or up (−), radians */
  tongueCurl = 0;
  /** where a carried item sits along the bill: 1 = at the tip, 0 = at the gape, above 1 = out on the tongue */
  carryAt = 1;

  tailPitch = 0; // + = lifted
  tailYaw = 0;
  tailRoll = 0;
  tailFan = 0; // 0 folded … 1 fanned

  wing: Record<Side, WingPose> = {
    L: { ...REST_WING },
    R: { ...REST_WING },
  };

  /** Back to rest, every frame. (reachTarget and reachDir keep theirs: they only count while reachWeight is up.) */
  reset() {
    Object.assign(this, REST);
    this.headShift.set(0, 0, 0);
    this.bodyShift.set(0, 0, 0);
    this.lift.fill(0);
    for (const s of SIDES) Object.assign(this.wing[s], REST_WING);
  }

  /** Add a bump to the lift profile centred at body coordinate c (0 bill … 1 tail). */
  addLift(c: number, width: number, amount: number) {
    for (let i = 0; i < 8; i++) {
      const d = (i / 7 - c) / width;
      this.lift[i] += amount * Math.exp(-d * d);
    }
  }
}

/** every scalar channel at its initial value, so the defaults above are written once */
const REST = Object.fromEntries(Object.entries(new Pose()).filter(([, v]) => typeof v === 'number')) as Partial<Pose>;

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const I = new THREE.Quaternion();

/** applyPose plus what the solve found out. */
export interface Solver {
  (p: Pose): void;
  /** bill tip after the last solve, root space */
  tip: THREE.Vector3;
  /** where a carried item sits after the last solve, root space */
  carry: THREE.Vector3;
  /** distance from head pivot to bill tip */
  billReach: number;
}

export function createSolver(rig: Rig, uniforms: PlumageUniforms): Solver {
  const { bones, rest, species } = rig;
  const e = new THREE.Euler();
  const qHips = new THREE.Quaternion();
  const qChestL = new THREE.Quaternion();
  const qChestW = new THREE.Quaternion();
  const qHead = new THREE.Quaternion();
  const qRel = new THREE.Quaternion();
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const qC = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const pFk = new THREE.Vector3();
  const pStill = new THREE.Vector3();
  const [n1, n2] = species.behaviour.neckShare;

  // axes for swinging the folded wing, expressed in forearm space
  const wingAxes = {} as Record<Side, { out: THREE.Vector3; fan: THREE.Vector3 }>;
  for (const s of SIDES) {
    const hq = rest[`hand.${s}`].quat;
    wingAxes[s] = { out: X.clone().applyQuaternion(hq), fan: Y.clone().applyQuaternion(hq) };
  }
  // the resting wing is feathers on the body: held off the flank, the shader turns them as one
  // piece about the shoulder end of the strip (left wing's frame; the right is its mirror)
  {
    const sfc = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
    const on = (u: number, vv: number) => {
      const q = rig.loft.wingAt(u, vv, 1);
      return rig.loft.surface(q.s, q.ang, sfc);
    };
    const pivot = on(0.03, 0.3).p.clone();
    const span = on(0.95, 0).p.clone().sub(pivot).normalize();
    const n = on(0.4, 0).n.clone();
    n.addScaledVector(span, -n.dot(span)).normalize();
    uniforms.uWingPivot.value.copy(pivot);
    uniforms.uWingSpan.value.copy(span);
    uniforms.uWingChord.value.crossVectors(n, span);
  }
  // the bill tip in head space, and how far the neck may unfold or tuck to carry it somewhere
  const billRest = rest.bill;
  const tipLocal = new THREE.Vector3(0, -species.bill.droop, species.bill.length).applyQuaternion(billRest.worldQuat).add(billRest.worldPos).sub(rest.head.worldPos);
  const tipLen = tipLocal.length();
  const tipElev = Math.atan2(tipLocal.y, tipLocal.z);
  const NECK_OUT = 0.34;
  const NECK_IN = 0.24;
  const tip = new THREE.Vector3();
  const carry = new THREE.Vector3();
  // the tongue rests with its tip at 0.8 of the bill and can reach 0.45 of a bill past the end
  const TONGUE_TRAVEL = species.bill.length * 0.65;
  // the three tongue bones ride the bill's centre line: y = -droop (z/L)^2, straight beyond the tip
  const TONGUE = ['tongue.1', 'tongue.2', 'tongue.3'] as const;
  const TONGUE_AT = [0.06, 0.5, 0.7].map((k) => k * species.bill.length);
  const TONGUE_CURL = [0, 0.3, 0.7];
  /** point on that line at z (bill space) into `out`; returns the angle the line dips there */
  const tonguePath = (z: number, out: THREE.Vector3) => {
    const L = species.bill.length;
    const zc = Math.min(z, L);
    const slope = (-2 * species.bill.droop * zc) / (L * L);
    out.set(0, -species.bill.droop * (zc / L) * (zc / L) + slope * (z - zc), z);
    return -Math.atan(slope);
  };
  const tongueRest = TONGUE_AT.map(() => new THREE.Vector3());
  const tongueNow = TONGUE_AT.map(() => new THREE.Vector3());
  const tongueRestA = TONGUE_AT.map((z, i) => tonguePath(z, tongueRest[i]));
  const hWant = new THREE.Vector3();
  const qAim = new THREE.Quaternion();
  const mLook = new THREE.Matrix4();
  const lx = new THREE.Vector3();
  const ly = new THREE.Vector3();
  // the throat sheet at rest: its chin, foot and middle on the front line, from the head's
  // pivot, the way out of it at the middle, the way down the breast at its foot, and how
  // far it is from foot to chin
  const throatRest = (() => {
    const [t0, t1] = species.throat;
    const sfc = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
    const o = rest.head.worldPos;
    const chin = rig.loft.point(t1, 0, new THREE.Vector3()).sub(o);
    const rim = rig.loft.point(t0, 0, new THREE.Vector3()).sub(o);
    const mid = rig.loft.surface((t0 + t1) / 2, 0, sfc).p.clone().sub(o);
    const out = sfc.n.clone();
    const down = rig.loft.surface(t0, 0, sfc).t.clone();
    return { chin, rim, mid, out, down, span: chin.distanceTo(rim), pivot: o.clone().sub(rest.chest.worldPos) };
  })();
  const THROAT_POUT = 0.12;
  const qT = new THREE.Quaternion();
  const tA = new THREE.Vector3();
  const tB = new THREE.Vector3();
  const tN = new THREE.Vector3();
  const tS = new THREE.Vector3();
  const sternumDir = rest.sternum.worldPos.clone().sub(rest.chest.worldPos).setX(0).normalize();
  // each leg's bones, looked up once (not by name every frame)
  const legs = SIDES.map((s) => ({
    s,
    foot: bones[`foot.${s}`],
    footRest: rest[`foot.${s}`],
    toes: [1, 2, 3, 4].map((i) => bones[`toe.${s}.${i}`]),
    tarsus: bones[`tarsus.${s}`],
  }));
  // the neck's share of the head's turn relative to the chest
  const solveNeck = () => {
    qRel.copy(qChestW).invert().multiply(qHead);
    qA.copy(I).slerp(qRel, n1);
    qB.copy(I).slerp(qRel, n2);
  };

  /** Root-space position of the head bone for a given hips transform and neck rotations. */
  function headFk(hipsPos: THREE.Vector3, hipsQ: THREE.Quaternion, chestL: THREE.Quaternion, neckA: THREE.Quaternion, neckB: THREE.Quaternion, out: THREE.Vector3) {
    // walk up from the head: each step rotates by the parent's local rotation and adds its offset
    out.copy(rest.head.pos).applyQuaternion(neckB).add(rest.neck2.pos);
    out.applyQuaternion(neckA).add(rest.neck1.pos);
    out.applyQuaternion(chestL).add(rest.chest.pos);
    out.add(rest.spine.pos); // spine keeps its rest rotation
    out.applyQuaternion(hipsQ).add(hipsPos);
    return out;
  }

  const applyPose = function applyPose(p: Pose) {
    // --- body -------------------------------------------------------------------
    e.set(p.bodyPitch, p.bodyYaw, p.bodyRoll, 'YXZ');
    qHips.setFromEuler(e);
    bones.hips.quaternion.copy(qHips);
    bones.hips.position.copy(rest.hips.pos).add(p.bodyShift);
    qChestL.setFromAxisAngle(X, p.chestPitch);
    bones.chest.quaternion.copy(qChestL);
    qChestW.copy(qHips).multiply(qChestL);

    // breath: sternum swings out and the flanks widen
    bones.sternum.position.copy(rest.sternum.pos).addScaledVector(sternumDir, p.breath * 0.011);
    bones.sternum.scale.set(1 + p.breath * 0.028, 1, 1 + p.breath * 0.012);

    // --- neck and head: world-stabilised gaze, optionally reaching with the bill ----------
    e.set(-p.headPitch, p.headYaw, p.headRoll, 'YXZ');
    qHead.setFromEuler(e);
    solveNeck();
    // where the head sits with the body's motion taken out (held still in space) and the
    // layers' own shifts added
    headFk(bones.hips.position, qHips, qChestL, qA, qB, pFk);
    headFk(rest.hips.pos, I, I, qA, qB, pStill);
    v.copy(pStill).sub(pFk).multiplyScalar(clamp(p.headStabil, 0, 1)).add(p.headShift);
    const w = clamp(p.reachWeight, 0, 1);
    if (w > 0) {
      // IK for the bill tip. The head pivot must end up exactly one bill-length from the
      // target, on the line from where it is now: slide it along that line, within what the
      // neck can give, then turn the head so the tip lies on the target.
      hWant.copy(pFk).add(v);
      v2.copy(p.reachTarget).sub(hWant);
      const dist = v2.length() || 1e-6;
      const slide = clamp(dist - tipLen, -NECK_IN, NECK_OUT);
      hWant.addScaledVector(v2, slide / dist);
      const pin = clamp(p.reachPin, 0, 1);
      if (pin > 0) hWant.lerp(v2.copy(p.reachDir).multiplyScalar(-tipLen).add(p.reachTarget), pin);
      v2.copy(p.reachTarget).sub(hWant).normalize();
      const yaw = clamp(Math.atan2(v2.x, v2.z), -2.2, 2.2);
      const pitch = clamp(Math.asin(clamp(v2.y, -1, 1)) - tipElev, -1.1, 1.25);
      e.set(-pitch, yaw, p.headRoll * (1 - w), 'YXZ');
      qAim.setFromEuler(e);
      if (pin > 0) {
        // along a given line the head may be turned right round and tipped steeply: no yaw or
        // pitch limits, crown kept as near up as the line allows, then rolled about the bill
        lx.crossVectors(Y, v2).normalize();
        ly.crossVectors(v2, lx);
        qB.setFromRotationMatrix(mLook.makeBasis(lx, ly, v2));
        qB.multiply(qA.setFromAxisAngle(Z, p.reachRoll)).multiply(qA.setFromAxisAngle(X, tipElev));
        qAim.slerp(qB, pin);
      }
      qHead.slerp(qAim, w);
      solveNeck();
      headFk(bones.hips.position, qHips, qChestL, qA, qB, pFk);
      v.lerp(hWant.sub(pFk), w);
    }
    bones.neck1.quaternion.copy(qA);
    bones.neck2.quaternion.copy(qB);
    // whatever the neck did not do, the head does: world orientation is exact
    qC.copy(qA).multiply(qB).invert().multiply(qRel);
    bones.head.quaternion.copy(qC);
    // the head's translation is shared down the neck (a bird's neck is a folded S under the
    // feathers: reaching is that S unfolding), each bone taking its part in its parent's frame
    tip.copy(pFk).add(v);
    qC.copy(qChestW).invert();
    bones.neck1.position.copy(rest.neck1.pos).add(v2.copy(v).multiplyScalar(0.22).applyQuaternion(qC));
    qC.copy(qChestW).multiply(qA).invert();
    bones.neck2.position.copy(rest.neck2.pos).add(v2.copy(v).multiplyScalar(0.3).applyQuaternion(qC));
    qC.copy(qChestW).multiply(qA).multiply(qB).invert();
    bones.head.position.copy(rest.head.pos).add(v2.copy(v).multiplyScalar(0.48).applyQuaternion(qC));
    // --- the throat sheet: foot, middle, chin (all in chest space) -----------------------
    // its foot stays on the breast and only turns with the head, about the chest's own up
    qT.set(0, qRel.y, 0, qRel.w);
    if (qT.lengthSq() < 1e-6) qT.set(0, 0, 0, 1);
    qT.normalize();
    bones.throat.quaternion.copy(qT);
    // and when the chin comes down on it (a deep tuck, the bill driven at the feet) it gives
    // way down the breast, so the sheet never has less than half its length to lie in
    v.copy(bones.head.position).applyQuaternion(bones.neck2.quaternion).add(bones.neck2.position).applyQuaternion(bones.neck1.quaternion).add(bones.neck1.position);
    tA.copy(throatRest.chin).applyQuaternion(qRel).add(v).sub(tB.copy(throatRest.rim).applyQuaternion(qT).add(throatRest.pivot));
    const short = throatRest.span * 0.5 - tA.length();
    const slide = 0.5 * (short + Math.sqrt(short * short + 1e-4));
    tS.copy(throatRest.down).applyQuaternion(qT).multiplyScalar(slide);
    bones.throat.position.copy(rest.throat.pos).add(tS);
    // its middle is halfway from there to the head, turn and travel: the three together carry
    // the sheet round the head's pivot as a fan closing (a nod) or opening, so it keeps its
    // bow at every pitch instead of cutting straight from chin to breast
    qC.copy(qT).slerp(qRel, 0.5);
    bones.gular.quaternion.copy(qC);
    v2.copy(throatRest.mid).applyQuaternion(qC);
    // (pressed short it pouts a little, pulled long it flattens)
    const pout = clamp(THROAT_POUT * (throatRest.span - tA.length()), -0.006, 0.03);
    tN.copy(throatRest.out).applyQuaternion(qC);
    bones.gular.position.copy(v).add(throatRest.pivot).add(tS).multiplyScalar(0.5).add(v2).addScaledVector(tN, pout);
    // bill tip, root space, for whoever wants to know (picking, carrying)
    tip.add(v2.copy(tipLocal).applyQuaternion(qHead));

    bones.jaw.quaternion.copy(rest.jaw.quat).multiply(qA.setFromAxisAngle(X, clamp(p.jaw, 0, 1.1) * 0.31));
    // tongue: slides out along the bill's own curve (so it stays between the mandibles) and
    // carries on straight past the tip; the two outer segments can curl
    const out = clamp(p.tongueOut, 0, 1) * TONGUE_TRAVEL;
    let prevA = 0;
    for (let i = 0; i < 3; i++) {
      // a: the turn that keeps this segment on the line; the curl comes on top, most of it at the tip
      const a = tonguePath(TONGUE_AT[i] + out, tongueNow[i]) - tongueRestA[i];
      const b = bones[TONGUE[i]];
      b.quaternion.setFromAxisAngle(X, a - prevA + p.tongueCurl * TONGUE_CURL[i]);
      if (i === 0) b.position.copy(rest[TONGUE[0]].pos).add(tongueNow[0]).sub(tongueRest[0]);
      else b.position.copy(tongueNow[i]).sub(tongueNow[i - 1]).sub(tongueRest[i]).add(tongueRest[i - 1]).add(rest[TONGUE[i]].pos).applyQuaternion(qA.setFromAxisAngle(X, -prevA));
      prevA = a;
    }
    // where a carried item sits
    const k = Math.max(p.carryAt, 0);
    carry.set(0, -species.bill.droop * Math.min(k, 1) * Math.min(k, 1) - (k < 1 ? 0.003 * (1 - k) : 0), k * species.bill.length).applyQuaternion(billRest.worldQuat).add(billRest.worldPos).sub(rest.head.worldPos);
    carry.applyQuaternion(qHead).add(tip).sub(v2.copy(tipLocal).applyQuaternion(qHead));

    // --- eyes -------------------------------------------------------------------
    for (const s of SIDES) {
      const eye = rig.eyes[s];
      const up = lerp(LID.upperOpen, 0, smoothstep(0, 1, p.lidUpper));
      const lo = lerp(LID.lowerOpen, 0, smoothstep(0, 1, p.lidLower));
      // sweeping from +Z toward +Y is a negative turn about X
      eye.lidUpper.quaternion.copy(rest[eye.lidUpper.name].quat).multiply(qA.setFromAxisAngle(X, -up));
      eye.lidLower.quaternion.copy(rest[eye.lidLower.name].quat).multiply(qA.setFromAxisAngle(X, -lo));
      // the membrane parks toward the bill: -X on the left eye, +X on the right
      const na = -sideSign(s) * LID.nictOpen * (1 - clamp(p.nict, 0, 1));
      eye.nict.quaternion.copy(rest[eye.nict.name].quat).multiply(qA.setFromAxisAngle(Y, na));
      // parked lids tuck under the skin
      eye.nict.scale.setScalar(p.nict > 0.002 ? 1 : 0.001);
      eye.lidUpper.scale.setScalar(lerp(0.93, 1, smoothstep(0, 0.5, p.lidUpper)));
      eye.lidLower.scale.setScalar(lerp(0.93, 1, smoothstep(0, 0.5, p.lidLower)));
    }

    // --- tail -------------------------------------------------------------------
    e.set(-p.tailPitch, p.tailYaw, p.tailRoll, 'YXZ');
    bones.tail.quaternion.copy(rest.tail.quat).multiply(qA.setFromEuler(e));
    const fan = lerp(species.tail.restFan, species.tail.maxFan, clamp(p.tailFan, -0.5, 1)) * DEG;
    for (const r of rig.rectrices) r.bone.quaternion.setFromAxisAngle(Y, r.k * fan);

    // --- wings ------------------------------------------------------------------
    for (const s of SIDES) {
      const w = rig.wings[s];
      const wp = p.wing[s];
      const k = smoothstep(0, 1, wp.spread);
      for (let i = 0; i < w.bones.length; i++) w.bones[i].quaternion.copy(w.folded[i]).slerp(w.spread[i], k);
      if (k > 0 && (wp.sweep !== 0 || wp.raise !== 0)) {
        // the stroke: the whole spread wing swung about the shoulder, in the chest's frame
        qA.setFromAxisAngle(Y, -sideSign(s) * wp.sweep * k);
        qB.setFromAxisAngle(Z, sideSign(s) * wp.raise * k);
        w.bones[0].quaternion.premultiply(qB).premultiply(qA);
      }
      const fold = 1 - k;
      if (fold > 0) {
        const ax = wingAxes[s];
        const fore = w.bones[1];
        // (the free tips follow a flick only a little: most of it is the resting wing's feathers lifting)
        fore.quaternion.multiply(qA.setFromAxisAngle(ax.out, -wp.lift * 0.3 * fold));
        fore.quaternion.multiply(qA.setFromAxisAngle(ax.fan, -sideSign(s) * wp.droop * fold));
      }
    }

    // --- legs: feet stay planted, the tarsus reaches for the hip ---------
    qA.setFromAxisAngle(Z, p.feetSlope);
    const open = (1 - clamp(p.grip, 0, 1)) * 0.6;
    for (const { s, foot, footRest, toes, tarsus: b } of legs) {
      // each foot sits on the twig where it is: along its slope, sized to its thickness
      foot.position.copy(footRest.pos).applyQuaternion(qA);
      foot.quaternion.copy(qA);
      foot.scale.setScalar(p.feetScale);
      for (let i = 0; i < 4; i++) toes[i].quaternion.setFromAxisAngle(X, i === 3 ? open : -open);
      // ankle in root space, then the tarsus reaches for the hip (in the foot's frame)
      v2.copy(rig.ankle[s]).sub(footRest.worldPos).multiplyScalar(p.feetScale).applyQuaternion(qA).add(foot.position);
      v.copy(rig.hipSocket[s]).applyQuaternion(qHips).add(bones.hips.position).sub(v2);
      const len = v.length();
      v.applyQuaternion(qB.copy(qA).invert());
      basisQuat(v, X, b.quaternion);
      b.scale.set(1, 1, len / rig.tarsusLength / p.feetScale);
    }

    // --- feathers -----------------------------------------------------------------
    uniforms.uFluff.value = p.fluff;
    uniforms.uLift.value.set(p.lift);
    // the crest channel also stands the plain head feathers up (they sit at the bill end of the profile)
    uniforms.uLift.value[0] += p.crest * 0.9;
    uniforms.uLift.value[1] += p.crest * 0.7;
    uniforms.uGorget.value = p.gorget;
    uniforms.uCrest.value = p.crest;
    uniforms.uWingSpread.value.set(p.wing.L.spread, p.wing.R.spread);
    uniforms.uWingOut.value.set(p.wing.L.out, p.wing.L.twist, p.wing.R.out, p.wing.R.twist);
    uniforms.uWingLift.value.set(p.wing.L.lift, p.wing.R.lift);
  } as Solver;
  applyPose.tip = tip;
  applyPose.carry = carry;
  applyPose.billReach = tipLen;
  return applyPose;
}

