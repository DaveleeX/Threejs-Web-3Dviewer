import * as THREE from 'three';

export interface EnvLightDef {
  pos: [number, number, number];
  size: [number, number];
  color: string;
  intensity: number;
  /** Euler XYZ in radians. When omitted the emitter is aimed at the origin. */
  rot?: [number, number, number];
}

export interface EnvPresetDef {
  id: string;
  label: string;
  sky: { top: string; horizon: string; bottom: string };
  lights: EnvLightDef[];
  /** Adds a large bounce disc under the subject. */
  bounce?: { color: string; intensity: number };
}

/**
 * Procedural image-based lighting rigs. Building them in code keeps the viewer
 * asset-free while still giving the soft, multi-source look of a real studio
 * HDRI. Users can always drop in their own .hdr / .exr on top of these.
 */
export const ENV_PRESETS: EnvPresetDef[] = [
  {
    id: 'studio',
    label: '摄影棚',
    sky: { top: '#2a3040', horizon: '#191d28', bottom: '#0d1017' },
    lights: [
      { pos: [-4, 4.4, 3.6], size: [7, 5], color: '#ffffff', intensity: 5.2 },
      { pos: [5.2, 2.6, 1.4], size: [5, 4], color: '#dbe6ff', intensity: 2.4 },
      { pos: [0, 3.2, -6], size: [8, 4], color: '#ffeedd', intensity: 2.0 },
      { pos: [0, 7.5, 0], size: [9, 9], color: '#ffffff', intensity: 1.5, rot: [-Math.PI / 2, 0, 0] },
    ],
    bounce: { color: '#8e97ab', intensity: 0.55 },
  },
  {
    id: 'softbox',
    label: '柔光箱',
    sky: { top: '#14171f', horizon: '#0d0f15', bottom: '#08090d' },
    lights: [
      { pos: [-3.4, 3.2, 3.4], size: [6, 6], color: '#ffffff', intensity: 8 },
      { pos: [4.2, 2.4, 2.2], size: [4, 5], color: '#ffffff', intensity: 3.2 },
      { pos: [0, 2, -5.5], size: [6, 3], color: '#c9d8ff', intensity: 1.6 },
    ],
    bounce: { color: '#5c6373', intensity: 0.4 },
  },
  {
    id: 'white',
    label: '白背景',
    sky: { top: '#f2f4f8', horizon: '#e4e8ef', bottom: '#cdd3dd' },
    lights: [
      { pos: [-4, 5, 4], size: [8, 6], color: '#ffffff', intensity: 3.4 },
      { pos: [5, 3, -2], size: [6, 6], color: '#ffffff', intensity: 2.2 },
      { pos: [0, 8, 0], size: [10, 10], color: '#ffffff', intensity: 2.0, rot: [-Math.PI / 2, 0, 0] },
    ],
    bounce: { color: '#ffffff', intensity: 1.1 },
  },
  {
    id: 'outdoor',
    label: '日光',
    sky: { top: '#3f7fd6', horizon: '#a9c8e8', bottom: '#5f5a4e' },
    lights: [
      { pos: [5.5, 5.5, 3.5], size: [2.4, 2.4], color: '#fff2d6', intensity: 26 },
      { pos: [-5, 4, -3], size: [9, 7], color: '#9fc4f0', intensity: 1.5 },
      { pos: [0, 9, 0], size: [14, 14], color: '#bcd8f6', intensity: 1.6, rot: [-Math.PI / 2, 0, 0] },
    ],
    bounce: { color: '#9a9179', intensity: 0.75 },
  },
  {
    id: 'sunset',
    label: '黄昏',
    sky: { top: '#1e2a52', horizon: '#e8834a', bottom: '#2a1c1a' },
    lights: [
      { pos: [6, 1.4, 2.5], size: [3.4, 2.2], color: '#ff9b4a', intensity: 16 },
      { pos: [-5, 3.4, -2.5], size: [8, 6], color: '#5f7ecb', intensity: 1.5 },
      { pos: [0, 6.5, 0], size: [12, 12], color: '#8a6f8f', intensity: 0.9, rot: [-Math.PI / 2, 0, 0] },
    ],
    bounce: { color: '#7a5a44', intensity: 0.5 },
  },
  {
    id: 'night',
    label: '夜景',
    sky: { top: '#080c18', horizon: '#101a2e', bottom: '#05070c' },
    lights: [
      { pos: [-4.5, 3, 3], size: [4, 5], color: '#5fa8ff', intensity: 5.5 },
      { pos: [4.5, 2.4, -1.5], size: [3.4, 4.5], color: '#ff6fa8', intensity: 4.2 },
      { pos: [0, 5.5, -4], size: [7, 3], color: '#7de3ff', intensity: 2.2 },
    ],
    bounce: { color: '#1b2438', intensity: 0.5 },
  },
  {
    id: 'warehouse',
    label: '厂房',
    sky: { top: '#3a3d44', horizon: '#26282e', bottom: '#17181c' },
    lights: [
      { pos: [-2.5, 6, 4], size: [1.6, 9], color: '#fff6e2', intensity: 7, rot: [-Math.PI / 2, 0, 0] },
      { pos: [2.5, 6, -1], size: [1.6, 9], color: '#fff6e2', intensity: 7, rot: [-Math.PI / 2, 0, 0] },
      { pos: [-7, 2.6, 0], size: [4, 4], color: '#c9d6e8', intensity: 1.4 },
      { pos: [7, 2.6, 0], size: [4, 4], color: '#c9d6e8', intensity: 1.4 },
    ],
    bounce: { color: '#6a6d75', intensity: 0.45 },
  },
  {
    id: 'neutral',
    label: '中性灰',
    sky: { top: '#7d838f', horizon: '#6b707a', bottom: '#4e525a' },
    lights: [
      { pos: [-4, 4, 4], size: [7, 7], color: '#ffffff', intensity: 2.0 },
      { pos: [4, 3, -3], size: [7, 7], color: '#ffffff', intensity: 1.6 },
      { pos: [0, 7, 0], size: [10, 10], color: '#ffffff', intensity: 1.4, rot: [-Math.PI / 2, 0, 0] },
    ],
  },
];

