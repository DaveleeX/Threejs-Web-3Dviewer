import * as THREE from 'three';
import type { Pose } from '../pose';
import { clamp, DEG, lerp, noise1, rand, randSkew } from '../util';
import type { Layer, Mind } from './mind';

// The head. Birds do not sweep their gaze: they snap between fixations
// (saccades, 40-80 ms) and then hold perfectly still. With eyes on the sides of
// the head they look at something either bill-on or by turning one eye to it,
// so the same point of interest produces both the frontal pose (gorget ablaze)
// and the profile.

interface Fix {
  yaw: number;
  pitch: number;
  roll: number;
}

const minJerk = (u: number) => u * u * u * (10 + u * (-15 + 6 * u));

export class GazeLayer implements Layer {
  readonly name = 'gaze';
  /** widest head turn relative to straight ahead, radians */
  maxYaw = 70 * DEG;
  /** chance that a new fixation concerns the point of interest (scaled up by arousal) */
  interest = 0.5;
  /** of the fixations on the point of interest, the share made bill-on (the rest turn one eye to it) */
  billOn = 0.46;
  /**
   * 0..1: follow a moving point of interest smoothly between saccades (set by
   * the scene while the pointer moves). Near the target the head glides after
   * it with a lag; too far off, it jumps to catch up.
   */
  pursuit = 0;
  /** lowest the bill may point (negative is below horizontal): a glance down, never straight down */
  minPitch = -45 * DEG;
  /** for food it may dip a little further */
  minPitchFood = -50 * DEG;

  private cur: Fix;
  private from: Fix;
  private to: Fix;
  private moving = false;
  private t0 = 0;
  private dur = 0.06;
  private amp = 0;
  private nextAt = 0.8;
  private settle = 10;
  private burst = 0;
  private attYaw = 0;
  private attPitch = 0;
  private seenYaw = 0;
  private seenPitch = 0;
  private lastStart = -10;
  private focusSeen = -1;
  private focusAt = 0;
  private head = new THREE.Vector3(0, 0.9, 0.05);
  private d = new THREE.Vector3();

  constructor(mind: Mind) {
    const up = mind.species.behaviour.billUp * DEG;
    this.cur = { yaw: 0.9, pitch: up, roll: 0 };
    this.from = { ...this.cur };
    this.to = { ...this.cur };
    mind.on('startle', () => {
      // snap to the threat, bill-on, almost at once
      this.nextAt = mind.t + 0.04 + mind.rng() * 0.04;
      this.burst = -1;
    });
  }

  /** Done with what it was looking at: on to something else shortly. */
  moveOn(m: Mind) {
    this.burst = 0;
    this.nextAt = Math.min(this.nextAt, m.t + rand(m.rng, 0.12, 0.4));
  }

  private lookAtAttention(m: Mind) {
    const at = m.focus ?? m.attention;
    if (!at) return false;
    this.d.copy(at).sub(this.head);
    this.attYaw = Math.atan2(this.d.x, this.d.z);
    this.attPitch = Math.atan2(this.d.y, Math.hypot(this.d.x, this.d.z));
    return true;
  }

