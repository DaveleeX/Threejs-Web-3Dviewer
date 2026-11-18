import type { Pose } from '../pose';
import { lerp, rand, smoothstep } from '../util';
import type { Layer, Mind } from './mind';

// Feather maintenance. Three flavours:
//   puff   – the contour feathers rise in a wave from the head down, the body
//            shivers them back into place, and they settle with a soft overshoot
//   shake  – the same with the head joining in
//   throat – the gorget and crown flare for a moment
// The lift is written into the pose's lift profile, so it really is the
// feathers hinging away from the skin, not the body scaling.
export type RuffleKind = 'puff' | 'shake' | 'throat';

export class RuffleLayer implements Layer {
  readonly name = 'ruffle';
  private kind: RuffleKind = 'puff';
  private t0 = -100;
  private nextAt: number;
  private amp = 0.6;
  /** when it last ruffled: the shake-off after a fright waits for the same gap */
  private last = -1e9;

  constructor(mind: Mind) {
    const [a, b] = mind.species.behaviour.ruffleEvery;
    this.nextAt = rand(mind.rng, a * 0.5, b * 0.6);
    mind.on('startle', () => {
      // displacement behaviour: shake it off once the fright has passed
      this.t0 = -100;
      this.nextAt = Math.max(mind.t + rand(mind.rng, 2.8, 5), this.last + mind.species.behaviour.ruffleEvery[0]);
    });
  }

  /** amp: how hard, 0..1 (random 0.45..0.75 when left out) */
  trigger(m: Mind, kind?: RuffleKind, amp?: number) {
    const r = m.rng();
    this.kind = kind ?? (r < 0.45 ? 'puff' : r < 0.7 ? 'shake' : 'throat');
    this.t0 = m.t;
    this.last = m.t;
    this.amp = amp ?? rand(m.rng, 0.45, 0.75);
    const [a, b] = m.species.behaviour.ruffleEvery;
    this.nextAt = m.t + rand(m.rng, a, b);
    m.emit('ruffle', { kind: this.kind });
  }

  update(m: Mind, p: Pose) {
    if (!m.quiet && m.t >= this.nextAt && m.freeze <= 0 && !m.saccading) {
      if (m.arousal < 0.7) this.trigger(m);
      else this.nextAt = m.t + 1;
    }
    const tau = m.t - this.t0;
    if (tau < 0 || tau > 3) return;
    const A = this.amp;

    if (this.kind === 'throat') {
      const env = smoothstep(0, 0.12, tau) * (1 - smoothstep(0.7, 1.25, tau));
      p.gorget += env * 0.42 * A;
      p.crest += env * 0.38 * A;
      p.addLift(0.12, 0.14, env * 0.25 * A);
      p.headShift.y += env * 0.01;
      return;
    }

    // the wave: each station along the body starts a little later than the one before
    for (let i = 0; i < 8; i++) {
      const x = tau - (i / 7) * 0.2;
      if (x <= 0) continue;
      const rise = smoothstep(0, 0.13, x);
      const fall = 1 - smoothstep(0.62, 1.5, x);
      const wobble = x > 0.62 ? 0.14 * Math.sin((x - 0.62) * 13) * Math.exp(-(x - 0.62) * 3.5) : 0;
      p.lift[i] += A * (rise * fall + wobble) * lerp(0.75, 1, i / 7);
    }
    p.crest += A * 0.25 * smoothstep(0, 0.1, tau) * (1 - smoothstep(0.5, 1.1, tau));

    // the shiver that drops the feathers back in place
    const win = smoothstep(0.14, 0.24, tau) * (1 - smoothstep(0.55, 0.85, tau));
    const ph = (tau - 0.14) * 14 * Math.PI * 2;
    const s = Math.sin(ph) * win;
    p.bodyRoll += s * 0.05 * A;
    p.bodyYaw += Math.cos(ph) * win * 0.035 * A;
    p.tailYaw += Math.sin(ph - 1.2) * win * 0.16 * A;
    p.tailFan += win * 0.55 * A + smoothstep(0, 0.2, tau) * (1 - smoothstep(0.6, 1.4, tau)) * 0.25 * A;
    for (const side of ['L', 'R'] as const) {
      p.wing[side].lift += (win * 0.11 + Math.abs(s) * 0.05) * A + smoothstep(0, 0.2, tau) * (1 - smoothstep(0.7, 1.5, tau)) * 0.06 * A;
      p.wing[side].droop += win * 0.07 * A;
    }
    p.bodyShift.y += win * 0.008;
    if (this.kind === 'shake') {
      // head joins: fast roll/yaw, eyes shut for the worst of it
      const hw = smoothstep(0.1, 0.2, tau) * (1 - smoothstep(0.5, 0.75, tau));
      p.headRoll += Math.sin(ph * 1.15 + 0.8) * hw * 0.3 * A;
      p.headYaw += Math.cos(ph * 1.15) * hw * 0.16 * A;
      p.nict += hw;
      p.lidLower += hw * 0.6;
      p.headStabil -= hw * 0.5;
    }
  }
}

