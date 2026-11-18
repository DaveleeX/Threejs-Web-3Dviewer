import * as THREE from 'three';
import type { Viewer } from '../core/Viewer';
import type { SceneEffect } from './EffectHost';

export interface LiquidGlassOptions {
  size?: [number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
}

/** WebGL port of codyhxyz/infinite-liquid-glass's MIT TSL lens.
 * See vendor/liquid-glass/NOTICE.md. The media input is the live Viewer scene.
 */
export class LiquidGlassEffect implements SceneEffect {
  readonly id = 'surface';
  readonly modelScoped = true;
  private scene?: THREE.Scene;
  private mesh?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private readonly dimensions = new THREE.Vector2();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly environmentMatrix = new THREE.Matrix4();
  private readonly viewport = new THREE.Vector4();
  private readonly scissor = new THREE.Vector4();
  constructor(private readonly viewer: Viewer, private readonly strength = 1, private readonly options: LiquidGlassOptions = {}) {
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  }

  mount(scene: THREE.Scene): void {
    this.scene = scene;
    const camera = this.viewer.camera;
    const bounds = new THREE.Box3();
    for (const mesh of this.viewer.getEffectMeshes()) bounds.expandByObject(mesh);
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    const radius = size.length() * 0.5;
    const cameraOffset = camera.getWorldPosition(new THREE.Vector3()).sub(center);
    const towardCamera = cameraOffset.clone().normalize();
    let autoWidth = Math.max(size.x, size.y, size.z, 0.2) * 1.1;
    const lensDistance = Math.max(cameraOffset.length() - radius - autoWidth * 0.08, camera.near * 4);
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const perspective = camera as THREE.PerspectiveCamera;
      const viewHeight = 2 * lensDistance * Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2)) / perspective.zoom;
      autoWidth = Math.min(autoWidth, viewHeight * 0.7 / 0.75, viewHeight * perspective.aspect * 0.8);
    } else {
      const orthographic = camera as THREE.OrthographicCamera;
      autoWidth = Math.min(autoWidth, (orthographic.top - orthographic.bottom) / orthographic.zoom * 0.7 / 0.75);
    }
    const width = this.options.size?.[0] ?? autoWidth;
    const height = this.options.size?.[1] ?? width * 0.75;
    if (![width, height, ...(this.options.position ?? []), ...(this.options.rotation ?? [])].every(Number.isFinite) || width <= 0 || height <= 0)
      throw new Error('玻璃透镜尺寸和变换必须为有效值。');
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: this.target.texture }, uEnvironment: { value: scene.environment },
        uPlaneSize: { value: new THREE.Vector2(width, height) },
        uRadius: { value: width * 5000 / (1728 * 0.38) },
        uThickness: { value: width * 155 / (1728 * 0.38) * this.strength },
        uModelInverse: { value: new THREE.Matrix4() }, uScreenSize: { value: new THREE.Vector2() },
        uCameraPosition: { value: new THREE.Vector3() }, uEnvironmentIntensity: { value: scene.environmentIntensity },
        uEnvironmentRotation: { value: new THREE.Matrix3() },
      },
      defines: {}, vertexShader: VERTEX, fragmentShader: FRAGMENT,
      transparent: true, depthWrite: true, depthTest: true, side: THREE.FrontSide,
      toneMapped: true,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 32, 24), material);
    mesh.name = 'Reference liquid glass lens';
    mesh.position.copy(center).addScaledVector(towardCamera, radius + width * 0.08);
    mesh.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()));
    if (this.options.position) mesh.position.fromArray(this.options.position);
    if (this.options.rotation) mesh.rotation.set(...this.options.rotation);
    mesh.renderOrder = 10;
    scene.add(mesh); this.mesh = mesh;
  }

  update(): void {
    const scene = this.scene, mesh = this.mesh;
    if (!scene || !mesh) return;
    const renderer = this.viewer.renderer, camera = this.viewer.camera, uniforms = mesh.material.uniforms;
    const dimensions = renderer.getDrawingBufferSize(this.dimensions);
    // The target uses the same aspect ratio as the viewport; only its resolution is tiered.
    const cap = this.viewer.settings.render.tier === 'low' ? 512 : this.viewer.settings.render.tier === 'medium' ? 960 : 1280;
    const scale = Math.min(1, cap / Math.max(dimensions.x, dimensions.y));
    const width = Math.max(1, Math.round(dimensions.x * scale)), height = Math.max(1, Math.round(dimensions.y * scale));
    if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
    uniforms.uScreenSize.value.copy(dimensions);
    uniforms.uCameraPosition.value.copy(camera.getWorldPosition(this.cameraPosition));
    mesh.updateWorldMatrix(true, false); uniforms.uModelInverse.value.copy(mesh.matrixWorld).invert();
    uniforms.uEnvironment.value = scene.environment;
    uniforms.uEnvironmentIntensity.value = scene.environmentIntensity;
    uniforms.uEnvironmentRotation.value.setFromMatrix4(this.environmentMatrix.makeRotationFromEuler(scene.environmentRotation));
    const env = scene.environment;
    // Reuse the Viewer's existing PMREM, including environment changes while the effect is active.
    const image = env?.image as { width?: number; height?: number } | undefined;
    const hasEnv = Boolean(env?.mapping === THREE.CubeUVReflectionMapping && image?.height && image?.width);
    const key = hasEnv ? `${image!.width}:${image!.height}` : 'none';
    if (mesh.material.userData.environmentSize !== key) {
      mesh.material.userData.environmentSize = key;
      mesh.material.defines = hasEnv ? {
        ENVMAP_TYPE_CUBE_UV: 1,
        CUBEUV_TEXEL_WIDTH: 1 / image!.width!, CUBEUV_TEXEL_HEIGHT: 1 / image!.height!,
        CUBEUV_MAX_MIP: Math.log2(image!.height! / 4).toFixed(1),
      } : {};
      mesh.material.needsUpdate = true;
    }
    const oldTarget = renderer.getRenderTarget(), oldTone = renderer.toneMapping;
    const viewport = renderer.getViewport(this.viewport), scissor = renderer.getScissor(this.scissor);
    const scissorTest = renderer.getScissorTest(), autoClear = renderer.autoClear;
    const shadowUpdate = renderer.shadowMap.autoUpdate;
    const visible = mesh.visible;
    try {
      mesh.visible = false;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.shadowMap.autoUpdate = false;
      renderer.autoClear = true;
      renderer.setScissorTest(false); renderer.setRenderTarget(this.target);
      renderer.render(scene, camera);
    } finally {
      mesh.visible = visible;
      renderer.setRenderTarget(oldTarget); renderer.setViewport(viewport); renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest); renderer.autoClear = autoClear;
      renderer.toneMapping = oldTone; renderer.shadowMap.autoUpdate = shadowUpdate;
    }
  }

  dispose(): void {
    this.mesh?.removeFromParent(); this.mesh?.geometry.dispose(); this.mesh?.material.dispose();
    this.target.dispose(); this.mesh = undefined; this.scene = undefined;
  }
}

