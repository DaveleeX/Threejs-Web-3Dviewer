import type { Pose } from '../pose';
import { rand, Spring } from '../util';
import type { Layer, Mind } from './mind';

// Tail flicks and pumps: a quick dip and rebound through an underdamped
// spring, the rectrices fanning for an instant.
export class TailLayer implements Layer {
  readonly name = 'tail';
  private pitch = new Spring(6.5, 0.28);
  private fan = new Spring(4.5, 0.5);
  private yaw = new Spring(5, 0.4);
  private nextAt: number;
  private pumps = 0;
  private pumpAt = 0;

  constructor(mind: Mind) {
    const [a, b] = mind.species.behaviour.tailEvery;
    this.nextAt = rand(mind.rng, a * 0.4, b * 0.5);
    mind.on('startle', (e) => {
      this.pitch.kick(-5 * e.strength);
      this.fan.kick(14 * e.strength);
    });
    mind.on('saccade', (e) => {
      // a big head turn tips the balance; the tail answers
      if (e.amp > 0.9) this.yaw.kick(-e.dyaw * 0.5);
    });
  }

  flick(m: Mind, strength = 1) {
    this.pitch.kick(-rand(m.rng, 3, 5.5) * strength);
    this.fan.kick(rand(m.rng, 5, 11) * strength);
    this.yaw.kick(rand(m.rng, -1.5, 1.5) * strength);
  }

  update(m: Mind, p: Pose) {
    if (!m.quiet && m.t >= this.nextAt && m.freeze <= 0) {
      const [a, b] = m.species.behaviour.tailEvery;
      this.nextAt = m.t + rand(m.rng, a, b);
      this.pumps = m.rng() < 0.4 ? 1 + Math.floor(m.rng() * 2) : 0;
      this.pumpAt = m.t + 0.16;
      this.flick(m);
    }
    if (this.pumps > 0 && m.t >= this.pumpAt) {
      this.pumps--;
      this.pumpAt = m.t + rand(m.rng, 0.13, 0.2);
      this.flick(m, 0.7);
    }
    p.tailPitch += this.pitch.step(0, m.dt);
    p.tailFan += Math.max(this.fan.step(0, m.dt), -0.3);
    p.tailYaw += this.yaw.step(0, m.dt);
  }
}

