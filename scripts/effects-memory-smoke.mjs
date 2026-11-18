import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/memory-test?tier=low', route => route.fulfill({ contentType: 'text/html', body: '<canvas style="width:160px;height:120px"></canvas>' }));
  await page.goto('http://127.0.0.1:5173/memory-test?tier=low');
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { Viewer } = await import('/src/core/Viewer.ts');
    const { EFFECT_PRESETS, applyEffectPreset } = await import('/src/effects/catalog.ts');
    const viewer = new Viewer(document.querySelector('canvas'));
    try {
      await viewer.applyEnvironment();
      const rawBackground = { matches: viewer.scene.background === viewer.getEffectEnvironment(), blur: viewer.scene.backgroundBlurriness,
        width: viewer.scene.background.image.width, height: viewer.scene.background.image.height,
        preset: viewer.settings.env.preset, background: viewer.settings.env.background, raw: viewer.getEffectEnvironment()?.uuid, active: viewer.scene.background?.uuid };
      const environment = viewer.scene.environment;
      for (let i = 0; i < 30; i++) { viewer.settings.env.rotation = i; viewer.settings.env.intensity = .5 + i / 30; await viewer.applyEnvironment(); }
      const sameProbe = environment === viewer.scene.environment;
      const object = new THREE.Mesh(new THREE.SphereGeometry(.8, 16, 10), new THREE.MeshStandardMaterial());
      viewer.setModel({ object, kind: 'mesh', format: 'test', animations: [], cleanup() {} });
      await viewer.applyEnvironment();
      const draw = () => viewer.renderer.render(viewer.scene, viewer.camera);
      const counts = () => ({ ...viewer.renderer.info.memory, programs: viewer.renderer.info.programs.length });
      const samples = [];
      for (let cycle = 0; cycle < 6; cycle++) {
        for (const preset of EFFECT_PRESETS) {
          applyEffectPreset(viewer, preset.id);
          viewer.effects.update(1 / 60); draw();
          viewer.effects.dispose(); draw();
        }
        samples.push(counts());
      }
      for (let cycle = 0; cycle < 3; cycle++) {
        for (const id of ['rain','wet','moss','mirror']) applyEffectPreset(viewer,id);
        viewer.effects.update(1/60); draw();
        applyEffectPreset(viewer,'jelly');
        viewer.effects.update(1/60); draw();
        viewer.effects.clearModelEffects(); viewer.effects.dispose(); draw();
        samples.push(counts());
      }
      viewer.settings.env.background = 'gradient';
      for (let i = 0; i < 30; i++) { viewer.settings.env.backgroundColor = '#' + (0x123400 + i * 19).toString(16); viewer.refreshBackground(); draw(); }
      const gradients = viewer.gradientCache.size;
      let lutDisposed = 0;
      for (let i = 0; i < 8; i++) {
        const texture = new THREE.Data3DTexture(new Uint8Array(32), 2, 2, 2);
        texture.addEventListener('dispose', () => lutDisposed++);
        viewer.postfx.setLUT(texture);
      }
      viewer.clearLut();
      return { rawBackground, sameProbe, samples, gradients, lutDisposed };
    } finally { viewer.dispose(); }
  });
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.rawBackground.matches, true); assert.equal(result.rawBackground.blur, 0); assert.equal(result.sameProbe, true);
  assert.equal(result.rawBackground.width, 3561); assert.equal(result.rawBackground.height, 1779);
  assert.ok(result.gradients <= 2); assert.equal(result.lutDisposed, 8);
  const base = result.samples[1];
  for (const counts of result.samples.slice(2)) for (const key of Object.keys(base))
    assert.ok(counts[key] <= base[key] + 1, `${key} keeps growing: ${JSON.stringify(result.samples)}`);
  assert.deepEqual(errors, []);
  console.log('PASS repeated effects plateau, PMREM reuse, bounded gradient cache, LUT disposal, sharp HDR');
} finally { await browser.close(); }
