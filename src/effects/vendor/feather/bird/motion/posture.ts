import type { Pose } from '../pose';
import { damp, lerp, noise1, Spring } from '../util';
import type { Layer, Mind } from './mind';

// Posture follows mood: drowsy = fluffed, round, head sunk into the shoulders;
// alert = sleek, tall, leaning in. Plus the slow weight shifts of a small
// animal balancing on a twig, and the body's reaction to its own head snaps.
export class PostureLayer implements Layer {
  readonly name = 'posture';
  private a = 0.3;
  private yaw = new Spring(3.2, 0.5);
  private follow = 0;
  private pitch = new Spring(5, 0.45);
  private headYaw = 0;

  constructor(mind: Mind) {
    mind.on('saccade', (e) => {
      // a fast head turn nudges the light body the other way
      this.yaw.kick(-e.dyaw * 0.5);
      this.pitch.kick(-e.dpitch * 0.4);
    });
    mind.on('fixate', (e) => (this.headYaw = e.yaw));
  }

  update(m: Mind, p: Pose) {
    this.a = damp(this.a, m.arousal, 2.5, m.dt);
    const a = this.a;
    p.fluff += lerp(0.2, -0.06, a);
    p.headShift.y += lerp(-0.032, 0.03, a);
    p.headShift.z += lerp(-0.014, 0.012, a);
    p.bodyPitch += lerp(-0.04, 0.05, a);
    p.bodyShift.y += lerp(-0.012, 0.008, a);
    // alert: the feathers on the crown stand a little higher
    p.crest += lerp(0, 0.22, a);
    p.wing.L.droop += lerp(0.05, 0, a);
    p.wing.R.droop += lerp(0.05, 0, a);

    // slow balance drift
    const t = m.t;
    p.bodyRoll += noise1(t * 0.17, 1) * 0.022;
    p.bodyShift.x += noise1(t * 0.13, 2) * 0.006;
    p.bodyPitch += noise1(t * 0.21, 3) * 0.012;

    // the body lazily follows where the head has settled
    this.follow = damp(this.follow, this.headYaw * 0.14, 0.9, m.dt);
    p.bodyYaw += this.follow + this.yaw.step(0, m.dt) + noise1(t * 0.11, 4) * 0.025;
    p.chestPitch += this.pitch.step(0, m.dt);
  }
}

