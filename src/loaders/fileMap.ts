/** A file plus the path it had inside the dropped selection/folder. */
export interface NamedFile {
  path: string;
  file: File;
}

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', '3mf', 'dae', 'usdz', 'vox'] as const;
export const SPLAT_EXTENSIONS = ['spz', 'splat', 'ksplat', 'sog'] as const;
export const ENV_EXTENSIONS = ['hdr', 'exr'] as const;
export const LUT_EXTENSIONS = ['cube', '3dl'] as const;

export function extensionOf(name: string): string {
  const clean = name.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  return dot < 0 ? '' : clean.slice(dot + 1).toLowerCase();
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function normalize(path: string): string {
  // Literal percent signs are legal in local filenames.
  try { path = decodeURI(path); } catch { /* Keep malformed URI text as a filename. */ }
  return path.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
}

/**
 * Resolves the sibling references inside multi-file formats (a .gltf pointing at
 * .bin and textures, or an .obj pointing at its .mtl) to blob URLs. Lookups fall
 * back to matching on file name alone, because users routinely drop a flat
 * selection of files that the manifest still references with folder prefixes.
 */
export class FileResolver {
  private readonly byPath = new Map<string, File>();
  private readonly byName = new Map<string, File>();
  private readonly urls = new Map<File, string>();

  constructor(files: NamedFile[]) {
    for (const { path, file } of files) {
      this.byPath.set(normalize(path), file);
      const name = normalize(baseName(path));
      // First writer wins so an exact path match is never shadowed by a duplicate name.
      if (!this.byName.has(name)) this.byName.set(name, file);
    }
  }

  find(request: string): File | undefined {
    const norm = normalize(request);
    const direct = this.byPath.get(norm);
    if (direct) return direct;

    for (const [path, file] of this.byPath) {
      if (path.endsWith('/' + norm) || norm.endsWith('/' + path)) return file;
    }

    return this.byName.get(normalize(baseName(norm)));
  }

  /** Creates (and remembers, for later revocation) a blob URL for a file. */
  url(file: File): string {
    const cached = this.urls.get(file);
    if (cached) return cached;
    const url = URL.createObjectURL(file);
    this.urls.set(file, url);
    return url;
  }

  resolveToUrl(request: string): string | undefined {
    const file = this.find(request);
    return file ? this.url(file) : undefined;
  }

  revokeAll(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

/** Reads a directory drop via the non-standard but universally shipped entries API. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<NamedFile[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  if (entries.length === 0) {
    return Array.from(dt.files).map((file) => ({ path: file.name, file }));
  }

  const out: NamedFile[] = [];
  await Promise.all(entries.map((entry) => walkEntry(entry, '', out)));
  return out;
}

function walkEntry(entry: FileSystemEntry, prefix: string, out: NamedFile[]): Promise<void> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => {
          out.push({ path: prefix + file.name, file });
          resolve();
        },
        () => resolve(),
      );
    });
  }

  if (!entry.isDirectory) return Promise.resolve();

  const reader = (entry as FileSystemDirectoryEntry).createReader();
  return new Promise((resolve) => {
    const children: FileSystemEntry[] = [];
    const readBatch = (): void => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            Promise.all(children.map((c) => walkEntry(c, `${prefix}${entry.name}/`, out))).then(() => resolve());
            return;
          }
          children.push(...batch);
          readBatch();
        },
        () => resolve(),
      );
    };
    readBatch();
  });
}

/** Turns an `<input type="file">` selection into paths, honouring folder picks. */
export function filesFromInput(list: FileList): NamedFile[] {
  return Array.from(list).map((file) => ({
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    file,
  }));
}
