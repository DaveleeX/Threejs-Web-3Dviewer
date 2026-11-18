import * as THREE from 'three';
import type { SceneEffect } from './EffectHost';

export type SurfaceKind = 'glass' | 'frosted' | 'gem' | 'metal' | 'carpaint' | 'jelly';
export class SurfaceEffect implements SceneEffect {
  readonly id = 'surface';
  readonly modelScoped = true;
  private readonly saved: Array<{ mesh: THREE.Mesh; material: THREE.Material | THREE.Material[];
    geometry: THREE.BufferGeometry; copy?: THREE.BufferGeometry; base?: Float32Array }> = [];
  private readonly material: THREE.MeshPhysicalMaterial;
  private time = 0;

  constructor(private readonly meshes: THREE.Mesh[], private readonly kind: SurfaceKind,
    private readonly strength = 1, private readonly speed = 1) {
    const common = { roughness: 0.05, metalness: 0, clearcoat: 1 };
    const definitions: Record<SurfaceKind, THREE.MeshPhysicalMaterialParameters> = {
      glass: { transmission: 1, thickness: 0.5, ior: 1.5, color: '#e1f6ff' },
      frosted: { transmission: 0.95, thickness: 0.5, roughness: 0.3, color: '#ddeeff' },
      gem: { transmission: 1, thickness: 1, ior: 2.1, dispersion: 0.7, color: '#c5eaff' },
      metal: { metalness: 1, roughness: 0.25, anisotropy: 0.8, color: '#b8bdc4' },
      carpaint: { metalness: 0.65, roughness: 0.22, clearcoatRoughness: 0.08, color: '#9d1731' },
      jelly: { transmission: 0.85, thickness: 1, ior: 1.36, attenuationColor: new THREE.Color('#82d42a'),
        attenuationDistance: 0.8, color: '#9ae04d', roughness: 0.12 },
    };
    this.material = new THREE.MeshPhysicalMaterial({ ...common, ...definitions[kind] });
  }

  mount(): void {
    for (const mesh of this.meshes) {
      const record: typeof this.saved[number] = { mesh, material: mesh.material, geometry: mesh.geometry };
      if (this.kind === 'jelly') {
        record.copy = mesh.geometry.clone();
        record.base = new Float32Array(mesh.geometry.attributes.position.array);
        mesh.geometry = record.copy;
      }
      this.saved.push(record);
      mesh.material = this.material;
    }
  }

  update(delta: number): void {
    if (this.kind !== 'jelly') return;
    this.time += delta * this.speed;
    // Volume-preserving elastic pulse; deliberately not a collision solver.
    const stretch = 1 + Math.sin(this.time * 3) * 0.12 * this.strength;
    const width = 1 / Math.sqrt(stretch);
    for (const item of this.saved) {
      const p = item.copy!.attributes.position;
      const base = item.base!;
      for (let i = 0; i < p.count; i++) p.setXYZ(i, base[i * 3] * width,
        base[i * 3 + 1] * stretch, base[i * 3 + 2] * width);
      p.needsUpdate = true;
      item.copy!.computeVertexNormals();
      item.copy!.computeBoundingSphere();
    }
  }

  dispose(): void {
    for (const item of this.saved) {
      item.mesh.material = item.material;
      item.mesh.geometry = item.geometry;
      item.copy?.dispose();
    }
    this.saved.length = 0;
    this.material.dispose();
  }
}
