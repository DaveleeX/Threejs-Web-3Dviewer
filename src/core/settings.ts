import type { IsolatorId } from './channels';
export type { IsolatorId } from './channels';
export type ToneMappingName = 'none' | 'linear' | 'reinhard' | 'cineon' | 'aces' | 'agx' | 'neutral';
export type BackgroundMode = 'environment' | 'color' | 'gradient' | 'transparent';
export type ShadingMode = 'shaded' | 'wireframe' | 'shaded-wire' | 'normals' | 'matcap';
export type ShadowKind = 'off' | 'soft' | 'blurred';
export type QualityTier = 'low' | 'medium' | 'high';
export type ProjectionMode = 'perspective' | 'orthographic';

export interface RenderSettings {
  tier: QualityTier;
  /** Multiplier over devicePixelRatio; 1 = native, <1 = upscaled from a smaller buffer. */
  resolutionScale: number;
  toneMapping: ToneMappingName;
  exposure: number;
  antialias: 'off' | 'smaa' | 'fxaa';
}

export interface EnvironmentSettings {
  /** Id of a procedural preset, or `custom` when an HDR/EXR file is loaded. */
  preset: string;
  intensity: number;
  rotation: number;
  background: BackgroundMode;
  backgroundColor: string;
  backgroundBlur: number;
  backgroundIntensity: number;
  fogEnabled: boolean;
  fogColor: string;
  fogNear: number;
  fogFar: number;
}

export interface LightSettings {
  keyEnabled: boolean;
  keyIntensity: number;
  keyColor: string;
  /** Degrees, around Y. */
  keyAzimuth: number;
  /** Degrees above the horizon. */
  keyElevation: number;
  fillEnabled: boolean;
  fillIntensity: number;
  rimEnabled: boolean;
  rimIntensity: number;
  shadow: ShadowKind;
  shadowMapSize: number;
  shadowRadius: number;
  shadowBias: number;
  shadowNormalBias: number;
  shadowOpacity: number;
  groundShadow: boolean;
}

export interface PostSettings {
  aoEnabled: boolean;
  aoIntensity: number;
  aoRadius: number;
  aoThickness: number;
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
}

export interface GradeSettings {
  enabled: boolean;
  contrast: number;
  saturation: number;
  shadows: number;
  midtones: number;
  highlights: number;
  tint: string;
  vignette: number;
  vignetteSoftness: number;
  lutEnabled: boolean;
  lutIntensity: number;
}

export interface CameraSettings {
  projection: ProjectionMode;
  fov: number;
  autoRotate: boolean;
  autoRotateSpeed: number;
  damping: number;
  panEnabled: boolean;
  /** Prevents orbiting below the ground plane. */
  limitBelowGround: boolean;
  /** Derives the clipping planes from the framed model instead of using near/far. */
  autoClip: boolean;
  near: number;
  far: number;
}

export interface SceneSettings {
  shading: ShadingMode;
  grid: boolean;
  axes: boolean;
  boundingBox: boolean;
  /** Rescales the model so its largest dimension matches `normalizeSize`. */
  autoNormalize: boolean;
  normalizeSize: number;
  flatShading: boolean;
  doubleSided: boolean;
  /** Isolates one PBR / geometry channel; `null` uses `shading`. */
  isolator: IsolatorId | null;
  /** 0 = show all Gaussians; 1 = hide far floaters around a splat model. */
  splatFloater: number;
}

export interface ViewerSettings {
  render: RenderSettings;
  env: EnvironmentSettings;
  light: LightSettings;
  post: PostSettings;
  grade: GradeSettings;
  camera: CameraSettings;
  scene: SceneSettings;
}

export function defaultSettings(tier: QualityTier): ViewerSettings {
  return {
    render: {
      tier,
      resolutionScale: 1,
      toneMapping: 'aces',
      exposure: 1,
      antialias: 'fxaa',
    },
    env: {
      preset: 'hdri:studio-abstract',
      intensity: 1,
      rotation: 0,
      background: 'environment',
      backgroundColor: '#0d1017',
      backgroundBlur: 0,
      backgroundIntensity: 1,
      fogEnabled: false,
      fogColor: '#0d1017',
      fogNear: 4,
      fogFar: 22,
    },
    light: {
      keyEnabled: true,
      keyIntensity: 2.1,
      keyColor: '#ffffff',
      keyAzimuth: 135,
      keyElevation: 48,
      fillEnabled: true,
      fillIntensity: 0.45,
      rimEnabled: true,
      rimIntensity: 0.9,
      shadow: 'soft',
      shadowMapSize: 4096,
      shadowRadius: 3,
      shadowBias: -0.0004,
      shadowNormalBias: 0.02,
      shadowOpacity: 0.42,
      groundShadow: true,
    },
    post: {
      aoEnabled: true,
      aoIntensity: 0.99,
      aoRadius: 0.08,
      aoThickness: 0.4,
      bloomEnabled: true,
      bloomStrength: 0.04,
      bloomRadius: 0.2,
      bloomThreshold: 3.79,
    },
    grade: {
      enabled: true,
      contrast: 1.06,
      saturation: 1.25,
      shadows: 0.04,
      midtones: 1.1,
      highlights: 0.89,
      tint: '#ffffff',
      vignette: 0.11,
      vignetteSoftness: 0.51,
      lutEnabled: false,
      lutIntensity: 1,
    },
    camera: {
      projection: 'perspective',
      fov: 45,
      autoRotate: false,
      autoRotateSpeed: 1,
      damping: 0.07,
      panEnabled: true,
      limitBelowGround: true,
      autoClip: true,
      near: 0.03951920502811009,
      far: 43.951920502811,
    },
    scene: {
      shading: 'shaded',
      grid: true,
      axes: false,
      boundingBox: false,
      autoNormalize: true,
      normalizeSize: 2,
      flatShading: false,
      doubleSided: false,
      isolator: null,
      splatFloater: 0,
    },
  };
}
