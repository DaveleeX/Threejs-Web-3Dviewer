import * as THREE from 'three';
import type { SceneEffect } from './EffectHost';

/** GLSL port of ektogamat/threejs-conference src/tsl/rainRipples.js (MIT).
 * Reuses the user's PBR textures, environment and lights. See vendor/collision-rain.
 */
export class WetSurfaceEffect implements SceneEffect {
  readonly id = 'surface';
  readonly modelScoped = true;
  private readonly saved: Array<{ mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }> = [];
  private readonly materials: THREE.Material[] = [];
  private readonly time = { value: 0 };
  constructor(private readonly meshes: THREE.Mesh[], private readonly strength: number, private readonly speed: number) {}
  mount(): void {
    for (const mesh of this.meshes) {
      const source = mesh.material;
      const adapt = (original: THREE.Material) => {
        if (!(original as THREE.MeshStandardMaterial).isMeshStandardMaterial) return original;
        const material = original.clone() as THREE.MeshStandardMaterial;
        const originalCompile = original.onBeforeCompile;
        const key = original.customProgramCacheKey();
        material.onBeforeCompile = (shader, renderer) => {
          originalCompile.call(material, shader, renderer);
          shader.uniforms.rainTime = this.time;
          shader.uniforms.rainStrength = { value: this.strength };
          shader.vertexShader = 'varying vec3 rainWorldPosition;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
            '#include <project_vertex>\nrainWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
          shader.fragmentShader = RIPPLE + '\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
            #include <normal_fragment_maps>
            vec3 rainWorldNormal=inverseTransformDirection(normal,viewMatrix);
            float rainMask=smoothstep(.6,.95,rainWorldNormal.y);
            vec3 rainNormal=rainRipples(rainWorldPosition.xz*6.0);
            normal=normalize(normal+(viewMatrix*vec4(rainNormal.x,0.0,rainNormal.y,0.0)).xyz*.015*rainStrength*rainMask);
            roughnessFactor*=mix(1.0,.55,clamp(rainStrength*rainMask,0.0,1.0));
          `);
        };
        material.customProgramCacheKey = () => key + ':source-wet-ripple-v1';
        this.materials.push(material);
        return material;
      };
      this.saved.push({ mesh, material: source });
      mesh.material = Array.isArray(source) ? source.map(adapt) : adapt(source);
    }
  }
  update(delta: number): void { this.time.value += delta * this.speed; }
  dispose(): void {
    for (const item of this.saved) item.mesh.material = item.material;
    for (const material of this.materials) material.dispose();
    this.saved.length = 0; this.materials.length = 0;
  }
}

const RIPPLE = `
uniform float rainTime, rainStrength;
varying vec3 rainWorldPosition;
float rainHash12(vec2 p) {
  vec3 p3=fract(vec3(p.x,p.y,p.x)*.1031);
  p3+=dot(p3,p3.yzx+19.19);
  return fract((p3.x+p3.y)*p3.z);
}
vec2 rainHash22(vec2 p) {
  vec3 p3=fract(vec3(p.x,p.y,p.x)*vec3(.1031,.103,.0973));
  p3+=dot(p3,p3.yzx+19.19);
  return fract((p3.xx+p3.yz)*p3.zy);
}
float rainWave(float d) {
  return sin(31.0*d)*smoothstep(-.6,-.3,d)*(1.0-smoothstep(-.3,0.0,d));
}
vec3 rainRipples(vec2 coord) {
  vec2 p0=floor(coord),circles=vec2(0.0);
  for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++){
    vec2 cell=p0+vec2(float(i),float(j));
    vec2 p=cell+rainHash22(cell);
    float t=fract(.3*rainTime*3.0+rainHash12(cell));
    vec2 v=p-coord;
    float d=length(v)-2.0*t;
    float derivative=(rainWave(d+.001)-rainWave(d-.001))/.002*(1.0-t)*(1.0-t);
    circles+=v/max(length(v),.000001)*derivative*.5;
  }
  circles/=9.0;
  return vec3(circles,sqrt(max(1.0-dot(circles,circles),0.0)));
}
`;
