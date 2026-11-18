import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/source-physics-test', route => route.fulfill({ contentType: 'text/html', body: '<canvas width="200" height="150"></canvas>' }));
  await page.goto('http://127.0.0.1:5173/source-physics-test');
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { createJellyCage } = await import('/src/effects/JellyCage.ts');
    const { SoftBody } = await import('/src/effects/vendor/jelly/soft-body.js');
    const { CollisionRainEffect } = await import('/src/effects/CollisionRainEffect.ts');
    const { JellyEffect } = await import('/src/effects/JellyEffect.ts');
    const physics = [];
    for (const geometry of [new T.SphereGeometry(.035, 20, 12), new T.BoxGeometry(.06,.04,.05,4,4,4), new T.TorusGeometry(.025,.01,8,20)]) {
      geometry.translate(0,.05,0);
      const rest = geometry.attributes.position.array.slice();
      const cage = createJellyCage(geometry, 4), body = new SoftBody(cage);
      let restError = 0;
      for (let i=0;i<rest.length;i++) restError = Math.max(restError, Math.abs(rest[i]-cage.surface.positions[i]));
      body.nudge();
      const started = performance.now();
      let minimum=1, finite=true;
      for(let i=0;i<1200;i++) {
        body.step(1/240);
        minimum=Math.min(minimum,body.lastMinJacobian);
        finite &&= body.isFinite();
        if(i%4===0 && body.surfaceDirty)body.updateSurface();
      }
      physics.push({restError, minimum, finite, volume:body.volumeRatio(), sleeping:body.sleeping,
        floor: Math.min(...Array.from(body.x).filter((_,i)=>i%3===1)), nodes:cage.pos.length/3,
        tets:cage.tets.length, elapsedMs:performance.now()-started});
      geometry.dispose();
    }
    const renderer = new T.WebGLRenderer({canvas:document.querySelector('canvas')});
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(45,4/3,.01,100);
    camera.position.set(4,3,5); camera.lookAt(0,0,0);
    // Asymmetric obstacles expose mirrored UV bugs in the top-down height map.
    const a = new T.Mesh(new T.BoxGeometry(1,2,1),new T.MeshStandardMaterial());
    a.position.set(1,1,.7); scene.add(a);
    const b = new T.Mesh(new T.BoxGeometry(.5,.6,.5),a.material);
    b.position.set(-1,.3,-.7); scene.add(b);
    const fake = { renderer,camera,settings:{render:{tier:'low'}},getEffectMeshes:()=>[a,b] };
    const effect=new CollisionRainEffect(fake,1);
    effect.mount(scene); effect.update(1/60);
    const sample = (x,z) => {
      const u=.5-(x-effect.center.x)/effect.extent, v=.5+(z-effect.center.z)/effect.extent;
      const data=new Uint16Array(4);
      renderer.readRenderTargetPixels(effect.heightTarget,Math.floor(u*effect.heightTarget.width),Math.floor(v*effect.heightTarget.height),1,1,data);
      return T.DataUtils.fromHalfFloat(data[1]);
    };
    const heights=[sample(1,.7),sample(-1,-.7)];
    const target=new T.WebGLRenderTarget(8,8);
    renderer.setRenderTarget(target); renderer.setViewport(1,2,3,4);renderer.setScissor(2,1,4,3);renderer.setScissorTest(true);renderer.setClearColor(0xff3300,.4);
    a.position.y+=1;
    effect.update(1/60);
    const restored=renderer.getRenderTarget()===target && renderer.getScissorTest() && renderer.getViewport(new T.Vector4()).equals(new T.Vector4(1,2,3,4)) && Math.abs(renderer.getClearAlpha()-.4)<1e-6;
    const movedHeight=sample(1,.7);
    renderer.setRenderTarget(null);renderer.setScissorTest(false);renderer.setViewport(0,0,200,150);
    for(let i=0;i<120;i++)effect.update(1/60);
    const data=new Uint16Array(effect.compute.getCurrentRenderTarget(effect.variable).width**2*4);
    const rt=effect.compute.getCurrentRenderTarget(effect.variable);
    renderer.readRenderTargetPixels(rt,0,0,rt.width,rt.height,data);
    const finiteRain=Array.from(data).every(n=>Number.isFinite(T.DataUtils.fromHalfFloat(n)));
    effect.dispose(); target.dispose();
    const plate=new T.Mesh(new T.BoxGeometry(4,.04,2),a.material);scene.add(plate);
    fake.controls={enabled:true};fake.getEffectMeshes=()=>[a,b,plate];
    const saved=[a.material,b.material,plate.material], jelly=new JellyEffect(fake,1,1);
    jelly.mount();
    const attached=jelly.entries.length;
    for(let i=0;i<300;i++)jelly.update(1/60);
    const bodies=jelly.entries.map(entry=>({finite:entry.body.isFinite(),volume:entry.body.volumeRatio()}));
    const platePreserved=plate.material===saved[2];
    jelly.dispose();
    const materialsRestored=[a,b,plate].every((mesh,i)=>mesh.material===saved[i]&&mesh.children.length===0);
    a.geometry.dispose();b.geometry.dispose();plate.geometry.dispose();a.material.dispose();renderer.dispose();
    return {physics,heights,movedHeight,restored,finiteRain,attached,bodies,platePreserved,materialsRestored};
  });
  console.log(JSON.stringify(result,null,2));
  for(const p of result.physics){
    assert.ok(p.restError<1e-6);assert.equal(p.finite,true);assert.ok(p.minimum>=.119);
    assert.ok(p.volume>.8&&p.volume<1.2);assert.ok(p.floor>-.002);
  }
  assert.ok(Math.abs(result.heights[0]-2)<.01);assert.ok(Math.abs(result.heights[1]-.6)<.01);
  assert.ok(Math.abs(result.movedHeight-3)<.01);assert.equal(result.restored,true);assert.equal(result.finiteRain,true);
  assert.equal(result.attached,2);assert.equal(result.platePreserved,true);assert.equal(result.materialsRestored,true);
  for(const b of result.bodies){assert.equal(b.finite,true);assert.ok(b.volume>.8&&b.volume<1.2);}
  assert.deepEqual(errors,[]);
  console.log('PASS source XPBD stability and binding; GPU rain collision, moved obstacles and renderer restoration');
} finally {await browser.close();}
