export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'mpeg', 'mpg', '3gp'] as const;

export type GsQuality = 'draft' | 'standard' | 'high';

export interface GsProgress {
  ratio: number;
  label: string;
  canFinish: boolean;
}

export interface GsJob {
  done: Promise<File>;
  finishEarly(): Promise<void>;
  abort(): void;
}

export interface GsLiveHooks {
  onFrames?(frames: Array<{ source: Blob; name: string }>): void;
  onLive?(session: import('splat.js').SplatSession): void;
  onTeardown?(): void;
  viewSize?: { maxViewW: number; maxViewH: number };
}

interface GsQualityPreset {
  maxIters: number;
  initTarget: number;
  shDeg: number;
  maxSplats: number;
  maxViewW: number;
  maxViewH: number;
  trainMaxDim?: number;
  targetBudgetBytes: number;
  targetFrames: number;
  samplesPerSec: number;
  minBufferSec: number;
  jpegQuality: number;
  hint: string;
}

/** More frames without a larger GPU budget just shrinks trainMaxDim — keep those two in lockstep. */
const QUALITY: Record<GsQuality, GsQualityPreset> = {
  draft: {
    maxIters: 8000,
    initTarget: 40_000,
    shDeg: 1,
    maxSplats: 250_000,
    maxViewW: 1280,
    maxViewH: 720,
    trainMaxDim: 960,
    targetBudgetBytes: 500_000_000,
    targetFrames: 40,
    samplesPerSec: 8,
    minBufferSec: 0.25,
    jpegQuality: 0.88,
    hint: '约 40 张训练帧、8 千步、1 阶球谐。先确认视频能不能重建。',
  },
  standard: {
    maxIters: 25_000,
    initTarget: 80_000,
    shDeg: 2,
    maxSplats: 500_000,
    maxViewW: 1920,
    maxViewH: 1080,
    targetBudgetBytes: 1_200_000_000,
    targetFrames: 80,
    samplesPerSec: 10,
    minBufferSec: 0.2,
    jpegQuality: 0.93,
    hint: '约 80 张帧、2.5 万步、2 阶球谐。一般绕拍视频用这一档。',
  },
  high: {
    maxIters: 50_000,
    initTarget: 150_000,
    shDeg: 3,
    maxSplats: 800_000,
    maxViewW: 2560,
    maxViewH: 1440,
    targetBudgetBytes: 1_800_000_000,
    targetFrames: 140,
    samplesPerSec: 12,
    minBufferSec: 0.15,
    jpegQuality: 0.95,
    hint: '约 140 张帧、5 万步、3 阶球谐、更高训练分辨率。请保持标签页在前台；显存不够时改回标准。',
  },
};

export function gsQualityHint(quality: GsQuality): string {
  return (QUALITY[quality] ?? QUALITY.standard).hint;
}

export interface GsEnvInfo {
  ok: boolean;
  detail: string;
}

/** Why video→3DGS often works in Cursor's browser but fails in system Chrome. */
export async function checkGsEnvironment(): Promise<GsEnvInfo> {
  const local = `http://localhost:${location.port || '5178'}/`;
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return {
      ok: false,
      detail: `当前地址 ${location.origin} 不是安全环境，WebGPU 会被关掉。请改用 ${local} 打开，不要用局域网 IP、未信任的自签 HTTPS、或 file://。`,
    };
  }

  const gpu = gpuApi();
  if (!gpu) {
    return {
      ok: false,
      detail: '当前浏览器没有 WebGPU。请用最新版 Chrome 或 Edge（不要用 Firefox / 微信内置浏览器），并在设置里打开「使用硬件加速」。',
    };
  }

  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      return {
        ok: false,
        detail: '找不到可用的 WebGPU 显卡。请打开硬件加速，或在 chrome://flags 启用 Unsafe WebGPU / Override software rendering list。',
      };
    }
    const name = adapter.info?.description || adapter.info?.vendor || 'GPU';
    return { ok: true, detail: `WebGPU 可用（${name}）。请用 ${local} 并保持标签页在前台。` };
  } catch (err) {
    return { ok: false, detail: translateGsError(err) };
  }
}

