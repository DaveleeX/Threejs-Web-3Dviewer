// Read-only source discovery: download published JS, never execute it.
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
for (const host of ['balloons.shader.se', 'infinite-liquid-glass.shader.se']) {
  const file = join(tmpdir(), `${host}.json`);
  let chunks;
  try { chunks = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`${host}: HTTP ${response.status}`);
    const html = await response.text();
    chunks = await Promise.all([...html.matchAll(/src=["']([^"']+\.js[^"']*)/g)].map(async match => {
      const url = new URL(match[1], `https://${host}`).href;
      if (new URL(url).host !== host) return null;
      const result = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!result.ok) throw new Error(`${url}: HTTP ${result.status}`);
      return { url, code: await result.text() };
    }));
    chunks = chunks.filter(Boolean);
  }
  const known = new Set(chunks.map(c => c.url));
  for (let index = 0; index < chunks.length && chunks.length < 45; index++) {
    for (const match of chunks[index].code.matchAll(/static\/immutable\/chunks\/[a-zA-Z0-9_-]+\.js/g)) {
      const url = `https://${host}/_next/${match[0]}`;
      if (known.has(url)) continue;
      known.add(url);
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (response.ok) chunks.push({ url, code: await response.text() });
    }
  }
  await writeFile(file, JSON.stringify(chunks));
  console.log(host, chunks.length, 'published chunks cached for inspection');
  for (const chunk of chunks) {
    const matches = [...chunk.code.matchAll(/.{0,100}(?:pressureForce|restVolume|compliance|pressure:|bevelWidth|sphereRadius|glassThickness|\.github\.com|github\.com\/(?!zloirock)).{0,150}/g)].slice(0,12).map(m => m[0]);
    if (matches.length) console.log(JSON.stringify({ url: chunk.url, sha256: createHash('sha256').update(chunk.code).digest('hex'), matches }));
  }
}
