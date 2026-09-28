import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';
import { LUT3dlLoader } from 'three/addons/loaders/LUT3dlLoader.js';
import { PostFX } from './PostFX';
import { InfiniteGrid } from './InfiniteGrid';
import { buildEnvScene, disposeEnvScene, findHdri, findPreset, type HdriPresetDef } from './environments';
import { detectTier, pixelRatioCap } from './tier';
import { defaultSettings, type ShadingMode, type ViewerSettings } from './settings';
import {
  GEOMETRY_CHANNELS,
  MATERIAL_CHANNELS,
  geometryChannelPresent,
  isolateGeometry,
  isolateMaterial,
  materialChannelPresent,
  type IsolatorId,
  type MaterialChannelId,
} from './channels';
import type { LoadResult } from '../loaders/ModelLoader';
import { extensionOf } from '../loaders/fileMap';
import { HandheldRig } from './HandheldRig';

export interface ModelStats {
  format: string;
  objects: number;
  meshes: number;
  triangles: number;
  vertices: number;
  materials: number;
  textures: number;
  animations: number;
  splats: number;
  /** Bounding-box dimensions in scene units, after normalisation. */
  size: THREE.Vector3;
}

const TONE_MAPPING: Record<string, THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

export type ViewDirection = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso';

export class Viewer {
  readonly settings: ViewerSettings;
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;

  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private readonly perspective: THREE.PerspectiveCamera;
  private readonly orthographic: THREE.OrthographicCamera;
  readonly controls: OrbitControls;

  private readonly postfx: PostFX;
  private readonly timer = new THREE.Timer();
  private readonly pmrem: THREE.PMREMGenerator;

  private readonly modelRoot = new THREE.Group();
  private readonly helpers = new THREE.Group();
  private readonly grid = new InfiniteGrid();
  private readonly axes = new THREE.AxesHelper(1);
  private boxHelper: THREE.Box3Helper | null = null;

  private readonly key = new THREE.DirectionalLight(0xffffff, 2.1);
  private readonly fill = new THREE.DirectionalLight(0xcddcff, 0.45);
  private readonly rim = new THREE.DirectionalLight(0xffffff, 0.9);
  private readonly shadowCatcher: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;

  private envRT: THREE.WebGLRenderTarget | null = null;
  private envSourceTexture: THREE.Texture | null = null;
  private splatRenderer: THREE.Object3D | null = null;
  private shadingOverrides: THREE.Material[] = [];
  private framingInsetRight = 0;
  private hdriCache = new Map<string, THREE.Texture>();
  private envToken = 0;

  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  private clips: THREE.AnimationClip[] = [];
  private animationPaused = true;
  private animationSpeed = 1;

  private currentModel: LoadResult | null = null;
  private modelBox = new THREE.Box3();
  private modelRadius = 1;
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private wireOverlay: THREE.Group | null = null;
  private matcapTexture: THREE.Texture | null = null;
  private splatFloaterCache: SplatFloaterCache | null = null;
  private splatFloaterRaf = 0;

