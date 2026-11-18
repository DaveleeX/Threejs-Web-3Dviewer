import type { Pose } from '../pose';
import { damp, rand, smoothstep } from '../util';
import type { Layer, Mind } from './mind';

// Small business of the bill and tongue outside of feeding.
//
// The tongue flick: every now and then a calm hummingbird shoots its tongue straight out
// past the bill tip and back, a quarter of a bill in a fifth of a second, often a few times
// in a row, the bill barely parting. Also most times after eating.
//
// Singing: nothing like a songbird's gape. The bill chatters open and shut a few times,
// fast and small, in short bursts; what you really see is the throat pumping (the gorget
// swelling and settling with each burst) while the forehead and the breast draw in a touch.
// It sings from sing(), and on its own when it has been calm for a while.

interface Burst {
  /** seconds from the start of the song */
  at: number;
  /** open-and-shut cycles */
  notes: number;
  hz: number;
  /** gape, in jaw units */
  amp: number;
}

export class MouthLayer implements Layer {
  readonly name = 'mouth';
  /** seconds between idle tongue flicks, min and max */
  lickEvery: [number, number] = [14, 36];
  /** seconds between songs of its own, min and max */
  singEvery: [number, number] = [30, 80];
  /** something else has the bird's attention (off the perch, preening, hopping) */
  blocked: () => boolean = () => false;

  // a run of flicks: start time and reach of each
  private flicks: { at: number; amp: number }[] = [];
  private nextLick: number;
  private singFrom = -10;
  private singFor = 0;
  private bursts: Burst[] = [];
  private nextSing: number;
  /** the throat, lagging behind the bursts */
  private pump = 0;

  constructor(mind: Mind) {
    this.nextLick = rand(mind.rng, 5, 14);
    this.nextSing = rand(mind.rng, 14, 34);
    mind.on('ate', () => {
      // wipe the bill afterwards, most times
      if (mind.rng() < 0.7) this.nextLick = mind.t + rand(mind.rng, 0.25, 0.6);
    });
    mind.on('startle', () => {
      this.singFor = 0;
      this.flicks.length = 0;
      this.nextLick = mind.t + rand(mind.rng, 8, 16);
      this.nextSing = Math.max(this.nextSing, mind.t + rand(mind.rng, 12, 30));
    });
  }

  /** Flick the tongue: `count` flicks in a row, the first reaching `amount` (0 … 1 of its travel). */
  lick(m: Mind, amount = rand(m.rng, 0.56, 0.68), count = m.rng() < 0.45 ? 1 : m.rng() < 0.6 ? 2 : 3) {
    this.flicks.length = 0;
    let at = m.t;
    for (let i = 0; i < count; i++) {
      this.flicks.push({ at, amp: i === 0 ? amount : amount * rand(m.rng, 0.8, 1.05) });
      at += rand(m.rng, 0.21, 0.3);
    }
    this.nextLick = m.t + rand(m.rng, this.lickEvery[0], this.lickEvery[1]);
  }

  /** Sing for about this long: bursts of bill chatter with the throat pumping. */
  sing(m: Mind, seconds = 1.6) {
    this.singFrom = m.t;
    this.bursts.length = 0;
    let at = 0.06;
    while (at < seconds - 0.2 || this.bursts.length === 0) {
      const notes = 3 + Math.floor(m.rng() * 3);
      const hz = rand(m.rng, 13, 16.5);
      this.bursts.push({ at, notes, hz, amp: rand(m.rng, 0.26, 0.4) });
      // a breath between bursts, a longer one now and then
      at += notes / hz + (m.rng() < 0.25 ? rand(m.rng, 0.32, 0.5) : rand(m.rng, 0.1, 0.22));
    }
    const last = this.bursts[this.bursts.length - 1];
    this.singFor = last.at + last.notes / last.hz + 0.25;
    this.nextSing = m.t + this.singFor + rand(m.rng, this.singEvery[0], this.singEvery[1]);
    this.flicks.length = 0;
    this.nextLick = Math.max(this.nextLick, m.t + this.singFor + rand(m.rng, 1.5, 5));
  }

  get singing() {
    return this.singFor > 0;
  }

  update(m: Mind, p: Pose) {
    const calm = !m.quiet && !m.gazeLock && !m.focus && !m.eating && m.freeze <= 0 && !this.blocked();
    if (calm && m.t >= this.nextLick && m.arousal < 0.6 && !this.singing) this.lick(m);
    if (calm && m.t >= this.nextSing && !this.singing) {
      // only when nothing is going on; otherwise ask again in a while
      if (m.arousal < 0.42 && this.flicks.length === 0) this.sing(m, rand(m.rng, 1.1, 2.4));
      else this.nextSing = m.t + rand(m.rng, 4, 9);
    }

    // --- tongue: out along the bill and back
    let tongue = 0;
    for (const f of this.flicks) {
      const x = (m.t - f.at) / 0.19;
      // out quicker than in
      if (x >= 0 && x <= 1) tongue = Math.max(tongue, f.amp * Math.sin(Math.PI * Math.pow(smoothstep(0, 1, x), 0.8)));
    }
    if (this.flicks.length && m.t > this.flicks[this.flicks.length - 1].at + 0.2) this.flicks.length = 0;
    if (tongue > 0) {
      // (0.62 of its travel is a fifth of a bill past the tip)
      p.tongueOut += Math.min(tongue, 0.7);
      // it hangs a little under its own weight
      p.tongueCurl += 0.16 * smoothstep(0.3, 0.6, tongue);
      // the mandibles part just enough to let it through
      p.jaw += 0.02 * smoothstep(0, 0.3, tongue);
    }

    // --- song
    let burst = 0;
    let note = 0;
    let amp = 0;
    const s = m.t - this.singFrom;
    if (this.singFor > 0) {
      if (s > this.singFor || this.blocked()) this.singFor = 0;
      else {
        for (const b of this.bursts) {
          const u = s - b.at;
          const len = b.notes / b.hz;
          if (u < 0 || u > len) continue;
          burst = smoothstep(0, 0.03, u) * (1 - smoothstep(len - 0.03, len, u));
          note = 0.5 - 0.5 * Math.cos(u * b.hz * Math.PI * 2);
          amp = b.amp;
        }
      }
    }
    // the throat fills over a burst and lets go in the gap: slower than the bill
    this.pump = damp(this.pump, burst, burst > this.pump ? 30 : 11, m.dt);
    const k = this.pump;
    if (k < 0.002 && burst === 0) return;
    // bill: small, fast, never quite shut inside a burst
    p.jaw += burst * amp * (0.1 + 0.9 * note);
    // throat out
    p.gorget += k * 0.2 + burst * note * 0.05;
    p.addLift(0.2, 0.07, k * 0.16);
    // forehead and breast in: the feathers sleek down and the sternum draws back
    p.crest -= k * 0.14;
    p.addLift(0.0, 0.07, -k * 0.14);
    p.addLift(0.4, 0.09, -k * 0.3);
    p.breath -= k * 0.7;
    // the head rides it: bill up a hair, a nod on each note
    p.headPitch += k * 0.035 + burst * note * 0.012;
    p.headShift.y -= k * 0.004;
    p.headShift.z -= k * 0.003;
    p.tailPitch -= k * 0.03;
  }
}

