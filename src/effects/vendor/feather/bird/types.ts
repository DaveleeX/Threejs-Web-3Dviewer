import type * as THREE from 'three';

// Contract between the scene (src/main.ts, src/env/*) and the bird (src/bird/*).
//
// Space: 1 unit ≈ 10 cm. The bird's local origin is the grip point between the
// two feet, on top of the perch. Forward is +Z, up is +Y. A perched
// hummingbird is about 1.1 units from feet to crown, the tail hangs below.
// The scene puts the perch so that its top surface passes through the origin.

export interface Food {
  id: number;
  /** world space, live (the scene moves it) */
  position: THREE.Vector3;
  /** world-space velocity, so the bird can lead a drifting seed */
  velocity: THREE.Vector3;
}

/** Where the perch is at a point along it, world space. */
export interface PerchFrame {
  /** top of the perch (where the grip point would sit) */
  point: THREE.Vector3;
  /** surface normal at the top, roughly up */
  up: THREE.Vector3;
  /** along the perch, toward +x */
  tangent: THREE.Vector3;
  /** perch radius there */
  radius: number;
}

export interface Bird {
  /** Add this to the scene. Already placed at its perch grip point. */
  root: THREE.Object3D;
  /** dt in seconds (clamped by the caller to ≤ 1/20) */
  update(dt: number): void;
  /**
   * World-space point the bird may pay attention to (the camera, the pointer).
   * null = nothing in particular. The bird decides when and how to look.
   */
  setAttention(target: THREE.Vector3 | null): void;
  /** Something sudden happened near the bird (click, key). */
  startle(strength?: number): void;
  /**
   * Food floating in the air (seeds), world space, refreshed every frame. The
   * scene owns and moves the objects; the bird decides whether one is worth
   * reaching for and how (IK on the neck so the bill tip meets it).
   */
  setFood(items: ReadonlyArray<Food>): void;
  /** Called once when the bill closes on an item. The scene then carries it on billTip until onSwallow. */
  onPick: ((id: number) => void) | null;
  /** Called once when a carried item has gone down (the scene removes it; it also gives up after 3 s). */
  onSwallow: ((id: number) => void) | null;
  /**
   * World-space point where a carried item sits: the bill tip at the pick,
   * then wherever the bird moves it (along the tongue, into the mouth).
   */
  billTip(out: THREE.Vector3): THREE.Vector3;
  /**
   * The perch, so the bird can hop along it. `at(x)` gives the perch frame at
   * world x (null where there is no perch); `range` is the x span it may use.
   * Called again when the perch changes (the Blender twig replacing the
   * procedural one).
   */
  setPerch(at: (x: number, out: PerchFrame) => PerchFrame | null, range: [number, number]): void;
  dispose(): void;
}

