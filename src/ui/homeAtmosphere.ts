import * as THREE from 'three';

/** Screen-space atmosphere shares the homepage renderer and animation clock. */
export function createHomeAtmosphere(time: { value: number }, pixelRatio: number, lowPower: boolean): THREE.Group {
  const group = new THREE.Group();
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uTime: time },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float depth = 1.0 - vUv.y;
        // Project the rippling surface into a widening fan of underwater light.
        float t = uTime * 0.16;
        float ray = (vUv.x - 0.61) / (0.30 + depth * 0.85);
        float ripple = ray + sin(ray * 8.0 + t) * 0.026 + sin(ray * 19.0 - t * 0.7) * 0.012;
        float broad = pow(0.5 + 0.5 * sin(ripple * 26.0 + sin(ripple * 11.0 + t)), 5.0);
        float fine = pow(0.5 + 0.5 * sin(ripple * 73.0 - t * 0.45), 12.0);
        float envelope = exp(-ray * ray * 1.6);
        float shafts = (broad * 0.72 + fine * 0.23) * envelope;
        float fade = exp(-depth * 3.1) * (1.0 - smoothstep(0.65, 1.0, depth));
        float surface = exp(-depth * 18.0) * exp(-pow((vUv.x - 0.61) * 2.3, 2.0));
        vec3 base = vec3(0.0196, 0.0275, 0.0471);
        vec3 light = vec3(0.11, 0.20, 0.25) * (shafts + envelope * 0.10) * fade
          + vec3(0.06, 0.11, 0.13) * surface;
        gl_FragColor = vec4(base + light, 1.0);
      }
    `,
  }));
  haze.frustumCulled = false;
  haze.renderOrder = -2;
  group.add(haze);

  const count = lowPower ? 180 : 420;
  const positions = new Float32Array(count * 3);
  // Stable distribution keeps the atmosphere consistent on reload.
  for (let i = 0; i < count; i++) {
    positions.set([(i * 0.754877666) % 1, (i * 0.569840296) % 1, (i * 0.438579021) % 1], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const dust = new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms: { uTime: time, uPixelRatio: { value: pixelRatio } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        float seed = position.z;
        vec2 p = position.xy;
        p.x = fract(p.x + uTime * (0.001 + seed * 0.0015) + sin(uTime * 0.09 + seed * 60.0) * 0.013);
        p.y = fract(p.y + uTime * (0.002 + seed * 0.003));
        float edge = smoothstep(0.0, 0.06, p.x) * smoothstep(0.0, 0.06, 1.0-p.x)
          * smoothstep(0.0, 0.06, p.y) * smoothstep(0.0, 0.06, 1.0-p.y);
        vAlpha = (0.13 + seed * 0.20) * (0.45 + p.y * 0.55) * edge;
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
        gl_PointSize = (1.1 + pow(seed, 3.0) * 2.5) * uPixelRatio;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = (1.0 - smoothstep(0.0, 1.0, radius)) * vAlpha;
        gl_FragColor = vec4(0.65, 0.76, 0.86, alpha);
      }
    `,
  }));
  dust.frustumCulled = false;
  dust.renderOrder = 1;
  group.add(dust);
  return group;
}
