import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { GradeShader } from './shaders/GradeShader';
import type { GradeSettings, PostSettings, RenderSettings } from './settings';

/**
 * Post chain, in order:
 *   Render -> GTAO -> Bloom -> Output(tonemap+sRGB) -> LUT -> Grade -> AA
 *
 * Bloom sits before OutputPass so it blooms scene-referred HDR values, while
 * LUT and grading sit after it because both are authored in display space.
 */
export class PostFX {
  readonly composer: EffectComposer;

  private readonly renderPass: RenderPass;
  private readonly gtao: GTAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly lut: LUTPass;
  private readonly grade: ShaderPass;
  private readonly smaa: SMAAPass;
  private readonly fxaa: FXAAPass;

  /** World-space scale hint so AO radius tracks the size of the loaded model. */
  private sceneScale = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.setSize(width, height);

    this.renderPass = new RenderPass(scene, camera);
    this.gtao = new GTAOPass(scene, camera, width, height);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.22, 0.5, 0.9);
    this.lut = new LUTPass({});
    this.grade = new ShaderPass(GradeShader);
    this.smaa = new SMAAPass();
    this.fxaa = new FXAAPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.gtao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.lut);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.smaa);
    this.composer.addPass(this.fxaa);

    this.lut.enabled = false;
    this.fxaa.enabled = false;
  }

  setCamera(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
    this.gtao.camera = camera;
  }

  setSceneScale(scale: number): void {
    this.sceneScale = Math.max(scale, 1e-3);
  }

  setLUT(texture: THREE.Data3DTexture | null): void {
    if (this.lut.lut && this.lut.lut !== texture) this.lut.lut.dispose();
    this.lut.lut = texture ?? undefined;
  }

  setSize(width: number, height: number): void {
    // EffectComposer caches the pixel ratio it was constructed with, so it has
    // to be re-synced whenever the resolution scale or display density changes.
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(width, height);
    this.fxaa.setSize(width * pr, height * pr);
  }

  apply(post: PostSettings, grade: GradeSettings, render: RenderSettings, isolatePreview = false): void {
    this.gtao.enabled = post.aoEnabled && !isolatePreview;
    this.gtao.blendIntensity = post.aoIntensity;
    this.gtao.updateGtaoMaterial({
      radius: post.aoRadius * this.sceneScale,
      thickness: post.aoThickness * this.sceneScale,
      distanceExponent: 1,
      scale: 1,
      samples: render.tier === 'low' ? 8 : render.tier === 'medium' ? 12 : 16,
    });

    this.bloom.enabled = post.bloomEnabled && !isolatePreview;
    this.bloom.strength = post.bloomStrength;
    this.bloom.radius = post.bloomRadius;
    this.bloom.threshold = post.bloomThreshold;

    this.lut.enabled = grade.lutEnabled && Boolean(this.lut.lut) && !isolatePreview;
    this.lut.intensity = grade.lutIntensity;

    this.grade.enabled = grade.enabled && !isolatePreview;
    const u = this.grade.uniforms;
    u.contrast.value = grade.contrast;
    u.saturation.value = grade.saturation;
    u.shadows.value = grade.shadows;
    u.midtones.value = grade.midtones;
    u.highlights.value = grade.highlights;
    (u.tint.value as THREE.Color).set(grade.tint);
    u.vignette.value = grade.vignette;
    u.vignetteSoftness.value = grade.vignetteSoftness;

    this.smaa.enabled = render.antialias === 'smaa';
    this.fxaa.enabled = render.antialias === 'fxaa';
  }

  render(delta: number): void {
    this.composer.render(delta);
  }

  dispose(): void {
    this.setLUT(null);
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
  }
}
