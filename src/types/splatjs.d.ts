declare module 'splat.js' {
  export function isVideoFile(file: { type?: string; name?: string }): boolean;

  export function extractSharpFrames(
    file: Blob,
    opts?: {
      samplesPerSec?: number;
      targetFrames?: number;
      minBufferSec?: number;
      jpegQuality?: number;
      onProgress?: (event: { stage: 'scan' | 'capture'; done: number; total: number }) => void;
      log?: (message: string) => void;
    },
  ): Promise<{
    frames: Array<{ source: Blob; name: string }>;
    duration: number;
    sampled: number;
    videoW: number;
    videoH: number;
  }>;

  export interface SplatSession {
    training: boolean;
    model: { n: number; center: number[]; radius: number } | null;
    trainer: {
      iter: number;
      n: number;
      camMeta: Array<{ R: number[]; t: number[]; f: number; w: number; h: number }>;
    } | null;
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
    on(type: 'stage', fn: (event: { stage: string; done: number; total: number; detail?: unknown }) => void): () => void;
    on(
      type: 'metrics',
      fn: (event: { iter: number; splats: number; itersPerSec?: number; psnrTrain?: number }) => void,
    ): () => void;
    on(type: 'event', fn: (event: { kind: string; iter?: number; splats?: number }) => void): () => void;
    on(type: 'log', fn: (message: string) => void): () => void;
    load(files: Array<File | Blob | { source: Blob; name: string }>): Promise<unknown>;
    solve(extra?: { signal?: AbortSignal }): Promise<{ cams: unknown[]; points: unknown[] }>;
    seed(): Promise<{ n: number; center: number[]; radius: number }>;
    start(): void;
    pause(): void;
    finish(): Promise<void>;
    exportPlyBlob(): Promise<Blob>;
    dispose(): void;
  }

  export function createSession(opts?: {
    maxIters?: number;
    initTarget?: number;
    maxViewW?: number;
    maxViewH?: number;
    trainer?: { shDeg?: number; maxSplats?: number; capMult?: number };
    frames?: { trainMaxDim?: number; featMaxDim?: number; targetBudgetBytes?: number };
  }): SplatSession;
}
