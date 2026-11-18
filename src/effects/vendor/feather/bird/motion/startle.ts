import type { Pose } from '../pose';
import { Spring } from '../util';
import type { Layer, Mind } from './mind';

// A fright: the bird drops into a crouch, slicks every feather flat, flicks
// its wings half-open, then freezes, staring, before it starts scanning again.
export class StartleLayer implements Layer {
  readonly name = 'startle';
  private crouch = new Spring(4.2, 0.42);
  private t0 = -100;
  private strength = 0;

  constructor(private mind: Mind) {}

  fire(strength: number) {
    const m = this.mind;
    this.strength = strength;
    this.t0 = m.t;
    m.arousal = Math.max(m.arousal, 0.6 + 0.4 * strength);
    m.freeze = 0.45 + m.rng() * 0.55;
    this.crouch.kick(-0.9 * strength);
    m.emit('startle', { strength });
  }

  update(m: Mind, p: Pose) {
    const c = this.crouch.step(0, m.dt);
    p.bodyShift.y += c;
    p.bodyPitch += -c * 2.2;
    p.headShift.y += c * 0.6;
    const tau = m.t - this.t0;
    if (tau < 0 || tau > 8) return;
    const s = this.strength;
    // sleek: decays over a few seconds
    const sleek = Math.exp(-tau / 1.6) * Math.min(tau / 0.05, 1);
    p.fluff -= 0.13 * sleek * s;
    p.headShift.y += 0.02 * sleek * s;
    // wing flick
    const flick = Math.exp(-tau / 0.09) * Math.min(tau / 0.03, 1);
    p.wing.L.lift += flick * 0.42 * s;
    p.wing.R.lift += flick * 0.42 * s;
    // eyes wide
    p.lidUpper -= 0.2 * sleek;
    p.lidLower -= 0.2 * sleek;
  }
}

