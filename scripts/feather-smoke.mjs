import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5173/?showcase=materials&tier=low');
  await page.getByText('渲染组件库', { exact: true }).click();
  assert.equal(await page.locator('[data-quality=approved]').count(), 2);
  await page.locator('[data-experimental] summary').click();
  await page.getByRole('button', { name: '源码复现 · 羽毛场景（待验收）', exact: true }).click();
  console.log('Opened source session');
  await page.waitForFunction(() => document.querySelector('.feather-reference-dialog [role=status]')?.textContent?.includes('运行中'), undefined, { timeout: 120000 });
  await page.waitForTimeout(3000);
  console.log('Reference rendered', errors);
  await mkdir('smoke-out/effects', { recursive: true });
  await page.screenshot({ path: 'smoke-out/effects/feather-source-port.png', timeout: 60000 });
  await page.getByRole('button', { name: '抖动羽毛', exact: true }).click();
  await page.getByRole('button', { name: '关闭羽毛场景', exact: true }).click();
  assert.equal(await page.locator('.feather-reference-dialog').count(), 0);
  await page.getByRole('button', { name: '源码复现 · 羽毛场景（待验收）', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.feather-reference-dialog [role=status]')?.textContent?.includes('运行中'), undefined, { timeout: 120000 });
  await page.getByRole('button', { name: '关闭羽毛场景', exact: true }).click();
  await page.locator('[data-effect=mirror]').click();
  assert.equal(await page.locator('[data-effect=mirror]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  console.log('PASS reference shaders, render, ruffle, close, viewer resume, approved gating');
} finally { await browser.close(); }
