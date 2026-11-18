// Small math helpers shared by the rig, the feathers and the motion layers.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const saturate = (x: number) => clamp(x, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const DEG = Math.PI / 180;

export function smoothstep(a: number, b: number, x: number) {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Uniform Catmull-Rom through scalar keys, t in [0, n-1]. Ends are clamped. */
export function catmull(keys: ArrayLike<number>, t: number) {
  const n = keys.length;
  const tt = clamp(t, 0, n - 1);
  const i = Math.min(Math.floor(tt), n - 2);
  const f = tt - i;
  const p0 = keys[Math.max(i - 1, 0)];
  const p1 = keys[i];
  const p2 = keys[i + 1];
  const p3 = keys[Math.min(i + 2, n - 1)];
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
}

/** Frame-rate independent exponential approach. */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** damp for an angle, radians: turns the short way round */
export function dampAngle(current: number, target: number, lambda: number, dt: number) {
  return current + Math.atan2(Math.sin(target - current), Math.cos(target - current)) * (1 - Math.exp(-lambda * dt));
}

function hash1(i: number, seed: number) {
  let h = (i * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x: number, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i, seed), hash1(i + 1, seed), u) * 2 - 1;
}

/** Random in [a, b]. */
export const rand = (rng: Rng, a: number, b: number) => a + (b - a) * rng();

/** Skewed hold-time sampler: mostly short, sometimes long. */
export function randSkew(rng: Rng, min: number, max: number, power = 2) {
  return min + (max - min) * Math.pow(rng(), power);
}

/** Critically-damped-ish spring with adjustable damping ratio. */
export class Spring {
  x = 0;
  v = 0;
  constructor(public freq = 6, public zeta = 0.5) {}
  step(target: number, dt: number) {
    const w = this.freq * Math.PI * 2;
    // semi-implicit, sub-stepped for stability at 20 fps
    const n = Math.max(1, Math.ceil(dt * this.freq * 8));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-w * w * (this.x - target) - 2 * this.zeta * w * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  kick(impulse: number) {
    this.v += impulse;
  }
}

