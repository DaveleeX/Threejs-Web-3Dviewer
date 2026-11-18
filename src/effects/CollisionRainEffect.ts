import * as THREE from 'three';
import { GPUComputationRenderer, type Variable } from 'three/addons/misc/GPUComputationRenderer.js';
import type { Viewer } from '../core/Viewer';
import type { SceneEffect } from './EffectHost';

export interface RainOptions {
  /** Caller-owned five-frame horizontal grayscale atlas; never disposed by this module. */
  splashAtlas?: THREE.Texture;
  count?: number;
}

/** MIT source port: see vendor/collision-rain/NOTICE.md. */
export class CollisionRainEffect implements SceneEffect {
  readonly id = 'atmosphere';
  readonly modelScoped = true;
  private readonly group = new THREE.Group();
  private readonly collisionScene = new THREE.Scene();
  private readonly heightCamera = new THREE.OrthographicCamera();
  private readonly heightTarget: THREE.WebGLRenderTarget;
  private readonly heightMaterial = new THREE.ShaderMaterial({
    vertexShader: 'varying float height; void main(){vec4 p=modelMatrix*vec4(position,1.0);height=p.y;gl_Position=projectionMatrix*viewMatrix*p;}',
    fragmentShader: 'varying float height; void main(){gl_FragColor=vec4(0.0,height,0.0,1.0);}',
    side: THREE.DoubleSide,
  });
  private readonly proxies: Array<{ source: THREE.Mesh; proxy: THREE.Mesh; version: number }> = [];
  private compute?: GPUComputationRenderer;
  private copyMaterial?: THREE.Material;
  private variable?: Variable;
  private material?: THREE.ShaderMaterial;
  private splashMaterial?: THREE.ShaderMaterial;
  private geometry?: THREE.InstancedBufferGeometry;
  private time = 0;
  private dirty = true;
  private readonly center = new THREE.Vector3();
  private extent = 1;
  private unit = 1;
  private floor = 0;
  private top = 1;
  private readonly viewport = new THREE.Vector4();
  private readonly scissor = new THREE.Vector4();
  private readonly clearColor = new THREE.Color();

