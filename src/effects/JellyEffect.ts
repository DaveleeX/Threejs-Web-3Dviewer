import * as THREE from 'three';
import type { Viewer } from '../core/Viewer';
import type { SceneEffect } from './EffectHost';
import { createJellyCage, type JellyCage } from './JellyCage';
import { SoftBody } from './vendor/jelly/soft-body.js';

interface BodyEntry {
  source: THREE.Mesh; saved: THREE.Material | THREE.Material[];
  hidden: THREE.Material; mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  cage: JellyCage; body: SoftBody;
}

export class JellyEffect implements SceneEffect {
  readonly id = 'surface';
  readonly modelScoped = true;
  private readonly entries: BodyEntry[] = [];
  private accumulator = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly plane = new THREE.Plane();
  private readonly hit = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private grab?: { entry: BodyEntry; pointerId: number; controls: boolean };
  constructor(private readonly viewer: Viewer, private readonly strength: number, private readonly speed: number) {}

  mount(): void {
    const sources = this.viewer.getEffectMeshes().filter(source => {
      const size = new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3());
      // Thin display plinths/sheets are not volume bodies and make ill-conditioned tets.
      return Math.min(size.x, size.y, size.z) / Math.max(size.x, size.y, size.z, .001) >= .12;
    });
    if (!sources.length) throw new Error('软体需要有厚度的实体；当前模型仅包含薄片或地台');
    if (sources.length > 8) throw new Error('源码软体当前支持最多 8 个独立网格，请先合并模型部件');
    const bounds = new THREE.Box3();
    for (const source of sources) bounds.expandByObject(source);
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const scale = .07 / Math.max(size.x, size.y, size.z, .001);
    const origin = new THREE.Vector3(center.x, bounds.min.y - .0002 / scale, center.z);
    const fromPhysical = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z)
      .multiply(new THREE.Matrix4().makeScale(1 / scale, 1 / scale, 1 / scale));
    const toPhysical = fromPhysical.clone().invert();
    for (const source of sources) {
      source.updateWorldMatrix(true, false);
      const geometry = source.geometry.clone();
      let entry: BodyEntry | undefined;
      try {
        geometry.applyMatrix4(toPhysical.clone().multiply(source.matrixWorld));
        // Ensure packed float attributes, including models with interleaved source data.
        for (const name of ['position', 'normal']) {
          const attr = geometry.getAttribute(name), values = new Float32Array(attr.count * 3);
          for (let i = 0; i < attr.count; i++) values.set([attr.getX(i), attr.getY(i), attr.getZ(i)], i * 3);
          geometry.setAttribute(name, new THREE.BufferAttribute(values, 3).setUsage(THREE.DynamicDrawUsage));
        }
        const cage = createJellyCage(geometry, this.viewer.settings.render.tier === 'low' ? 3 : 4);
        const body = new SoftBody(cage);
        const physicalSize = geometry.boundingBox!.getSize(new THREE.Vector3());
        const material = new THREE.MeshPhysicalMaterial({
          color: '#e0f5af', transmission: 1, thickness: Math.max(physicalSize.x, physicalSize.y, physicalSize.z) * .5, ior: 1.35, dispersion: .025,
          roughness: .08, attenuationColor: new THREE.Color('#a7dc58'), attenuationDistance: .035,
          clearcoat: 1, clearcoatRoughness: .05,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Source XPBD jelly';
        mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(source.matrixWorld).invert().multiply(fromPhysical);
        // Optics lengths are world units in Three, while physics uses SI meters.
        material.thickness /= scale; material.attenuationDistance /= scale;
        const hidden = new THREE.MeshBasicMaterial({ visible: false });
        entry = { source, saved: source.material, hidden, mesh, cage, body };
        this.entries.push(entry);
        source.material = hidden; source.add(mesh);
        body.nudge();
        // Keep the local preview framed: retain the source nudge's strain impulse,
        // remove its net horizontal launch, and use a small vertical lift.
        let vx = 0, vz = 0;
        for (let i = 0; i < body.mass.length; i++) {
          vx += body.velocity[i * 3] * body.mass[i] / body.totalMass;
          vz += body.velocity[i * 3 + 2] * body.mass[i] / body.totalMass;
        }
        for (let i = 0; i < body.mass.length; i++) {
          body.velocity[i * 3] -= vx; body.velocity[i * 3 + 2] -= vz;
          body.velocity[i * 3 + 1] *= .25;
        }
        for (let i = 0; i < body.velocity.length; i++) body.velocity[i] *= this.strength * .15;
      } catch (error) {
        if (!entry) geometry.dispose();
        throw error;
      }
    }
    const canvas = this.viewer.renderer.domElement;
    canvas.addEventListener('pointerdown', this.down, true);
    canvas.addEventListener('pointermove', this.move, true);
    canvas.addEventListener('pointerup', this.up, true);
    canvas.addEventListener('pointercancel', this.up, true);
    canvas.addEventListener('lostpointercapture', this.up, true);
  }

  update(delta: number): void {
    const step = 1 / 240;
    // Bound work after a stalled frame; never accumulate a spiral of catch-up steps.
    this.accumulator = Math.min(this.accumulator + delta * this.speed, step * 12);
    while (this.accumulator >= step) {
      for (const entry of this.entries) entry.body.step(step);
      this.accumulator -= step;
    }
    for (const entry of this.entries) {
      if (!entry.body.isFinite()) throw new Error('软体求解失稳，已停用以恢复模型');
      if (entry.body.surfaceDirty) entry.body.updateSurface();
    }
  }

  private setRay(event: PointerEvent): void {
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    this.raycaster.setFromCamera(this.pointer, this.viewer.camera);
  }
  private down = (event: PointerEvent): void => {
    if (!event.shiftKey || event.button !== 0) return;
    this.setRay(event);
    const intersection = this.raycaster.intersectObjects(this.entries.map(entry => entry.mesh), false)[0];
    if (!intersection?.face) return;
    const entry = this.entries.find(item => item.mesh === intersection.object)!;
    entry.mesh.updateWorldMatrix(true, false);
    const ids = entry.cage.surface.bindingIds, weights = entry.cage.surface.bindingWeights;
    this.hit.copy(intersection.point).applyMatrix4(this.inverse.copy(entry.mesh.matrixWorld).invert());
    const face = intersection.face, position = entry.mesh.geometry.attributes.position;
    const bary = THREE.Triangle.getBarycoord(this.hit,
      new THREE.Vector3().fromBufferAttribute(position, face.a),
      new THREE.Vector3().fromBufferAttribute(position, face.b),
      new THREE.Vector3().fromBufferAttribute(position, face.c), new THREE.Vector3());
    if (!bary) return;
    const combined = new Map<number, number>();
    [face.a, face.b, face.c].forEach((vertex, corner) => {
      for (let i = 0; i < 4; i++) {
        const id = ids[vertex * 4 + i], weight = weights[vertex * 4 + i] * bary.getComponent(corner);
        combined.set(id, (combined.get(id) ?? 0) + weight);
      }
    });
    entry.body.grab = { weights: [...combined],
      point: this.hit.clone(), target: this.hit.clone(), lambda: new Float64Array(3) };
    this.viewer.camera.getWorldDirection(this.hit);
    this.plane.setFromNormalAndCoplanarPoint(this.hit, intersection.point);
    this.grab = { entry, pointerId: event.pointerId, controls: this.viewer.controls.enabled };
    this.viewer.controls.enabled = false;
    this.viewer.renderer.domElement.setPointerCapture(event.pointerId);
    event.stopImmediatePropagation(); event.preventDefault();
  };
  private move = (event: PointerEvent): void => {
    if (!this.grab || event.pointerId !== this.grab.pointerId) return;
    this.setRay(event);
    if (this.raycaster.ray.intersectPlane(this.plane, this.hit)) {
      const { entry } = this.grab;
      entry.mesh.updateWorldMatrix(true, false);
      entry.body.grab!.target.copy(this.hit).applyMatrix4(this.inverse.copy(entry.mesh.matrixWorld).invert());
    }
    event.stopImmediatePropagation(); event.preventDefault();
  };
  private up = (event?: PointerEvent): void => {
    if (!this.grab || event && event.pointerId !== this.grab.pointerId) return;
    const { entry, pointerId, controls } = this.grab;
    this.grab = undefined; entry.body.grab = null;
    this.viewer.controls.enabled = controls;
    const canvas = this.viewer.renderer.domElement;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  };

  dispose(): void {
    this.up();
    const canvas = this.viewer.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.down, true); canvas.removeEventListener('pointermove', this.move, true);
    canvas.removeEventListener('pointerup', this.up, true); canvas.removeEventListener('pointercancel', this.up, true);
    canvas.removeEventListener('lostpointercapture', this.up, true);
    for (const entry of this.entries) {
      entry.source.material = entry.saved; entry.hidden.dispose(); entry.mesh.removeFromParent();
      entry.mesh.geometry.dispose(); entry.mesh.material.dispose();
    }
    this.entries.length = 0;
  }
}