  stats: ModelStats | null = null;
  onStatsChange: ((stats: ModelStats | null) => void) | null = null;
  onFrame: ((time: number, duration: number) => void) | null = null;
  onClipChange: ((near: number, far: number) => void) | null = null;
  onSelect: ((object: THREE.Object3D | null) => void) | null = null;
  readonly handheld: HandheldRig;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });

    const tier = detectTier(this.renderer.getContext());
    this.settings = defaultSettings(tier);

    this.renderer.setPixelRatio(Math.min(devicePixelRatio, pixelRatioCap(tier)));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();

    const { clientWidth: w, clientHeight: h } = canvas;
    this.perspective = new THREE.PerspectiveCamera(45, w / Math.max(h, 1), 0.01, 1000);
    this.perspective.position.set(3.2, 2.1, 4.4);
    this.orthographic = new THREE.OrthographicCamera(-2, 2, 2, -2, -500, 1000);
    this.camera = this.perspective;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.02;
    this.controls.maxDistance = 400;
    this.handheld = new HandheldRig(this);

    this.scene.add(this.modelRoot, this.helpers);

    this.helpers.add(this.grid);
    this.axes.visible = false;
    this.helpers.add(this.axes);

    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.42, transparent: true }),
    );
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.position.y = 0.0005;
    this.helpers.add(this.shadowCatcher);

    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key, this.key.target, this.fill, this.rim);

    this.postfx = new PostFX(this.renderer, this.scene, this.camera, w || 1, h || 1);

    this.resize();
    void this.applyEnvironment();
    this.applyLighting();
    this.applyRender();
    this.applyPost();
    this.applyCamera();
    this.applyScene();

    canvas.addEventListener('pointerdown', this.handlePointerDown);
  }

  // ------------------------------------------------------------------ loop

  start(): void {
    this.renderer.setAnimationLoop(() => this.tick());
  }

  pause(): void {
    this.renderer.setAnimationLoop(null);
  }

  resume(): void {
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private tick(): void {
    this.timer.update();
    const delta = this.timer.getDelta();

    if (this.mixer && !this.animationPaused) {
      this.mixer.update(delta * this.animationSpeed);
      if (this.action && this.onFrame) {
        this.onFrame(this.action.time, this.action.getClip().duration);
      }
    }

    this.handheld.update();
    if (this.handheld.driving) {
      this.controls.autoRotate = false;
    } else {
      this.controls.update();
    }
    this.postfx.render(delta);
  }

  resize(): void {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    const scale = this.settings.render.resolutionScale;

    this.renderer.setPixelRatio(Math.min(devicePixelRatio, pixelRatioCap(this.settings.render.tier)) * scale);
    this.renderer.setSize(width, height, false);
    this.postfx.setSize(width, height);

    this.perspective.aspect = width / height;
    this.perspective.updateProjectionMatrix();
    this.updateOrthographicFrustum();
    this.applyViewOffset();
  }

  /**
   * Tells the viewer how many pixels on the right are covered by UI, so the
   * model is centred in the area the user can actually see rather than in the
   * canvas the sidebar floats over.
   */
  setFramingInset(rightPx: number): void {
    this.framingInsetRight = rightPx;
    this.applyViewOffset();
  }

  private applyViewOffset(): void {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    const shift = this.framingInsetRight / 2;

    for (const camera of [this.perspective, this.orthographic]) {
      if (shift > 0.5) camera.setViewOffset(width, height, shift, 0, width, height);
      else camera.clearViewOffset();
    }
  }

  // -------------------------------------------------------------- settings

  applyRender(): void {
    const r = this.settings.render;
    this.renderer.toneMapping = TONE_MAPPING[r.toneMapping] ?? THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = r.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.resize();
    this.applyPost();
  }

  applyPost(): void {
    this.postfx.setSceneScale(this.modelRadius);
    this.postfx.apply(this.settings.post, this.settings.grade, this.settings.render, Boolean(this.settings.scene.isolator));
  }

  applyCamera(): void {
    const c = this.settings.camera;
    this.controls.enableDamping = c.damping > 0;
    this.controls.dampingFactor = Math.max(c.damping, 0.001);
    this.controls.autoRotate = c.autoRotate;
    this.controls.autoRotateSpeed = c.autoRotateSpeed;
    this.controls.enablePan = c.panEnabled;
    this.controls.maxPolarAngle = c.limitBelowGround ? Math.PI / 2 - 0.001 : Math.PI;

    if (this.perspective.fov !== c.fov) {
      this.perspective.fov = c.fov;
      this.perspective.updateProjectionMatrix();
    }

    const wantOrtho = c.projection === 'orthographic';
    const isOrtho = this.camera === this.orthographic;
    if (wantOrtho !== isOrtho) this.switchProjection(wantOrtho);
    this.applyClipPlanes();
  }

  applyLighting(): void {
    const l = this.settings.light;
    const r = Math.max(this.modelRadius, 0.001);

    const az = THREE.MathUtils.degToRad(l.keyAzimuth);
    const el = THREE.MathUtils.degToRad(l.keyElevation);
    const dist = r * 4;
    this.key.position.set(
      Math.cos(el) * Math.sin(az) * dist,
      Math.sin(el) * dist,
      Math.cos(el) * Math.cos(az) * dist,
    );
    this.key.target.position.copy(this.modelBox.getCenter(new THREE.Vector3()));
    this.key.target.updateMatrixWorld();

    this.key.visible = l.keyEnabled;
    this.key.intensity = l.keyIntensity;
    this.key.color.set(l.keyColor);

    this.fill.visible = l.fillEnabled;
    this.fill.intensity = l.fillIntensity;
    this.fill.position.set(-dist * 0.7, dist * 0.4, dist * 0.6);

    this.rim.visible = l.rimEnabled;
    this.rim.intensity = l.rimIntensity;
    this.rim.position.set(-dist * 0.5, dist * 0.5, -dist);

    const shadowsOn = l.shadow !== 'off';
    this.renderer.shadowMap.enabled = shadowsOn;
    const wantType = l.shadow === 'blurred' ? THREE.VSMShadowMap : THREE.PCFShadowMap;
    if (this.renderer.shadowMap.type !== wantType) {
      this.renderer.shadowMap.type = wantType;
      this.invalidateMaterials();
    }

    this.key.castShadow = shadowsOn && l.keyEnabled;
    this.key.shadow.radius = l.shadowRadius;
    this.key.shadow.blurSamples = Math.max(4, Math.round(l.shadowRadius * 3));
    this.key.shadow.bias = l.shadowBias;
    this.key.shadow.normalBias = l.shadowNormalBias;

    // Resizing the map requires dropping the allocated target, but only then —
    // this runs on every slider tick.
    if (this.key.shadow.mapSize.x !== l.shadowMapSize) {
      this.key.shadow.mapSize.setScalar(l.shadowMapSize);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }

    const cam = this.key.shadow.camera;
    const span = r * 1.6;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 0.01;
    cam.far = dist * 3;
    cam.updateProjectionMatrix();

    this.shadowCatcher.visible = shadowsOn && l.groundShadow;
    this.shadowCatcher.material.opacity = l.shadowOpacity;
    this.shadowCatcher.scale.setScalar(Math.max(r * 14, 1));
  }

  applyScene(): void {
    const s = this.settings.scene;
    this.grid.visible = s.grid;
    this.grid.setAxesVisible(s.axes);
    this.axes.visible = s.axes;
    this.applyGeometryFlags();
    if (s.isolator) this.applyIsolator(s.isolator);
    else this.applyShading(s.shading);
    this.setBoundingBoxVisible(s.boundingBox);
    this.applyPost();
  }

  async applyEnvironment(): Promise<void> {
    const e = this.settings.env;
    const hdri = findHdri(e.preset);

    if (hdri) {
      // Guard against a slow fetch landing after the user has moved on.
      const token = ++this.envToken;
      const texture = await this.loadHdri(hdri);
      if (token !== this.envToken) return;
      this.setEnvironmentTexture(this.pmrem.fromEquirectangular(texture));
    } else if (e.preset !== 'custom') {
      this.envToken++;
      const preset = findPreset(e.preset);
      const envScene = buildEnvScene(preset);
      this.setEnvironmentTexture(this.pmrem.fromScene(envScene, 0.02));
      disposeEnvScene(envScene);
    } else if (this.envSourceTexture) {
      this.envToken++;
      this.setEnvironmentTexture(this.pmrem.fromEquirectangular(this.envSourceTexture));
    }

    this.refreshBackground();
    this.scene.environmentIntensity = e.intensity;
    this.scene.environmentRotation.set(0, THREE.MathUtils.degToRad(e.rotation), 0);
    this.scene.backgroundRotation.set(0, THREE.MathUtils.degToRad(e.rotation), 0);

    if (e.fogEnabled) {
      this.scene.fog = new THREE.Fog(new THREE.Color(e.fogColor), e.fogNear * this.modelRadius, e.fogFar * this.modelRadius);
    } else {
      this.scene.fog = null;
    }
  }

  /** Applies background-only settings without rebuilding the light probe. */
  refreshBackground(): void {
    const e = this.settings.env;
    switch (e.background) {
      case 'environment':
        this.scene.background = this.scene.environment;
        break;
      case 'color':
        this.scene.background = new THREE.Color(e.backgroundColor);
        break;
      case 'gradient':
        this.scene.background = this.gradientTexture(e.backgroundColor);
        break;
      case 'transparent':
        this.scene.background = null;
        break;
    }
    this.scene.backgroundBlurriness = e.backgroundBlur;
    this.scene.backgroundIntensity = e.backgroundIntensity;
    this.scene.backgroundRotation.set(0, THREE.MathUtils.degToRad(e.rotation), 0);
    this.renderer.setClearAlpha(e.background === 'transparent' ? 0 : 1);
  }

  private gradientCache = new Map<string, THREE.Texture>();

  private gradientTexture(base: string): THREE.Texture {
    const cached = this.gradientCache.get(base);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const top = new THREE.Color(base).clone().offsetHSL(0, 0.02, 0.09);
    const bottom = new THREE.Color(base).clone().offsetHSL(0, 0, -0.045);
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, `#${top.getHexString()}`);
    gradient.addColorStop(1, `#${bottom.getHexString()}`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.mapping = THREE.UVMapping;
    this.gradientCache.set(base, texture);
    return texture;
  }

  /**
   * PMREMGenerator hands back a render target that owns the probe texture, so
   * the previous one has to be released or every environment switch leaks a
   * cube-UV target.
   */
  private setEnvironmentTexture(target: THREE.WebGLRenderTarget): void {
    const previous = this.envRT;
    this.envRT = target;
    this.scene.environment = target.texture;
    if (previous && previous !== target) previous.dispose();
  }

  /** Fetches one of the bundled HDR panoramas, keeping the decoded texture around. */
  private async loadHdri(def: HdriPresetDef): Promise<THREE.Texture> {
    const cached = this.hdriCache.get(def.id);
    if (cached) return cached;

    const texture = await new RGBELoader().loadAsync(`${import.meta.env.BASE_URL}${def.file}`);
    texture.mapping = THREE.EquirectangularReflectionMapping;

    const raced = this.hdriCache.get(def.id);
    if (raced) {
      texture.dispose();
      return raced;
    }

    this.hdriCache.set(def.id, texture);
    return texture;
  }

  /** Loads a user-supplied .hdr / .exr as the light probe. */
  async loadEnvironmentFile(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    try {
      const ext = extensionOf(file.name);
      const loader = ext === 'exr' ? new EXRLoader() : new RGBELoader();
      const texture = await loader.loadAsync(url);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      this.envSourceTexture?.dispose();
      this.envSourceTexture = texture;
      this.settings.env.preset = 'custom';
      await this.applyEnvironment();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Loads a .cube / .3dl look-up table for the grading stage. */
  async loadLutFile(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    try {
      const ext = extensionOf(file.name);
      const loader = ext === '3dl' ? new LUT3dlLoader() : new LUTCubeLoader();
      const result = await loader.loadAsync(url);
      this.postfx.setLUT(result.texture3D);
      this.settings.grade.lutEnabled = true;
      this.applyPost();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  clearLut(): void {
    this.postfx.setLUT(null);
    this.settings.grade.lutEnabled = false;
    this.applyPost();
  }

  // ----------------------------------------------------------------- model

  setModel(result: LoadResult): void {
    this.clearModel();
    this.currentModel = result;
    this.settings.scene.splatFloater = 0;
    this.splatFloaterCache = null;

    this.modelRoot.add(result.object);
    this.normalizeAndGround(result.object);
    this.prepareMaterials(result.object, result.kind === 'splat');

    this.clips = result.animations;
    if (this.clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(result.object);
      this.playClip(0);
    }

    this.applyAssetLook(result.kind === 'splat' ? 'splat' : 'mesh');
    this.stats = this.collectStats(result);
    this.onStatsChange?.(this.stats);

    this.grid.fitTo(this.modelRadius);
    this.applyLighting();
    this.applyScene();
    void this.applyEnvironment();
    this.applyRender();
    this.frameModel();
  }

  /**
   * Two display profiles:
   * - splat: match the video/training view (no ACES/bloom/grade, black backdrop)
   * - mesh: the page's default studio look (ACES, lights, gradient)
   */
  private applyAssetLook(kind: 'mesh' | 'splat'): void {
    if (kind === 'splat') this.applySplatDisplayLook();
    else this.applyMeshDisplayLook();
  }

  private applySplatDisplayLook(): void {
    const s = this.settings;
    s.render.toneMapping = 'none';
    s.render.exposure = 1;
    s.post.aoEnabled = false;
    s.post.bloomEnabled = false;
    s.grade.enabled = false;
    s.env.background = 'color';
    s.env.backgroundColor = '#000000';
    s.scene.grid = false;
  }

  private applyMeshDisplayLook(): void {
    const s = this.settings;
    const d = defaultSettings(s.render.tier);
    s.render.toneMapping = d.render.toneMapping;
    s.render.exposure = d.render.exposure;
    s.post.aoEnabled = d.post.aoEnabled;
    s.post.aoIntensity = d.post.aoIntensity;
    s.post.aoRadius = d.post.aoRadius;
    s.post.aoThickness = d.post.aoThickness;
    s.post.bloomEnabled = d.post.bloomEnabled;
    s.post.bloomStrength = d.post.bloomStrength;
    s.post.bloomRadius = d.post.bloomRadius;
    s.post.bloomThreshold = d.post.bloomThreshold;
    s.grade.enabled = d.grade.enabled;
    s.grade.contrast = d.grade.contrast;
    s.grade.saturation = d.grade.saturation;
    s.grade.shadows = d.grade.shadows;
    s.grade.midtones = d.grade.midtones;
    s.grade.highlights = d.grade.highlights;
    s.grade.tint = d.grade.tint;
    s.grade.vignette = d.grade.vignette;
    s.grade.vignetteSoftness = d.grade.vignetteSoftness;
    s.env.background = d.env.background;
    s.env.backgroundColor = d.env.backgroundColor;
    s.env.backgroundBlur = d.env.backgroundBlur;
    s.env.backgroundIntensity = d.env.backgroundIntensity;
    s.env.intensity = d.env.intensity;
    s.light.keyEnabled = d.light.keyEnabled;
    s.light.fillEnabled = d.light.fillEnabled;
    s.light.rimEnabled = d.light.rimEnabled;
    s.light.groundShadow = d.light.groundShadow;
    s.scene.grid = d.scene.grid;
  }

  clearModel(): void {
    this.stopAnimation();
    this.originalMaterials.clear();
    this.removeWireOverlay();
    this.setBoundingBoxVisible(false);

    for (const child of [...this.modelRoot.children]) {
      this.modelRoot.remove(child);
      disposeObject(child);
    }

    this.currentModel?.cleanup();
    this.currentModel = null;
    this.splatFloaterCache = null;
    if (this.splatFloaterRaf) cancelAnimationFrame(this.splatFloaterRaf);
    this.splatFloaterRaf = 0;
    this.stats = null;
    this.onStatsChange?.(null);
  }

  /**
   * Centres the model over the origin and rests it on the ground plane, so the
   * shadow catcher and grid line up regardless of the exporter's conventions.
   */
  private normalizeAndGround(object: THREE.Object3D): void {
    object.updateWorldMatrix(true, true);
    const box = boundsOf(object);
    if (box.isEmpty()) {
      this.modelBox = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
      this.modelRadius = 1;
      return;
    }

    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    if (this.settings.scene.autoNormalize) {
      const scale = this.settings.scene.normalizeSize / maxDim;
      object.scale.multiplyScalar(scale);
      object.updateWorldMatrix(true, true);
    }

    const grounded = boundsOf(object);
    const center = grounded.getCenter(new THREE.Vector3());
    object.position.x -= center.x;
    object.position.z -= center.z;
    object.position.y -= grounded.min.y;
    object.updateWorldMatrix(true, true);

    this.modelBox = boundsOf(object);
    const finalSize = this.modelBox.getSize(new THREE.Vector3());
    this.modelRadius = Math.max(finalSize.x, finalSize.y, finalSize.z) * 0.5 || 1;
  }

  private prepareMaterials(object: THREE.Object3D, isSplat: boolean): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      if (!isSplat) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      this.originalMaterials.set(mesh, mesh.material);

      for (const material of materialsOf(mesh)) {
        // Point lights and IBL both need tangents/normals to behave.
        if ('envMapIntensity' in material) {
          (material as THREE.MeshStandardMaterial).envMapIntensity = 1;
        }
      }
    });
  }

  private applyGeometryFlags(): void {
    const { flatShading, doubleSided } = this.settings.scene;
    for (const [mesh] of this.originalMaterials) {
      for (const material of materialsOf(mesh)) {
        const std = material as THREE.MeshStandardMaterial;
        if ('flatShading' in std && std.flatShading !== flatShading) {
          std.flatShading = flatShading;
          std.needsUpdate = true;
        }
        const wantSide = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
        if (std.side !== wantSide) {
          std.side = wantSide;
          std.needsUpdate = true;
        }
      }
    }
  }

  private applyShading(mode: ShadingMode): void {
    this.removeWireOverlay();

    for (const material of this.shadingOverrides) material.dispose();
    this.shadingOverrides = [];

    // One override instance is shared by every mesh, so switching modes costs a
    // single material rather than one per mesh.
    let override: THREE.Material | null = null;
    if (mode === 'wireframe') {
      override = new THREE.MeshBasicMaterial({ color: 0x7fb4ff, wireframe: true });
    } else if (mode === 'normals') {
      override = new THREE.MeshNormalMaterial({ flatShading: this.settings.scene.flatShading });
    } else if (mode === 'matcap') {
      override = new THREE.MeshMatcapMaterial({ matcap: this.getMatcap() });
    }
    if (override) this.shadingOverrides.push(override);

    for (const [mesh, original] of this.originalMaterials) {
      mesh.material = override ?? original;
    }

    if (mode === 'shaded-wire') this.addWireOverlay();
  }

  private applyIsolator(id: IsolatorId): void {
    this.removeWireOverlay();
    for (const material of this.shadingOverrides) material.dispose();
    this.shadingOverrides = [];

    const isGeometry = id === 'geomNormal' || id === 'uv' || id === 'vertexColor';

    for (const [mesh, original] of this.originalMaterials) {
      const sources = Array.isArray(original) ? original : [original];
      const isolated = sources.map((source) => {
        const next = isGeometry
          ? isolateGeometry(id, mesh.geometry, source.side)
          : isolateMaterial(source, id as MaterialChannelId, mesh.geometry);
        this.shadingOverrides.push(next);
        return next;
      });
      mesh.material = isolated.length === 1 ? isolated[0] : isolated;
    }
  }

  private addWireOverlay(): void {
    const overlay = new THREE.Group();
    overlay.name = 'WireOverlay';
    const material = new THREE.LineBasicMaterial({ color: 0x8fc4ff, transparent: true, opacity: 0.22 });

    for (const [mesh] of this.originalMaterials) {
      const lines = new THREE.LineSegments(new THREE.WireframeGeometry(mesh.geometry), material);
      mesh.getWorldPosition(lines.position);
      mesh.getWorldQuaternion(lines.quaternion);
      mesh.getWorldScale(lines.scale);
      overlay.add(lines);
    }

    this.wireOverlay = overlay;
    this.scene.add(overlay);
  }

  private removeWireOverlay(): void {
    if (!this.wireOverlay) return;
    this.scene.remove(this.wireOverlay);
    disposeObject(this.wireOverlay);
    this.wireOverlay = null;
  }

  /** Procedural clay matcap — avoids shipping an image just for the shading mode. */
  private getMatcap(): THREE.Texture {
    if (this.matcapTexture) return this.matcapTexture;

    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#0c0f15';
    ctx.fillRect(0, 0, size, size);

    const light = ctx.createRadialGradient(size * 0.34, size * 0.3, size * 0.02, size * 0.5, size * 0.5, size * 0.62);
    light.addColorStop(0, '#ffffff');
    light.addColorStop(0.35, '#b9c3d2');
    light.addColorStop(0.75, '#59626f');
    light.addColorStop(1, '#22262e');
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = light;
    ctx.fill();

    const rim = ctx.createRadialGradient(size * 0.68, size * 0.78, size * 0.02, size * 0.5, size * 0.5, size * 0.5);
    rim.addColorStop(0, 'rgba(120,170,255,0.55)');
    rim.addColorStop(0.6, 'rgba(120,170,255,0)');
    ctx.fillStyle = rim;
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.matcapTexture = texture;
    return texture;
  }

  private setBoundingBoxVisible(visible: boolean): void {
    if (this.boxHelper) {
      this.helpers.remove(this.boxHelper);
      this.boxHelper.geometry.dispose();
      (this.boxHelper.material as THREE.Material).dispose();
      this.boxHelper = null;
    }
    if (!visible || this.modelBox.isEmpty()) return;

    this.boxHelper = new THREE.Box3Helper(this.modelBox, new THREE.Color(0x4a9bff));
    this.helpers.add(this.boxHelper);
  }

  private invalidateMaterials(): void {
    this.scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of materialsOf(mesh)) material.needsUpdate = true;
    });
  }

  private collectStats(result: LoadResult): ModelStats {
    let objects = 0;
    let meshes = 0;
    let triangles = 0;
    let vertices = 0;
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();

    result.object.traverse((child) => {
      objects++;
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      meshes++;

      const position = mesh.geometry.attributes.position;
      if (position) {
        vertices += position.count;
        triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : position.count / 3;
      }

      for (const material of materialsOf(mesh)) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture);
        }
      }
    });

    return {
      format: result.format,
      objects,
      meshes,
      triangles: Math.round(triangles),
      vertices,
      materials: materials.size,
      textures: textures.size,
      animations: result.animations.length,
      splats: result.splatCount ?? 0,
      size: this.modelBox.getSize(new THREE.Vector3()),
    };
  }

  /**
   * Gaussian splats are drawn by Spark's own renderer object, which has to live
   * in the scene graph and is created lazily so the (large) Spark bundle is only
   * fetched when a splat asset is actually opened.
   */
  async enableSplatRendering(): Promise<void> {
    if (this.splatRenderer) return;
    const { SparkRenderer } = await import('@sparkjsdev/spark');
    const spark = new SparkRenderer({ renderer: this.renderer, encodeLinear: true });
    this.splatRenderer = spark;
    this.scene.add(spark);
  }

  /** Hide far Gaussians around a splat. 0 restores the original cloud. */
  setSplatFloaterTrim(amount: number): void {
    this.settings.scene.splatFloater = Math.min(1, Math.max(0, amount));
    if (this.splatFloaterRaf) return;
    this.splatFloaterRaf = requestAnimationFrame(() => {
      this.splatFloaterRaf = 0;
      this.applySplatFloaterTrim();
    });
  }

  private applySplatFloaterTrim(): void {
    const mesh = this.currentModel?.kind === 'splat' ? asSplatMesh(this.currentModel.object) : null;
    const packed = mesh?.packedSplats;
    if (!mesh || !packed || packed.numSplats < 8) return;

    const cache = this.splatFloaterCache ?? (this.splatFloaterCache = buildSplatFloaterCache(packed));
    const t = this.settings.scene.splatFloater;
    const maxDist = t <= 0.001 ? Infinity : cache.p70 * (6.2 - 4.7 * t);

    for (let i = 0; i < packed.numSplats; i++) {
      const splat = packed.getSplat(i);
      packed.setSplat(
        i,
        splat.center,
        splat.scales,
        splat.quaternion,
        cache.dists[i] > maxDist ? 0 : cache.opacities[i],
        splat.color,
      );
    }
    packed.needsUpdate = true;
    mesh.needsUpdate = true;
  }

  /** The loaded model's root, or null when the viewer is empty. */
  get modelObject(): THREE.Object3D | null {
    return this.currentModel?.object ?? null;
  }

  get boundsRadius(): number {
    return this.modelRadius;
  }

  /** Which isolator rows currently have authored data on the loaded model. */
  channelPresence(): Set<IsolatorId> {
    const present = new Set<IsolatorId>();
    const root = this.modelObject;
    if (!root) return present;

    for (const channel of GEOMETRY_CHANNELS) {
      if (geometryChannelPresent(root, channel.id)) present.add(channel.id);
    }

    for (const [, original] of this.originalMaterials) {
      const list = Array.isArray(original) ? original : [original];
      for (const material of list) {
        for (const channel of MATERIAL_CHANNELS) {
          if (materialChannelPresent(material, channel.id)) present.add(channel.id);
        }
      }
    }
    return present;
  }

  // ---------------------------------------------------------------- camera

  frameModel(margin = 1.06): void {
    const box = this.modelBox.isEmpty()
      ? new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1))
      : this.modelBox;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    // Fitting the bounding sphere rather than a single axis keeps the model
    // inside the frame while it spins or the user orbits around it.
    const radius = ((size.length() / 2) * margin) || 1;

    const width = Math.max(this.canvas.clientWidth, 1);
    const height = Math.max(this.canvas.clientHeight, 1);
    const usableWidth = Math.max(width - this.framingInsetRight, width * 0.35);

    const halfV = THREE.MathUtils.degToRad(this.perspective.fov) / 2;
    const halfH = Math.atan(Math.tan(halfV) * (usableWidth / height));
    const distance = radius / Math.sin(Math.min(halfV, halfH));

    const direction = new THREE.Vector3(0.62, 0.42, 1).normalize();
    this.perspective.position.copy(center).addScaledVector(direction, distance);

    this.controls.target.copy(center);
    this.controls.minDistance = maxDim * 0.05;
    this.controls.maxDistance = distance * 12;
    this.applyClipPlanes(distance, maxDim);
    this.controls.update();
    if (this.handheld.connected) this.handheld.onHostFramed();
  }

  /**
   * Recomputes the clipping planes for wherever the camera currently sits.
   * far/near is capped so the depth buffer keeps a stable triangle order —
   * a ratio past ~1e4 is what shows up as flickering, intersecting faces.
   */
  applyClipPlanes(distance = this.camera.position.distanceTo(this.controls.target), maxDim = this.modelRadius * 2): void {
    const c = this.settings.camera;
    const MAX_RATIO = 10_000;

    if (c.autoClip) {
      const dist = distance || this.modelRadius * 4;
      const size = Math.max(maxDim, 1e-4);
      c.near = Math.max(dist / 100, size / 100, 0.001);
      c.far = dist + size * 20;
    }

    c.near = Math.max(c.near, 0.0001);
    c.far = Math.max(c.far, c.near * 2);
    if (c.far / c.near > MAX_RATIO) c.near = c.far / MAX_RATIO;

    this.onClipChange?.(c.near, c.far);

    this.perspective.near = c.near;
    this.perspective.far = c.far;
    this.perspective.updateProjectionMatrix();
    this.updateOrthographicFrustum();
    this.applyViewOffset();
  }

  setView(direction: ViewDirection): void {
    const center = this.modelBox.isEmpty() ? new THREE.Vector3(0, 1, 0) : this.modelBox.getCenter(new THREE.Vector3());
    const distance = this.camera.position.distanceTo(this.controls.target) || this.modelRadius * 4;

    const offsets: Record<ViewDirection, THREE.Vector3> = {
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
      top: new THREE.Vector3(0, 1, 0.0001),
      bottom: new THREE.Vector3(0, -1, 0.0001),
      iso: new THREE.Vector3(0.62, 0.42, 1).normalize(),
    };

    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(offsets[direction], distance);
    this.camera.lookAt(center);
    this.controls.update();
  }

  private switchProjection(toOrtho: boolean): void {
    const from = this.camera;
    const to = toOrtho ? this.orthographic : this.perspective;
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);

    this.camera = to;
    this.controls.object = to;
    this.postfx.setCamera(to);
    this.updateOrthographicFrustum();
    this.controls.update();
  }

  private updateOrthographicFrustum(): void {
    const distance = this.orthographic.position.distanceTo(this.controls.target) || this.modelRadius * 4;
    const fov = THREE.MathUtils.degToRad(this.perspective.fov);
    const halfHeight = Math.tan(fov / 2) * distance;
    const aspect = this.perspective.aspect || 1;

    this.orthographic.top = halfHeight;
    this.orthographic.bottom = -halfHeight;
    this.orthographic.left = -halfHeight * aspect;
    this.orthographic.right = halfHeight * aspect;

    const c = this.settings.camera;
    if (c.autoClip) {
      // A negative near keeps anything between the camera and the subject
      // visible, which an orthographic frustum would otherwise cut away.
      this.orthographic.near = -this.modelRadius * 200 - 100;
      this.orthographic.far = this.modelRadius * 200 + 1000;
    } else {
      this.orthographic.near = c.near;
      this.orthographic.far = Math.max(c.far, c.near + 1e-4);
    }
    this.orthographic.updateProjectionMatrix();
  }

  // ------------------------------------------------------------- animation

  get animationClips(): THREE.AnimationClip[] {
    return this.clips;
  }

  playClip(index: number): void {
    if (!this.mixer || !this.clips[index]) return;
    this.action?.stop();
    this.action = this.mixer.clipAction(this.clips[index]);
    this.action.reset().play();
    this.animationPaused = false;
    this.action.paused = false;
    this.emitFrame();
  }

  toggleAnimation(): boolean {
    if (!this.action) return false;
    this.animationPaused = !this.animationPaused;
    this.action.paused = this.animationPaused;
    this.emitFrame();
    return !this.animationPaused;
  }

  pauseAnimation(): void {
    if (!this.action) return;
    this.animationPaused = true;
    this.action.paused = true;
    this.emitFrame();
  }

  /** Keeps the timeline readout in sync while the render loop is not driving it. */
  private emitFrame(): void {
    if (this.action) this.onFrame?.(this.action.time, this.action.getClip().duration);
  }

  seekAnimation(time: number): void {
    if (!this.action || !this.mixer) return;
    this.action.time = time;
    this.mixer.update(0);
    this.onFrame?.(this.action.time, this.action.getClip().duration);
  }

  setAnimationSpeed(speed: number): void {
    this.animationSpeed = speed;
  }

  get isAnimationPlaying(): boolean {
    return this.action !== null && !this.animationPaused;
  }

  private stopAnimation(): void {
    this.action?.stop();
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.action = null;
    this.clips = [];
    this.animationPaused = true;
  }

  // -------------------------------------------------------------- picking

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.onSelect) return;

    const start = { x: event.clientX, y: event.clientY };
    const onUp = (up: PointerEvent) => {
      this.canvas.removeEventListener('pointerup', onUp);
      // Ignore the pointer-up that ends an orbit drag.
      if (Math.hypot(up.clientX - start.x, up.clientY - start.y) > 4) return;
      this.pickAt(up);
    };
    this.canvas.addEventListener('pointerup', onUp);
  };

  private pickAt(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const hits = raycaster.intersectObject(this.modelRoot, true);
    this.onSelect?.(hits[0]?.object ?? null);
  }

  // --------------------------------------------------------------- capture

  /** Renders one frame at `scale`x the viewport size and returns a PNG blob. */
  async captureImage(scale: number, transparent: boolean): Promise<Blob> {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const previousBackground = this.scene.background;
    const previousRatio = this.renderer.getPixelRatio();

    if (transparent) {
      this.scene.background = null;
      this.renderer.setClearAlpha(0);
    }

    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(width, height, false);
    this.postfx.setSize(width, height);
    this.postfx.render(0);

    const blob = await new Promise<Blob | null>((resolve) => this.canvas.toBlob(resolve, 'image/png'));

    this.scene.background = previousBackground;
    this.renderer.setClearAlpha(this.settings.env.background === 'transparent' ? 0 : 1);
    this.renderer.setPixelRatio(previousRatio);
    this.resize();

    if (!blob) throw new Error('截图失败');
    return blob;
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.clearModel();
    this.postfx.dispose();
    this.pmrem.dispose();
    this.envRT?.dispose();
    this.envSourceTexture?.dispose();
    this.matcapTexture?.dispose();
    for (const texture of this.hdriCache.values()) texture.dispose();
    for (const material of this.shadingOverrides) material.dispose();
    for (const texture of this.gradientCache.values()) texture.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }
}

