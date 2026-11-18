import * as THREE from 'three';
import type { SceneEffect } from './EffectHost';

/** Fixed-step Verlet sheet with pinned corners, structural/shear constraints and ground contact. */
export class ClothEffect implements SceneEffect {
  readonly id = 'cloth';
  private readonly n = 20;
  private readonly geometry = new THREE.PlaneGeometry(1.4, 1.2, 20, 20);
  private readonly material = new THREE.MeshPhysicalMaterial({ color: '#c68a60', roughness: 0.9,
    sheen: 1, sheenColor: new THREE.Color('#f4cfa7'), side: THREE.DoubleSide });
  private readonly mesh = new THREE.Mesh(this.geometry, this.material);
  private readonly positions: THREE.Vector3[] = [];
  private readonly previous: THREE.Vector3[] = [];
  private readonly links: Array<[number, number, number]> = [];
  private accumulator = 0;
  private time = 0;
  constructor(private readonly wind: number, private readonly speed: number) {
    const attr = this.geometry.attributes.position;
    for (let i = 0; i < attr.count; i++) {
      const p = new THREE.Vector3(attr.getX(i), attr.getY(i) + 0.85, -0.4);
      this.positions.push(p); this.previous.push(p.clone());
    }
    const add = (a: number, b: number) => this.links.push([a, b, this.positions[a].distanceTo(this.positions[b])]);
    for (let y = 0; y <= this.n; y++) for (let x = 0; x <= this.n; x++) {
      const i = y * (this.n + 1) + x;
      if (x < this.n) add(i, i + 1);
      if (y < this.n) add(i, i + this.n + 1);
      if (x < this.n && y < this.n) { add(i, i + this.n + 2); add(i + 1, i + this.n + 1); }
    }
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.name = 'Pinned cloth';
    this.upload();
  }
  mount(scene: THREE.Scene): void { scene.add(this.mesh); }
  update(delta: number): void {
    this.accumulator = Math.min(this.accumulator + delta * this.speed, 0.1);
    const h = 1 / 60;
    while (this.accumulator >= h) {
      this.accumulator -= h; this.time += h;
      for (let i = 0; i < this.positions.length; i++) {
        if (i === 0 || i === this.n) continue;
        const p = this.positions[i], old = this.previous[i];
        const x = p.x, y = p.y, z = p.z;
        p.set(x + (x - old.x) * 0.985, y + (y - old.y) * 0.985 - 9.8 * h * h,
          z + (z - old.z) * 0.985 + Math.sin(this.time * 2 + x) * this.wind * 12 * h * h);
        old.set(x, y, z);
      }
      const offset = new THREE.Vector3();
      for (let pass = 0; pass < 6; pass++) for (const [a, b, rest] of this.links) {
        offset.subVectors(this.positions[b], this.positions[a]);
        const distance = offset.length();
        if (distance < 1e-8) continue;
        const fixedA = a === 0 || a === this.n, fixedB = b === 0 || b === this.n;
        offset.multiplyScalar((distance - rest) / distance / (fixedA || fixedB ? 1 : 2));
        if (!fixedA) this.positions[a].add(offset);
        if (!fixedB) this.positions[b].sub(offset);
      }
      for (const p of this.positions) p.y = Math.max(0.02, p.y);
    }
    this.upload();
  }
  private upload(): void {
    const attr = this.geometry.attributes.position;
    this.positions.forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z));
    attr.needsUpdate = true;
    this.geometry.computeVertexNormals(); this.geometry.computeBoundingSphere();
  }
  dispose(): void { this.mesh.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
