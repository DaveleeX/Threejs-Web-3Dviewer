import * as THREE from 'three';
import type { Bird, Food } from './types';
import { MOUNTAIN_GEM, type Species } from './species';
import { buildRig, type Rig } from './rig';
import { buildPlumageGeometry } from './plumageGeometry';
import { createPlumageDepthMaterial, createPlumageMaterial, type PlumageUniforms } from './plumageMaterial';
import { buildParts } from './parts';
import { createSolver, Pose } from './pose';
import { Mind, type Layer } from './motion/mind';
import { PostureLayer } from './motion/posture';
import { BreathLayer } from './motion/breath';
import { GazeLayer } from './motion/gaze';
import { BlinkLayer } from './motion/blink';
import { RuffleLayer, type RuffleKind } from './motion/ruffle';
import { TailLayer } from './motion/tail';
import { WingLayer } from './motion/wings';
import { StartleLayer } from './motion/startle';
import { ForageLayer } from './motion/forage';
import { MouthLayer } from './motion/mouth';
import { HopLayer, type Ground } from './motion/hop';
import { FleeLayer } from './motion/flee';
import { PreenLayer } from './motion/preen';

/** The bird plus the handles a UI, a debugger or a new behaviour would want. */
export interface BirdHandle extends Bird {
  species: Species;
  rig: Rig;
  pose: Pose;
  mind: Mind;
  /** Behaviour layers, run in order every frame. Push your own. */
  layers: Layer[];
  layer<T extends Layer>(name: string): T;
  /** Feather shader uniforms: uFlash and uGlint are free to tune. */
  plumage: PlumageUniforms;
  /** the feather meshes, for the scene's quality and drawing switches */
  feathers: { contour: THREE.SkinnedMesh; flight: THREE.SkinnedMesh; fuzz: THREE.SkinnedMesh };
  /** world-space position of the head bone */
  headPosition(out: THREE.Vector3): THREE.Vector3;
  /**
   * Take off and vanish, come back after a few seconds (see motion/flee.ts). Returns false
   * if it is already off or mid-hop.
   */
  flee(): boolean;
  /** true from the moment it gathers itself to leave until it is back on the perch, wings folded */
  readonly fleeing: boolean;
  /** true while it is out of sight */
  readonly away: boolean;
  /** on the twig: not off it in the air (gathering itself to go and settling after landing count) */
  readonly perched: boolean;
  /** Preen under a wing (a random one if not given). Returns false if it is busy. */
  preen(side?: 'L' | 'R'): boolean;
  readonly preening: boolean;
  /** off the perch, mid-hop, preening, or after food (watching it, striking, eating) */
  readonly busy: boolean;
  // The verbs below return false, and do nothing, while the bird is busy (ruffle aside).
  /** Sing for about this long (starts over if it already is). */
  sing(seconds?: number): boolean;
  readonly singing: boolean;
  /** Flick the tongue: `count` flicks, the first reaching `amount` (random when left out). */
  lick(amount?: number, count?: number): boolean;
  /** Hop to world x on the perch (clamped to its range and to one hop). */
  hopTo(x: number): boolean;
  /** Hop this far along the perch from where it stands. */
  hopBy(dx: number): boolean;
  /** Ruffle now, whatever it is doing, `amount` 0..1 (random when left out). Its own one-a-minute limit doesn't apply. */
  ruffle(kind: RuffleKind, amount?: number): void;
  /** Hook that runs after the layers and before the solver: last word on the pose. */
  onPose: ((pose: Pose, mind: Mind) => void) | null;
}

export interface BirdOptions {
  /** Host adaptation: avoid global debug state in the viewer. */
  debug?: boolean;
  species?: Species;
  seed?: number;
}

