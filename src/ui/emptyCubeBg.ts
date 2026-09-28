import * as THREE from 'three';
import { detectTier, pixelRatioCap } from '../core/tier';
import type { ViewDirection } from '../core/Viewer';
import { createHomeAtmosphere } from './homeAtmosphere';

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uFocusDistance;
uniform float uScatterAmount;
uniform float uNoiseScale;
uniform float uFlowSpeed;
uniform float uPointScale;
uniform vec4 uTrail[12];
uniform float uTrailAge[12];
uniform float uAspect;

varying float vDefocus;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m *= m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec3 flowField(vec3 p) {
  float n1 = snoise(p);
  float n2 = snoise(p + vec3(31.2, 17.8, 9.4));
  float n3 = snoise(p + vec3(7.1, 42.6, 19.3));
  vec3 coarse = vec3(n1, n2, n3);
  vec3 fine = vec3(
    snoise(p * 2.15 + vec3(0.0, 8.1, 0.0)),
    snoise(p * 2.15 + vec3(4.7, 0.0, 12.3)),
    snoise(p * 2.15 + vec3(0.0, 0.0, 21.8))
  );
  return coarse * 0.72 + fine * 0.28;
}

void main() {
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  float depth = -viewPosition.z;
  float behind = depth - uFocusDistance;
  float defocus = pow(smoothstep(0.06, 2.05, behind), 1.2);
  vDefocus = defocus;

  vec3 sampleP = position * uNoiseScale + vec3(uTime * uFlowSpeed, uTime * 0.07, -uTime * 0.11);
  vec3 flow = flowField(sampleP);
  vec3 gust = vec3(
    snoise(vec3(position.y * 0.85, uTime * 0.22, 0.4)),
    snoise(vec3(uTime * 0.18, position.x * 0.85, 1.9)) * 0.65,
    snoise(vec3(position.x * 0.55, position.y * 0.55, uTime * 0.16))
  );

  vec3 displacement = (flow * 0.9 + gust * 0.45) * defocus * uScatterAmount;
  vec4 finalView = modelViewMatrix * vec4(position + displacement, 1.0);

  // Screen-space segments keep fast mouse strokes continuous. Each fades back
  // to the original geometry; no position changes accumulate on the CPU.
  vec4 projected = projectionMatrix * finalView;
  vec2 screen = projected.xy / projected.w;
  screen.x += 1.0;
  vec2 metric = vec2(uAspect, 1.0);
  vec2 push = vec2(0.0);
  for (int i = 0; i < 12; i++) {
    float age = uTrailAge[i];
    if (age >= 1.4) continue;
    vec2 a = uTrail[i].xy * metric;
    vec2 b = uTrail[i].zw * metric;
    vec2 segment = b - a;
    float t = clamp(dot(screen * metric - a, segment) / max(dot(segment, segment), 0.00001), 0.0, 1.0);
    vec2 delta = screen * metric - mix(a, b, t);
    float influence = (1.0 - smoothstep(0.0, 0.24, length(delta))) * pow(1.0 - age / 1.4, 2.0);
    vec2 direction = normalize(delta + vec2(0.001));
    push += (direction * 0.10 + flow.xy * 0.065) * influence;
  }
  push = push / (1.0 + length(push) * 3.0);
  finalView.xy += push * max(0.35, -finalView.z) / projectionMatrix[1][1];

  gl_Position = projectionMatrix * finalView;
  gl_Position.x += gl_Position.w;
  float bokeh = mix(1.0, 4.2, defocus);
  gl_PointSize = clamp(uPointScale * bokeh / max(0.35, -finalView.z), 1.15, 26.0);
}
`;

const FRAGMENT = /* glsl */ `
varying float vDefocus;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.1, d);
  float alpha = core * mix(1.0, 0.28, vDefocus);
  vec3 color = mix(vec3(0.82, 0.93, 1.0), vec3(0.22, 0.68, 1.0), vDefocus);
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

const CUBE_SIZE = 3.8;

export class EmptyCubeBg {
  private readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly points: THREE.Points;
  private readonly uniforms: {
    uTime: { value: number };
    uFocusDistance: { value: number };
    uScatterAmount: { value: number };
    uNoiseScale: { value: number };
    uFlowSpeed: { value: number };
    uPointScale: { value: number };
    uTrail: { value: THREE.Vector4[] };
    uTrailAge: { value: number[] };
    uAspect: { value: number };
  };
  private readonly clock = new THREE.Clock();
  private readonly observer: MutationObserver;
  private raf = 0;
  private active = false;
  private reduceMotion = false;
  private yaw = 0.62;
  private pitch = 0.38;
  private radius = 5.05;
  private dragging = false;
  private autoOrbit = true;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private anim: { fromYaw: number; fromPitch: number; toYaw: number; toPitch: number; elapsed: number; duration: number } | null =
    null;
  private readonly pitchLimit = Math.PI / 2 - 0.08;
  private trailIndex = 0;
  private hoverPoint: THREE.Vector2 | null = null;
  private lastTrailAt = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.host = canvas.parentElement ?? canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor(0x05070c, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    const gl = this.renderer.getContext();
    const tier = detectTier(gl);
    this.renderer.setPixelRatio(pixelRatioCap(tier));

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 40);

