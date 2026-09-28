/** Live view of in-browser 3DGS training: source video, extracted frames, then WebGPU splats. */

type Vec3 = [number, number, number];

type TrainCam = {
  R: number[];
  t: number[];
  f: number;
  w: number;
  h: number;
};

type LiveSession = {
  model: { center: number[]; radius: number } | null;
  trainer: { camMeta: TrainCam[] } | null;
  view: {
    attach(canvas: HTMLCanvasElement): void;
    lookThrough(i: number): unknown;
    setCamera(cam: {
      R: number[];
      t: number[];
      f: number;
      cx: number;
      cy: number;
      w: number;
      h: number;
    }): void;
  };
};

export function previewViewSize(): { maxViewW: number; maxViewH: number } {
  const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  return {
    maxViewW: Math.max(960, Math.min(2560, Math.round(window.innerWidth * dpr))),
    maxViewH: Math.max(540, Math.min(1440, Math.round(window.innerHeight * dpr))),
  };
}

export class GsLivePreview {
  private readonly canvas = byId<HTMLCanvasElement>('gs-preview');
  private readonly stage = byId('gs-stage');
  private readonly video = byId<HTMLVideoElement>('gs-source-video');
  private readonly frames = byId('gs-frames');

  private session: LiveSession | null = null;
  private objectUrls: string[] = [];
  private videoUrl = '';
  private yaw = 0.55;
  private pitch = 0.28;
  private radius = 4;
  private center: Vec3 = [0, 0, 0];
  private refF = 800;
  private refH = 720;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private autoRotate = true;
  private orbitRaf = 0;
  private maxW = 1920;
  private maxH = 1080;
  private resizeObs: ResizeObserver | null = null;

