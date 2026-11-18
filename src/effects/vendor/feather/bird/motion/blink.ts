import type { Pose } from '../pose';
import { lerp, rand, smoothstep } from '../util';
import type { Layer, Mind } from './mind';

// Birds blink mostly with the nictitating membrane: a milky film that flicks
// across the eye from the bill side and back in about a tenth of a second,
// often hidden inside a head saccade. The lower lid rises with it; full
// lid-closing blinks are rarer and slower.
export class BlinkLayer implements Layer {
  readonly name = 'blink';
  private t0 = -10;
  private full = false;
  private nextAt = 1.5;

  constructor(mind: Mind) {
    mind.on('saccade', (e) => {
      if (e.amp > 0.6 && mind.rng() < 0.45 && mind.t - this.t0 > 0.5) this.start(mind, false);
    });
    mind.on('startle', () => {
      this.nextAt = mind.t + 1.2 + mind.rng();
    });
  }

  private start(m: Mind, full: boolean) {
    this.t0 = m.t;
    this.full = full;
    const [a, b] = m.species.behaviour.blinkEvery;
    this.nextAt = m.t + rand(m.rng, a, b) * lerp(1.3, 0.8, m.arousal);
  }

  update(m: Mind, p: Pose) {
    if (!m.quiet && m.t >= this.nextAt && m.freeze <= 0) this.start(m, m.rng() < lerp(0.3, 0.08, m.arousal));
    const s = this.full ? 1.7 : 1;
    const x = (m.t - this.t0) / s;
    // close 45 ms, hold 25 ms, open 95 ms
    const k = x < 0 ? 0 : x < 0.045 ? smoothstep(0, 0.045, x) : x < 0.07 ? 1 : 1 - smoothstep(0.07, 0.165, x);
    p.nict += k;
    p.lidLower += k * (this.full ? 1 : 0.3);
    p.lidUpper += k * (this.full ? 0.75 : 0.08);
    // drowsy eyes sit a little closed
    const sleepy = smoothstep(0.3, 0.05, m.arousal);
    p.lidUpper += sleepy * 0.22;
    p.lidLower += sleepy * 0.18;
  }
}