    const count = tier === 'low' ? 12_000 : tier === 'medium' ? 24_000 : 36_000;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(sphereCloud(count, CUBE_SIZE), 3));

    this.uniforms = {
      uTime: { value: 0 },
      uFocusDistance: { value: Math.max(0.2, this.radius - CUBE_SIZE * 0.5) },
      uScatterAmount: { value: 0.48 },
      uNoiseScale: { value: 1.05 },
      uFlowSpeed: { value: 0.14 },
      uPointScale: { value: tier === 'low' ? 13 : 18 },
      uTrail: { value: Array.from({ length: 12 }, () => new THREE.Vector4()) },
      uTrailAge: { value: Array(12).fill(2) },
      uAspect: { value: 1 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: this.uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.points = new THREE.Points(geometry, material);
    this.scene.add(this.points);
    this.scene.add(createHomeAtmosphere(this.uniforms.uTime, this.renderer.getPixelRatio(), tier === 'low'));

    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.reduceMotion) this.autoOrbit = false;
    this.observer = new MutationObserver(() => this.syncActive());
    this.observer.observe(this.host, { attributes: true, attributeFilter: ['class'] });
    this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', this.onVisibility);
    new ResizeObserver(() => this.resize()).observe(this.host);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', () => { this.hoverPoint = null; });
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('lostpointercapture', this.onPointerUp);

    this.applyCamera();
    this.resize();
    this.syncActive();
  }

  setView(direction: ViewDirection): void {
    const targets: Record<ViewDirection, { yaw: number; pitch: number }> = {
      front: { yaw: 0, pitch: 0 },
      back: { yaw: Math.PI, pitch: 0 },
      left: { yaw: -Math.PI / 2, pitch: 0 },
      right: { yaw: Math.PI / 2, pitch: 0 },
      top: { yaw: this.yaw, pitch: this.pitchLimit },
      bottom: { yaw: this.yaw, pitch: -this.pitchLimit },
      iso: { yaw: 0.62, pitch: 0.38 },
    };
    const target = targets[direction];
    this.autoOrbit = false;
    this.anim = {
      fromYaw: this.yaw,
      fromPitch: this.pitch,
      toYaw: shortestYaw(this.yaw, target.yaw),
      toPitch: target.pitch,
      elapsed: 0,
      duration: 0.42,
    };
  }

  private readonly onVisibility = (): void => this.syncActive();

  private syncActive(): void {
    const want =
      !this.host.classList.contains('hidden') &&
      !document.body.classList.contains('gs-live') &&
      !document.body.classList.contains('project-preview-open') &&
      document.visibilityState === 'visible';
    if (want === this.active) return;
    this.active = want;
    if (!want) {
      this.hoverPoint = null;
      this.uniforms.uTrailAge.value.fill(2);
    }
    if (want) {
      this.clock.start();
      this.resize();
      this.tick();
    } else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.dragging = true;
    this.autoOrbit = false;
    this.anim = null;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas.classList.add('is-dragging');
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic events may not support capture */
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.active && !this.reduceMotion) {
      const now = performance.now();
      if (now - this.lastTrailAt >= 16) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width * 2 - 1;
        const y = 1 - (event.clientY - rect.top) / rect.height * 2;
        const previous = this.hoverPoint ?? new THREE.Vector2(x, y);
        this.uniforms.uTrail.value[this.trailIndex].set(previous.x, previous.y, x, y);
        this.uniforms.uTrailAge.value[this.trailIndex] = 0;
        this.trailIndex = (this.trailIndex + 1) % 12;
        this.hoverPoint = previous.set(x, y);
        this.lastTrailAt = now;
      }
    }
    if (!this.dragging) return;
    const dx = event.clientX - this.lastPointerX;
    const dy = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.yaw -= dx * 0.0055;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0055, -this.pitchLimit, this.pitchLimit);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.canvas.classList.remove('is-dragging');
    try {
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  private applyCamera(): void {
    const cosPitch = Math.cos(this.pitch);
    this.camera.position.set(
      this.radius * Math.sin(this.yaw) * cosPitch,
      this.radius * Math.sin(this.pitch),
      this.radius * Math.cos(this.yaw) * cosPitch,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.uniforms.uFocusDistance.value = Math.max(0.2, this.radius - CUBE_SIZE * 0.5);
    this.uniforms.uScatterAmount.value = this.reduceMotion ? 0.08 : 0.48;
  }

  private readonly tick = (): void => {
    if (!this.active) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    this.uniforms.uAspect.value = this.camera.aspect;
    for (let i = 0; i < 12; i++) this.uniforms.uTrailAge.value[i] += dt;
    if (!this.reduceMotion) this.uniforms.uTime.value += dt;

    if (this.anim) {
      this.anim.elapsed += dt;
      const k = Math.min(1, this.anim.elapsed / this.anim.duration);
      const ease = 1 - (1 - k) ** 3;
      this.yaw = this.anim.fromYaw + (this.anim.toYaw - this.anim.fromYaw) * ease;
      this.pitch = this.anim.fromPitch + (this.anim.toPitch - this.anim.fromPitch) * ease;
      if (k >= 1) this.anim = null;
    } else if (this.autoOrbit && !this.dragging) {
      this.yaw += dt * 0.22;
    }

    this.applyCamera();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.tick);
  };
}

function shortestYaw(from: number, to: number): number {
  let target = to;
  while (target - from > Math.PI) target -= Math.PI * 2;
  while (target - from < -Math.PI) target += Math.PI * 2;
  return target;
}

function sphereCloud(count: number, diameter: number): Float32Array {
  const positions = new Float32Array(count * 3);
  const radius = diameter * 0.5;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - 2 * (i + 0.5) / count;
    const ring = Math.sqrt(1 - y * y);
    const angle = i * goldenAngle;
    positions.set([Math.cos(angle) * ring * radius, y * radius, Math.sin(angle) * ring * radius], i * 3);
  }
  return positions;
}
