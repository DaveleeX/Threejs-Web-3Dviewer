import type { Viewer } from '../core/Viewer';
import type { FeatherOptions } from '../effects/FeatherEffect';
import { EFFECT_PRESETS, applyEffectPreset, isApprovedPreset } from '../effects/catalog';
import { addButtons, addNote, addSlider, addSelect, createPanel, el } from './controls';
import '../styles/effects.css';

export function mountEffectsPanel(sidebar: HTMLElement, viewer: Viewer,
  notify: (message: string, kind?: 'info' | 'error' | 'success') => void): void {
  const panel = createPanel({ title: '渲染组件库', hue: 'var(--g-scene)', open: false });
  sidebar.append(panel.root);
  addNote(panel.body, '一键启用，再次点击撤销。同类组件互斥；模型表面组件在换模型或切换着色时自动撤销。');
  let strength = 1, speed = 1;
  addSlider(panel.body, { label: '下次应用 · 幅度/长度', value: 1, min: 0.1, max: 2, step: 0.1,
    onInput: value => { strength = value; } });
  addSlider(panel.body, { label: '下次应用 · 动画速度', value: 1, min: 0, max: 3, step: 0.1,
    onInput: value => { speed = value; } });
  const buttons = new Map<string, HTMLButtonElement>();
  const featherOptions: FeatherOptions = {};
  const featherTarget = el('select'); featherTarget.setAttribute('aria-label', '羽毛覆盖对象');
  const refreshTargets = () => {
    const previous = featherTarget.value;
    featherTarget.replaceChildren(new Option('当前模型全部网格', 'all'));
    for (const mesh of viewer.getEffectMeshes()) featherTarget.add(new Option(mesh.name || mesh.uuid.slice(0, 8), mesh.uuid));
    featherTarget.value = [...featherTarget.options].some(option => option.value === previous) ? previous : 'all';
  };
  featherTarget.addEventListener('focus', refreshTargets);
  panel.root.addEventListener('toggle', refreshTargets);
  const experimental = createPanel({ title: '实验项 · 尚未达到参考画质', hue: 'var(--g-scene)', open: false });
  experimental.root.dataset.experimental = 'true';
  addNote(experimental.body, '旧版原型与源码复现候选均尚未通过参考画质验收；完成源码核查与画面对比后才会转入正式组件。');
  const sync = () => {
    for (const preset of EFFECT_PRESETS) {
      const enabled = viewer.effects.activePreset(preset.slot) === preset.id;
      const button = buttons.get(preset.id)!;
      button.setAttribute('aria-pressed', String(enabled));
      button.textContent = `${enabled ? '撤销 · ' : ''}${preset.label}`;
    }
  };
  for (const preset of EFFECT_PRESETS) {
    const row = el('div', 'effect-card');
    const button = el('button', 'btn', preset.label); button.type = 'button';
    button.dataset.effect = preset.id; button.setAttribute('aria-pressed', 'false');
    buttons.set(preset.id, button);
    const description = el('p', undefined, preset.description);
    const source = el('a', undefined, '参考案例 ↗'); source.href = preset.source;
    if (preset.id === 'fur') source.textContent = '原条目视频（纹理玻璃）↗';
    source.target = '_blank'; source.rel = 'noopener noreferrer';
    button.onclick = () => {
      try {
        if (viewer.effects.activePreset(preset.slot) === preset.id) viewer.effects.remove(preset.slot);
        else {
          applyEffectPreset(viewer, preset.id, { strength, speed,
            feather: { ...featherOptions, meshIds: featherTarget.value && featherTarget.value !== 'all' ? [featherTarget.value] : undefined } });
        }
        sync();
      } catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); sync(); }
    };
    row.dataset.quality = isApprovedPreset(preset.id) ? 'approved' : 'experimental';
    row.append(button, description, source);
    if (preset.id === 'feather') {
      const label = el('label', undefined, '羽毛覆盖对象'); label.append(featherTarget); row.append(label);
      addSelect(row, { label: '羽色', value: 'body', options: [
        { value: 'body', label: '躯干羽毛' }, { value: 'gorget', label: '紫色颈羽' }, { value: 'crown', label: '青色冠羽' },
      ], onChange: value => { featherOptions.look = value as FeatherOptions['look']; } });
      addSelect(row, { label: '梳理方向', value: 'down', options: [
        { value: 'down', label: '向下 −Y' }, { value: 'back', label: '向后 −Z' }, { value: 'right', label: '横向 +X' },
      ], onChange: value => { featherOptions.direction = value === 'back' ? [0, 0, -1] : value === 'right' ? [1, 0, 0] : [0, -1, 0]; } });
      addNote(row, '选好对象、羽色和方向后点击覆盖。更改参数后需撤销再应用；骨骼和 Morph 模型暂不支持。');
    }
    (isApprovedPreset(preset.id) ? panel.body : experimental.body).append(row);
  }
  viewer.effects.events.addEventListener('change', sync);
  viewer.effects.events.addEventListener('error', event => {
    const error = (event as CustomEvent).detail;
    notify(`组件已停用：${error instanceof Error ? error.message : String(error)}`, 'error');
  });
  addButtons(panel.body, [{ label: '移除全部组件', onClick() { viewer.effects.dispose(); sync(); } }]);
  panel.body.append(experimental.root);
  const [feather] = addButtons(experimental.body, [{ label: '源码复现 · 羽毛场景（待验收）', onClick: () => {
    feather.disabled = true;
    void import('../effects/FeatherReferenceSession').then(module => module.openFeatherReference(viewer))
      .catch(error => notify(error instanceof Error ? error.message : String(error), 'error'))
      .finally(() => { feather.disabled = false; });
  } }]);
  const [trace] = addButtons(experimental.body, [{ label: '路径追踪静帧', onClick: () => {
    trace.disabled = true;
    void import('../effects/PathTracePreview').then(module => module.openPathTracePreview(viewer))
      .catch(error => notify(error instanceof Error ? error.message : String(error), 'error'))
      .finally(() => { trace.disabled = false; });
  } }]);
  addNote(experimental.body, '路径追踪目前仍是实验静帧入口，尚未完成与参考案例的画质验收。');
}