  constructor(private readonly viewer: Viewer, private readonly speed: number, private readonly options: RainOptions = {}) {
    const resolution = viewer.settings.render.tier === 'low' ? 128 : 256;
    this.heightTarget = new THREE.WebGLRenderTarget(resolution, resolution, {
      type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
  }

  mount(scene: THREE.Scene): void {
    const bounds = new THREE.Box3();
    for (const source of this.viewer.getEffectMeshes()) {
      bounds.expandByObject(source);
      const proxy = new THREE.Mesh(source.geometry, this.heightMaterial);
      proxy.matrixAutoUpdate = false;
      this.collisionScene.add(proxy);
      this.proxies.push({ source, proxy, version: -1 });
    }
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    bounds.getCenter(this.center);
    const size = bounds.getSize(new THREE.Vector3());
    this.unit = Math.max(size.x, size.y, size.z, .1) / 10;
    this.extent = 60 * this.unit;
    this.floor = bounds.min.y;
    this.top = bounds.max.y + 25 * this.unit;
    this.heightCamera.left = this.heightCamera.bottom = -this.extent / 2;
    this.heightCamera.right = this.heightCamera.top = this.extent / 2;
    this.heightCamera.near = .001;
    this.heightCamera.far = this.top - this.floor + this.unit;
    this.heightCamera.position.set(this.center.x, this.top, this.center.z);
    // Positive texture V corresponds to positive world Z.
    this.heightCamera.up.set(0, 0, 1);
    this.heightCamera.lookAt(this.center.x, this.floor, this.center.z);
    this.heightCamera.updateProjectionMatrix();
    this.heightCamera.updateMatrixWorld(true);

    const count = Math.round(THREE.MathUtils.clamp(this.options.count ?? (this.viewer.settings.render.tier === 'low' ? 500 : 3000), 500, 5000));
    if (!Number.isFinite(count)) throw new Error('雨滴数量必须为有限数值');
    const side = Math.ceil(Math.sqrt(count));
    const compute = this.compute = new GPUComputationRenderer(side, side, this.viewer.renderer);
    // r185's GPUComputationRenderer.dispose omits its internal copy material.
    // Observe that material through the public pass hook and release it with the effect.
    const renderPass = compute.doRenderTarget.bind(compute);
    compute.doRenderTarget = (material, target) => {
      if ((material as THREE.ShaderMaterial).uniforms?.passThruTexture) this.copyMaterial = material;
      renderPass(material, target);
    };
    compute.setDataType(THREE.HalfFloatType);
    const initial = compute.createTexture();
    const data = initial.image.data as Float32Array;
    for (let i = 0; i < side * side; i++) {
      const r = (i * .754877666 + .37) % 1, z = (i * .569840296 + .53) % 1;
      data.set([this.center.x + (r - .5) * this.extent, this.floor + ((i * .438579021 + .61) % 1) * (this.top - this.floor),
        this.center.z + (z - .5) * this.extent, r], i * 4);
    }
    const variable = this.variable = compute.addVariable('state', COMPUTE, initial);
    compute.setVariableDependencies(variable, [variable]);
    Object.assign(variable.material.uniforms, {
      heightMap: { value: this.heightTarget.texture }, center: { value: this.center },
      extent: { value: this.extent }, unit: { value: this.unit }, floorY: { value: this.floor },
      top: { value: this.top }, dt: { value: 0 }, time: { value: 0 },
    });
    const error = compute.init();
    if (error) throw new Error(error);
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = this.geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.attributes = { ...plane.attributes };
    geometry.instanceCount = count;
    const coords = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) coords.set([(i % side + .5) / side, (Math.floor(i / side) + .5) / side], i * 2);
    geometry.setAttribute('stateUV', new THREE.InstancedBufferAttribute(coords, 2));
    const uniforms = {
      state: { value: compute.getCurrentRenderTarget(variable).texture }, unit: { value: this.unit },
      time: { value: 0 }, heightMap: { value: this.heightTarget.texture },
      center: { value: this.center }, extent: { value: this.extent }, floorY: { value: this.floor },
      atlas: { value: this.options.splashAtlas ?? null },
    };
    this.material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT,
      transparent: true, depthWrite: false, toneMapped: false });
    const rain = new THREE.Mesh(geometry, this.material);
    rain.frustumCulled = false; rain.renderOrder = 12;
    rain.name = 'Source collision rain';
    this.group.add(rain);
    if (this.options.splashAtlas) {
      this.splashMaterial = new THREE.ShaderMaterial({ uniforms, defines: { SPLASH: 1 },
        vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, toneMapped: false });
      const splashes = new THREE.Mesh(geometry, this.splashMaterial);
      splashes.frustumCulled = false; splashes.renderOrder = 11;
      this.group.add(splashes);
    }
    scene.add(this.group);
  }

  update(delta: number): void {
    if (!this.compute || !this.variable || !this.material) return;
    // Surface modules can replace the visible mesh (e.g. the deformed jelly).
    // Reconcile cheap object references, then render only if geometry/transforms changed.
    const visibleMeshes = new Set<THREE.Mesh>();
    for (const root of this.viewer.getEffectMeshes()) root.traverseVisible(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some(material => material.visible)) visibleMeshes.add(mesh);
    });
    for (let i = this.proxies.length - 1; i >= 0; i--) {
      if (!visibleMeshes.has(this.proxies[i].source)) {
        this.proxies[i].proxy.removeFromParent(); this.proxies.splice(i, 1); this.dirty = true;
      }
    }
    for (const source of visibleMeshes) if (!this.proxies.some(item => item.source === source)) {
      const proxy = new THREE.Mesh(source.geometry, this.heightMaterial);
      proxy.matrixAutoUpdate = false; this.collisionScene.add(proxy);
      this.proxies.push({ source, proxy, version: -1 }); this.dirty = true;
    }
    for (const item of this.proxies) {
      item.source.updateWorldMatrix(true, false);
      const version = (item.source.geometry.attributes.position as THREE.BufferAttribute).version;
      const visible = item.source.visible;
      if (!item.proxy.matrix.equals(item.source.matrixWorld) || item.proxy.visible !== visible || item.version !== version ||
          item.proxy.geometry !== item.source.geometry) this.dirty = true;
      item.proxy.matrix.copy(item.source.matrixWorld);
      item.proxy.matrixWorldNeedsUpdate = true;
      item.proxy.geometry = item.source.geometry;
      item.proxy.visible = visible;
      item.version = version;
    }
    const renderer = this.viewer.renderer;
    const target = renderer.getRenderTarget(), autoClear = renderer.autoClear, scissorTest = renderer.getScissorTest();
    const alpha = renderer.getClearAlpha(), xr = renderer.xr.enabled;
    renderer.getViewport(this.viewport); renderer.getScissor(this.scissor); renderer.getClearColor(this.clearColor);
    try {
      renderer.xr.enabled = false;
      renderer.setScissorTest(false); renderer.autoClear = true;
      if (this.dirty) {
        renderer.setClearColor(0, 0); renderer.setRenderTarget(this.heightTarget);
        renderer.render(this.collisionScene, this.heightCamera);
        this.dirty = false;
      }
      this.time += delta * this.speed;
      this.variable.material.uniforms.dt.value = delta * this.speed;
      this.variable.material.uniforms.time.value = this.time;
      this.compute.compute();
      this.material.uniforms.state.value = this.compute.getCurrentRenderTarget(this.variable).texture;
      this.material.uniforms.time.value = this.time;
    } finally {
      renderer.setRenderTarget(target); renderer.setViewport(this.viewport); renderer.setScissor(this.scissor);
      renderer.setScissorTest(scissorTest); renderer.setClearColor(this.clearColor, alpha);
      renderer.autoClear = autoClear; renderer.xr.enabled = xr;
    }
  }

  dispose(): void {
    this.group.removeFromParent(); this.group.clear(); this.collisionScene.clear();
    this.proxies.length = 0;
    this.compute?.dispose(); this.compute = undefined; this.variable = undefined;
    this.copyMaterial?.dispose(); this.copyMaterial = undefined;
    this.heightTarget.dispose(); this.heightMaterial.dispose();
    this.geometry?.dispose(); this.material?.dispose(); this.splashMaterial?.dispose();
  }
}

