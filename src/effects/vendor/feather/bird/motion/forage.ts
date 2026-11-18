import * as THREE from 'three';
import type { Pose, Solver } from '../pose';
import { clamp, damp, lerp, rand, smoothstep } from '../util';
import type { HopLayer } from './hop';
import type { Layer, Mind } from './mind';

// Picking food out of the air. A seed drifting into view takes over the gaze
// (mind.focus: the gaze layer goes bill-on and keeps re-fixating it). If it is
// within reach, after a moment of sizing it up the bird strikes: a small
// wind-up, then the bill tip is driven onto the seed's predicted position by
// the solver's reach IK in well under a fifth of a second, the bill opening on
// the way and snapping shut on contact. Then a short hold, the neck folds
// back, and a gulp with a little toss of the head.

type State = 'idle' | 'watch' | 'windup' | 'strike' | 'hold' | 'retract' | 'eat' | 'swallow';

const minJerk = (u: number) => u * u * u * (10 + u * (-15 + 6 * u));

/** slower than this (per second) and a thing out of reach counts as keeping still */
const STILL = 0.06;

export class ForageLayer implements Layer {
  readonly name = 'forage';
  /** how far the neck will unfold / tuck to bring the bill tip onto a seed */
  reachOut = 0.3;
  reachIn = 0.2;
  /** how close the tip must be when the bill shuts for it to count */
  catchRadius = 0.05;

  state: State = 'idle';
  private id = -1;
  private t0 = 0;
  private dur = 0.15;
  private decideAt = 0;
  private watchUntil = 0;
  private readyAt = 0;
  private retried = false;
  private ignore = new Map<number, number>();
  private target = new THREE.Vector3();
  private w = 0;
  private wFrom = 0;
  private lean = 0;
  private yaw = 0;
  private rel = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private licks = 3;
  private carried = -1;
  private hopAt = 0;
  private moved = new THREE.Vector3();

  constructor(
    private mind: Mind,
    private solver: Solver,
    private headRest: THREE.Vector3,
    private pick: (id: number) => void,
    private swallowed: (id: number) => void,
    private hop: HopLayer | null = null,
  ) {
    mind.on('startle', () => {
      // a fright drops everything (whatever was in the bill is gone too)
      if (this.carried >= 0) this.swallowed(this.carried);
      this.carried = -1;
      this.release(this.mind, 'idle');
      this.readyAt = this.mind.t + 1.5;
    });
  }

  private seed(m: Mind) {
    return m.food.find((f) => f.id === this.id);
  }

  /** How much the neck would have to unfold (+) or tuck (−) for the tip to touch p; null if out of reach. */
  private slideFor(p: THREE.Vector3): number | null {
    const r = this.rel.copy(p).sub(this.headRest);
    const dist = r.length();
    const yaw = Math.atan2(r.x, r.z);
    const elev = Math.asin(clamp(r.y / Math.max(dist, 1e-6), -1, 1));
    if (Math.abs(yaw) > 2.0 || elev < -0.95 || elev > 1.3 || p.y < -0.12) return null;
    const slide = dist - this.solver.billReach;
    return slide > this.reachOut || slide < -this.reachIn ? null : slide;
  }

  private inView(p: THREE.Vector3) {
    const r = this.rel.copy(p).sub(this.headRest);
    return Math.abs(Math.atan2(r.x, r.z)) < 2.2 && r.length() < 2.2 && p.y > -0.9;
  }

  private release(m: Mind, to: State) {
    this.state = to;
    this.t0 = m.t;
    this.wFrom = this.w;
    if (to === 'idle') {
      m.focus = null;
      m.gazeLock = false;
      this.id = -1;
    }
  }

  private begin(m: Mind, to: State, dur: number) {
    this.state = to;
    this.t0 = m.t;
    this.dur = dur;
    this.wFrom = this.w;
  }

