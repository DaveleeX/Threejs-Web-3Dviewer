import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Viewer } from '../core/Viewer';
import { createBird, type BirdHandle, type HopLayer } from './vendor/feather/bird';
import { createBackdrop } from './vendor/feather/env/backdrop';
import { loadBranch, GRIP_X, perchFrames, PERCH_RANGE } from './vendor/feather/env/branch';
import { createPost, type Post } from './vendor/feather/post';

let opened = false;

/** Complete reference look session, isolated from the user's model and render settings. */
export async function openFeatherReference(viewer: Viewer): Promise<void> {
  if (opened) return;
  opened = true;
  const dialog = document.createElement('dialog');
  dialog.className = 'effect-trace-dialog feather-reference-dialog';
  const title = document.createElement('h2'); title.textContent = '源码复现 · 羽毛场景（待验收）';
  const note = document.createElement('p');
  note.textContent = 'Theo Tillberg · MIT。原羽毛几何、蒙皮、结构色、绒毛、树枝资产与景深。独立场景，关闭后恢复原模型。';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '正在载入原树枝资产…';
  const canvas = document.createElement('canvas');
  const close = document.createElement('button'); close.className = 'btn'; close.textContent = '关闭羽毛场景';
  const ruffle = document.createElement('button'); ruffle.className = 'btn'; ruffle.textContent = '抖动羽毛'; ruffle.disabled = true;
  const source = document.createElement('a'); source.textContent = '打开原案例对照 ↗';
  source.href = 'https://ttillberg.github.io/codevember-2026/12/?still'; source.target = '_blank'; source.rel = 'noopener noreferrer';
  dialog.append(title, note, status, canvas, ruffle, close, source);
  document.body.append(dialog); dialog.showModal(); viewer.pause();
  const scene = new THREE.Scene();
  let renderer: THREE.WebGLRenderer | undefined, controls: OrbitControls | undefined;
  let bird: BirdHandle | undefined, post: Post | undefined;
  let environment: THREE.WebGLRenderTarget | undefined, observer: ResizeObserver | undefined;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true; opened = false;
    renderer?.setAnimationLoop(null); observer?.disconnect(); controls?.dispose();
    if (bird) { bird.root.removeFromParent(); bird.dispose(); }
    disposeTree(scene); post?.dispose(); environment?.dispose();
    renderer?.dispose(); renderer?.forceContextLoss();
    dialog.close(); dialog.remove(); viewer.resume();
  };
  close.onclick = cleanup;
  dialog.addEventListener('cancel', event => { event.preventDefault(); cleanup(); });
  ruffle.onclick = () => bird?.ruffle('shake', 0.7);
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 120);
    camera.position.set(1.55, 0.85, 3);
    controls = new OrbitControls(camera, canvas); controls.target.set(GRIP_X - 0.04, 0.5, 0);
    controls.enableDamping = true; controls.dampingFactor = 0.06;
    controls.minDistance = 1.4; controls.maxDistance = 4.4;
    controls.minPolarAngle = 1.2; controls.maxPolarAngle = 1.78;
    controls.minAzimuthAngle = -0.45; controls.maxAzimuthAngle = 0.85;
    controls.enablePan = false; controls.rotateSpeed = 0.6; controls.update();
    const backdrop = createBackdrop(); scene.add(backdrop.mesh);
    const envScene = new THREE.Scene(), envBackdrop = createBackdrop();
    envBackdrop.material.uniforms.uEnv.value = 1; envScene.add(envBackdrop.mesh);
    const pmrem = new THREE.PMREMGenerator(renderer);
    try { environment = pmrem.fromScene(envScene, 0.02); }
    finally { pmrem.dispose(); disposeTree(envScene); }
    scene.environment = environment.texture; scene.environmentIntensity = 1.6;
    scene.add(new THREE.HemisphereLight(0xeef2e6, 0x3a3826, 0.6));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
    key.position.set(-1.3, 3.6, 1.5); key.target.position.set(0, 0.5, 0); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -1.2, bottom: -1.2, right: 1.2, top: 1.2, near: 0.5, far: 8 });
    key.shadow.bias = -0.0015; key.shadow.normalBias = 0.025; key.shadow.radius = 4;
    const rim = new THREE.DirectionalLight(0xf2fae8, 1.4);
    rim.position.set(1.5, 1.8, -2.5); rim.target.position.set(0, 0.5, 0);
    scene.add(key, key.target, rim, rim.target);
    const branch = await loadBranch(`${import.meta.env.BASE_URL}effects/feather/branch.glb`);
    if (closed) { disposeTree(branch.group); return; }
    scene.add(branch.group);
    status.textContent = '正在构建原羽毛几何与着色管线…';
    bird = createBird(); bird.root.position.x = GRIP_X;
    bird.layer<HopLayer>('hop').home = GRIP_X;
    bird.setPerch(perchFrames(branch.group), PERCH_RANGE);
    scene.add(bird.root);
    post = createPost(renderer, { samples: 4 });
    post.setToneMapping(THREE.NeutralToneMapping);
    const grade = post.grade;
    grade.uWhite.value.set(1, 1, 1.04); grade.uLift.value.set(0.015, 0.005, 0.022);
    grade.uGamma.value.set(1, 1.04, 1); grade.uVignette.value = 0.22;
    grade.uExposure.value = 1.15; grade.uContrast.value = 0.87; grade.uSat.value = 0.97;
    const resize = () => {
      if (closed || !renderer || !post) return;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setSize(Math.max(1, w), Math.max(1, h), false);
      camera.aspect = w / Math.max(1, h); camera.fov = camera.aspect < 1 ? 30 / Math.max(camera.aspect, 0.55) : 30;
      camera.updateProjectionMatrix(); post.setSize(Math.max(1, w), Math.max(1, h), renderer.getPixelRatio());
    };
    observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    await post.compile(() => [renderer!.compileAsync(scene, camera)]);
    if (closed) return;
    const focus = new THREE.Vector3(); let previous = performance.now(), time = 0;
    renderer.setAnimationLoop(now => {
      if (closed || !bird || !post) return;
      const delta = Math.min(0.05, (now - previous) / 1000); previous = now; time += delta;
      controls!.update(); bird.setAttention(camera.position); bird.update(delta);
      bird.headPosition(focus); post.focusOn(focus);
      backdrop.material.uniforms.uTime.value = time;
      post.render(scene, camera, time);
    });
    ruffle.disabled = false; status.textContent = '原核心管线运行中 · 待画面对比验收';
  } catch (error) { cleanup(); throw error; }
}

function disposeTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(mat);
      for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
    }
    (object as THREE.DirectionalLight).shadow?.dispose();
  });
  for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); for (const t of textures) t.dispose();
}
