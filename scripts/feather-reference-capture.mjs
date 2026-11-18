import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 898, height: 520 } });
  await page.goto('https://ttillberg.github.io/codevember-2026/12/?still', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.body.classList.contains('loading'), undefined, { timeout: 120000 });
  // The reference clamps simulation dt. Wall-clock waiting can capture its drawing reveal,
  // especially on software GPUs: wait actual frames before comparing the rendered look.
  await page.evaluate(() => new Promise(resolve => {
    let frames = 0;
    const tick = () => ++frames >= 55 ? resolve() : requestAnimationFrame(tick);
    requestAnimationFrame(tick);
  }));
  await mkdir('smoke-out/effects', { recursive: true });
  await page.screenshot({ path: 'smoke-out/effects/feather-upstream.png', timeout: 60000 });
  console.log('Saved reference after reveal frames');
} finally { await browser.close(); }