  update(m: Mind, p: Pose) {
    const t = m.t;
    const u = clamp((t - this.t0) / this.dur, 0, 1);
    let seed = this.seed(m);
    m.eating = this.state !== 'idle' && this.state !== 'watch';

    switch (this.state) {
      case 'idle': {
        this.w = damp(this.w, 0, 22, m.dt);
        if (t < this.readyAt) break;
        // the nearest thing worth a look
        let best = null as (typeof m.food)[number] | null;
        let bestD = Infinity;
        for (const f of m.food) {
          if (!this.inView(f.pos)) continue;
          // seen it already: only worth another look once it comes within reach
          if ((this.ignore.get(f.id) ?? 0) > t && this.slideFor(f.pos) === null) continue;
          // out of reach, a thing that keeps still doesn't catch the eye: only motion does
          if (f.vel.lengthSq() < STILL * STILL && this.slideFor(f.pos) === null) continue;
          const d = f.pos.distanceTo(this.headRest) - (this.slideFor(f.pos) !== null ? 1 : 0);
          if (d < bestD) {
            bestD = d;
            best = f;
          }
        }
        if (best) {
          this.id = best.id;
          this.state = 'watch';
          this.decideAt = 0;
          // a look, not a stare: out of reach it gets a glance and the bird goes on with its business
          this.watchUntil = t + rand(m.rng, 0.7, 1.5);
          m.focus = this.focus.copy(best.pos);
          m.focusId++;
          m.excite(0.25);
        }
        break;
      }
      case 'watch': {
        this.w = damp(this.w, 0, 22, m.dt);
        if (!seed || !this.inView(seed.pos)) {
          this.release(m, 'idle');
          break;
        }
        m.focus = this.focus.copy(seed.pos);
        if (this.hop?.busy) break; // mid-hop: keep watching, decide after landing
        if (this.slideFor(seed.pos) === null) {
          // out of reach: just watch it go by for a while
          this.decideAt = 0;
          // unless a sidestep along the perch would bring it in reach: then hop over
          if (this.hop && m.freeze <= 0) {
            if (!this.hopAt) this.hopAt = t + rand(m.rng, 0.45, 1.1);
            if (t >= this.hopAt) {
              const sp = seed.pos;
              const x = this.hop.spotFor((move) => this.slideFor(this.moved.copy(sp).sub(move)) !== null);
              this.hopAt = t + rand(m.rng, 0.5, 0.9);
              if (x !== null && this.hop.go(m, x)) {
                this.watchUntil = Math.max(this.watchUntil, t + 3);
                break;
              }
            }
          }
          // it stopped moving out there: done with it soon
          if (seed.vel.lengthSq() < STILL * STILL) this.watchUntil = Math.min(this.watchUntil, t + 0.25);
          if (t > this.watchUntil) {
            this.ignore.set(seed.id, t + rand(m.rng, 25, 45));
            this.release(m, 'idle');
            this.readyAt = t + rand(m.rng, 0.3, 1);
          }
          break;
        }
        // in reach: size it up for a moment, bill-on, then go
        this.hopAt = 0;
        if (!this.decideAt) this.decideAt = t + rand(m.rng, 0.35, 1.1);
        if (t >= this.decideAt && !m.saccading && m.freeze <= 0) {
          m.gazeLock = true;
          this.retried = false;
          this.begin(m, 'windup', rand(m.rng, 0.09, 0.13));
          m.emit('strike', { id: seed.id });
        }
        break;
      }
      case 'windup': {
        if (!seed) {
          this.release(m, 'idle');
          break;
        }
        // a hair of recoil before the strike
        const k = Math.sin(u * Math.PI * 0.5);
        this.rel.copy(seed.pos).sub(this.headRest).normalize();
        p.headShift.addScaledVector(this.rel, -0.03 * k);
        p.bodyShift.y -= 0.006 * k;
        if (u >= 1) {
          const slide = this.slideFor(seed.pos) ?? 0;
          this.lean = slide;
          this.yaw = Math.atan2(seed.pos.x - this.headRest.x, seed.pos.z - this.headRest.z);
          this.begin(m, 'strike', clamp(0.13 + Math.abs(slide) * 0.2, 0.12, 0.2));
        }
        break;
      }
      case 'strike': {
        if (!seed) {
          this.begin(m, 'retract', 0.2);
          break;
        }
        // lead it: aim where it will be when the bill gets there
        this.target.copy(seed.pos).addScaledVector(seed.vel, (1 - u) * this.dur);
        this.w = this.wFrom + (1 - this.wFrom) * (1 - Math.pow(1 - u, 3));
        p.jaw += smoothstep(0.2, 0.7, u) * (1 - smoothstep(0.92, 1, u) * 0.88) * 0.95;
        if (u >= 1) {
          if (this.solver.tip.distanceTo(seed.pos) < this.catchRadius) {
            this.pick(seed.id);
            this.carried = seed.id;
            m.excite(0.1);
            this.begin(m, 'hold', rand(m.rng, 0.06, 0.1));
          } else if (!this.retried && this.slideFor(seed.pos) !== null) {
            // missed: one quick second stab
            this.retried = true;
            this.begin(m, 'strike', 0.1);
          } else {
            this.ignore.set(seed.id, t + rand(m.rng, 3, 5));
            this.begin(m, 'retract', 0.22);
          }
        }
        break;
      }
      case 'hold':
        this.w = 1;
        p.jaw += 0.1; // the seed is held in the very tip
        if (u >= 1) {
          // the neck folds back while the tongue is already working the seed in
          m.focus = null;
          this.licks = 2;
          this.begin(m, 'eat', this.licks * 0.13 + 0.04);
        }
        break;
      case 'retract':
        // (after a miss: nothing in the bill, just come back)
        this.w = this.wFrom * (1 - minJerk(u));
        if (u >= 1) {
          this.release(m, 'idle');
          this.readyAt = t + rand(m.rng, 0.3, 0.9);
        }
        break;
      case 'eat': {
        // two fast licks: each runs out under the seed and draws it half the bill back, the
        // bill parting for it and closing in a small chew between
        this.w = this.wFrom * (1 - minJerk(clamp((t - this.t0) / 0.2, 0, 1)));
        const x = clamp(((t - this.t0) / (this.dur - 0.04)) * this.licks, 0, this.licks);
        const i = Math.min(Math.floor(x), this.licks - 1);
        const f = x >= this.licks ? 1 : x - i;
        const from = 1 - i / this.licks;
        const to = 1 - (i + 1) / this.licks;
        const outK = Math.sin(Math.PI * smoothstep(0, 0.55, f));
        // tongue tip sits at 0.8 of the bill when in; reach just past where the seed is
        p.tongueOut += clamp(((from - 0.72) / 0.65) * outK + 0.04 * outK, 0, 1);
        p.carryAt = lerp(from, to + 0.04, smoothstep(0.35, 1, f));
        p.jaw += 0.12 + 0.3 * Math.sin(Math.PI * smoothstep(0, 0.7, f)) - 0.08 * smoothstep(0.75, 1, f);
        p.headPitch += 0.03 * Math.sin(Math.PI * f);
        if (u >= 1) this.begin(m, 'swallow', rand(m.rng, 0.36, 0.44));
        break;
      }
      case 'swallow': {
        // gulp: a quick toss of the head, the bill parts and shuts, the throat bobs
        this.w = 0;
        p.carryAt = 0.04;
        const toss = Math.sin(Math.PI * smoothstep(0, 0.55, u)) * 0.26;
        p.headPitch += toss;
        p.headShift.y += toss * 0.03;
        p.jaw += Math.sin(Math.PI * smoothstep(0.1, 0.5, u)) * 0.45;
        const bob = Math.sin(Math.PI * smoothstep(0.35, 0.95, u));
        p.gorget += bob * 0.16;
        p.addLift(0.2, 0.12, bob * 0.12);
        if (u > 0.18 && this.carried >= 0) {
          // it has gone down
          this.swallowed(this.carried);
          m.emit('ate', { id: this.carried });
          this.carried = -1;
        }
        if (u >= 1) {
          this.release(m, 'idle');
          this.readyAt = t + rand(m.rng, 0.4, 1.3);
        }
        break;
      }
    }

    if (this.w > 0.001) {
      p.reachTarget.copy(this.target);
      p.reachWeight = this.w;
      // the body goes with it: lean into a long reach, rock back from a close one, turn a little
      p.bodyPitch += this.w * clamp(this.lean * 0.75, -0.16, 0.24);
      p.bodyYaw += this.w * this.yaw * 0.14;
      p.bodyShift.y -= this.w * 0.008;
      p.headStabil *= 1 - this.w;
    }
  }
}