const VERTEX = /* glsl */ `
uniform float uRadius;
varying vec2 vLensPosition;
varying vec3 vWorldPosition;
varying vec4 vClipPosition;
void main() {
  vLensPosition = position.xy;
  float sag = sqrt(max(uRadius*uRadius-dot(position.xy,position.xy),0.000001))-uRadius;
  vec4 world = modelMatrix * vec4(position.xy,sag,1.0);
  vWorldPosition = world.xyz;
  vClipPosition = projectionMatrix * viewMatrix * world;
  gl_Position = vClipPosition;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uEnvironment;
uniform vec2 uPlaneSize;
uniform vec2 uScreenSize;
uniform float uRadius;
uniform float uThickness;
uniform float uEnvironmentIntensity;
uniform mat4 uModelInverse;
uniform mat3 uEnvironmentRotation;
uniform vec3 uCameraPosition;
varying vec2 vLensPosition;
varying vec3 vWorldPosition;
varying vec4 vClipPosition;
#include <common>
#include <cube_uv_reflection_fragment>
float sdRect(vec2 p) {
  vec2 halfSize=uPlaneSize*.5;
  float r=min(uPlaneSize.x*.163,min(halfSize.x,halfSize.y));
  vec2 q=abs(p)-halfSize+r;
  return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r;
}
float thicknessAt(vec2 p) {
  float t=clamp(1.0+sdRect(p)/max(uPlaneSize.x*.192,.000001),0.0,1.0);
  return pow(max(1.0-pow(t,3.9),0.0),1.0/3.9)*uThickness;
}
vec3 spectralWeight(float t) {
  return max(vec3(0.0),1.0-abs(vec3(t)-vec3(0.0,.5,1.0))/.5);
}
void main() {
  vec2 p=vLensPosition;
  float sd=sdRect(p), aa=max(fwidth(sd)*.5,.000001);
  float alpha=1.0-smoothstep(-aa,aa,sd);
  if(alpha<.001) discard;
  float eps=max(uPlaneSize.x*.192*.06,uPlaneSize.x*.35/(1728.0*.38));
  vec2 grad=vec2(thicknessAt(p+vec2(eps,0.0))-thicknessAt(p-vec2(eps,0.0)),
                 thicknessAt(p+vec2(0.0,eps))-thicknessAt(p-vec2(0.0,eps)))/(2.0*eps);
  float slope=length(grad);
  grad*=min(slope,1.74)/max(slope,.0001);
  float sphereZ=sqrt(max(uRadius*uRadius-dot(p,p),.000001));
  vec3 N=normalize(vec3(p/sphereZ-grad,1.0));
  vec3 camLocal=(uModelInverse*vec4(uCameraPosition,1.0)).xyz;
  vec3 V=normalize(camLocal-vec3(p,sphereZ-uRadius));
  vec2 screenUV=vClipPosition.xy/vClipPosition.w*.5+.5;
  // Project the lens-local ray offset into the scene capture. This adapts the reference's
  // per-card media UV mapping to the user's live model behind the lens.
  vec2 dx=dFdx(screenUV), dy=dFdy(screenUV);
  vec2 px=dFdx(p), py=dFdy(p);
  float determinant=px.x*py.y-px.y*py.x;
  mat2 localToScreen=abs(determinant)>1e-12 ? mat2(dx*py.y-dy*px.y,dy*px.x-dx*py.x)/determinant : mat2(0.0);
  vec3 transmitted=vec3(0.0), weights=vec3(0.0), transmittedAlpha=vec3(0.0);
  for(int i=0;i<5;i++) {
    float t=float(i)/4.0;
    vec3 weight=spectralWeight(t); weights+=weight;
    vec3 ray=refract(-V,N,1.0/max(2.3+.32*(t-.5),1.0001));
    float distance=uThickness/max(abs(ray.z),.05);
    vec2 offset=localToScreen*(ray.xy*distance*.7);
    vec4 sampleColor=texture2D(uScene,clamp(screenUV+offset,vec2(0.0),vec2(1.0)));
    transmitted+=sampleColor.rgb*weight;
    transmittedAlpha+=sampleColor.a*weight;
  }
  transmitted/=weights;
  transmittedAlpha/=weights;
  mat3 localToWorld=transpose(mat3(uModelInverse));
  vec3 Nw=normalize(localToWorld*N), Vw=normalize(uCameraPosition-vWorldPosition);
  vec3 reflection=normalize(reflect(-Vw,Nw));
  vec3 env=vec3(0.0);
  #ifdef ENVMAP_TYPE_CUBE_UV
    env=textureCubeUV(uEnvironment,uEnvironmentRotation*reflection,0.0).rgb*uEnvironmentIntensity;
  #endif
  float fresnel=.045+(1.0-.045)*pow(clamp(1.0-dot(N,V),0.0,1.0),5.0);
  float envMix=min(clamp(fresnel*1.93,0.0,1.0),.27);
  #ifndef ENVMAP_TYPE_CUBE_UV
    envMix=0.0;
  #endif
  float rim=smoothstep(-uPlaneSize.x*10.0/(1728.0*.38),0.0,sd)*.11;
  float coverage=clamp(dot(transmittedAlpha,vec3(1.0/3.0))*(1.0-envMix)+envMix+rim,0.0,1.0);
  gl_FragColor=vec4((mix(transmitted,env,envMix)+vec3(rim))/max(coverage,.0001),alpha*coverage);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
