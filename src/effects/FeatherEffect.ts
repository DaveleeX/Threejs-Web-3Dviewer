import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import type { SceneEffect } from './EffectHost';
import { Builder, specFromLook } from './vendor/feather/bird/plumageGeometry';
import { createPlumageMaterial, createPlumageDepthMaterial } from './vendor/feather/bird/plumageMaterial';
import { MOUNTAIN_GEM } from './vendor/feather/bird/species';
import { mulberry32 } from './vendor/feather/bird/util';

export interface FeatherOptions {
  /** World-space comb direction, projected onto each surface tangent plane. */
  direction?: [number, number, number];
  look?: 'body' | 'gorget' | 'crown';
  count?: number;
  lengthScale?: number;
  speed?: number;
  seed?: number;
}

/** Original reference feather geometry + optical/shadow shaders, attached to static user meshes.
 * Surface placement is an adapter, not the original bird's anatomical tract/rig system.
 * No renderer, environment, camera, source material or source geometry is replaced.
 */
export class FeatherEffect implements SceneEffect {
  readonly id = 'growth';
  readonly modelScoped = true;
  private readonly plumage = createPlumageMaterial();
  private readonly depth = createPlumageDepthMaterial(this.plumage.uniforms);
  private readonly distance = new THREE.MeshDistanceMaterial({ side: THREE.DoubleSide });
  private readonly attachments: THREE.Mesh[] = [];
  private time = 0;
  constructor(private readonly sources: THREE.Mesh[], private readonly options: FeatherOptions = {}) {
    // The reference uses directional shadows. The same root/hinge deformation must
    // also run in the Viewer's point-light distance pass.
    this.distance.onBeforeCompile = this.depth.onBeforeCompile;
    this.distance.customProgramCacheKey = () => 'reference-feather-distance-v1';
  }