// ----------------------------------------------------------------- helpers

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/**
 * Box3.setFromObject can return an empty box for splat meshes and for skinned
 * geometry whose bind pose sits outside the rest bounds, so fall back to a
 * per-object union when the fast path yields nothing usable.
 */
function boundsOf(object: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3().setFromObject(object, true);
  if (!box.isEmpty() && Number.isFinite(box.min.x) && Number.isFinite(box.max.x)) return box;

  const fallback = new THREE.Box3();
  const withBounds = object as THREE.Object3D & { getBoundingBox?: () => THREE.Box3 };
  if (typeof withBounds.getBoundingBox === 'function') {
    const own = withBounds.getBoundingBox();
    if (own && !own.isEmpty()) {
      fallback.union(own.clone().applyMatrix4(object.matrixWorld));
    }
  }
  return fallback;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const disposable = child as THREE.Object3D & { dispose?: () => void };

    if (mesh.isMesh || (child as THREE.LineSegments).isLineSegments) {
      mesh.geometry?.dispose();
      for (const material of materialsOf(mesh)) {
        for (const value of Object.values(material ?? {})) {
          if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
        }
        material?.dispose();
      }
    } else if (typeof disposable.dispose === 'function') {
      disposable.dispose();
    }
  });
}

interface SplatFloaterCache {
  opacities: Float32Array;
  dists: Float32Array;
  p70: number;
}

