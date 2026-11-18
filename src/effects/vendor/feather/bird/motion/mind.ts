import * as THREE from 'three';
import type { Species } from '../species';
import type { Pose } from '../pose';
import { clamp, damp, mulberry32, type Rng } from '../util';

// Shared state every behaviour layer reads and writes: how alert the bird is,
// what it is attending to, and a tiny event bus so layers can react to each
// other (a blink rides a saccade, a ruffle follows a fright).

export interface MindEvents {
  saccade: { amp: number; dur: number; dyaw: number; dpitch: number };
  fixate: { yaw: number; pitch: number };
  startle: { strength: number };
  ruffle: { kind: string };
  /** it winds up to strike at a food item (once per windup: a quick second stab after a miss is the same strike) */
  strike: { id: number };
  /** something went down the hatch */
  ate: { id: number };
  /** the feet press on the twig at world x, a push-off or a landing (push ~1 for a flight); on: standing on it after */
  perch: { x: number; push: number; on: boolean; side: number };
}

type Handler<K extends keyof MindEvents> = (e: MindEvents[K]) => void;

export class Mind {
  t = 0;
  dt = 0;
  rng: Rng;
  /** 0 drowsy … 1 on high alert */
  arousal = 0.3;
  baseline = 0.32;
  /** root-local point of interest, or null */
  attention: THREE.Vector3 | null = null;
  /** how fast the point of interest sweeps across the bird's view, rad/s, smoothed */
  attentionSpeed = 0;
  /** seconds left of holding dead still after a fright */
  freeze = 0;
  /** true while the head is mid-saccade */
  saccading = false;
  /** food in the air, root-local, refreshed every frame by the bird */
  food: { id: number; pos: THREE.Vector3; vel: THREE.Vector3 }[] = [];
  /** something that outranks the general point of interest: the gaze goes bill-on and keeps re-fixating it */
  focus: THREE.Vector3 | null = null;
  /** bumps whenever the focus becomes a different thing */
  focusId = 0;
  /** from the strike until the swallow: mouth and neck are spoken for */
  eating = false;
  /** the head is busy (a strike): no saccades */
  gazeLock = false;
  /** debug: pin the gaze to [yaw, pitch, roll] degrees */
  pinGaze: [number, number, number] | null = null;
  /** debug: silence the spontaneous behaviours */
  quiet = false;

  private handlers: { [K in keyof MindEvents]?: Handler<K>[] } = {};
  private lastDir = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private hasLast = false;

  constructor(readonly species: Species, seed = 7) {
    this.rng = mulberry32(seed);
  }

  on<K extends keyof MindEvents>(type: K, fn: Handler<K>) {
    ((this.handlers[type] ??= []) as Handler<K>[]).push(fn);
  }

  emit<K extends keyof MindEvents>(type: K, e: MindEvents[K]) {
    for (const fn of (this.handlers[type] ?? []) as Handler<K>[]) fn(e);
  }

  excite(amount: number) {
    this.arousal = clamp(this.arousal + amount, 0, 1);
  }

  step(dt: number, headPos: THREE.Vector3) {
    this.dt = dt;
    this.t += dt;
    this.freeze = Math.max(0, this.freeze - dt);
    // things moving across its view keep it alert
    if (this.attention && dt > 0) {
      this.dir.copy(this.attention).sub(headPos).normalize();
      if (this.hasLast) {
        const w = this.dir.angleTo(this.lastDir) / dt;
        this.attentionSpeed = damp(this.attentionSpeed, Math.min(w, 6), 6, dt);
      }
      this.lastDir.copy(this.dir);
      this.hasLast = true;
    } else {
      this.hasLast = false;
      this.attentionSpeed = damp(this.attentionSpeed, 0, 4, dt);
    }
    this.excite(Math.max(this.attentionSpeed - 0.25, 0) * 0.5 * dt);
    this.arousal = damp(this.arousal, this.baseline, 0.14, dt);
  }
}

export interface Layer {
  readonly name: string;
  update(mind: Mind, pose: Pose): void;
}

