import * as THREE from 'three';

/** Live local IBL: every probe captures the shared scene, excluding its owner. */
export class WorldReflections {
  private probes = new Map<THREE.Mesh, { target: THREE.WebGLCubeRenderTarget; camera: THREE.CubeCamera }>();
  private assigned = new Map<THREE.MeshStandardMaterial, THREE.Texture | null>();
  private elapsed = 1;
  private cursor = 0;
  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {}

  update(delta: number): void {
    this.elapsed += delta;
    if (this.elapsed < 0.15) return;
    this.elapsed = 0;
    const meshes: THREE.Mesh[] = [];
    const activeMaterials = new Set<THREE.MeshStandardMaterial>();
    this.scene.traverseVisible(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry.attributes.normal) return;
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
      const reflective = materials.filter(m => m.isMeshStandardMaterial && (m.metalness > 0.1 || (m as THREE.MeshPhysicalMaterial).clearcoat > 0 || m.roughness < 0.35));
      if (!reflective.length) return;
      meshes.push(mesh); reflective.forEach(m => activeMaterials.add(m));
    });
    for (const [material, original] of this.assigned) if (!activeMaterials.has(material)) {
      material.envMap = original; material.needsUpdate = true; this.assigned.delete(material);
    }
    for (const [mesh, probe] of this.probes) if (!meshes.includes(mesh)) {
      probe.target.dispose(); this.probes.delete(mesh);
    }
    if (!meshes.length) return;
    const mesh = meshes[this.cursor++ % meshes.length];
    let probe = this.probes.get(mesh);
    if (!probe) {
      const target = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      probe = { target, camera: new THREE.CubeCamera(0.01, 1000, target) };
      this.probes.set(mesh, probe);
    }
    mesh.updateWorldMatrix(true, false);
    new THREE.Box3().setFromObject(mesh).getCenter(probe.camera.position);
    const visible = mesh.visible;
    const target = this.renderer.getRenderTarget();
    const xr = this.renderer.xr.enabled;
    const background = this.scene.background;
    // Use the lighting panorama when the visible background is a flat colour.
    if (!(background instanceof THREE.Texture)) this.scene.background = this.scene.environment;
    const maps = new Map<THREE.MeshStandardMaterial, THREE.Texture | null>();
    for (const [material, original] of this.assigned) {
      maps.set(material, material.envMap);
      material.envMap = original;
    }
    try {
      mesh.visible = false;
      this.renderer.xr.enabled = false;
      probe.camera.update(this.renderer, this.scene);
    } finally {
      for (const [material, map] of maps) material.envMap = map;
      mesh.visible = visible;
      this.scene.background = background;
      this.renderer.xr.enabled = xr;
      this.renderer.setRenderTarget(target);
    }
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
      const m = material as THREE.MeshStandardMaterial;
      if (!activeMaterials.has(m)) continue;
      if (!this.assigned.has(m)) this.assigned.set(m, m.envMap);
      if (m.envMap !== probe.target.texture) { m.envMap = probe.target.texture; m.needsUpdate = true; }
    }
  }
  dispose(): void {
    for (const [material, original] of this.assigned) { material.envMap = original; material.needsUpdate = true; }
    this.assigned.clear();
    for (const probe of this.probes.values()) probe.target.dispose();
    this.probes.clear();
  }
}