const HASH = `
float hash(float n){return fract(sin(n*12.9898)*43758.5453);}
`;
const COMPUTE = `
uniform sampler2D heightMap;
uniform vec3 center;
uniform float extent, unit, floorY, top, dt, time;
${HASH}
void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  vec4 p=texture2D(state,uv);
  p.y+=(p.w*.07-.035-.7)*unit*dt*60.0;
  p.xz=center.xz+(fract((p.xz-center.xz)/extent+.5)-.5)*extent;
  vec2 hUV=(p.xz-center.xz)/extent+.5;
  hUV.x=1.0-hUV.x;
  vec4 h=texture2D(heightMap,hUV);
  float ground=h.a>.5?h.y:floorY;
  if(p.y<ground+.05*unit){
    float seed=gl_FragCoord.x+gl_FragCoord.y*resolution.x+time*1000.0;
    p.y=top+(hash(seed+77.7)*15.0-15.0)*unit;
    p.xz=center.xz+(vec2(hash(seed+11.1),hash(seed+44.4))-.5)*extent;
    p.w=hash(seed+99.9);
  }
  gl_FragColor=p;
}`;
const VERTEX = `
attribute vec2 stateUV;
uniform sampler2D state, heightMap;
uniform float unit, time, extent, floorY;
uniform vec3 center;
varying vec2 vUv;
varying float phase;
${HASH}
void main(){
  vUv=uv;
  float id=stateUV.x*1000.0+stateUV.y*100000.0;
  vec3 p=texture2D(state,stateUV).xyz;
  vec4 view;
  #ifdef SPLASH
    float cycle=floor(time*6.0+hash(id)*6.28);
    phase=fract(time*6.0+hash(id)*6.28);
    float seed=id+cycle*196613.0;
    p.xz=center.xz+(vec2(hash(seed),hash(seed+77777.0))-.5)*extent;
    vec2 hUV=(p.xz-center.xz)/extent+.5;
    hUV.x=1.0-hUV.x;
    vec4 h=texture2D(heightMap,hUV);
    p.y=(h.a>.5?h.y:floorY)+.06*unit;
    float scale=(hash(id+12345.0)*.7+.3)*mix(.1,1.4,phase);
    view=viewMatrix*vec4(p,1.0);
    view.xy+=position.xy*.13*unit*scale;
  #else
    vec3 right=normalize(vec3(viewMatrix[0][0],0.0,viewMatrix[2][0])+vec3(.000001,0.0,0.0));
    p+=right*position.x*.04*unit;
    p.y+=(position.y+.75)*1.1*unit;
    view=viewMatrix*vec4(p,1.0);
    phase=0.0;
  #endif
  gl_Position=projectionMatrix*view;
}`;
const FRAGMENT = `
uniform sampler2D atlas;
varying vec2 vUv;
varying float phase;
void main(){
  float opacity;
  #ifdef SPLASH
    float frame=phase*5.0, a=floor(frame), b=min(a+1.0,4.0);
    float mask=mix(texture2D(atlas,vec2((vUv.x+a)/5.0,vUv.y)).r,
      texture2D(atlas,vec2((vUv.x+b)/5.0,vUv.y)).r,fract(frame));
    opacity=mask*.18*smoothstep(0.0,.5,1.0-phase);
  #else
    opacity=pow(1.0-abs(vUv.x-.5)*2.0,2.0)*smoothstep(0.0,.08,vUv.y)*smoothstep(0.0,.15,1.0-vUv.y)*.15*.45;
  #endif
  gl_FragColor=vec4(.7157,.9047,1.0,opacity);
  #include <colorspace_fragment>
}`;
