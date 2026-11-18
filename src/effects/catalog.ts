import type { Viewer } from '../core/Viewer';
import type { SceneEffect } from './EffectHost';
import { WaterEffect } from './WaterEffect';
import { SurfaceEffect, type SurfaceKind } from './SurfaceEffect';
import { GrowthEffect, type GrowthKind } from './GrowthEffect';
import { FeatherEffect, type FeatherOptions } from './FeatherEffect';
import { LiquidGlassEffect, type LiquidGlassOptions } from './LiquidGlassEffect';
import { ClothEffect } from './ClothEffect';
import { ReflectiveFloorEffect } from './AtmosphereEffect';
import { CollisionRainEffect, type RainOptions } from './CollisionRainEffect';
import { JellyEffect } from './JellyEffect';
import { WetSurfaceEffect } from './WetSurfaceEffect';

export interface EffectOptions { strength: number; speed: number; feather?: FeatherOptions & { meshIds?: string[] }; glass?: LiquidGlassOptions; rain?: RainOptions }
export interface EffectPreset {
  id: string; label: string; slot: string; description: string; source: string;
  model?: boolean;
  create(viewer: Viewer, options: EffectOptions): SceneEffect;
}

/** Only visually accepted implementations belong in the main library. */
export function isApprovedPreset(id: string): boolean {
  return id === 'mirror' || id === 'moss';
}
const sources = {
  glass: 'https://infinite-liquid-glass.shader.se/?v=2',
  jelly: 'https://github.com/scottstts/Jelly-Baby',
  product: 'https://custom.gomezsimindustries.com/',
  moss: 'https://ttillberg.github.io/codevember-2026/05/',
  feather: 'https://ttillberg.github.io/codevember-2026/12/',
  fur: 'https://x.com/0xrinx/status/2119507326348779632/video/1',
};
const surface = (id: SurfaceKind, label: string, description: string, source: string): EffectPreset => ({
  id, label, description: id === 'jelly' ? '源码 XPBD 体积软体、落地接触与休眠；Shift 拖动模型。光学仍为实验项。' : description, source, slot: 'surface', model: true,
  create: (v, p) => id === 'jelly' ? new JellyEffect(v, p.strength, p.speed) : new SurfaceEffect(v.getEffectMeshes(), id, p.strength, p.speed),
});
const growth = (id: GrowthKind, label: string, description: string): EffectPreset => ({
  id, label, description, source: sources[id], slot: 'growth', model: true,
  create: (v, p) => new GrowthEffect(v.getEffectMeshes(), id,
    v.settings.render.tier === 'low' ? 1200 : v.settings.render.tier === 'medium' ? 3500 : 7000,
    (id === 'fur' ? 0.04 : id === 'moss' ? 0.025 : 0.065) * p.strength, p.speed),
});

