import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /shader|WebGL|THREE/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:5173/'}?showcase=materials&tier=low`, { waitUntil: 'domcontentloaded' });
  await page.getByText('渲染组件库', { exact: true }).click();
  assert.deepEqual(await page.locator('[data-quality=approved] [data-effect]').evaluateAll(nodes => nodes.map(n => n.dataset.effect).sort()), ['mirror', 'moss']);
  await page.locator('[data-experimental] summary').click();
  const ids = await page.locator('[data-effect]').evaluateAll(nodes => nodes.map(n => n.dataset.effect));
  assert.equal(ids.length, 15);
  await mkdir('smoke-out/effects', { recursive: true });
  if (!process.argv.includes('--trace-only')) {
  for (const id of ids) {
    const button = page.locator(`[data-effect="${id}"]`);
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true', id);
    await page.waitForTimeout(350);
    if (['glass', 'moss', 'cloth', 'mirror'].includes(id))
      await page.screenshot({ path: `smoke-out/effects/${id}.png` });
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'false', `${id} off`);
    console.log(`PASS UI ${id}`);
  }
  await page.locator('[data-effect=glass]').click();
  await page.locator('[data-effect=metal]').click();
  assert.equal(await page.locator('[data-effect=glass]').getAttribute('aria-pressed'), 'false');
  await page.locator('[data-effect=moss]').click();
  await page.locator('[data-effect=mirror]').click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '移除全部组件', exact: true }).click();
  assert.equal(await page.locator('[data-effect][aria-pressed=true]').count(), 0);
  console.log('PASS exclusive slots, composition and remove all');

  const lifecycle = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { SurfaceEffect } = await import('/src/effects/SurfaceEffect.ts');
    const { GrowthEffect } = await import('/src/effects/GrowthEffect.ts');
    const { ClothEffect } = await import('/src/effects/ClothEffect.ts');
    const { EffectHost } = await import('/src/effects/EffectHost.ts');
    const scene = new THREE.Scene();
    const geometry = new THREE.SphereGeometry(1, 12, 8), material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(geometry, material); scene.add(mesh);
    const host = new EffectHost(scene);
    host.add(new SurfaceEffect([mesh], 'jelly'));
    for (let i = 0; i < 120; i++) host.update(1 / 60);
    const deformed = mesh.geometry !== geometry;
    host.remove('surface');
    const restored = mesh.geometry === geometry && mesh.material === material;
    host.add(new GrowthEffect([mesh], 'moss', 200, 0.05, 1));
    host.update(0.05); host.clearModelEffects();
    const detached = mesh.children.length === 0;
    host.add(new ClothEffect(2, 3));
    for (let i = 0; i < 600; i++) host.update(1 / 60);
    const cloth = scene.children.find(o => o.name === 'Pinned cloth');
    const finite = [...cloth.geometry.attributes.position.array].every(Number.isFinite);
    host.dispose(); geometry.dispose(); material.dispose();
    return { deformed, restored, detached, finite, remaining: scene.children.length };
  });
  assert.deepEqual(lifecycle, { deformed: true, restored: true, detached: true, finite: true, remaining: 1 });
  console.log('PASS geometry/material restoration, model cleanup and cloth stability');
  }
  assert.deepEqual(errors, []);

  if (!process.argv.includes('--realtime-only')) {
  await page.getByRole('button', { name: '路径追踪静帧', exact: true }).click();
  await page.waitForFunction(() => /已累积 [1-9]/.test(document.querySelector('.effect-trace-dialog [role=status]')?.textContent ?? ''), undefined, { timeout: 120000 });
  await page.getByRole('button', { name: '暂停采样', exact: true }).click();
  const png = await page.locator('.effect-trace-dialog canvas').evaluate(canvas => canvas.toDataURL());
  assert.ok(png.length > 1000, 'path-traced image must contain rendered pixels');
  await writeFile('smoke-out/effects/pathtrace.png', Buffer.from(png.split(',')[1], 'base64'));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存路径追踪 PNG', exact: true }).click();
  assert.equal((await downloadPromise).suggestedFilename(), 'pathtraced-model.png');
  await page.getByRole('button', { name: '关闭路径追踪', exact: true }).click();
  assert.equal(await page.locator('.effect-trace-dialog').count(), 0);
  await page.locator('[data-effect=water-calm]').click();
  await page.waitForTimeout(300);
  console.log('PASS path tracing samples, export, close and realtime resume');
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