interface PackedSplatApi {
  numSplats: number;
  needsUpdate: boolean;
  getSplat(index: number): {
    center: THREE.Vector3;
    scales: THREE.Vector3;
    quaternion: THREE.Quaternion;
    opacity: number;
    color: THREE.Color;
  };
  setSplat(
    index: number,
    center: THREE.Vector3,
    scales: THREE.Vector3,
    quaternion: THREE.Quaternion,
    opacity: number,
    color: THREE.Color,
  ): void;
  forEachSplat(
    callback: (
      index: number,
      center: THREE.Vector3,
      scales: THREE.Vector3,
      quaternion: THREE.Quaternion,
      opacity: number,
      color: THREE.Color,
    ) => void,
  ): void;
}

function asSplatMesh(object: THREE.Object3D): (THREE.Object3D & { packedSplats?: PackedSplatApi; needsUpdate: boolean }) | null {
  const mesh = object as THREE.Object3D & { packedSplats?: PackedSplatApi; needsUpdate: boolean };
  return mesh.packedSplats ? mesh : null;
}

function buildSplatFloaterCache(packed: PackedSplatApi): SplatFloaterCache {
  const n = packed.numSplats;
  const opacities = new Float32Array(n);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const zs = new Float32Array(n);
  packed.forEachSplat((i, center, _scales, _quat, opacity) => {
    opacities[i] = opacity;
    xs[i] = center.x;
    ys[i] = center.y;
    zs[i] = center.z;
  });

  const solid: number[] = [];
  for (let i = 0; i < n; i++) if (opacities[i] >= 0.16) solid.push(i);
  const ids = solid.length >= 32 ? solid : [...Array(n).keys()].filter((i) => opacities[i] > 0.04);
  const [cx, cy, cz] = densestSplatCenter(xs, ys, zs, ids);

  const dists = new Float32Array(n);
  const solidDists: number[] = [];
  for (let i = 0; i < n; i++) {
    dists[i] = Math.hypot(xs[i] - cx, ys[i] - cy, zs[i] - cz);
    if (opacities[i] >= 0.16) solidDists.push(dists[i]);
  }
  solidDists.sort((a, b) => a - b);
  const p70 = solidDists[Math.min(solidDists.length - 1, Math.floor(solidDists.length * 0.7))] || 1;
  return { opacities, dists, p70 };
}

