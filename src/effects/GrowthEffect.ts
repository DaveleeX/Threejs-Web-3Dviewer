import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import type { SceneEffect } from './EffectHost';

export type GrowthKind = 'fur' | 'moss' | 'feather';
/** Seeded, area-weighted surface attachments on static source meshes. */
export class GrowthEffect implements SceneEffect {
  readonly id = 'growth';
  readonly modelScoped = true;
  private readonly batches: THREE.InstancedMesh[] = [];
  private readonly material: THREE.MeshPhysicalMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private time = 0;
  private readonly origins: Array<{ batch: THREE.InstancedMesh; matrices: THREE.Matrix4[] }> = [];
  constructor(private readonly meshes: THREE.Mesh[], private readonly kind: GrowthKind,
    private readonly count: number, private readonly length: number, private readonly speed: number) {
    this.geometry = kind === 'fur' ? new THREE.ConeGeometry(1, 1, 4) : organicGeometry(kind);
    if (kind === 'fur') this.geometry.translate(0, 0.5, 0);
    this.material = new THREE.MeshPhysicalMaterial({ color: kind === 'fur' ? '#b99b78' : '#4d792a',
      roughness: kind === 'feather' ? 0.3 : 0.85, sheen: 0.7,
      iridescence: kind === 'feather' ? 1 : 0, iridescenceIOR: 1.4,
      metalness: kind === 'feather' ? 0.45 : 0, side: THREE.DoubleSide });
  }

  mount(): void {
    let seed = 731;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const pos = new THREE.Vector3(), normal = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const dummy = new THREE.Object3D();
    // Fixed total budget, capped mesh count: no unbounded per-model allocations.
    const sources = this.meshes.slice(0, 32);
    for (const source of sources) {
      const n = Math.max(1, Math.floor(this.count / sources.length));
      // r185 runtime exposes this method; the installed @types omits it.
      const sampler = new MeshSurfaceSampler(source) as MeshSurfaceSampler & {
        setRandomGenerator(fn: () => number): MeshSurfaceSampler;
      };
      sampler.setRandomGenerator(random).build();
      const batch = new THREE.InstancedMesh(this.geometry, this.material, n);
      batch.name = `${this.kind} attachment`;
      const matrices: THREE.Matrix4[] = [];
      source.updateWorldMatrix(true, false);
      const scale = source.getWorldScale(new THREE.Vector3());
      const worldScale = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z), 0.0001);
      const len = this.length / worldScale;
      for (let i = 0; i < n; i++) {
        sampler.sample(pos, normal);
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(up, normal.normalize());
        const height = len * (0.55 + random() * 0.9);
        const radius = height * (this.kind === 'fur' ? 0.035 : this.kind === 'moss' ? 0.8 : 0.42);
        dummy.scale.set(radius, height, this.kind === 'feather' ? radius * 0.12 : radius);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
        batch.setMatrixAt(i, dummy.matrix);
        batch.setColorAt(i, new THREE.Color().setHSL(this.kind === 'fur' ? 0.09 : 0.21 + random() * 0.12,
          0.35 + random() * 0.25, 0.3 + random() * 0.25));
      }
      batch.castShadow = true;
      batch.receiveShadow = true;
      batch.frustumCulled = false;
      source.add(batch);
      this.batches.push(batch);
      this.origins.push({ batch, matrices });
    }
  }

  update(delta: number): void {
    this.time += delta * this.speed;
    const matrix = new THREE.Matrix4(), sway = new THREE.Matrix4();
    for (const { batch, matrices } of this.origins) {
      for (let i = 0; i < matrices.length; i++) {
        sway.makeRotationZ(Math.sin(this.time * 1.5 + i * 0.7) * 0.12);
        matrix.copy(matrices[i]).multiply(sway);
        batch.setMatrixAt(i, matrix);
      }
      batch.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const batch of this.batches) { batch.removeFromParent(); batch.dispose(); }
    this.batches.length = 0;
    this.origins.length = 0;
    this.geometry.dispose(); this.material.dispose();
  }
}

/** Small leaf clusters and split feather vanes, generated locally without borrowed assets. */
function organicGeometry(kind: 'moss' | 'feather'): THREE.BufferGeometry {
  const vertices: number[] = [];
  const triangle = (a: number[], b: number[], c: number[]) => vertices.push(...a, ...b, ...c);
  if (kind === 'feather') {
    for (let i = 0; i < 14; i++) {
      const y = i / 14, width = Math.pow(Math.sin((y * 0.9 + 0.05) * Math.PI), 0.8);
      for (const side of [-1, 1]) {
        const root = [0, y, 0], edge = [width * side, Math.min(1.1, y + 0.16), 0.2 * width];
        const tip = [width * side * 0.95, Math.min(1.1, y + 0.2), 0.2 * width];
        triangle(root, edge, tip); triangle(root, tip, [0, y + 0.06, 0]);
      }
    }
  } else {
    for (let stem = 0; stem < 5; stem++) {
      const angle = stem * 2.39996, ox = Math.cos(angle) * 0.35, oz = Math.sin(angle) * 0.35;
      for (let ring = 0; ring < 3; ring++) for (let leaf = 0; leaf < 4; leaf++) {
        const a = leaf * Math.PI / 2 + ring * 0.8 + angle;
        const y = ring * 0.22;
        const dx = Math.cos(a), dz = Math.sin(a);
        const root = [ox, y, oz], tip = [ox + dx * 0.6, y + 0.45, oz + dz * 0.6];
        const left = [ox + dx * 0.3 - dz * 0.17, y + 0.18, oz + dz * 0.3 + dx * 0.17];
        const right = [ox + dx * 0.3 + dz * 0.17, y + 0.18, oz + dz * 0.3 - dx * 0.17];
        triangle(root, left, tip); triangle(root, tip, right);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}