  private pick(m: Mind, forceFrontal = false): Fix {
    const r = m.rng;
    const up = m.species.behaviour.billUp * DEG;
    const has = this.lookAtAttention(m);
    const c = this.cur;
    let f: Fix;
    if (!forceFrontal && this.burst > 0) {
      // a little run of small corrections around the current fixation
      this.burst--;
      f = { yaw: c.yaw + rand(r, -1, 1) * 13 * DEG, pitch: c.pitch + rand(r, -1, 1) * 8 * DEG, roll: c.roll * 0.5 + rand(r, -1, 1) * 9 * DEG };
    } else if (has && (forceFrontal || r() < this.interest + 0.4 * m.arousal)) {
      this.seenYaw = this.attYaw;
      this.seenPitch = this.attPitch;
      const mode = forceFrontal ? 0 : r();
      if (mode < this.billOn) {
        // bill-on: both eyes, chin up
        f = { yaw: this.attYaw + rand(r, -5, 5) * DEG, pitch: this.attPitch * 0.8 + up + rand(r, -4, 14) * DEG, roll: r() < 0.25 ? rand(r, -18, 18) * DEG : rand(r, -5, 5) * DEG };
      } else {
        // one eye: turn the side of the head to it. Prefer the nearer side, usually.
        const off = rand(r, 60, 84) * DEG;
        const near = Math.abs(c.yaw - (this.attYaw + off)) < Math.abs(c.yaw - (this.attYaw - off)) ? 1 : -1;
        let side = r() < 0.6 ? near : -near;
        if (Math.abs(this.attYaw + side * off) > this.maxYaw) side = -side;
        // tilt that eye a touch toward the target
        f = { yaw: this.attYaw + side * off, pitch: up * 0.6 + rand(r, -8, 12) * DEG, roll: side * (this.attPitch * 0.5 + rand(r, -4, 10) * DEG) };
      }
      if (r() < 0.35) this.burst = 1 + Math.floor(r() * 2);
    } else {
      // scan the surroundings
      // (never a full swing from one shoulder to the other)
      let yaw = clamp(rand(r, -1, 1) * 105 * DEG, c.yaw - 140 * DEG, c.yaw + 140 * DEG);
      if (Math.abs(yaw - c.yaw) < 22 * DEG) yaw += Math.sign(yaw - c.yaw || 1) * 30 * DEG;
      f = { yaw, pitch: up * 0.5 + rand(r, -14, 24) * DEG, roll: rand(r, -9, 9) * DEG };
      if (r() < 0.3) this.burst = 1 + Math.floor(r() * 2);
    }
    f.yaw = clamp(f.yaw, -this.maxYaw, this.maxYaw);
    f.pitch = clamp(f.pitch, this.minPitch, 52 * DEG);
    f.roll = clamp(f.roll, -26 * DEG, 26 * DEG);
    return f;
  }

  private begin(m: Mind, f: Fix) {
    const [a, b] = m.species.behaviour.saccade;
    this.from = { ...this.cur };
    this.to = f;
    const dy = f.yaw - this.from.yaw;
    const dp = f.pitch - this.from.pitch;
    const dr = f.roll - this.from.roll;
    this.amp = Math.hypot(dy * Math.cos((f.pitch + this.from.pitch) / 2), dp, dr * 0.5);
    this.dur = Math.min(a + (b * this.amp) / DEG, 0.095);
    this.t0 = m.t;
    this.moving = true;
    this.lastStart = m.t;
    m.saccading = true;
    m.emit('saccade', { amp: this.amp, dur: this.dur, dyaw: dy, dpitch: dp });
  }