  mount(): void {
    const direction = new THREE.Vector3(...(this.options.direction ?? [0, -1, 0]));
    if (!direction.toArray().every(Number.isFinite) || direction.lengthSq() < 1e-8)
      throw new Error('羽毛梳理方向必须是有效的非零向量。');
    direction.normalize();
    const requested = this.options.count ?? 6500;
    const lengthScale = this.options.lengthScale ?? 1;
    const speed = this.options.speed ?? 1;
    if (![requested, lengthScale, speed].every(Number.isFinite) || lengthScale <= 0 || speed < 0)
      throw new Error('羽毛数量、长度与速度必须为有效值。');
    const budget = Math.max(100, Math.min(16000, Math.floor(requested)));
    const look = MOUNTAIN_GEM.looks[this.options.look ?? 'body'];
    if (!look) throw new Error('未知羽毛外观。');
    const random = mulberry32(this.options.seed ?? 731);
    const prepared: { source: THREE.Mesh; geometry: THREE.BufferGeometry; area: number; inverse: THREE.Matrix4 }[] = [];
    try {
      for (const source of this.sources) {
        if ((source as THREE.SkinnedMesh).isSkinnedMesh || (source as THREE.InstancedMesh).isInstancedMesh ||
            source.geometry.morphAttributes.position?.length) throw new Error('此羽毛绑定暂不支持骨骼、Morph 或实例网格。');
        source.updateWorldMatrix(true, false);
        if (Math.abs(source.matrixWorld.determinant()) < 1e-10) continue;
        const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
        const area = surfaceArea(geometry);
        if (!(area > 1e-10) || !Number.isFinite(area)) { geometry.dispose(); continue; }
        prepared.push({ source, geometry, area, inverse: source.matrixWorld.clone().invert() });
      }
      const area = prepared.reduce((sum, item) => sum + item.area, 0);
      if (!prepared.length) throw new Error('模型没有可覆盖的有效三角面。');
      // Coverage remains consistent across model scale and differently sized child meshes.
      const length = Math.sqrt(area / budget / Math.max(look.aspect, 0.1)) * look.aspect * 2.1 * lengthScale;
      const position = new THREE.Vector3(), normal = new THREE.Vector3(), tangent = new THREE.Vector3();
      const fallback = new THREE.Vector3(), platelet = new THREE.Vector3();
      let cumulative = 0, assigned = 0;
      for (const item of prepared) {
        cumulative += item.area;
        const count = Math.round(budget * cumulative / area) - assigned;
        assigned += count;
        if (!count) continue;
        const sampler = new MeshSurfaceSampler(new THREE.Mesh(item.geometry)) as MeshSurfaceSampler & {
          setRandomGenerator(fn: () => number): MeshSurfaceSampler;
        };
        sampler.setRandomGenerator(random).build();
        const builder = new Builder();
        for (let i = 0; i < count; i++) {
          sampler.sample(position, normal); normal.normalize();
          tangent.copy(direction).addScaledVector(normal, -direction.dot(normal));
          if (tangent.lengthSq() < 0.002) {
            fallback.set(Math.abs(normal.x) < 0.8 ? 1 : 0, 0, Math.abs(normal.x) < 0.8 ? 0 : 1);
            tangent.copy(fallback).addScaledVector(normal, -fallback.dot(normal));
          }
          tangent.normalize().applyAxisAngle(normal, (random() - 0.5) * 0.24);
          tangent.addScaledVector(normal, Math.tan(THREE.MathUtils.degToRad(look.tilt))).normalize();
          position.addScaledVector(normal, length * 0.025);
          platelet.copy(normal).addScaledVector(tangent, (random() - 0.5) * look.jitter).normalize();
          const len = length * (0.85 + random() * 0.3);
          builder.add({ ...specFromLook(look, random), root: position, dir: tangent, normal,
            skinNormal: normal, iriNormal: platelet, width: len / look.aspect, length: len,
            cols: look.fine ? 7 : 5, rows: look.fine ? 7 : 4,
            curl: 0.03, asym: 0, cover: 1 - look.rowStep,
            bones: [0, 0, 0, 0], weights: [1, 0, 0, 0],
            rand: random(), coord: random(), gain: look.lift,
          });
        }
        const geometry = builder.build();
        const attachment = new THREE.Mesh(geometry, this.plumage.material);
        attachment.name = 'Reference feather attachment';
        attachment.userData.effect = 'feather';
        attachment.customDepthMaterial = this.depth;
        attachment.customDistanceMaterial = this.distance;
        attachment.castShadow = true; attachment.receiveShadow = true;
        // World-space construction makes dimensions invariant under initial nonuniform scale.
        // The inverse bind transform keeps attachments following later parent transforms.
        attachment.matrixAutoUpdate = false; attachment.matrix.copy(item.inverse);
        attachment.frustumCulled = false; // hinge displacement is outside static bounds
        item.source.add(attachment); this.attachments.push(attachment);
      }
    } finally { for (const item of prepared) item.geometry.dispose(); }
  }

  update(delta: number): void {
    this.time += delta * (this.options.speed ?? 1);
    for (let i = 0; i < 8; i++)
      this.plumage.uniforms.uLift.value[i] = Math.sin(this.time * 1.4 - i * 0.6) * 0.035;
  }

  dispose(): void {
    for (const mesh of this.attachments) { mesh.removeFromParent(); mesh.geometry.dispose(); }
    this.attachments.length = 0;
    this.plumage.material.dispose(); this.depth.dispose(); this.distance.dispose();
  }
}

function surfaceArea(geometry: THREE.BufferGeometry): number {
  const p = geometry.getAttribute('position'), index = geometry.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let area = 0;
  const count = index?.count ?? p.count;
  for (let i = 0; i + 2 < count; i += 3) {
    a.fromBufferAttribute(p, index ? index.getX(i) : i);
    b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1);
    c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2);
    area += b.sub(a).cross(c.sub(a)).length() * 0.5;
  }
  return area;
}
