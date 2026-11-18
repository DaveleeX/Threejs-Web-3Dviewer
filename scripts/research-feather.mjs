// Downloads upstream source for inspection only. Does not execute it or edit the application.
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { createHash } from 'node:crypto';
const base = 'https://raw.githubusercontent.com/ttillberg/codevember-2026/main/12/src/';
const queue = ['bird/index.ts', 'env/backdrop.ts', 'env/branch.ts', 'post.ts'];
const files = new Map();
while (queue.length) {
  const requested = queue.shift();
  if (files.has(requested)) continue;
  const candidates = requested.endsWith('.ts') ? [requested] : [`${requested}.ts`, `${requested}/index.ts`];
  let found = false;
  for (const path of candidates) {
    if (files.has(path)) { found = true; break; }
    const response = await fetch(base + path, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) continue;
    const text = await response.text();
    files.set(path, text); found = true;
    for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      const dependency = posix.normalize(posix.join(posix.dirname(path), match[1]));
      if (dependency.startsWith('../')) throw Error(`Out-of-tree dependency ${dependency}`);
      queue.push(dependency);
    }
    break;
  }
  if (!found) throw Error(`Missing source: ${requested}`);
}
const response = await fetch('https://raw.githubusercontent.com/ttillberg/codevember-2026/main/LICENSE');
if (!response.ok) throw Error('Missing license');
files.set('LICENSE', await response.text());
const directory = join(tmpdir(), 'viewer-feather-source-audit');
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'bundle.json'), JSON.stringify(Object.fromEntries(files)));
console.log(JSON.stringify([...files].map(([path, text]) => ({ path, bytes: text.length,
  sha256: createHash('sha256').update(text).digest('hex') })), null, 2));
