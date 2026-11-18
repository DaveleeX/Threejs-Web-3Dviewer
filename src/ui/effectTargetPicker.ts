import * as THREE from 'three';
import type { Viewer } from '../core/Viewer';

/** One-shot surface picker. Highlight resources never modify source materials. */
export function pickEffectTarget(viewer: Viewer, selected: (mesh: THREE.Mesh) => void): () => void {
  const canvas = viewer.renderer.domElement;
  const previousCursor = canvas.style.cursor;
  const previousControls = viewer.controls.enabled;
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const glow = new THREE.Group();
  const materials = [0.018, 0.035, 0.055].map((_, i) => new THREE.ShaderMaterial({
    uniforms: { expansion: { value: 0 }, opacity: { value: [0.65, 0.25, 0.1][i] } },
    vertexShader: 'uniform float expansion; void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position+normal*expansion,1.0);}',
    fragmentShader: 'uniform float opacity; void main(){gl_FragColor=vec4(0.15,0.8,1.0,opacity);}',
    side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false,
  }));
  let hovered: THREE.Mesh | undefined;
  let ended = false;
  viewer.scene.add(glow);
  canvas.style.cursor = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M22 3l7 7-5 5-2-2-12 12-7 3 3-7L18 9l-2-2z" fill="white" stroke="black" stroke-width="2"/><path d="M8 22l3 3" stroke="#00bbff" stroke-width="3"/></svg>')}") 3 28, crosshair`;
  viewer.controls.enabled = false;
  const highlight = (mesh?: THREE.Mesh) => {
    if (hovered === mesh) return;
    hovered = mesh; glow.clear();
    if (!mesh) return;
    mesh.geometry.computeBoundingSphere();
    const radius = mesh.geometry.boundingSphere?.radius || 1;
    materials.forEach((material, i) => {
      material.uniforms.expansion.value = radius * [0.018, 0.035, 0.055][i];
      const shell = new THREE.Mesh(mesh.geometry, material);
      shell.matrixAutoUpdate = false;
      mesh.updateWorldMatrix(true, false);
      shell.matrix.copy(mesh.matrixWorld);
      glow.add(shell);
    });
  };
  const hit = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    ray.setFromCamera(pointer, viewer.camera);
    return ray.intersectObjects(viewer.getEffectMeshes(), false)[0]?.object as THREE.Mesh | undefined;
  };
  const move = (event: PointerEvent) => { event.stopImmediatePropagation(); highlight(hit(event)); };
  const leave = () => highlight();
  const cleanup = () => {
    if (ended) return;
    ended = true;
    canvas.style.cursor = previousCursor;
    viewer.controls.enabled = previousControls;
    canvas.removeEventListener('pointermove', move, true);
    canvas.removeEventListener('pointerdown', down, true);
    canvas.removeEventListener('pointerleave', leave);
    window.removeEventListener('keydown', key, true);
    viewer.scene.remove(glow); glow.clear(); materials.forEach(material => material.dispose());
  };
  const down = (event: PointerEvent) => {
    event.stopImmediatePropagation(); event.preventDefault();
    if (event.button !== 0) return;
    const mesh = hit(event);
    if (mesh) { cleanup(); selected(mesh); }
  };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cleanup(); } };
  canvas.addEventListener('pointermove', move, true);
  canvas.addEventListener('pointerdown', down, true);
  canvas.addEventListener('pointerleave', leave);
  window.addEventListener('keydown', key, true);
  return cleanup;
}
