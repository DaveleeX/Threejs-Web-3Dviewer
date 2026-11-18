import * as THREE from 'three';
import { phone } from './device';

// Scene → 4x MSAA HalfFloat target (alpha-to-coverage on the feathers needs the
// samples) with a depth texture → depth of field → tone map + grade → screen.
//
// DOF is a gather: per-pixel circle of confusion from real depth, a
// golden-angle spiral of taps, each tap weighted by its own CoC so a sharp
// bird doesn't smear into the background and the background doesn't bleed
// over the bird's edge. A pack pass first puts colour and 1/z in one target,
// so a tap is a single fetch. Tiles hold the biggest CoC around, so the gather
// only reaches as far (and taps as often) as something near can blur. What is
// blurry anyway is gathered at half size; near focus the grade gathers at full.

const fsVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** The lens: blur circle radius (CSS px) at 1 / view distance. The motes in ambient.ts draw their discs by it too. */
export const lensGlsl = /* glsl */ `
float lensCoc(float invZ, float focus, float aperture, float maxCoc) {
  // a real lens gets shallower up close; scale that back so a macro look at
  // the eye isn't a smear (blur grows with distance from focus, not 1/f^2)
  float k = focus / 3.3;
  return min(aperture * abs(1.0 / focus - invZ) * k, maxCoc);
}
`;

// colour + 1/z (view distance) in one HalfFloat texel: the gather reads nothing else
const packFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uNear, uFar;
uniform float uFocus;    // view-space distance in focus
uniform float uAperture; // CoC in px for 1/z difference of 1
uniform float uFarCoc;   // px for the sky sphere / cleared depth

void main() {
  float d = texture2D(tDepth, vUv).x;
  float invZ;
  if (d >= 0.99999) {
    // the sky: the 1/z, past infinity, whose blur circle is uFarCoc
    invZ = max(1.0 / uFocus - uFarCoc * 3.3 / (max(uAperture, 1e-3) * uFocus), -1e4);
  } else {
    // perspective depth → 1 / positive view distance
    float z = d * 2.0 - 1.0;
    invZ = (uFar + uNear - z * (uFar - uNear)) / (2.0 * uNear * uFar);
  }
  // NaNs go through as they are: the gather drops them
  gl_FragColor = vec4(texture2D(tColor, vUv).rgb, invZ);
}
`;

// Biggest CoC in each tile, then over the tile and its 8 neighbours: what could
// blur over a pixel, a blurry foreground next to a sharp one included.
// A tile is no smaller than the gather's reach (TILE below).
const tileFrag = /* glsl */ `
precision highp float;
uniform sampler2D tPack;
uniform int uTile; // device px
uniform float uFocus, uAperture, uMaxCoc;
${lensGlsl}
void main() {
  ivec2 last = textureSize(tPack, 0) - 1;
  ivec2 base = ivec2(gl_FragCoord.xy) * uTile;
  // the CoC grows with |1/focus - 1/z|: the tile's two ends of 1/z are enough
  float lo = 1e9, hi = -1e9;
  for (int y = 0; y < uTile; y++) {
    for (int x = 0; x < uTile; x++) {
      float invZ = texelFetch(tPack, min(base + ivec2(x, y), last), 0).a;
      lo = min(lo, invZ);
      hi = max(hi, invZ);
    }
  }
  gl_FragColor = vec4(max(lensCoc(lo, uFocus, uAperture, uMaxCoc), lensCoc(hi, uFocus, uAperture, uMaxCoc)));
}
`;
const dilateFrag = /* glsl */ `
precision highp float;
uniform sampler2D tTile;
void main() {
  ivec2 last = textureSize(tTile, 0) - 1;
  ivec2 p = ivec2(gl_FragCoord.xy);
  float m = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) m = max(m, texelFetch(tTile, clamp(p + ivec2(x, y), ivec2(0), last), 0).r);
  }
  gl_FragColor = vec4(m);
}
`;

// the gather itself, shared: the half size pass runs it for the blurry lot, the
// grade for the pixels near focus
const gatherGlsl = /* glsl */ `
uniform sampler2D tPack; // rgb colour, a = 1 / view distance
uniform sampler2D tTile; // biggest CoC near here
uniform int uTile;
uniform vec2 uTexel;     // dpr / size: CoC numbers are in CSS px
uniform vec2 uSpiral[TAPS]; // (cos, sin) of i * golden angle
uniform float uFocus;
uniform float uAperture;
uniform float uMaxCoc;   // px
${lensGlsl}
const int MIN_TAPS = 8;
const float FULL = 48.0; // the look was set with 48 taps: fewer each weigh more

