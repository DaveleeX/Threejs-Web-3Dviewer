import * as THREE from 'three';
import type { Viewer } from '../core/Viewer';
import type { HandheldHost } from './handheldHost';
import { ENV_PRESETS, HDRI_PREFIX, HDRI_PRESETS, presetThumbCss } from '../core/environments';
import type { BackgroundMode, ProjectionMode, QualityTier, ShadingMode, ToneMappingName } from '../core/settings';
import {
  CHANNEL_ICONS,
  GEOMETRY_CHANNELS,
  MATERIAL_CHANNELS,
  type ChannelDef,
  type IsolatorId,
} from '../core/channels';
import { mountHandheldPanel } from './handheldPanel';
import {
  addButtons,
  addColor,
  addDivider,
  addNote,
  addSegmented,
  addSelect,
  addSlider,
  addSubhead,
  addToggle,
  createPanel,
  el,
  pickFiles,
  type SliderHandle,
} from './controls';

export interface PanelsApi {
  refreshStats(): void;
  refreshTree(): void;
  refreshChannels(): void;
  selectInTree(object: THREE.Object3D | null): void;
}

export function buildPanels(
  sidebar: HTMLElement,
  viewer: Viewer,
  notify: (message: string, kind?: 'info' | 'error' | 'success') => void,
  handheld: HandheldHost,
): PanelsApi {
  const s = viewer.settings;
  let refreshChannels = (): void => {};
  let splatCleanup: HTMLElement;
  let splatFloaterSlider: SliderHandle;
  let splatLookNote: HTMLParagraphElement;
  let gridToggle: ReturnType<typeof addToggle>;
  let backgroundMode: ReturnType<typeof addSegmented<BackgroundMode>>;
  let backgroundColor: ReturnType<typeof addColor>;
  let aoToggle: ReturnType<typeof addToggle>;
  let bloomToggle: ReturnType<typeof addToggle>;
  let gradeToggle: ReturnType<typeof addToggle>;
  let toneMappingSelect: ReturnType<typeof addSelect<ToneMappingName>>;
  let exposureSlider: SliderHandle;

  // ------------------------------------------------------------------ scene

  const scenePanel = createPanel({ title: '场景与显示', hue: 'var(--g-scene)', open: true });
  {
    const b = scenePanel.body;
    addSubhead(b, '着色模式');
    addSegmented<ShadingMode>(b, {
      value: s.scene.shading,
      options: [
        { value: 'shaded', label: '着色' },
        { value: 'shaded-wire', label: '着色+线框' },
        { value: 'wireframe', label: '线框' },
        { value: 'normals', label: '法线' },
        { value: 'matcap', label: '素模' },
      ],
      onChange: (value) => {
        s.scene.shading = value;
        s.scene.isolator = null;
        viewer.applyScene();
        markChannel(null);
      },
    });

    addDivider(b);
    const matHead = el('div', 'panel-subhead', '材质通道');
    b.append(matHead);
    const matList = el('div', 'channel-list');
    const channelRows = new Map<IsolatorId, HTMLElement>();

    const markChannel = (id: IsolatorId | null): void => {
      for (const [key, row] of channelRows) row.classList.toggle('is-active', key === id);
    };

    const bindChannel = (channel: ChannelDef, list: HTMLElement): void => {
      const row = el('button', 'channel-row');
      row.type = 'button';
      row.innerHTML = `${CHANNEL_ICONS[channel.icon] ?? ''}<span>${channel.label}</span>`;
      row.addEventListener('click', () => {
        s.scene.isolator = s.scene.isolator === channel.id ? null : channel.id;
        viewer.applyScene();
        markChannel(s.scene.isolator);
      });
      channelRows.set(channel.id, row);
      list.append(row);
    };

    for (const channel of MATERIAL_CHANNELS) bindChannel(channel, matList);
    b.append(matList);

    const geoHead = el('div', 'panel-subhead', '几何');
    b.append(geoHead);
    const geoList = el('div', 'channel-list');
    for (const channel of GEOMETRY_CHANNELS) bindChannel(channel, geoList);
    b.append(geoList);
    markChannel(s.scene.isolator);

    const refreshChannelPresence = (): void => {
      const present = viewer.channelPresence();
      let matCount = 0;
      let geoCount = 0;
      for (const channel of MATERIAL_CHANNELS) {
        const on = present.has(channel.id);
        if (on) matCount++;
        channelRows.get(channel.id)?.classList.toggle('is-empty', !on);
      }
      for (const channel of GEOMETRY_CHANNELS) {
        const on = present.has(channel.id);
        if (on) geoCount++;
        channelRows.get(channel.id)?.classList.toggle('is-empty', !on);
      }
      matHead.textContent = `材质通道 (${matCount})`;
      geoHead.textContent = `几何 (${geoCount})`;
    };
    refreshChannels = refreshChannelPresence;
    refreshChannelPresence();

    addDivider(b);
    gridToggle = addToggle(b, {
      label: '地面网格',
      value: s.scene.grid,
      onChange: (v) => {
        s.scene.grid = v;
        viewer.applyScene();
      },
    });
    addToggle(b, {
      label: '坐标轴',
      value: s.scene.axes,
      onChange: (v) => {
        s.scene.axes = v;
        viewer.applyScene();
      },
    });
    addToggle(b, {
      label: '包围盒',
      value: s.scene.boundingBox,
      onChange: (v) => {
        s.scene.boundingBox = v;
        viewer.applyScene();
      },
    });

    splatCleanup = el('div', 'hidden');
    addDivider(splatCleanup);
    addSubhead(splatCleanup, '高斯泼溅');
    splatFloaterSlider = addSlider(splatCleanup, {
      label: '清理浮点',
      min: 0,
      max: 100,
      step: 1,
      value: Math.round(s.scene.splatFloater * 100),
      suffix: '%',
      onInput: (value) => viewer.setSplatFloaterTrim(value / 100),
    });
    addNote(splatCleanup, '只隐藏远离主体的高斯球，不重新训练。0% 为原始结果。');
    splatLookNote = addNote(
      splatCleanup,
      '高斯资产按原视频/训练色显示（无 ACES、泛光、调色）。打开网格模型会自动回到网页默认的摄影棚外观。',
    );
    splatLookNote.classList.add('hidden');
    b.append(splatCleanup);

    addDivider(b);
    addToggle(b, {
      label: '平滑法线 → 平面',
      value: s.scene.flatShading,
      onChange: (v) => {
        s.scene.flatShading = v;
        viewer.applyScene();
      },
    });
    addToggle(b, {
      label: '双面渲染',
      value: s.scene.doubleSided,
      onChange: (v) => {
        s.scene.doubleSided = v;
        viewer.applyScene();
      },
    });
    addToggle(b, {
      label: '自动归一化尺寸',
      value: s.scene.autoNormalize,
      onChange: (v) => {
        s.scene.autoNormalize = v;
        notify('将在下次载入模型时生效');
      },
    });
  }

  // ------------------------------------------------------------ environment

  const envPanel = createPanel({ title: '环境与背景', hue: 'var(--g-env)', open: true });
  const envThumbs = new Map<string, HTMLElement>();
  {
    const b = envPanel.body;

    addSubhead(b, '程序化');
    const grid = el('div', 'thumb-grid');
    for (const preset of ENV_PRESETS) {
      const thumb = el('div', 'thumb');
      thumb.style.background = presetThumbCss(preset);
      thumb.title = preset.label;
      thumb.append(el('span', undefined, preset.label));
      thumb.addEventListener('click', () => {
        s.env.preset = preset.id;
        void viewer.applyEnvironment();
        markEnv(preset.id);
      });
      envThumbs.set(preset.id, thumb);
      grid.append(thumb);
    }
    b.append(grid);

    addSubhead(b, 'HDR 全景');
    const hdriGrid = el('div', 'thumb-grid');
    for (const preset of HDRI_PRESETS) {
      const key = `${HDRI_PREFIX}${preset.id}`;
      const thumb = el('div', 'thumb');
      thumb.style.backgroundImage = `url(${import.meta.env.BASE_URL}${preset.thumb})`;
      thumb.title = preset.label;
      thumb.append(el('span', undefined, preset.label));
      thumb.addEventListener('click', async () => {
        if (thumb.classList.contains('is-busy')) return;
        const previous = s.env.preset;
        s.env.preset = key;
        markEnv(key);
        thumb.classList.add('is-busy');
        try {
          await viewer.applyEnvironment();
          envPanel.setNote(preset.label);
        } catch (err) {
          s.env.preset = previous;
          markEnv(previous);
          notify(`HDR 载入失败：${message(err)}`, 'error');
        } finally {
          thumb.classList.remove('is-busy');
        }
      });
      envThumbs.set(key, thumb);
      hdriGrid.append(thumb);
    }
    b.append(hdriGrid);

    markEnv(s.env.preset);

    addButtons(b, [
      {
        label: '载入 HDR / EXR',
        onClick: async () => {
          const [file] = await pickFiles('.hdr,.exr', false);
          if (!file) return;
          try {
            await viewer.loadEnvironmentFile(file);
            markEnv('custom');
            envPanel.setNote(file.name);
            notify(`已应用环境贴图 ${file.name}`, 'success');
          } catch (err) {
            notify(`环境贴图载入失败：${message(err)}`, 'error');
          }
        },
      },
    ]);

    addSlider(b, {
      label: '环境强度',
      min: 0,
      max: 4,
      step: 0.01,
      value: s.env.intensity,
      onInput: (v) => {
        s.env.intensity = v;
        viewer.scene.environmentIntensity = v;
      },
    });
    addSlider(b, {
      label: '环境旋转',
      min: 0,
      max: 360,
      step: 1,
      suffix: '°',
      value: s.env.rotation,
      onInput: (v) => {
        s.env.rotation = v;
        viewer.scene.environmentRotation.set(0, THREE.MathUtils.degToRad(v), 0);
        viewer.refreshBackground();
      },
    });

    addDivider(b);
    addSubhead(b, '背景');
    backgroundMode = addSegmented<BackgroundMode>(b, {
      value: s.env.background,
      options: [
        { value: 'gradient', label: '渐变' },
        { value: 'color', label: '纯色' },
        { value: 'environment', label: '环境' },
        { value: 'transparent', label: '透明' },
      ],
      onChange: (v) => {
        s.env.background = v;
        viewer.refreshBackground();
      },
    });
    backgroundColor = addColor(b, {
      label: '背景颜色',
      value: s.env.backgroundColor,
      onChange: (v) => {
        s.env.backgroundColor = v;
        viewer.refreshBackground();
      },
    });
    addSlider(b, {
      label: '背景模糊',
      min: 0,
      max: 1,
      step: 0.01,
      value: s.env.backgroundBlur,
      onInput: (v) => {
        s.env.backgroundBlur = v;
        viewer.refreshBackground();
      },
    });
    addSlider(b, {
      label: '背景亮度',
      min: 0,
      max: 3,
      step: 0.01,
      value: s.env.backgroundIntensity,
      onInput: (v) => {
        s.env.backgroundIntensity = v;
        viewer.refreshBackground();
      },
    });

    addDivider(b);
    addToggle(b, {
      label: '雾效',
      value: s.env.fogEnabled,
      onChange: (v) => {
        s.env.fogEnabled = v;
        void viewer.applyEnvironment();
      },
    });
    addColor(b, {
      label: '雾颜色',
      value: s.env.fogColor,
      onChange: (v) => {
        s.env.fogColor = v;
        void viewer.applyEnvironment();
      },
    });
    addSlider(b, {
      label: '雾起点',
      min: 0,
      max: 20,
      step: 0.1,
      value: s.env.fogNear,
      onInput: (v) => {
        s.env.fogNear = v;
        void viewer.applyEnvironment();
      },
    });
    addSlider(b, {
      label: '雾终点',
      min: 1,
      max: 80,
      step: 0.5,
      value: s.env.fogFar,
      onInput: (v) => {
        s.env.fogFar = v;
        void viewer.applyEnvironment();
      },
    });
  }

  function markEnv(id: string): void {
    for (const [key, node] of envThumbs) node.classList.toggle('is-active', key === id);
  }

  // ---------------------------------------------------------------- lights

  const lightPanel = createPanel({ title: '灯光与阴影', hue: 'var(--g-light)' });
  {
    const b = lightPanel.body;
    const refresh = () => viewer.applyLighting();

    addSubhead(b, '主光');
    addToggle(b, { label: '启用', value: s.light.keyEnabled, onChange: (v) => ((s.light.keyEnabled = v), refresh()) });
    addSlider(b, {
      label: '强度',
      min: 0,
      max: 10,
      step: 0.05,
      value: s.light.keyIntensity,
      onInput: (v) => ((s.light.keyIntensity = v), refresh()),
    });
    addColor(b, { label: '颜色', value: s.light.keyColor, onChange: (v) => ((s.light.keyColor = v), refresh()) });
    addSlider(b, {
      label: '水平角',
      min: 0,
      max: 360,
      step: 1,
      suffix: '°',
      value: s.light.keyAzimuth,
      onInput: (v) => ((s.light.keyAzimuth = v), refresh()),
    });
    addSlider(b, {
      label: '仰角',
      min: 2,
      max: 89,
      step: 1,
      suffix: '°',
      value: s.light.keyElevation,
      onInput: (v) => ((s.light.keyElevation = v), refresh()),
    });

    addDivider(b);
    addSubhead(b, '补光 / 轮廓光');
    addToggle(b, { label: '补光', value: s.light.fillEnabled, onChange: (v) => ((s.light.fillEnabled = v), refresh()) });
    addSlider(b, {
      label: '补光强度',
      min: 0,
      max: 4,
      step: 0.05,
      value: s.light.fillIntensity,
      onInput: (v) => ((s.light.fillIntensity = v), refresh()),
    });
    addToggle(b, { label: '轮廓光', value: s.light.rimEnabled, onChange: (v) => ((s.light.rimEnabled = v), refresh()) });
    addSlider(b, {
      label: '轮廓强度',
      min: 0,
      max: 4,
      step: 0.05,
      value: s.light.rimIntensity,
      onInput: (v) => ((s.light.rimIntensity = v), refresh()),
    });

    addDivider(b);
    addSubhead(b, '阴影');
    addSegmented(b, {
      value: s.light.shadow,
      options: [
        { value: 'off' as const, label: '关闭' },
        { value: 'soft' as const, label: 'PCF 柔和' },
        { value: 'blurred' as const, label: 'VSM 虚化' },
      ],
      onChange: (v) => ((s.light.shadow = v), refresh()),
    });
    addSelect(b, {
      label: '阴影分辨率',
      value: String(s.light.shadowMapSize),
      options: [
        { value: '1024', label: '1024' },
        { value: '2048', label: '2048' },
        { value: '4096', label: '4096' },
      ],
      onChange: (v) => ((s.light.shadowMapSize = Number(v)), refresh()),
    });
    addSlider(b, {
      label: '柔和度',
      min: 0,
      max: 16,
      step: 0.5,
      value: s.light.shadowRadius,
      onInput: (v) => ((s.light.shadowRadius = v), refresh()),
    });
    addSlider(b, {
      label: '偏移 bias',
      min: -0.005,
      max: 0.002,
      step: 0.0001,
      decimals: 4,
      value: s.light.shadowBias,
      onInput: (v) => ((s.light.shadowBias = v), refresh()),
    });
    addSlider(b, {
      label: '法线偏移',
      min: 0,
      max: 0.2,
      step: 0.001,
      decimals: 3,
      value: s.light.shadowNormalBias,
      onInput: (v) => ((s.light.shadowNormalBias = v), refresh()),
    });
    addToggle(b, {
      label: '地面接影',
      value: s.light.groundShadow,
      onChange: (v) => ((s.light.groundShadow = v), refresh()),
    });
    addSlider(b, {
      label: '接影浓度',
      min: 0,
      max: 1,
      step: 0.01,
      value: s.light.shadowOpacity,
      onInput: (v) => ((s.light.shadowOpacity = v), refresh()),
    });
  }

  // ---------------------------------------------------------------- camera

  const cameraPanel = createPanel({ title: '相机', hue: 'var(--g-camera)' });
  {
    const b = cameraPanel.body;
    const refresh = () => viewer.applyCamera();

    addSegmented<ProjectionMode>(b, {
      value: s.camera.projection,
      options: [
        { value: 'perspective', label: '透视' },
        { value: 'orthographic', label: '正交' },
      ],
      onChange: (v) => ((s.camera.projection = v), refresh()),
    });
    addSlider(b, {
      label: '视野 FOV',
      min: 10,
      max: 110,
      step: 1,
      suffix: '°',
      value: s.camera.fov,
      onInput: (v) => ((s.camera.fov = v), refresh()),
    });
    addToggle(b, {
      label: '自动旋转',
      value: s.camera.autoRotate,
      onChange: (v) => ((s.camera.autoRotate = v), refresh()),
    });
    addSlider(b, {
      label: '旋转速度',
      min: -8,
      max: 8,
      step: 0.1,
      value: s.camera.autoRotateSpeed,
      onInput: (v) => ((s.camera.autoRotateSpeed = v), refresh()),
    });
    addSlider(b, {
      label: '阻尼',
      min: 0,
      max: 0.3,
      step: 0.005,
      decimals: 3,
      value: s.camera.damping,
      onInput: (v) => ((s.camera.damping = v), refresh()),
    });
    addToggle(b, { label: '允许平移', value: s.camera.panEnabled, onChange: (v) => ((s.camera.panEnabled = v), refresh()) });
    addToggle(b, {
      label: '锁定地平线以上',
      value: s.camera.limitBelowGround,
      onChange: (v) => ((s.camera.limitBelowGround = v), refresh()),
    });

    addSubhead(b, '裁剪平面');

    let nearSlider!: SliderHandle;
    let farSlider!: SliderHandle;
    const syncClipEnabled = (auto: boolean) => {
      nearSlider.setEnabled(!auto);
      farSlider.setEnabled(!auto);
    };

    addToggle(b, {
      label: '自动裁剪',
      value: s.camera.autoClip,
      onChange: (v) => {
        s.camera.autoClip = v;
        syncClipEnabled(v);
        viewer.applyClipPlanes();
      },
    });

    nearSlider = addSlider(b, {
      label: '近裁剪',
      min: 0.001,
      max: 5,
      step: 0.001,
      decimals: 3,
      value: s.camera.near,
      onInput: (v) => {
        s.camera.near = v;
        if (s.camera.far < v * 2) s.camera.far = v * 2;
        viewer.applyClipPlanes();
      },
    });
    farSlider = addSlider(b, {
      label: '远裁剪',
      min: 1,
      max: 5000,
      step: 1,
      value: s.camera.far,
      onInput: (v) => {
        s.camera.far = v;
        if (s.camera.near > v / 2) s.camera.near = Math.max(0.001, v / 2);
        viewer.applyClipPlanes();
      },
    });
    syncClipEnabled(s.camera.autoClip);

    viewer.onClipChange = (near, far) => {
      nearSlider.set(near);
      farSlider.set(far);
    };

    addNote(b, '近裁剪过大会切掉靠近镜头的部分；远/近比值过大会让重叠面闪烁、前后翻。');
    addButtons(b, [{ label: '重新框选模型', onClick: () => viewer.frameModel() }]);
    mountHandheldPanel(b, handheld);
  }

  // ------------------------------------------------------------ post effects

  const postPanel = createPanel({ title: '后期特效', hue: 'var(--g-post)' });
  {
    const b = postPanel.body;
    const refresh = () => viewer.applyPost();

    addSubhead(b, '环境光遮蔽 GTAO');
    aoToggle = addToggle(b, { label: '启用 AO', value: s.post.aoEnabled, onChange: (v) => ((s.post.aoEnabled = v), refresh()) });
    addSlider(b, {
      label: 'AO 强度',
      min: 0,
      max: 2,
      step: 0.01,
      value: s.post.aoIntensity,
      onInput: (v) => ((s.post.aoIntensity = v), refresh()),
    });
    addSlider(b, {
      label: 'AO 半径',
      min: 0.01,
      max: 1,
      step: 0.01,
      value: s.post.aoRadius,
      onInput: (v) => ((s.post.aoRadius = v), refresh()),
    });
    addSlider(b, {
      label: 'AO 厚度',
      min: 0.05,
      max: 4,
      step: 0.05,
      value: s.post.aoThickness,
      onInput: (v) => ((s.post.aoThickness = v), refresh()),
    });

    addDivider(b);
    addSubhead(b, '泛光 Bloom');
    bloomToggle = addToggle(b, { label: '启用泛光', value: s.post.bloomEnabled, onChange: (v) => ((s.post.bloomEnabled = v), refresh()) });
    addSlider(b, {
      label: '强度',
      min: 0,
      max: 2,
      step: 0.01,
      value: s.post.bloomStrength,
      onInput: (v) => ((s.post.bloomStrength = v), refresh()),
    });
    addSlider(b, {
      label: '半径',
      min: 0,
      max: 1.5,
      step: 0.01,
      value: s.post.bloomRadius,
      onInput: (v) => ((s.post.bloomRadius = v), refresh()),
    });
    addSlider(b, {
      label: '阈值',
      min: 0,
      max: 2,
      step: 0.01,
      value: s.post.bloomThreshold,
      onInput: (v) => ((s.post.bloomThreshold = v), refresh()),
    });
  }

  // ---------------------------------------------------------------- grading

  const gradePanel = createPanel({ title: '调色', hue: 'var(--g-color)' });
  {
    const b = gradePanel.body;
    const refresh = () => viewer.applyPost();

    gradeToggle = addToggle(b, { label: '启用调色', value: s.grade.enabled, onChange: (v) => ((s.grade.enabled = v), refresh()) });
    addSlider(b, {
      label: '对比度',
      min: 0.5,
      max: 2,
      step: 0.01,
      value: s.grade.contrast,
      onInput: (v) => ((s.grade.contrast = v), refresh()),
    });
    addSlider(b, {
      label: '饱和度',
      min: 0,
      max: 2.5,
      step: 0.01,
      value: s.grade.saturation,
      onInput: (v) => ((s.grade.saturation = v), refresh()),
    });
    addSlider(b, {
      label: '暗部提升',
      min: -0.15,
      max: 0.25,
      step: 0.005,
      decimals: 3,
      value: s.grade.shadows,
      onInput: (v) => ((s.grade.shadows = v), refresh()),
    });
    addSlider(b, {
      label: '中间调',
      min: 0.4,
      max: 2.2,
      step: 0.01,
      value: s.grade.midtones,
      onInput: (v) => ((s.grade.midtones = v), refresh()),
    });
    addSlider(b, {
      label: '高光增益',
      min: 0.3,
      max: 2,
      step: 0.01,
      value: s.grade.highlights,
      onInput: (v) => ((s.grade.highlights = v), refresh()),
    });
    addColor(b, { label: '色调', value: s.grade.tint, onChange: (v) => ((s.grade.tint = v), refresh()) });

    addDivider(b);
    addSlider(b, {
      label: '暗角',
      min: 0,
      max: 1.5,
      step: 0.01,
      value: s.grade.vignette,
      onInput: (v) => ((s.grade.vignette = v), refresh()),
    });
    addSlider(b, {
      label: '暗角柔度',
      min: 0,
      max: 1,
      step: 0.01,
      value: s.grade.vignetteSoftness,
      onInput: (v) => ((s.grade.vignetteSoftness = v), refresh()),
    });

    addDivider(b);
    addSubhead(b, '3D LUT');
    const lutToggle = addToggle(b, {
      label: '启用 LUT',
      value: s.grade.lutEnabled,
      onChange: (v) => ((s.grade.lutEnabled = v), refresh()),
    });
    addSlider(b, {
      label: 'LUT 强度',
      min: 0,
      max: 1,
      step: 0.01,
      value: s.grade.lutIntensity,
      onInput: (v) => ((s.grade.lutIntensity = v), refresh()),
    });
    addButtons(b, [
      {
        label: '载入 .cube / .3dl',
        onClick: async () => {
          const [file] = await pickFiles('.cube,.3dl', false);
          if (!file) return;
          try {
            await viewer.loadLutFile(file);
            lutToggle.set(true);
            gradePanel.setNote(file.name);
            notify(`已应用 LUT ${file.name}`, 'success');
          } catch (err) {
            notify(`LUT 载入失败：${message(err)}`, 'error');
          }
        },
      },
      {
        label: '清除',
        onClick: () => {
          viewer.clearLut();
          lutToggle.set(false);
          gradePanel.setNote('');
        },
      },
    ]);
  }

  // ------------------------------------------------------------------ render

  const renderPanel = createPanel({ title: '渲染质量', hue: 'var(--g-render)' });
  {
    const b = renderPanel.body;
    const refresh = () => viewer.applyRender();

    addSelect<QualityTier>(b, {
      label: '性能档位',
      value: s.render.tier,
      options: [
        { value: 'low', label: '低（移动端）' },
        { value: 'medium', label: '中' },
        { value: 'high', label: '高' },
      ],
      onChange: (v) => ((s.render.tier = v), refresh()),
    });
    addSlider(b, {
      label: '渲染倍率',
      min: 0.5,
      max: 2,
      step: 0.05,
      value: s.render.resolutionScale,
      onInput: (v) => ((s.render.resolutionScale = v), refresh()),
    });
    toneMappingSelect = addSelect<ToneMappingName>(b, {
      label: '色调映射',
      value: s.render.toneMapping,
      options: [
        { value: 'aces', label: 'ACES Filmic' },
        { value: 'agx', label: 'AgX' },
        { value: 'neutral', label: 'Khronos Neutral' },
        { value: 'reinhard', label: 'Reinhard' },
        { value: 'cineon', label: 'Cineon' },
        { value: 'linear', label: 'Linear' },
        { value: 'none', label: '不使用' },
      ],
      onChange: (v) => ((s.render.toneMapping = v), refresh()),
    });
    exposureSlider = addSlider(b, {
      label: '曝光',
      min: 0,
      max: 4,
      step: 0.01,
      value: s.render.exposure,
      onInput: (v) => ((s.render.exposure = v), refresh()),
    });
    addSelect(b, {
      label: '抗锯齿',
      value: s.render.antialias,
      options: [
        { value: 'smaa' as const, label: 'SMAA（质量优先）' },
        { value: 'fxaa' as const, label: 'FXAA（性能优先）' },
        { value: 'off' as const, label: '关闭' },
      ],
      onChange: (v) => ((s.render.antialias = v), refresh()),
    });
    addNote(b, '首次打开会按显卡自动选择档位，可随时手动覆盖。');
  }

  // ------------------------------------------------------------------- info

  const infoPanel = createPanel({ title: '模型信息', hue: 'var(--g-info)', open: true });
  const statsList = el('dl', 'kv');
  const tree = el('div', 'tree');
  {
    const b = infoPanel.body;
    b.append(statsList);
    addDivider(b);
    addSubhead(b, '场景层级');
    b.append(tree);
    addNote(b, '点击视口中的模型可定位对象；点击列表项可切换显隐。');
  }

  sidebar.append(
    scenePanel.root,
    envPanel.root,
    lightPanel.root,
    cameraPanel.root,
    postPanel.root,
    gradePanel.root,
    renderPanel.root,
    infoPanel.root,
  );

  // ---------------------------------------------------------------- updates

  const rowsByObject = new Map<THREE.Object3D, HTMLElement>();

  function refreshStats(): void {
    statsList.replaceChildren();
    const stats = viewer.stats;
    if (!stats) {
      infoPanel.setNote('');
      splatCleanup.classList.add('hidden');
      splatLookNote.classList.add('hidden');
      return;
    }

    infoPanel.setNote(stats.format);
    const size = stats.size;
    const entries: Array<[string, string]> = [
      ['格式', stats.format],
      ['三角面', stats.triangles.toLocaleString()],
      ['顶点', stats.vertices.toLocaleString()],
      ['网格', String(stats.meshes)],
      ['材质', String(stats.materials)],
      ['贴图', String(stats.textures)],
      ['动画', String(stats.animations)],
      ['尺寸', `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`],
    ];
    if (stats.splats > 0) entries.splice(1, 0, ['高斯点', stats.splats.toLocaleString()]);
    splatCleanup.classList.toggle('hidden', stats.splats <= 0);
    splatLookNote.classList.toggle('hidden', stats.splats <= 0);
    splatFloaterSlider.set(Math.round(s.scene.splatFloater * 100));
    gridToggle.set(s.scene.grid);
    backgroundMode.set(s.env.background);
    backgroundColor.set(s.env.backgroundColor);
    aoToggle.set(s.post.aoEnabled);
    bloomToggle.set(s.post.bloomEnabled);
    gradeToggle.set(s.grade.enabled);
    toneMappingSelect.set(s.render.toneMapping);
    exposureSlider.set(s.render.exposure);

    for (const [key, value] of entries) {
      statsList.append(el('dt', undefined, key), el('dd', undefined, value));
    }
  }

  function refreshTree(): void {
    tree.replaceChildren();
    rowsByObject.clear();

    const root = viewer.modelObject;
    if (!root) {
      tree.append(el('div', 'panel-note', '尚未载入模型'));
      return;
    }

    const walk = (object: THREE.Object3D, depth: number): void => {
      const row = el('div', 'tree-row');
      row.style.paddingLeft = `${4 + depth * 11}px`;

      const eye = el('span', 'tree-eye', object.visible ? '●' : '○');
      const name = el('span', 'tree-name', object.name || object.type);
      const kind = el('span', 'tree-kind', shortType(object));
      row.append(eye, name, kind);

      row.addEventListener('click', () => {
        object.visible = !object.visible;
        eye.textContent = object.visible ? '●' : '○';
        row.classList.toggle('is-hidden', !object.visible);
      });

      rowsByObject.set(object, row);
      tree.append(row);

      // Deep hierarchies from CAD exports would otherwise flood the sidebar.
      if (depth < 6) for (const child of object.children) walk(child, depth + 1);
    };

    walk(root, 0);
  }

  function selectInTree(object: THREE.Object3D | null): void {
    for (const row of rowsByObject.values()) row.classList.remove('is-selected');
    if (!object) return;
    const row = rowsByObject.get(object);
    if (!row) return;
    row.classList.add('is-selected');
    row.scrollIntoView({ block: 'nearest' });
  }

  return { refreshStats, refreshTree, refreshChannels, selectInTree };
}

function shortType(object: THREE.Object3D): string {
  const mesh = object as THREE.Mesh;
  if (mesh.isMesh) {
    const count = mesh.geometry?.attributes.position?.count ?? 0;
    return `${count.toLocaleString()}v`;
  }
  return object.type.replace(/Object3D|Group/, 'Grp');
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
