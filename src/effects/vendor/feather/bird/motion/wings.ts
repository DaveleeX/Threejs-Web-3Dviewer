import type { Pose } from '../pose';
import { rand, smoothstep } from '../util';
import type { Layer, Mind } from './mind';

// Wing re-fold: the folded wings pop off the flanks, jiggle and tuck back,
// one a beat behind the other.
export class WingLayer implements Layer {
  readonly name = 'wings';
  private t0 = -100;
  private nextAt: number;
  private lead = 1;
  private amp = 1;

  constructor(mind: Mind) {
    const [a, b] = mind.species.behaviour.wingEvery;
    this.nextAt = rand(mind.rng, a * 0.5, b * 0.6);
  }

  shuffle(m: Mind) {
    this.t0 = m.t;
    this.lead = m.rng() < 0.5 ? 1 : -1;
    this.amp = rand(m.rng, 0.7, 1.2);
    const [a, b] = m.species.behaviour.wingEvery;
    this.nextAt = m.t + rand(m.rng, a, b);
  }

  update(m: Mind, p: Pose) {
    if (!m.quiet && m.t >= this.nextAt && m.freeze <= 0) this.shuffle(m);
    const tau = m.t - this.t0;
    if (tau < 0 || tau > 1.2) return;
    for (const side of ['L', 'R'] as const) {
      const x = tau - ((side === 'L' ? 1 : -1) * this.lead > 0 ? 0 : 0.07);
      if (x <= 0) continue;
      const env = smoothstep(0, 0.07, x) * (1 - smoothstep(0.22, 0.6, x));
      const jig = Math.sin(x * 12 * Math.PI * 2) * smoothstep(0.05, 0.1, x) * (1 - smoothstep(0.2, 0.42, x));
      p.wing[side].lift += (env * 0.2 + jig * 0.06) * this.amp;
      p.wing[side].droop += env * 0.1 * this.amp;
    }
    const b = smoothstep(0, 0.08, tau) * (1 - smoothstep(0.15, 0.5, tau));
    p.bodyShift.y += b * 0.006;
    p.addLift(0.5, 0.25, b * 0.12);
  }
}