export function translateGsError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/WebGPU not available|没有 WebGPU/i.test(msg)) {
    return '当前浏览器没有 WebGPU。请用最新版 Chrome 或 Edge 打开 http://localhost 上的本页。';
  }
  if (/no WebGPU adapter/i.test(msg)) {
    return '找不到 WebGPU 显卡。请打开硬件加速，或换用 Edge。';
  }
  if (/decode|no decodable|could not decode|MEDIA_ERR/i.test(msg)) {
    return '当前浏览器解不开这段视频。即梦导出经常是 HEVC，Chrome 常会失败。请改用 Edge，或先转成 H.264 MP4。';
  }
  if (/Failed to fetch dynamically imported module|Failed to load|error loading dynamically/i.test(msg)) {
    return '训练模块加载失败。请确认用开发服务器打开本页（不要用 file://），然后强制刷新。';
  }
  if (/Failed to construct 'Worker'|import\.meta/i.test(msg)) {
    return '训练用的 Worker 被浏览器拦住了。请用 http://localhost 打开，不要用局域网 IP。';
  }
  if (/out of memory|OOM|device lost|GPUDevice/i.test(msg)) {
    return '显存不够或 GPU 设备丢失。请关掉其他 3D 标签页，改用「草稿」质量再试。';
  }
  return msg;
}

function gpuApi(): {
  requestAdapter(opts?: { powerPreference?: string }): Promise<{
    info?: { description?: string; vendor?: string };
  } | null>;
} | undefined {
  const gpu = typeof navigator !== 'undefined' ? (navigator as Navigator & { gpu?: { requestAdapter: Function } }).gpu : undefined;
  return gpu as ReturnType<typeof gpuApi>;
}

export function isVideoFileName(name: string, mime = ''): boolean {
  if (mime.startsWith('video/')) return true;
  return (VIDEO_EXTENSIONS as readonly string[]).includes(name.split('.').pop()?.toLowerCase() ?? '');
}

