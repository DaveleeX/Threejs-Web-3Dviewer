import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto((process.argv[2] ?? 'http://127.0.0.1:5173/') + '?showcase=materials&tier=high');
  await page.getByText('渲染组件库',{exact:true}).click();
  await page.locator('[data-experimental] summary').click();
  await mkdir('smoke-out/effects',{recursive:true});
  const gpu=await page.evaluate(()=>{
    const gl=document.querySelector('canvas').getContext('webgl2');
    const ext=gl.getExtension('WEBGL_debug_renderer_info');
    return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  });
  if(/swiftshader|software|llvmpipe/i.test(gpu))throw Error('Hardware benchmark requires a physical GPU');
  const measure=()=>page.evaluate(async()=>{
    const frames=[];let previous;
    for(let i=0;i<100;i++){
      const t=await new Promise(requestAnimationFrame);
      if(i>40)frames.push(t-previous);
      previous=t;
    }
    frames.sort((a,b)=>a-b);
    return {medianMs:frames[Math.floor(frames.length*.5)],p95Ms:frames[Math.floor(frames.length*.95)],
      averageFps:1000/(frames.reduce((a,b)=>a+b,0)/frames.length)};
  });
  const ids=await page.locator('[data-effect]').evaluateAll(nodes=>nodes.map(n=>n.dataset.effect));
  const samples=[];
  samples.push({id:'baseline',cycle:0,...await measure()});
  for(let cycle=0;cycle<2;cycle++){
    for(const id of ids){
      const button=page.locator('[data-effect="'+id+'"]');
      await button.click();
      const sample={id,cycle,...await measure()};
      samples.push(sample);console.log(JSON.stringify(sample));
      if(cycle===0&&['jelly','wet','rain','feather'].includes(id))
        await page.screenshot({path:'smoke-out/effects/'+id+'-gpu.png'});
      await button.click();
    }
    samples.push({id:'baseline',cycle:cycle+1,...await measure()});
  }
  const result={gpu,viewport:[1440,900],tier:'high',devicePixelRatio:1,samples,errors};
  await writeFile('smoke-out/effects/gpu-benchmark.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({gpu,baselines:samples.filter(x=>x.id==='baseline'),errors},null,2));
  if(errors.length)throw Error('Console errors during GPU benchmark');
} finally {await browser.close();}