/** Source provenance differs by module; see REFERENCE_RESEARCH.md and vendor notices. */
export const EFFECT_PRESETS: EffectPreset[] = [
  { id: 'wet', slot: 'surface', model: true, label: '源码湿表面涟漪',
    source: 'https://github.com/ektogamat/threejs-conference/blob/main/src/tsl/rainRipples.js',
    description: '保留原 PBR 贴图，向上表面加入原版雨滴涟漪和湿润粗糙度；可与降雨组合。',
    create: (v, p) => new WetSurfaceEffect(v.getEffectMeshes(), p.strength, p.speed) },
  ...(['calm', 'ocean'] as const).map((kind): EffectPreset => ({
    id: `water-${kind}`, slot: 'water', label: kind === 'calm' ? '平静水面' : '海洋波浪',
    source: 'https://oscardumlao.com/', description: '动态几何波浪＋环境高光；无流体碰撞、岸边泡沫。',
    create(v, p) { const effect = new WaterEffect(v.settings.render.tier); effect.setPreset(kind);
      effect.setAmplitude((kind === 'calm' ? 0.025 : 0.16) * p.strength); effect.setSpeed(p.speed); return effect; },
  })),
  { id: 'glass', slot: 'surface', model: true, label: '液态玻璃透镜', source: sources.glass,
    description: '场景内玻璃透镜：Lamé 倒角、5 波长色散与当前环境反射，折射当前模型画面。',
    create: (v, p) => new LiquidGlassEffect(v, p.strength, p.glass) },
  surface('frosted', '磨砂玻璃', '应用到当前静态模型；粗糙透射。', sources.glass),
  surface('gem', '高折射晶体', '高折射率与色散；非多次光线追踪。', 'https://r3f.maximeheckel.com/raytracing6'),
  surface('metal', '拉丝金属', '复用现有 PBR；添加可撤销的各向异性材质预设。', sources.product),
  surface('carpaint', '清漆车漆', '复用现有 PBR；金属底色与清漆高光。', 'https://toyota-neotix-demo.vercel.app/'),
  surface('jelly', '果冻弹性', '透射材质＋体积保持弹性脉动；无软体碰撞和拖拽。', sources.jelly),
  growth('fur', '表面毛发（旧原型）', '尚无已核验的毛发参考；原 MD 视频实际展示纹理玻璃，此项未完成源码复现。'),
  growth('moss', '表面苔藓', '实例化簇状几何；无原案例的物种笔刷。'),
  { id: 'feather', slot: 'growth', model: true, label: '源码羽毛覆盖', source: sources.feather,
    description: '原版羽片几何、结构色与阴影，直接覆盖当前静态模型；支持选择对象、梳理方向与羽色。',
    create(v, p) {
      const meshes = v.getEffectMeshes().filter(mesh => !p.feather?.meshIds || p.feather.meshIds.includes(mesh.uuid));
      if (!meshes.length) throw new Error('所选对象不可用，请重新选择羽毛覆盖对象。');
      return new FeatherEffect(meshes, { count: v.settings.render.tier === 'low' ? 1800 : v.settings.render.tier === 'medium' ? 5000 : 10000,
        ...p.feather, lengthScale: p.strength, speed: p.speed });
    } },
  { id: 'cloth', slot: 'cloth', label: '风动布料', source: 'https://balloons.shader.se/',
    description: '新增双角固定布片；Verlet 约束与地面接触，无充气压力和模型碰撞。',
    create: (_v, p) => new ClothEffect(p.strength, p.speed) },
  { id: 'rain', slot: 'atmosphere', label: 'GPU 碰撞降雨', source: 'https://threejspunk.vercel.app/',
    description: '源码 GPU 雨带与模型高度碰撞；水花需提供五帧图集，尚不含湿路面。',
    create: (v, p) => new CollisionRainEffect(v, p.speed, p.rain) },
  { id: 'mirror', slot: 'reflection', label: '镜面地台', source: 'https://threejspunk.vercel.app/',
    description: '新增地面平面反射，可反射当前模型；不是粗糙路面反射。',
    create: v => new ReflectiveFloorEffect(v.settings.render.tier === 'low' ? 256 : 512) },
];

/** Shared entry point for UI and future automation; original materials are restored on removal. */
export function applyEffectPreset(viewer: Viewer, id: string, options: Partial<EffectOptions> = {}): void {
  const preset = EFFECT_PRESETS.find(p => p.id === id);
  if (!preset) throw new Error(`未知效果预设：${id}`);
  if (preset.model) {
    if (!viewer.getEffectMeshes().length) throw new Error('请先载入带法线的静态网格模型；暂不支持高斯、骨骼、Morph 或实例模型。');
    if (viewer.settings.scene.isolator || viewer.settings.scene.shading !== 'shaded')
      throw new Error('请先在场景面板切换到常规着色，并关闭通道隔离。');
    const vertices = viewer.getEffectMeshes().reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
    if ((id === 'jelly' || preset.slot === 'growth') && vertices > 300000)
      throw new Error('表面生长和弹性组件当前支持总顶点数 30 万以内的静态模型。');
  }
  const strength = Math.min(2, Math.max(0.1, options.strength ?? 1));
  const speed = Math.min(3, Math.max(0, options.speed ?? 1));
  if (!Number.isFinite(strength) || !Number.isFinite(speed)) throw new Error('效果参数必须为有限数值。');
  const effect = preset.create(viewer, { strength, speed, feather: options.feather, glass: options.glass, rain: options.rain });
  Object.assign(effect, { presetId: preset.id });
  viewer.effects.add(effect);
}