export function startSplatFromVideo(
  video: File,
  quality: GsQuality,
  onProgress: (state: GsProgress) => void,
  hooks: GsLiveHooks = {},
): GsJob {
  const abort = new AbortController();
  let session: import('splat.js').SplatSession | null = null;
  let finishing = false;

  const done = run();

  return {
    done,
    abort: () => abort.abort(),
    finishEarly: async () => {
      finishing = true;
      await session?.finish();
    },
  };

  async function run(): Promise<File> {
    const env = await checkGsEnvironment();
    if (!env.ok) throw new Error(env.detail);

    const throwIfAborted = (): void => {
      if (abort.signal.aborted && !finishing) throw new DOMException('已取消', 'AbortError');
    };

    let createSession: typeof import('splat.js').createSession;
    let extractSharpFrames: typeof import('splat.js').extractSharpFrames;
    try {
      ({ createSession, extractSharpFrames } = await import('splat.js'));
    } catch (err) {
      throw new Error(translateGsError(err));
    }
    throwIfAborted();

    const preset = QUALITY[quality] ?? QUALITY.standard;

    onProgress({ ratio: 0.02, label: '正在从视频抽取清晰帧…', canFinish: false });
    let extracted: Awaited<ReturnType<typeof extractSharpFrames>>;
    try {
      extracted = await extractSharpFrames(video, {
        targetFrames: preset.targetFrames,
        samplesPerSec: preset.samplesPerSec,
        minBufferSec: preset.minBufferSec,
        jpegQuality: preset.jpegQuality,
        onProgress: (event) => {
          const part = event.total > 0 ? event.done / event.total : 0;
          const ratio = event.stage === 'scan' ? 0.02 + 0.1 * part : 0.12 + 0.1 * part;
          const label = event.stage === 'scan' ? '扫描视频清晰度' : '截取训练帧';
          onProgress({ ratio, label: `${label} ${event.done}/${event.total}`, canFinish: false });
        },
      });
    } catch (err) {
      throw new Error(translateGsError(err));
    }
    throwIfAborted();
    if (extracted.frames.length < 8) {
      throw new Error(`可用帧太少（${extracted.frames.length}）。请换一段绕物体缓慢拍摄、约 20 秒以上的视频。`);
    }

    hooks.onFrames?.(extracted.frames);

    const view = hooks.viewSize;
    session = createSession({
      maxIters: preset.maxIters,
      initTarget: preset.initTarget,
      maxViewW: Math.max(preset.maxViewW, view?.maxViewW ?? 0),
      maxViewH: Math.max(preset.maxViewH, view?.maxViewH ?? 0),
      trainer: { shDeg: preset.shDeg, maxSplats: preset.maxSplats },
      frames: {
        ...(preset.trainMaxDim ? { trainMaxDim: preset.trainMaxDim } : {}),
        targetBudgetBytes: preset.targetBudgetBytes,
      },
    });

    const unsub: Array<() => void> = [];
    try {
      unsub.push(
        session.on('stage', (event) => {
          onProgress({
            ratio: mapStageRatio(event.stage, event.done, event.total),
            label: stageLabel(event),
            canFinish: event.stage === 'train' && event.done > 400,
          });
        }),
      );
      unsub.push(
        session.on('metrics', (event) => {
          const psnr = event.psnrTrain != null ? ` · ${event.psnrTrain.toFixed(1)} dB` : '';
          onProgress({
            ratio: 0.58 + 0.36 * Math.min(1, event.iter / preset.maxIters),
            label: `训练中 ${event.iter.toLocaleString()}/${preset.maxIters.toLocaleString()} · ${event.splats.toLocaleString()} 点${psnr}`,
            canFinish: event.iter > 400,
          });
        }),
      );

      onProgress({ ratio: 0.24, label: `解码 ${extracted.frames.length} 张训练照片`, canFinish: false });
      await session.load(extracted.frames);
      throwIfAborted();

      onProgress({ ratio: 0.34, label: '解算相机位姿（SfM）…', canFinish: false });
      await session.solve({ signal: abort.signal });
      throwIfAborted();

      onProgress({ ratio: 0.56, label: '初始化高斯点', canFinish: false });
      await session.seed();
      throwIfAborted();

      onProgress({ ratio: 0.58, label: '开始训练 3DGS…', canFinish: false });
      hooks.onLive?.(session);
      await waitForTraining(session, abort.signal, () => finishing);

      onProgress({ ratio: 0.96, label: '导出高斯泼溅 PLY', canFinish: false });
      const blob = await session.exportPlyBlob();
      const stem = video.name.replace(/\.[^.]+$/, '') || 'video';
      return new File([blob], `${stem}-3dgs.ply`, { type: 'application/octet-stream' });
    } finally {
      for (const off of unsub) off();
      session.pause();
      try {
        hooks.onTeardown?.();
      } catch {
        /* host already torn down */
      }
      session.dispose();
      session = null;
    }
  }
}

function waitForTraining(
  session: import('splat.js').SplatSession,
  signal: AbortSignal,
  isFinishing: () => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const off = session.on('event', (event) => {
      if (event.kind !== 'train-complete') return;
      cleanup();
      resolve();
    });
    const onAbort = () => {
      if (isFinishing()) return;
      cleanup();
      session.pause();
      reject(new DOMException('已取消', 'AbortError'));
    };
    const cleanup = () => {
      off();
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted && !isFinishing()) {
      onAbort();
      return;
    }
    session.start();
  });
}

function mapStageRatio(stage: string, done: number, total: number): number {
  const part = total > 0 ? Math.min(1, done / total) : 0;
  if (stage === 'decode') return 0.24 + 0.08 * part;
  if (stage === 'solved' || stage === 'seed') return 0.54 + 0.04 * part;
  if (stage === 'train') return 0.58 + 0.36 * part;
  return 0.34 + 0.2 * part;
}

function stageLabel(event: { stage: string; done: number; total: number }): string {
  if (event.stage === 'decode') return `解码训练帧 ${event.done}/${event.total}`;
  if (event.stage === 'solved') return '相机位姿已解算';
  if (event.stage === 'seed') return '高斯点已初始化';
  if (event.stage === 'train') return `训练中 ${event.done.toLocaleString()}/${event.total.toLocaleString()}`;
  return `重建中 · ${event.stage} ${event.done}/${event.total}`;
}
