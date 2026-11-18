import * as THREE from 'three';
import type { Pose } from '../pose';
import type { PerchFrame } from '../types';
import { clamp, damp, lerp, rand, smoothstep, Spring } from '../util';
import type { Layer, Mind } from './mind';

// Sidestepping along the perch. The bird's root is moved here while it is on the
// twig, and in flee.ts while it is off it (the hop on hold till it lands): a hop
// is a crouch, a short ballistic arc to another spot on the twig with the wings
// flicked off the body and the toes open, and a landing the legs soak up. The
// feet are re-set to the twig's local slope and thickness. The head is held back
// against the jump (the bird keeps looking at whatever it was looking at) and
// catches up after landing.

/** Where the bird stands: owned by createBird, fed by setPerch. */
export interface Ground {
  root: THREE.Object3D;
  at: ((x: number, out: PerchFrame) => PerchFrame | null) | null;
  range: [number, number];
  restRadius: number;
}

const newFrame = (): PerchFrame => ({ point: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), tangent: new THREE.Vector3(1, 0, 0), radius: 0.0405 });

export class HopLayer implements Layer {
  readonly name = 'hop';
  /** longest single hop along the perch */
  maxHop = 0.35;
  /** after this long with nothing to eat, wander back toward the middle (0 = never) */
  homeAfter: [number, number] = [14, 30];
  /** where on the perch it likes to sit, and drifts back to */
  home = 0;

  /** something else is moving the bird (it has flown): no hops until released */
  hold = false;
  /** where on the perch the bird stands (world x) */
  x = 0;
  private phase: 'stand' | 'crouch' | 'air' | 'land' = 'stand';
  private t0 = 0;
  private dur = 0.1;
  private x0 = 0;
  private x1 = 0;
  private apex = 0.05;
  private from = newFrame();
  private to = newFrame();
  private here = newFrame();
  private tmp = newFrame();
  private legs = new Spring(5.5, 0.4);
  private lag = new THREE.Vector3();
  private anchor = new THREE.Vector3();
  private off = new THREE.Vector3();
  private slope = 0;
  private scale = 1;
  private placed = false;
  private homeAt = 20;
  private lastFood = 0;

  constructor(
    mind: Mind,
    private ground: Ground,
  ) {
    mind.on('startle', (e) => {
      // a fright can send it a step along the twig
      if (this.hold || this.phase !== 'stand' || mind.eating || mind.rng() > 0.55 * e.strength) return;
      const d = rand(mind.rng, 0.1, 0.2) * (mind.rng() < 0.5 ? -1 : 1);
      const x = this.clampX(this.x + d);
      if (Math.abs(x - this.x) > 0.06) this.go(mind, x, 0.05);
    });
  }

  get busy() {
    return this.phase !== 'stand';
  }

  private clampX(x: number) {
    return clamp(x, this.ground.range[0], this.ground.range[1]);
  }

  private frame(x: number, out: PerchFrame) {
    const f = this.ground.at?.(x, out) ?? null;
    if (!f) {
      // no perch known: a level twig through the root's height
      out.point.set(x, this.ground.root.position.y, this.ground.root.position.z);
      out.up.set(0, 1, 0);
      out.tangent.set(1, 0, 0);
      out.radius = this.ground.restRadius;
    }
    return out;
  }

  /** The perch changed under the bird (new twig): stand on it where we are. */
  reseat() {
    this.placed = false;
  }

  /**
   * Where to hop so that `ok` comes to hold: the nearest spot on the perch from which it
   * does, or, if that is more than one hop away, one hop toward it. `ok` is given how far
   * the root would have moved (so the caller can ask "would the seed be in reach from
   * there?"). null if nowhere on the perch will do.
   */
  spotFor(ok: (rootMove: THREE.Vector3) => boolean): number | null {
    if (!this.ground.at) return null;
    const span = this.ground.range[1] - this.ground.range[0];
    for (let d = 0.1; d <= span + 1e-6; d += 0.05) {
      for (const sgn of [1, -1]) {
        const x = this.x + sgn * d;
        if (x < this.ground.range[0] || x > this.ground.range[1]) continue;
        const f = this.ground.at(x, this.tmp);
        if (!f) continue;
        if (ok(this.off.copy(f.point).sub(this.here.point))) return this.x + sgn * Math.min(d, this.maxHop);
      }
    }
    return null;
  }

  /** The bird will come down at world x (clamped): from now on that is where it stands. Returns the x, fills in the point. */
  place(x: number, out: THREE.Vector3) {
    this.x = this.clampX(x);
    this.frame(this.x, this.here);
    this.slope = Math.atan2(this.here.tangent.y, this.here.tangent.x);
    this.scale = this.here.radius / this.ground.restRadius;
    out.copy(this.here.point);
    return this.x;
  }

  /** It just touched down from flight: the legs take it. */
  landed() {
    this.legs.kick(-1.1);
    this.follow();
  }

  /** The root was moved from outside: the head does not lag behind it. */
  follow() {
    this.anchor.copy(this.ground.root.position);
  }