export function findPreset(id: string): EnvPresetDef {
  return ENV_PRESETS.find((p) => p.id === id) ?? ENV_PRESETS[0];
}

export interface HdriPresetDef {
  id: string;
  label: string;
  /** Equirectangular .hdr under public/hdri, fetched on first use. */
  file: string;
  /** Optional full-resolution panorama for an unblurred visible background. */
  backgroundFile?: string;
  thumb: string;
}

/**
 * Captured HDR panoramas, downsampled to 1024x512 by scripts/build-hdri.mjs.
 * They are several hundred KB each, so they are fetched lazily the first time
 * the user picks one rather than shipped in the initial payload.
 */
export const HDRI_PRESETS: HdriPresetDef[] = [
  { id: 'studio-abstract', label: '抽象棚拍', file: 'hdri/studio-abstract.hdr', thumb: 'hdri/studio-abstract.png' },
  { id: 'studio-metal', label: '金属棚拍', file: 'hdri/studio-metal.hdr', thumb: 'hdri/studio-metal.png' },
  { id: 'studio-strip', label: '条灯棚拍', file: 'hdri/studio-strip.hdr', thumb: 'hdri/studio-strip.png' },
  { id: 'studio-white', label: '纯白环境', file: 'hdri/studio-white.hdr', thumb: 'hdri/studio-white.png' },
  { id: 'interior-hall', label: '室内会场', file: 'hdri/interior-hall.hdr', backgroundFile: 'hdri/interior-hall-full.hdr', thumb: 'hdri/interior-hall.png' },
];

export const HDRI_PREFIX = 'hdri:';

export function findHdri(presetId: string): HdriPresetDef | undefined {
  if (!presetId.startsWith(HDRI_PREFIX)) return undefined;
  const id = presetId.slice(HDRI_PREFIX.length);
  return HDRI_PRESETS.find((p) => p.id === id);
}

/** CSS gradient used for the preset thumbnails in the sidebar. */
export function presetThumbCss(p: EnvPresetDef): string {
  return `linear-gradient(to bottom, ${p.sky.top}, ${p.sky.horizon} 58%, ${p.sky.bottom})`;
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 top;
  uniform vec3 horizon;
  uniform vec3 bottom;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, -1.0, 1.0);
    vec3 c = h > 0.0
      ? mix(horizon, top, pow(h, 0.55))
      : mix(horizon, bottom, pow(-h, 0.55));
    gl_FragColor = vec4(c, 1.0);
  }
`;

/**
 * Builds a throwaway scene whose only job is to be captured by PMREMGenerator.
 * Emissive quads stand in for softboxes; their colours are allowed above 1.0 so
 * the resulting probe carries real HDR range.
 */
export function buildEnvScene(preset: EnvPresetDef): THREE.Scene {
  const scene = new THREE.Scene();

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(40, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(preset.sky.top).convertSRGBToLinear() },
        horizon: { value: new THREE.Color(preset.sky.horizon).convertSRGBToLinear() },
        bottom: { value: new THREE.Color(preset.sky.bottom).convertSRGBToLinear() },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    }),
  );
  scene.add(sky);

  const quad = new THREE.PlaneGeometry(1, 1);

  for (const light of preset.lights) {
    const color = new THREE.Color(light.color).convertSRGBToLinear().multiplyScalar(light.intensity);
    const mesh = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    mesh.position.set(...light.pos);
    mesh.scale.set(light.size[0], light.size[1], 1);
    if (light.rot) mesh.rotation.set(...light.rot);
    else mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  }

  if (preset.bounce) {
    const color = new THREE.Color(preset.bounce.color).convertSRGBToLinear().multiplyScalar(preset.bounce.intensity);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.MeshBasicMaterial({ color }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.6;
    scene.add(disc);
  }

  return scene;
}

/** Frees the geometries/materials of a scene produced by `buildEnvScene`. */
export function disposeEnvScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat.dispose();
  });
}