  update(m: Mind, p: Pose) {
    const B = m.species.behaviour;
    if (m.pinGaze) {
      p.headYaw += m.pinGaze[0] * DEG;
      p.headPitch += m.pinGaze[1] * DEG;
      p.headRoll += m.pinGaze[2] * DEG;
      return;
    }

    if (m.focus && !this.moving && !m.gazeLock && this.lookAtAttention(m)) {
      // something to keep the bill on (food): go to it, then follow with small re-fixations
      const off = Math.hypot((this.attYaw - this.cur.yaw) * Math.cos(this.attPitch), this.attPitch - this.cur.pitch);
      const fresh = this.focusSeen !== m.focusId;
      if (fresh && !this.focusAt) this.focusAt = m.t + rand(m.rng, 0.09, 0.24);
      if ((fresh && m.t >= this.focusAt) || (!fresh && off > 6 * DEG && m.t - this.lastStart > 0.16 && m.rng() < m.dt * 9)) {
        this.focusSeen = m.focusId;
        this.focusAt = 0;
        this.burst = 0;
        this.begin(m, {
          yaw: clamp(this.attYaw, -this.maxYaw, this.maxYaw),
          pitch: clamp(this.attPitch + (fresh ? rand(m.rng, -3, 3) * DEG : 0), this.minPitchFood, 65 * DEG),
          roll: fresh ? rand(m.rng, -8, 8) * DEG : this.cur.roll * 0.6,
        });
      }
    } else if (!this.moving && !m.quiet && !m.focus && !m.gazeLock) {
      if (m.t >= this.nextAt && (m.freeze <= 0 || this.burst < 0)) {
        const startle = this.burst < 0;
        if (startle) this.burst = 0;
        this.begin(m, this.pick(m, startle));
      } else if (m.freeze <= 0 && m.t - this.lastStart > 0.22 && this.lookAtAttention(m)) {
        // the point of interest moved: react after a short, random latency
        const moved = Math.hypot((this.attYaw - this.seenYaw) * Math.cos(this.attPitch), this.attPitch - this.seenPitch);
        if (moved > 13 * DEG && m.rng() < m.dt * lerp(3, 9, m.arousal)) {
          this.burst = 0;
          this.begin(m, this.pick(m, m.rng() < 0.5));
          this.seenYaw = this.attYaw;
          this.seenPitch = this.attPitch;
        }
      }
    }

    if (!this.moving && this.pursuit > 0 && !m.focus && !m.gazeLock && m.freeze <= 0 && this.lookAtAttention(m)) {
      const up = B.billUp * DEG;
      const ty = clamp(this.attYaw, -this.maxYaw, this.maxYaw);
      const tp = clamp(this.attPitch * 0.8 + up * 0.6, this.minPitch, 52 * DEG);
      const err = Math.hypot((ty - this.cur.yaw) * Math.cos(tp), tp - this.cur.pitch);
      // a lag that builds up during a fast move gets snapped out now and then
      const snap = err > 14 * DEG && m.t - this.lastStart > 0.3 && m.rng() < m.dt * 5;
      if (err < 28 * DEG && !snap) {
        // smooth pursuit with a lag; the gain wobbles so it isn't robotic
        const g = 1 - Math.exp(-m.dt * 3.2 * this.pursuit * (0.75 + 0.35 * noise1(m.t * 3.1, 31)));
        this.cur = {
          yaw: this.cur.yaw + (ty - this.cur.yaw) * g,
          pitch: this.cur.pitch + (tp - this.cur.pitch) * g,
          roll: this.cur.roll * (1 - g * 0.5),
        };
        this.from = { ...this.cur };
        this.to = { ...this.cur };
        this.seenYaw = this.attYaw;
        this.seenPitch = this.attPitch;
        // while following, don't wander off at once; the odd glance away still happens
        if (err > 3 * DEG) this.nextAt = Math.max(this.nextAt, m.t + 0.25);
      } else if (snap || (m.t - this.lastStart > 0.16 && m.rng() < m.dt * 10)) {
        // behind: a catch-up saccade, bill-on
        this.burst = 0;
        this.begin(m, this.pick(m, true));
      }
    }

    let yaw: number;
    let pitch: number;
    let roll: number;
    if (this.moving) {
      const u = (m.t - this.t0) / this.dur;
      if (u >= 1) {
        this.moving = false;
        m.saccading = false;
        this.cur = { ...this.to };
        this.settle = 0;
        const frontal = Math.abs(this.cur.yaw - this.attYaw) < 15 * DEG;
        const [h0, h1] = [lerp(B.holdCalm[0], B.holdAlert[0], m.arousal), lerp(B.holdCalm[1], B.holdAlert[1], m.arousal)];
        // a fright that landed mid-saccade still gets its snap toward the threat
        this.nextAt = m.t + (this.burst < 0 ? 0.05 : this.burst > 0 ? rand(m.rng, 0.14, 0.42) : randSkew(m.rng, h0, h1, 1.8) * (frontal ? 1.15 : 1));
        m.emit('fixate', { yaw: this.cur.yaw, pitch: this.cur.pitch });
      }
      const e = minJerk(clamp(u, 0, 1));
      const arc = Math.sin(Math.PI * clamp(u, 0, 1));
      yaw = lerp(this.from.yaw, this.to.yaw, e);
      // the bill dips through a big turn: the head swings on an arc, not a line
      pitch = lerp(this.from.pitch, this.to.pitch, e) - arc * this.amp * 0.09;
      roll = lerp(this.from.roll, this.to.roll, e);
      p.headShift.y -= arc * Math.min(this.amp, 1.6) * 0.012;
    } else {
      // arrival: a hair of overshoot that rings out in a few frames
      this.settle += m.dt;
      const ring = Math.exp(-this.settle / 0.032) * Math.cos(this.settle * 24 * Math.PI * 2) * 0.04;
      yaw = this.cur.yaw + (this.to.yaw - this.from.yaw) * ring;
      pitch = this.cur.pitch + (this.to.pitch - this.from.pitch) * ring;
      roll = this.cur.roll + (this.to.roll - this.from.roll) * ring;
    }

    // held still: only tremor and the slowest drift remain
    yaw += noise1(m.t * 11, 11) * 0.0028 + noise1(m.t * 0.6, 12) * 0.008;
    pitch += noise1(m.t * 12, 13) * 0.0028 + noise1(m.t * 0.5, 14) * 0.007;
    roll += noise1(m.t * 0.7, 15) * 0.008;

    p.headYaw += yaw;
    p.headPitch += pitch;
    p.headRoll += roll;
    // the head leads with the bill: it shifts a little toward where it looks
    p.headShift.x += Math.sin(yaw) * 0.014;
    p.headShift.z += (Math.cos(yaw) - 1) * 0.01 - Math.max(pitch, 0) * 0.018;
  }
}

