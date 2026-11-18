import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { SceneEffect } from './EffectHost';

// Three r185 caches transmission targets by camera id. Reusing reflection cameras
// prevents every mirror re-enable beside glass/jelly from allocating a retained target.
const reflectionCameras = new WeakMap<THREE.Scene, WeakMap<THREE.Camera, THREE.Camera>>();

export class AtmosphereEffect implements SceneEffect {
  readonly id = 'atmosphere';
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.PointsMaterial;
  private readonly points: THREE.Points;
  constructor(private readonly count: number, private readonly speed: number) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) positions.set([
      ((i * 0.754877666) % 1 - 0.5) * 12, ((i * 0.569840296) % 1) * 8,
      ((i * 0.438579021) % 1 - 0.5) * 12], i * 3);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.PointsMaterial({ color: '#a9cce9', size: 0.025, transparent: true, opacity: 0.5, depthWrite: false });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }
  mount(scene: THREE.Scene): void { scene.add(this.points); }
  update(delta: number): void {
    const p = this.geometry.attributes.position;
    for (let i = 0; i < this.count; i++) p.setY(i, (p.getY(i) - delta * this.speed * 3 + 8) % 8);
    p.needsUpdate = true;
  }
  dispose(): void { this.points.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}

/** Local planar reflection; deliberately labelled mirror rather than rough wet asphalt. */
export class ReflectiveFloorEffect implements SceneEffect {
  readonly id = 'reflection';
  private readonly geometry = new THREE.PlaneGeometry(12, 12);
  private readonly reflector: Reflector;
  constructor(resolution: number) {
    this.reflector = new Reflector(this.geometry, { textureWidth: resolution, textureHeight: resolution,
      clipBias: 0.003, color: 0x777777 });
    this.reflector.rotation.x = -Math.PI / 2;
    this.reflector.position.y = -0.03;
  }
  mount(scene: THREE.Scene): void {
    let cameras = reflectionCameras.get(scene);
    if (!cameras) { cameras = new WeakMap(); reflectionCameras.set(scene, cameras); }
    (this.reflector as Reflector & { _reflectionCameras: WeakMap<THREE.Camera, THREE.Camera> })._reflectionCameras = cameras;
    scene.add(this.reflector);
  }
  update(): void {}
  dispose(): void { this.reflector.removeFromParent(); this.reflector.dispose(); this.geometry.dispose(); }
}
