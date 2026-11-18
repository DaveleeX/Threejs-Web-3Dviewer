import * as THREE from 'three';
import type { Viewer } from '../core/Viewer';
import { downloadBlob } from '../core/Recorder';

let opened = false;
/** Isolated frozen snapshot; main renderer and post chain remain unchanged. */
export async function openPathTracePreview(viewer: Viewer): Promise<void> {
  if (opened) return;
  const meshes = viewer.getEffectMeshes();
  if (!meshes.length) throw new Error('请先载入静态网格模型。');
  const triangles = meshes.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
  if (triangles > 300000) throw new Error('静帧路径追踪当前限定 30 万三角形以内。');
  opened = true;
  const dialog = document.createElement('dialog'); dialog.className = 'effect-trace-dialog';
  const heading = document.createElement('h2'); heading.textContent = '路径追踪 · 模型静帧';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '正在加载路径追踪器…';
  const note = document.createElement('p');
  note.textContent = '冻结静态模型与机位；不含附加效果、辅助线和后期。HDR 沿用原图，程序化环境使用中性天空。';
  const canvas = document.createElement('canvas');
  const close = document.createElement('button'); close.className = 'btn'; close.textContent = '关闭路径追踪';
  const save = document.createElement('button'); save.className = 'btn'; save.textContent = '保存路径追踪 PNG'; save.disabled = true;
  const pause = document.createElement('button'); pause.className = 'btn'; pause.textContent = '暂停采样'; pause.disabled = true;
  dialog.append(heading, note, status, canvas, pause, save, close); document.body.append(dialog);
  dialog.showModal(); viewer.pause();
  let closed = false;
  let renderer: THREE.WebGLRenderer | undefined;
  let tracer: import('three-gpu-pathtracer').WebGLPathTracer | undefined;
  let environment: THREE.Texture | undefined;
  let fence: WebGLSync | null = null;
  let sampling = true;
  let tick: (() => void) | undefined;
  pause.onclick = () => {
    sampling = !sampling;
    renderer?.setAnimationLoop(sampling && tick ? tick : null);
    pause.textContent = sampling ? '暂停采样' : '继续采样';
  };
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const cleanup = () => {
    if (closed) return;
    closed = true; opened = false;
    if (fence && renderer) (renderer.getContext() as WebGL2RenderingContext).deleteSync(fence);
    renderer?.setAnimationLoop(null); tracer?.dispose();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    environment?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
    dialog.close(); dialog.remove(); viewer.resume();
  };
  close.onclick = cleanup;
  dialog.addEventListener('cancel', event => { event.preventDefault(); cleanup(); });
  save.onclick = () => canvas.toBlob(blob => { if (blob) downloadBlob(blob, 'pathtraced-model.png'); });
  try {
    const { WebGLPathTracer, GradientEquirectTexture } = await import('three-gpu-pathtracer');
    if (closed) return;
    renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
    if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('设备缺少浮点渲染目标支持。');
    const low = viewer.settings.render.tier === 'low';
    const width = low ? 128 : viewer.settings.render.tier === 'medium' ? 512 : 640;
    renderer.setSize(width, width * 0.75, false);
    renderer.toneMapping = viewer.renderer.toneMapping;
    renderer.toneMappingExposure = viewer.renderer.toneMappingExposure;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#20252c');
    const originalEnv = viewer.getEffectEnvironment();
    environment = originalEnv ? originalEnv.clone() : new GradientEquirectTexture(128);
    if (!originalEnv) (environment as InstanceType<typeof GradientEquirectTexture>).update();
    scene.environment = environment;
    scene.environmentIntensity = viewer.scene.environmentIntensity;
    scene.environmentRotation.copy(viewer.scene.environmentRotation);
    viewer.scene.updateMatrixWorld(true);
    for (const source of meshes) {
      const geometry = source.geometry.clone(); geometries.push(geometry);
      const originals = Array.isArray(source.material) ? source.material : [source.material];
      const copies = originals.map(material => {
        if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial)
          throw new Error('路径追踪需要常规 PBR 材质，请关闭线框或通道隔离。');
        const copy = material.clone(); materials.push(copy); return copy;
      });
      const mesh = new THREE.Mesh(geometry, Array.isArray(source.material) ? copies : copies[0]);
      mesh.matrixAutoUpdate = false; mesh.matrix.copy(source.matrixWorld); scene.add(mesh);
    }
    viewer.scene.traverse(object => {
      const light = object as THREE.DirectionalLight;
      if (!light.isDirectionalLight || !light.visible) return;
      const copy = light.clone(); copy.position.copy(light.getWorldPosition(new THREE.Vector3()));
      copy.target = new THREE.Object3D(); copy.target.position.copy(light.target.getWorldPosition(new THREE.Vector3()));
      scene.add(copy, copy.target);
    });
    const camera = viewer.camera.clone(); camera.clearViewOffset();
    if (camera instanceof THREE.PerspectiveCamera) camera.aspect = 640 / 480;
    camera.updateProjectionMatrix();
    tracer = new WebGLPathTracer(renderer); tracer.bounces = low ? 3 : 5;
    tracer.transmissiveBounces = low ? 2 : 5;
    tracer.textureSize.set(512, 512); tracer.tiles.set(3, 3);
    tracer.minSamples = 1; tracer.renderDelay = 0;
    status.textContent = '正在构建静态场景…';
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (closed) return;
    tracer.setScene(scene, camera);
    tick = () => {
      if (closed || !tracer) return;
      try {
        // At most one submitted tile in flight, including on software GPUs.
        const gl = renderer!.getContext() as WebGL2RenderingContext;
        if (fence) {
          const state = gl.clientWaitSync(fence, 0, 0);
          if (state === gl.TIMEOUT_EXPIRED) return;
          gl.deleteSync(fence); fence = null;
          if (state === gl.WAIT_FAILED) throw new Error('GPU 同步失败，请关闭并重新打开。');
        }
        tracer.renderSample();
        fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
        status.textContent = `已累积 ${Math.floor(tracer.samples)} / 64 samples`;
        save.disabled = tracer.samples < 1;
        pause.disabled = false;
        if (tracer.samples >= 64) { renderer?.setAnimationLoop(null); pause.disabled = true; }
      } catch (error) {
        renderer?.setAnimationLoop(null);
        status.textContent = `渲染失败：${error instanceof Error ? error.message : String(error)}`;
      }
    };
    renderer.setAnimationLoop(tick);
  } catch (error) { cleanup(); throw error; }
}