// p0: the pack's texel at uv, c0: its CoC, seed: a pixel's own two numbers
vec3 gather(vec2 uv, vec4 p0, float c0, vec2 seed) {
  vec3 acc = p0.rgb;
  if (any(isnan(acc)) || any(isinf(acc))) acc = vec3(0.0);
  float wsum = 1.0;
  // the full reach: big enough to catch blurry foreground spilling over a sharp pixel
  float R0 = max(c0, uMaxCoc * 0.5);
  // nothing near blurs further than the tile says (+1: the weight's soft edge),
  // so look no further, with as many taps as keeps them as dense as on the full
  // disc. Even in focus a few stay: the full disc's innermost taps soften the
  // picture a little, and it should look the same.
  float R = min(R0, texelFetch(tTile, ivec2(uv * vec2(textureSize(tPack, 0))) / uTile, 0).r + 1.0);
  float area = (R * R) / (R0 * R0);
  int taps = clamp(int(ceil(float(TAPS) * area)), MIN_TAPS, TAPS);
  float dense = FULL * area / float(taps);
  // rotate the spiral per pixel so a hot speck blurs to a soft disc, not a ring of dots
  float rot = fract(sin(dot(seed, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  mat2 spin = mat2(cos(rot), sin(rot), -sin(rot), cos(rot));
  float jr = fract(sin(dot(seed, vec2(39.3468, 11.135))) * 24634.6345);
  for (int i = 1; i < taps; i++) {
    float fi = float(i);
    float r = sqrt((fi - jr) / float(taps)) * R;
    vec4 p = texture2D(tPack, uv + spin * uSpiral[i] * r * uTexel);
    float ci = lensCoc(p.a, uFocus, uAperture, uMaxCoc);
    // a tap behind us can't blur over us further than our own blur
    if (p.a * 1.02 < p0.a) ci = min(ci, c0);
    float w = smoothstep(r - 1.0, r + 1.0, ci) * dense;
    vec3 s = p.rgb;
    // one NaN pixel would smear into a dotted disc: drop it
    if (any(isnan(s)) || any(isinf(s))) continue;
    s = min(s, vec3(32.0));
    // out-of-focus highlights bloom into discs a little
    w *= 1.0 + 0.25 * smoothstep(0.6, 1.6, dot(s, vec3(0.333)));
    acc += s * w;
    wsum += w;
  }
  return acc / wsum;
}
`;

// Half size, a quarter of the work: each texel is the blur of one real pixel
// (not of four averaged: its CoC has to be a true one), with that CoC in alpha
// for the grade to pick its neighbours by.
const dofFrag = /* glsl */ `
precision highp float;
${gatherGlsl}
void main() {
  vec2 size = vec2(textureSize(tPack, 0));
  vec2 uv = (min(floor(gl_FragCoord.xy) * 2.0 + 1.0, size - 1.0) + 0.5) / size;
  vec4 p0 = texture2D(tPack, uv);
  float c0 = lensCoc(p0.a, uFocus, uAperture, uMaxCoc);
  gl_FragColor = vec4(gather(uv, p0, c0, gl_FragCoord.xy), c0);
}
`;

const gradeFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDof;  // half size: blurred colour, a = the CoC it was blurred by
uniform float uDof;      // 0 with the lens shut
${gatherGlsl}
uniform float uExposure;
uniform vec3 uWhite;     // white balance multiplier (linear)
uniform vec3 uLift;      // display space
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSat;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform vec2 uRes;
uniform sampler2D tWire;  // the loading drawing: ink where alpha
uniform float uReveal;   // 0 = the drawing on millimetre paper, 1 = the picture
uniform float uDpr;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// Half size blur is fine where the picture is blurry anyway. Near focus (the
// bird, its feathers) the gather runs here, at full size, as it always did.
const float NEAR = 2.0; // CoC px: below, all full size
const float FAR = 4.0;  // above, all half size
vec3 lens() {
  vec4 p0 = texture2D(tPack, vUv);
  float c0 = lensCoc(p0.a, uFocus, uAperture, uMaxCoc);
  vec3 sharp = vec3(0.0);
  if (c0 < FAR) {
    sharp = gather(vUv, p0, c0, gl_FragCoord.xy);
    if (c0 <= NEAR) return sharp;
  }
  // the four half size texels around, each by how close its sharpness is to
  // ours: a blurry background doesn't take the bird's crisp edge in
  ivec2 last = textureSize(tDof, 0) - 1;
  vec2 q = gl_FragCoord.xy * 0.5 - 0.75; // a texel stands for the odd pixel of its four
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  vec4 soft = vec4(0.0);
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    vec4 t = texelFetch(tDof, clamp(i + o, ivec2(0), last), 0);
    float d = min(t.a, FAR) - min(c0, FAR); // past FAR blurry is blurry: plain bilinear
    vec2 b = mix(1.0 - f, f, vec2(o));
    soft += vec4(t.rgb, 1.0) * (b.x * b.y + 0.01) / (0.25 + d * d);
  }
  return mix(sharp, soft.rgb / soft.a, smoothstep(NEAR, FAR, c0));
}

void main() {
  vec3 c;
  if (uDof > 0.0) {
    c = lens();
  } else {
    c = texture2D(tColor, vUv).rgb;
    // the gather drops NaNs; with the lens shut this is the first to see them
    if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  }
  c *= uExposure * uWhite;
  c = toneMapping(c);
  c = linearToOutputTexel(vec4(c, 1.0)).rgb;
  // lift / gamma / gain in display space
  c = uGain * (c + uLift * (1.0 - c));
  c = pow(max(c, 0.0), 1.0 / uGamma);
  // soft contrast around mid grey
  c = mix(vec3(0.5), c, uContrast);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  // vignette
  vec2 q = vUv - 0.5;
  q.x *= uRes.x / uRes.y;
  c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
  // grain, luminance-weighted, a touch stronger in the mids
  float g = hash(vUv * uRes + fract(uTime) * 91.7) - 0.5;
  c += g * uGrain * (0.4 + 0.6 * (1.0 - abs(l - 0.5) * 2.0));
  c = clamp(c, 0.0, 1.0);
  if (uReveal < 1.0) {
    // millimetre paper, in CSS px from the top left so it lines up with the page's own
    vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
    float line = 0.0;
    vec3 lines = vec3(1.0 / 5.0, 1.0 / 25.0, 1.0 / 50.0);
    vec3 alpha = vec3(0.12, 0.22, 0.35);
    for (int i = 0; i < 3; i++) {
      vec2 f = fract(px * lines[i]);
      float on = max(step(f.x, lines[i] * 1.0), step(f.y, lines[i] * 1.0));
      line = max(line, on * alpha[i]);
    }
    vec3 paper = mix(vec3(0.945, 0.941, 0.910), vec3(0.435, 0.561, 0.416), line);
    float ink = texture2D(tWire, vUv).a;
    paper = mix(paper, vec3(0.17, 0.23, 0.17), ink * 0.85);
    c = mix(paper, c, uReveal);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

const TILE = 8;
// a phone's pixels are small and its GPU smaller: half the taps, a little more noise
const TAPS = phone ? 24 : 48;

export interface Post {
  dispose(): void;
  /** wire: while loading, draws the drawing (into its own target); null once revealing */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, t: number, wire?: (() => void) | null): void;
  setSize(w: number, h: number, dpr: number): void;
  /** world-space point to keep in focus */
  focusOn(p: THREE.Vector3): void;
  dof: Record<string, THREE.IUniform>;
  grade: Record<string, THREE.IUniform>;
  /** swap the tone mapping curve (the grade pass calls it itself) */
  setToneMapping(t: THREE.ToneMapping): void;
  /** the drawing is off screen: free its target (it comes back on the next drawing frame) */
  endDrawing(): void;
  /**
   * Compile what the picture will draw, while the drawing still shows: `jobs` runs with the
   * scene target bound (its compileAsync calls get the programs that pass uses), then the lens.
   * Resolves once they are all ready.
   */
  compile(jobs: () => Promise<unknown>[]): Promise<unknown>;
  /** draw the picture once into its targets, unseen: whatever compile can't reach (the shadow pass) is done then */
  prerender(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
}

export function createPost(renderer: THREE.WebGLRenderer, opts: { samples: number }): Post {
  const depth = new THREE.DepthTexture(1, 1);
  depth.type = THREE.UnsignedIntType;
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: opts.samples,
    depthTexture: depth,
    depthBuffer: true,
  });
  sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const packRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const tileOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
  const tileRT = new THREE.WebGLRenderTarget(1, 1, tileOpts);
  const tileMaxRT = new THREE.WebGLRenderTarget(1, 1, tileOpts);
  const dofRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const wireRT = new THREE.WebGLRenderTarget(1, 1, { samples: opts.samples });
  const clearCol = new THREE.Color();

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const fsScene = new THREE.Scene();
  fsScene.add(quad);
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // one lens for every pass (and the motes, through `dof`)
  const lens = { uFocus: { value: 3.3 }, uAperture: { value: 85 }, uMaxCoc: { value: 14 } };
  const packMat = new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: packFrag,
    uniforms: {
      tColor: { value: sceneRT.texture },
      tDepth: { value: depth },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uFarCoc: { value: 6 },
      uFocus: lens.uFocus,
      uAperture: lens.uAperture,
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const uTile = { value: 16 };
  const tileMat = new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: tileFrag,
    uniforms: { tPack: { value: packRT.texture }, uTile, ...lens },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const dilateMat = new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: dilateFrag,
    uniforms: { tTile: { value: tileRT.texture } },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const gather = {
    tPack: { value: packRT.texture },
    tTile: { value: tileMaxRT.texture },
    uTile,
    uTexel: { value: new THREE.Vector2() },
    uSpiral: { value: Array.from({ length: TAPS }, (_, i) => new THREE.Vector2(Math.cos(i * 2.39996323), Math.sin(i * 2.39996323))) },
    ...lens,
  };
  const dofMat = new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: dofFrag,
    uniforms: gather,
    defines: { TAPS },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const gradeMat = new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: gradeFrag,
    uniforms: {
      tColor: { value: sceneRT.texture },
      tDof: { value: dofRT.texture },
      uDof: { value: 1 },
      ...gather,
      uExposure: { value: 1.0 },
      uWhite: { value: new THREE.Vector3(1, 1, 1) },
      uLift: { value: new THREE.Vector3(0, 0, 0) },
      uGamma: { value: new THREE.Vector3(1, 1, 1) },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSat: { value: 1 },
      uContrast: { value: 1 },
      uVignette: { value: 0.2 },
      uGrain: { value: 0.025 },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      tWire: { value: wireRT.texture as THREE.Texture | null },
      uReveal: { value: 1 },
      uDpr: { value: 1 },
    },
    depthTest: false,
    depthWrite: false,
    defines: { TAPS },
    // keep toneMapped so three defines toneMapping() for the screen pass; the
    // shader calls it itself, before the grade
    toneMapped: true,
  });

  const dofPasses: [THREE.Material, THREE.WebGLRenderTarget][] = [
    [packMat, packRT],
    [tileMat, tileRT],
    [dilateMat, tileMaxRT],
    [dofMat, dofRT],
  ];
  // the scene, then the lens, each into its target
  function drawPicture(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);
    // lens wide shut: nothing to blur, the grade reads the scene as it is
    gradeMat.uniforms.uDof.value = lens.uAperture.value > 0 ? 1 : 0;
    if (!gradeMat.uniforms.uDof.value) return;
    for (const [mat, rt] of dofPasses) {
      quad.material = mat;
      renderer.setRenderTarget(rt);
      renderer.render(fsScene, fsCam);
    }
  }

  const focusWorld = new THREE.Vector3(0, 0.9, 0);
  const tmp = new THREE.Vector3();
  let focusDist = 3.3;

  return {
    dispose() {
      for (const target of [sceneRT, packRT, tileRT, tileMaxRT, dofRT, wireRT]) target.dispose();
      for (const material of [packMat, tileMat, dilateMat, dofMat, gradeMat]) material.dispose();
      quad.geometry.dispose(); depth.dispose();
    },
    dof: dofMat.uniforms,
    grade: gradeMat.uniforms,
    endDrawing() {
      wireRT.dispose();
      gradeMat.uniforms.tWire.value = null;
    },
    compile(jobs) {
      const prev = renderer.getRenderTarget();
      // into a float target three compiles linear, untone-mapped programs: compiled against the
      // screen they would be the wrong ones, and the picture would compile its own on its first frame.
      // (binding the targets also allocates them, so that isn't left to the first frame either)
      renderer.setRenderTarget(sceneRT);
      const all = jobs();
      for (const [mat, rt] of dofPasses) {
        renderer.setRenderTarget(rt);
        quad.material = mat;
        all.push(renderer.compileAsync(quad, fsCam, fsScene));
      }
      quad.material = gradeMat;
      renderer.setRenderTarget(prev);
      return Promise.all(all);
    },
    prerender(scene, camera) {
      const prev = renderer.getRenderTarget();
      drawPicture(scene, camera);
      quad.material = gradeMat;
      renderer.setRenderTarget(prev);
    },
    setToneMapping(t) {
      renderer.toneMapping = t;
      gradeMat.needsUpdate = true;
    },
    focusOn(p) {
      focusWorld.copy(p);
    },
    setSize(w, h, d) {
      const W = Math.floor(w * d);
      const H = Math.floor(h * d);
      sceneRT.setSize(W, H);
      packRT.setSize(W, H);
      // TILE css px a side: no less than the gather's reach past a sharp pixel (uMaxCoc / 2, + 1)
      uTile.value = Math.ceil(TILE * d);
      tileRT.setSize(Math.ceil(W / uTile.value), Math.ceil(H / uTile.value));
      tileMaxRT.setSize(tileRT.width, tileRT.height);
      dofRT.setSize(Math.ceil(W / 2), Math.ceil(H / 2));
      wireRT.setSize(W, H);
      gradeMat.uniforms.uDpr.value = d;
      gather.uTexel.value.set(d / W, d / H);
      gradeMat.uniforms.uRes.value.set(W, H);
    },
    render(scene, camera, t, wire) {
      if (wire) {
        gradeMat.uniforms.tWire.value = wireRT.texture;
        renderer.getClearColor(clearCol);
        const a = renderer.getClearAlpha();
        renderer.setRenderTarget(wireRT);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        wire();
        renderer.setClearColor(clearCol, a);
      }
      // focus distance along the view axis, eased so saccades don't pump the focus
      tmp.copy(focusWorld).applyMatrix4(camera.matrixWorldInverse);
      focusDist += (-tmp.z - focusDist) * 0.15;
      lens.uFocus.value = Math.max(focusDist, 0.1);
      packMat.uniforms.uNear.value = camera.near;
      packMat.uniforms.uFar.value = camera.far;
      gradeMat.uniforms.uTime.value = t;

      gradeMat.uniforms.uDof.value = 0;
      // nothing of the picture shows yet: skip it (the drawing is all there is)
      if (gradeMat.uniforms.uReveal.value > 0) drawPicture(scene, camera);
      quad.material = gradeMat;
      renderer.setRenderTarget(null);
      renderer.render(fsScene, fsCam);
    },
  };
}

