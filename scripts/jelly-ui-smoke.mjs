import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--use-angle=d3d11','--ignore-gpu-blocklist']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4174/?showcase=materials&tier=high');
  await page.getByText('渲染组件库',{exact:true}).click();
  await page.locator('[data-experimental] summary').click();
  await page.locator('[data-effect=jelly]').click();
  await page.evaluate(async()=>{for(let i=0;i<120;i++)await new Promise(requestAnimationFrame);});
  assert.equal(await page.locator('[data-effect=jelly]').getAttribute('aria-pressed'),'true');
  await page.screenshot({path:'smoke-out/effects/jelly-gpu.png'});
  await page.locator('[data-effect=jelly]').click();
  assert.deepEqual(errors,[]);
  console.log('PASS actual UI activates source jelly, simulates and removes without errors');
} finally {await browser.close();}