function densestSplatCenter(
  xs: Float32Array,
  ys: Float32Array,
  zs: Float32Array,
  ids: number[],
): [number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const i of ids) {
    minX = Math.min(minX, xs[i]);
    minY = Math.min(minY, ys[i]);
    minZ = Math.min(minZ, zs[i]);
    maxX = Math.max(maxX, xs[i]);
    maxY = Math.max(maxY, ys[i]);
    maxZ = Math.max(maxZ, zs[i]);
  }
  const cell = Math.max(1e-4, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 18);
  const bins = new Map<number, { n: number; x: number; y: number; z: number }>();
  const gx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const gy = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  for (const i of ids) {
    const xi = Math.min(gx - 1, Math.max(0, Math.floor((xs[i] - minX) / cell)));
    const yi = Math.min(gy - 1, Math.max(0, Math.floor((ys[i] - minY) / cell)));
    const zi = Math.max(0, Math.floor((zs[i] - minZ) / cell));
    const key = xi + yi * gx + zi * gx * gy;
    const bin = bins.get(key);
    if (bin) {
      bin.n++;
      bin.x += xs[i];
      bin.y += ys[i];
      bin.z += zs[i];
    } else {
      bins.set(key, { n: 1, x: xs[i], y: ys[i], z: zs[i] });
    }
  }
  let best: { n: number; x: number; y: number; z: number } | null = null;
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
  if (!best) return [0, 0, 0];
  return [best.x / best.n, best.y / best.n, best.z / best.n];
}
