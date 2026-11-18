import * as THREE from 'three';
import type { SceneEffect } from './EffectHost';
import type { QualityTier } from '../core/settings';

export const WATER_PRESETS = {
  calm: { amplitude: 0.025, speed: 0.65, color: '#287c8c', roughness: 0.16 },
  ocean: { amplitude: 0.16, speed: 1.2, color: '#146578', roughness: 0.24 },
} as const;
export type WaterPreset = keyof typeof WATER_PRESETS;

/** Analytic surface waves, not a fluid solver. No external assets or renderer. */
export class WaterEffect implements SceneEffect {
  readonly id = 'water';
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material = new THREE.MeshPhysicalMaterial({
    color: '#287c8c', metalness: 0, roughness: 0.16,
    ior: 1.333, clearcoat: 1, clearcoatRoughness: 0.08,
    side: THREE.DoubleSide,
  });
  private readonly mesh: THREE.Mesh;
  private time = 0;
  private amplitude = 0.025;
  private speed = 0.65;

  constructor(tier: QualityTier) {
    const segments = tier === 'low' ? 32 : tier === 'medium' ? 64 : 96;
    this.geometry = new THREE.PlaneGeometry(1, 1, segments, segments);
    this.geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'Water surface';
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.setSize(10);
    this.setHeight(-0.02);
    this.update(0);
  }

  mount(scene: THREE.Scene): void { scene.add(this.mesh); }
  setHeight(value: number): void { this.mesh.position.y = value; }
  setSize(value: number): void { this.mesh.scale.set(Math.max(0.1, value), 1, Math.max(0.1, value)); }
  setAmplitude(value: number): void { this.amplitude = Math.max(0, value); }
  setSpeed(value: number): void { this.speed = Math.max(0, value); }
  setColor(value: string): void { this.material.color.set(value); }
  setPreset(preset: WaterPreset): void {
    const p = WATER_PRESETS[preset];
    this.amplitude = p.amplitude;
    this.speed = p.speed;
    this.material.color.set(p.color);
    this.material.roughness = p.roughness;
  }

  update(delta: number): void {
    this.time += delta * this.speed;
    const positions = this.geometry.attributes.position;
    const normals = this.geometry.attributes.normal;
    const size = this.mesh.scale.x;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i) * size;
      const z = positions.getZ(i) * size;
      const a = x * 2.1 + z * 0.7 + this.time;
      const b = x * -1.3 + z * 3.2 + this.time * 1.4;
      positions.setY(i, this.amplitude * (Math.sin(a) + 0.4 * Math.sin(b)));
      const dx = this.amplitude * (2.1 * Math.cos(a) - 0.52 * Math.cos(b));
      const dz = this.amplitude * (0.7 * Math.cos(a) + 1.28 * Math.cos(b));
      // Inverse scale is applied by the normal matrix during rendering.
      normals.setXYZ(i, -dx * size, 1, -dz * size);
    }
    positions.needsUpdate = true;
    normals.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
