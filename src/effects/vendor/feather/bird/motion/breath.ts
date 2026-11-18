import type { Pose } from '../pose';
import { lerp } from '../util';
import type { Layer, Mind } from './mind';

// Fast shallow breathing. A hummingbird at rest runs at a few breaths per
// second; you see it in the breast, the flank feathers and the tail.
export class BreathLayer implements Layer {
  readonly name = 'breath';
  private phase = 0;

  update(m: Mind, p: Pose) {
    const [calm, alert] = m.species.behaviour.breathHz;
    this.phase += m.dt * lerp(calm, alert, m.arousal) * Math.PI * 2;
    // quick in, slower out
    const b = Math.sin(this.phase + 0.45 * Math.sin(this.phase)) * lerp(0.75, 1.1, m.arousal);
    p.breath += b;
    p.addLift(0.42, 0.2, b * 0.014);
    p.tailPitch += b * 0.011;
    p.bodyShift.y += b * 0.0012;
    p.wing.L.lift += b * 0.005;
    p.wing.R.lift += b * 0.005;
  }
}