  constructor() {
    this.canvas.addEventListener('pointerdown', (event) => {
      if (!this.session) return;
      this.dragging = true;
      this.autoRotate = false;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      this.yaw -= (event.clientX - this.lastX) * 0.007;
      this.pitch = clamp(this.pitch + (event.clientY - this.lastY) * 0.005, -1.15, 1.15);
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.pushCamera();
    });
    const endDrag = (event: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.autoRotate = true;
      try {
        this.canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
    this.canvas.addEventListener(
      'wheel',
      (event) => {
        if (!this.session) return;
        event.preventDefault();
        this.radius = clamp(this.radius * (event.deltaY > 0 ? 1.08 : 0.92), 0.15, 80);
        this.pushCamera();
      },
      { passive: false },
    );
  }

  begin(video: File): void {
    this.end();
    document.body.classList.add('gs-live');
    this.stage.classList.remove('hidden');
    this.canvas.classList.add('hidden');
    this.frames.replaceChildren();
    this.videoUrl = URL.createObjectURL(video);
    this.objectUrls.push(this.videoUrl);
    this.video.src = this.videoUrl;
    this.video.classList.remove('hidden');
    void this.video.play().catch(() => {
      /* autoplay can fail; stills will replace this shortly */
    });
  }

  showFrames(files: Array<{ source: Blob; name: string }>): void {
    this.video.pause();
    this.video.classList.add('hidden');
    this.frames.replaceChildren();
    const shown = files.slice(0, 36);
    for (const frame of shown) {
      const url = URL.createObjectURL(frame.source);
      this.objectUrls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = frame.name;
      this.frames.append(img);
    }
    this.stage.classList.remove('hidden');
  }

  attachSession(session: LiveSession): void {
    this.session = session;
    document.body.classList.add('gs-live-splats');
    this.video.pause();
    this.stage.classList.add('hidden');
    this.canvas.classList.remove('hidden');

    const size = previewViewSize();
    this.maxW = size.maxViewW;
    this.maxH = size.maxViewH;
    this.syncCanvasBuffer();

    const model = session.model;
    const cams = session.trainer?.camMeta ?? [];
    const mid = cams[Math.floor(cams.length / 2)] ?? cams[0];
    this.center = (model?.center as Vec3 | undefined) ?? [0, 0, 0];
    if (mid) {
      const eye = camPosition(mid);
      this.radius = Math.max(0.35, Math.hypot(eye[0] - this.center[0], eye[1] - this.center[1], eye[2] - this.center[2]));
      this.refF = mid.f;
      this.refH = Math.max(1, mid.h);
      const dx = eye[0] - this.center[0];
      const dz = eye[2] - this.center[2];
      this.yaw = Math.atan2(dz, dx);
      const dy = this.center[1] - eye[1];
      this.pitch = clamp(Math.asin(clamp(dy / Math.max(this.radius, 1e-4), -0.99, 0.99)), -1.15, 1.15);
    } else if (model) {
      this.radius = Math.max(0.8, model.radius * 2.4);
      this.refF = this.canvas.height * 1.1;
      this.refH = Math.max(1, this.canvas.height);
    }

    try {
      session.view.attach(this.canvas);
    } catch (err) {
      console.warn('3DGS live view attach failed', err);
      return;
    }

    this.pushCamera();
    this.stopOrbit();
    const tick = () => {
      this.orbitRaf = requestAnimationFrame(tick);
      if (this.autoRotate && !this.dragging) {
        this.yaw += 0.0032;
        this.pushCamera();
      }
    };
    this.orbitRaf = requestAnimationFrame(tick);

    this.resizeObs?.disconnect();
    this.resizeObs = new ResizeObserver(() => {
      this.syncCanvasBuffer();
      this.pushCamera();
    });
    this.resizeObs.observe(this.canvas);
  }

  detachGpu(): void {
    this.stopOrbit();
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.session = null;
    this.canvas.classList.add('hidden');
    document.body.classList.remove('gs-live-splats');
  }

  end(): void {
    this.detachGpu();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.classList.add('hidden');
    this.frames.replaceChildren();
    this.stage.classList.add('hidden');
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    this.videoUrl = '';
    document.body.classList.remove('gs-live');
  }

  private syncCanvasBuffer(): void {
    const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    const cssW = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const w = Math.max(2, Math.min(this.maxW, Math.round(cssW * dpr)));
    const h = Math.max(2, Math.min(this.maxH, Math.round(cssH * dpr)));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  private pushCamera(): void {
    const session = this.session;
    if (!session) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const eye: Vec3 = [
      this.center[0] + this.radius * cp * Math.cos(this.yaw),
      this.center[1] - this.radius * sp,
      this.center[2] + this.radius * cp * Math.sin(this.yaw),
    ];
    const { R, t } = lookAtPose(eye, this.center);
    session.view.setCamera({
      R,
      t,
      f: this.refF * (h / this.refH),
      cx: w / 2,
      cy: h / 2,
      w,
      h,
    });
  }

  private stopOrbit(): void {
    if (this.orbitRaf) cancelAnimationFrame(this.orbitRaf);
    this.orbitRaf = 0;
  }
}

function lookAtPose(eye: Vec3, center: Vec3): { R: number[]; t: number[] } {
  const worldUp: Vec3 = [0, -1, 0];
  const zc = norm(sub(center, eye));
  let xc = cross(zc, worldUp);
  if (Math.hypot(xc[0], xc[1], xc[2]) < 1e-6) xc = cross(zc, [1, 0, 0]);
  xc = norm(xc);
  const yc = cross(zc, xc);
  const R = [xc[0], xc[1], xc[2], yc[0], yc[1], yc[2], zc[0], zc[1], zc[2]];
  const t = [
    -(R[0] * eye[0] + R[1] * eye[1] + R[2] * eye[2]),
    -(R[3] * eye[0] + R[4] * eye[1] + R[5] * eye[2]),
    -(R[6] * eye[0] + R[7] * eye[1] + R[8] * eye[2]),
  ];
  return { R, t };
}

function camPosition(cam: TrainCam): Vec3 {
  const { R, t } = cam;
  return [
    -(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]),
    -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]),
    -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2]),
  ];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
}