export function createBird(options: BirdOptions = {}): BirdHandle {
  const species = options.species ?? MOUNTAIN_GEM;
  const root = new THREE.Group();
  root.name = 'bird';

  const rig = buildRig(species);
  root.add(rig.rootBone);

  const plumageGeo = buildPlumageGeometry(rig);
  const { material: plumageMat, uniforms } = createPlumageMaterial();
  const contour = new THREE.SkinnedMesh(plumageGeo.contour, plumageMat);
  contour.name = 'bird.contour';
  const flight = new THREE.SkinnedMesh(plumageGeo.flight, plumageMat);
  flight.name = 'bird.flight';
  const fuzz = new THREE.SkinnedMesh(plumageGeo.fuzz, plumageMat);
  fuzz.name = 'bird.fuzz';
  fuzz.frustumCulled = false;
  fuzz.bind(rig.skeleton, new THREE.Matrix4());
  fuzz.receiveShadow = true;
  const plumageDepth = createPlumageDepthMaterial(uniforms);
  for (const m of [contour, flight]) {
    m.customDepthMaterial = plumageDepth;
    m.castShadow = true;
    m.frustumCulled = false;
    m.bind(rig.skeleton, new THREE.Matrix4());
    m.receiveShadow = true;
  }
  const parts = buildParts(rig);
  root.add(contour, flight, fuzz, ...parts.meshes);

  const pose = new Pose();
  const solve = createSolver(rig, uniforms);
  const mind = new Mind(species, options.seed ?? species.seed);
  const startle = new StartleLayer(mind);
  const ground: Ground = { root, at: null, range: [0, 0], restRadius: species.legs.perchRadius };
  const hop = new HopLayer(mind, ground);
  const forage = new ForageLayer(mind, solve, rig.rest.head.worldPos.clone(), (id) => handle.onPick?.(id), (id) => handle.onSwallow?.(id), hop);
  const mouth = new MouthLayer(mind);
  const ruffle = new RuffleLayer(mind);
  const tail = new TailLayer(mind);
  const flee = new FleeLayer(mind, rig, root, hop, ruffle, tail);
  const wingLayer = new WingLayer(mind);
  const preen = new PreenLayer(mind, rig, solve.billReach);
  mouth.blocked = () => flee.active || hop.busy || preen.active;
  // what the verbs wait for: the mouth's own block, and food (as the preen's)
  const busy = () => mouth.blocked() || forage.state !== 'idle';
  preen.blocked = () => flee.active || hop.busy || mind.eating || forage.state !== 'idle';
  preen.onDone = (m) => {
    wingLayer.shuffle(m);
    if (m.rng() < 0.5) ruffle.trigger(m, 'puff', 0.35);
  };
  const layers: Layer[] = [new PostureLayer(mind), new BreathLayer(), new GazeLayer(mind), new BlinkLayer(mind), ruffle, tail, wingLayer, forage, mouth, preen, hop, startle, flee];
  let food: ReadonlyArray<Food> = [];
  const foodPool: { id: number; pos: THREE.Vector3; vel: THREE.Vector3 }[] = [];

  const headRest = rig.rest.head.worldPos.clone();
  const local = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  let attention: THREE.Vector3 | null = null;

  const handle: BirdHandle = {
    root,
    species,
    rig,
    pose,
    mind,
    layers,
    layer: <T extends Layer>(name: string) => {
      const l = layers.find((x) => x.name === name);
      if (!l) throw new Error(`no layer ${name}`);
      return l as T;
    },
    plumage: uniforms,
    feathers: { contour, flight, fuzz },
    headPosition: (out) => rig.bones.head.getWorldPosition(out),
    onPose: null,
    flee: () => flee.start(),
    preen: (side) => preen.start(mind, side),
    get preening() {
      return preen.active;
    },
    get fleeing() {
      return flee.active;
    },
    get away() {
      return flee.gone;
    },
    get perched() {
      return flee.perched;
    },
    sing: (seconds) => !busy() && (mouth.sing(mind, seconds), true),
    get singing() {
      return mouth.singing;
    },
    lick: (amount, count) => !busy() && (mouth.lick(mind, amount, count), true),
    hopTo: (x) => !busy() && hop.go(mind, x),
    hopBy: (dx) => handle.hopTo(hop.x + dx),
    get busy() {
      return busy();
    },
    // (feathers can lift over anything else it is doing: no busy check)
    ruffle: (kind, amount) => ruffle.trigger(mind, kind, amount),
    update(dt) {
      root.updateWorldMatrix(true, false);
      inv.copy(root.matrixWorld).invert();
      mind.attention = attention ? local.copy(attention).applyMatrix4(inv) : null;
      // food into root space
      mind.food.length = 0;
      // (off the perch it is not feeding)
      for (let i = 0; i < (flee.active || preen.active ? 0 : food.length); i++) {
        const f = (foodPool[i] ??= { id: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
        f.id = food[i].id;
        f.pos.copy(food[i].position).applyMatrix4(inv);
        f.vel.copy(food[i].velocity).transformDirection(inv).multiplyScalar(food[i].velocity.length());
        mind.food.push(f);
      }
      mind.step(dt, headRest);
      pose.reset();
      for (const l of layers) l.update(mind, pose);
      handle.onPose?.(pose, mind);
      solve(pose);
    },
    setAttention(target) {
      attention = target;
    },
    setFood(items) {
      food = items;
    },
    setPerch(at, range) {
      ground.at = at;
      ground.range = range;
      hop.reseat();
    },
    onPick: null,
    onSwallow: null,
    billTip(out) {
      return out.copy(solve.carry).applyMatrix4(root.matrixWorld);
    },
    startle(strength = 1) {
      if (flee.active) return;
      startle.fire(Math.min(Math.max(strength, 0), 1));
      // a real fright sometimes sends it off altogether
      if (strength >= 0.9 && !mind.quiet && mind.rng() < 0.22) flee.start();
    },
    dispose() {
      plumageGeo.contour.dispose();
      plumageGeo.flight.dispose();
      plumageGeo.fuzz.dispose();
      plumageMat.dispose();
      plumageDepth.dispose();
      flee.dispose();
      parts.dispose();
      rig.skeleton.dispose();
      debugCleanup?.();
    },
  };

  const debugCleanup = options.debug ? installDebug(handle) : null;
  // settle into the first pose so frame 0 is not the bind pose
  handle.update(0);
  return handle;
}

/**
 * URL switches, all optional:
 *   ?gaze=yaw,pitch,roll   pin the head (degrees);  ?pose=front|profile|up|back as shortcuts
 *   ?quiet                 no spontaneous behaviour (breathing and tremor stay)
 *   ?arousal=0..1          pin the mood
 *   ?fluff=rad  ?spread=0..1  ?fan=0..1  ?blink=0..1
 *   ?bones  ?skin (hide feathers)  ?noflash
 * and window.__bird for poking.
 */
function installDebug(bird: BirdHandle) {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  (window as unknown as { __bird: BirdHandle }).__bird = bird;
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : null);
  const poses: Record<string, [number, number, number]> = { front: [0, 22, 0], profile: [88, 16, 0], up: [10, 40, 8], back: [-110, 10, 0], three: [38, 20, -4] };
  const pose = q.get('pose');
  if (pose && poses[pose]) bird.mind.pinGaze = poses[pose];
  const gaze = q.get('gaze');
  if (gaze) {
    const [y = 0, p = 0, r = 0] = gaze.split(',').map(Number);
    bird.mind.pinGaze = [y, p, r];
  }
  if (q.has('quiet')) bird.mind.quiet = true;
  if (q.has('sing')) {
    // debug: sing every few seconds
    const prev = bird.onPose;
    let next = 1;
    bird.onPose = (p, mind) => {
      prev?.(p, mind);
      if (mind.t > next && !bird.singing && bird.sing(1.8)) next = mind.t + 4;
    };
  }
  const jawOpen = num('jaw');
  const tongue = num('tongue');
  const arousal = num('arousal');
  const fluff = num('fluff');
  const spread = num('spread');
  const fan = num('fan');
  const blink = num('blink');
  if (arousal !== null || fluff !== null || spread !== null || fan !== null || blink !== null || jawOpen !== null || tongue !== null) {
    const before = bird.onPose;
    bird.onPose = (p, m) => {
      before?.(p, m);
      if (jawOpen !== null) p.jaw = jawOpen;
      if (tongue !== null) p.tongueOut = tongue;
      if (arousal !== null) m.arousal = m.baseline = arousal;
      if (fluff !== null) p.fluff = fluff;
      if (spread !== null) p.wing.L.spread = p.wing.R.spread = spread;
      if (fan !== null) p.tailFan = fan;
      if (blink !== null) p.nict = p.lidLower = p.lidUpper = blink;
    };
  }
  if (q.has('nofuzz')) bird.root.traverse((o) => o.name === 'bird.fuzz' && (o.visible = false));
  if (q.has('noflash')) bird.plumage.uFlash.value = bird.plumage.uGlint.value = 0;
  if (q.has('skin')) bird.root.traverse((o) => o.name.match(/contour|flight|fuzz/) && (o.visible = false));
  if (q.has('wire')) {
    bird.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (o.name === 'bird.skin' && m) {
        m.wireframe = true;
        m.color.set(0xffffff);
        m.emissive.set(0x888888);
      }
    });
  }
  let helper: THREE.SkeletonHelper | null = null;
  if (q.has('bones')) {
    helper = new THREE.SkeletonHelper(bird.rig.rootBone);
    (helper.material as THREE.LineBasicMaterial).depthTest = false;
    helper.renderOrder = 10;
    bird.root.add(helper);
  }
  return () => {
    helper?.dispose();
  };
}

export type { Bird } from './types';
export type { Species } from './species';
export { MOUNTAIN_GEM } from './species';
export { Pose } from './pose';
export type { Layer, Mind } from './motion/mind';
export type { GazeLayer } from './motion/gaze';
export type { MouthLayer } from './motion/mouth';
export type { RuffleLayer, RuffleKind } from './motion/ruffle';
export type { ForageLayer } from './motion/forage';
export type { HopLayer } from './motion/hop';
export type { FleeLayer } from './motion/flee';
export type { PreenLayer } from './motion/preen';