  /** Hop to world x on the perch (clamped to the allowed range and to one hop). */
  go(m: Mind, x: number, crouch = rand(m.rng, 0.07, 0.11)) {
    if (this.hold || this.phase !== 'stand') return false;
    x = this.clampX(clamp(x, this.x - this.maxHop, this.x + this.maxHop));
    if (Math.abs(x - this.x) < 0.03) return false;
    this.x0 = this.x;
    this.x1 = x;
    this.frame(this.x0, this.from);
    this.frame(this.x1, this.to);
    const dist = this.from.point.distanceTo(this.to.point);
    this.apex = clamp(0.035 + dist * 0.13, 0.04, 0.08);
    this.phase = 'crouch';
    this.t0 = m.t;
    this.dur = crouch;
    m.excite(0.15);
    return true;
  }

  update(m: Mind, p: Pose) {
    const root = this.ground.root;
    if (!this.placed) {
      this.placed = true;
      this.x = this.clampX(root.position.x);
      this.frame(this.x, this.here);
      root.position.copy(this.here.point);
      this.anchor.copy(root.position);
      this.slope = Math.atan2(this.here.tangent.y, this.here.tangent.x);
      this.scale = this.here.radius / this.ground.restRadius;
    }
    const t = m.t;
    const u = clamp((t - this.t0) / this.dur, 0, 1);
    let grip = 1;

    // nothing to eat for a while: drift back toward the middle of the perch
    if (m.food.length) this.lastFood = t;
    if (this.phase === 'stand' && !this.hold && this.homeAfter[1] > 0 && !m.quiet && !m.eating && m.freeze <= 0 && Math.abs(this.x - this.home) > 0.12 && t - this.lastFood > 4 && t > this.homeAt) {
      this.go(m, this.home + (this.x - this.home) * 0.3);
      this.homeAt = t + rand(m.rng, this.homeAfter[0], this.homeAfter[1]);
    }

    switch (this.phase) {
      case 'crouch': {
        const k = Math.sin(u * Math.PI * 0.5);
        p.bodyShift.y -= 0.022 * k;
        p.bodyPitch += 0.07 * k;
        p.wing.L.lift += 0.1 * k;
        p.wing.R.lift += 0.1 * k;
        if (u >= 1) {
          m.emit('perch', { x: this.x0, push: 0.45, on: false, side: 0 });
          this.phase = 'air';
          this.t0 = t;
          this.dur = clamp(0.12 + this.from.point.distanceTo(this.to.point) * 0.38, 0.12, 0.25);
        }
        break;
      }
      case 'air': {
        // ballistic: steady along the twig, a parabola over it
        root.position.copy(this.from.point).lerp(this.to.point, u);
        root.position.y += 4 * this.apex * u * (1 - u);
        this.slope = lerp(Math.atan2(this.from.tangent.y, this.from.tangent.x), Math.atan2(this.to.tangent.y, this.to.tangent.x), u);
        this.scale = lerp(this.from.radius, this.to.radius, u) / this.ground.restRadius;
        const air = Math.sin(Math.PI * u);
        grip = 1 - smoothstep(0, 0.2, u) * (1 - smoothstep(0.75, 1, u));
        // legs push off, tuck, then reach for the landing
        p.bodyShift.y += 0.014 * (1 - u) - 0.012 * air + 0.008 * smoothstep(0.7, 1, u);
        p.bodyPitch += 0.07 * (1 - u) - 0.04 * air;
        const side = Math.sign(this.x1 - this.x0);
        p.bodyRoll += -side * 0.07 * air;
        p.wing.L.lift += 0.1 + 0.3 * air;
        p.wing.R.lift += 0.1 + 0.3 * air;
        p.wing.L.droop += 0.12 * air;
        p.wing.R.droop += 0.12 * air;
        p.tailFan += 0.5 * air;
        p.tailPitch += 0.12 * air;
        p.fluff -= 0.05 * air;
        if (u >= 1) {
          this.x = this.x1;
          this.frame(this.x, this.here);
          root.position.copy(this.here.point);
          this.phase = 'land';
          this.t0 = t;
          this.dur = 0.28;
          this.legs.kick(-0.75);
          m.emit('perch', { x: this.x1, push: 0.55, on: true, side: 0 });
        }
        break;
      }
      case 'land': {
        const k = 1 - smoothstep(0, 1, u);
        p.wing.L.lift += 0.1 * k;
        p.wing.R.lift += 0.1 * k;
        p.tailFan += 0.3 * k;
        p.tailPitch -= 0.1 * Math.sin(Math.PI * u) * 0.8;
        p.addLift(0.55, 0.3, 0.14 * Math.sin(Math.PI * smoothstep(0, 0.8, u)));
        if (u >= 1) this.phase = 'stand';
        break;
      }
      default:
        break;
    }
    // the legs soak up the landing
    const c = this.legs.step(0, m.dt);
    p.bodyShift.y += c;
    p.bodyPitch += -c * 1.6;

    // head lock: the head stays behind where the body has just jumped from, then catches up
    this.anchor.x = damp(this.anchor.x, root.position.x, this.phase === 'air' ? 9 : 16, m.dt);
    this.anchor.y = damp(this.anchor.y, root.position.y, this.phase === 'air' ? 9 : 16, m.dt);
    this.anchor.z = damp(this.anchor.z, root.position.z, 16, m.dt);
    this.lag.copy(this.anchor).sub(root.position).clampLength(0, 0.16);
    p.headShift.add(this.lag);

    // feet follow the twig: its slope, its thickness; toes open in the air
    p.feetSlope = this.slope;
    p.feetScale = this.scale;
    p.grip = grip;
    p.bodyRoll += this.slope * 0.12;
  }
}

