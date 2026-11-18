// Converts the source HDR panoramas into web-sized RGBE files plus small PNG
// thumbnails for the sidebar. The originals run up to 3561x1779 / 18 MB, which
// is far more than a light probe needs: PMREM blurs them down to 256px anyway,
// while a separate original is retained for the default sharp background.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';

const SRC = 'F:/SynologyDrive/AI/Coding/RobotDogViewerWithAni/assets/hdr';
const OUT = resolve(process.cwd(), 'public/hdri');
const MAX_W = 1024;
const MAX_H = 512;
const THUMB_W = 128;

const JOBS = [
  { src: 'ConventionCenterSeating.hdr', out: 'interior-hall' },
  { src: 'Studio_Abstract2_sm.hdr', out: 'studio-abstract' },
  { src: 'GSG_PRO_STUDIOS_METAL_013_sm.hdr', out: 'studio-metal' },
  { src: 'Untitled.hdr', out: 'studio-strip' },
  { src: 'OureWhite.hdr', out: 'studio-white' },
];

// ------------------------------------------------------------------ RGBE read

function decodeHdr(buf) {
  let p = 0;
  const readLine = () => {
    let s = '';
    while (buf[p] !== 0x0a) s += String.fromCharCode(buf[p++]);
    p++;
    return s;
  };

  if (!readLine().startsWith('#?')) throw new Error('not a Radiance file');
  let line;
  while ((line = readLine()) !== '') {
    if (line.startsWith('FORMAT=') && !line.includes('32-bit_rle_rgbe')) throw new Error(`unsupported ${line}`);
  }

  const dims = readLine().match(/-Y (\d+) \+X (\d+)/);
  if (!dims) throw new Error('unsupported scanline order');
  const height = Number(dims[1]);
  const width = Number(dims[2]);

  const rgbe = new Uint8Array(width * height * 4);
  const row = new Uint8Array(width * 4);

  for (let y = 0; y < height; y++) {
    const isRle = buf[p] === 2 && buf[p + 1] === 2 && ((buf[p + 2] << 8) | buf[p + 3]) === width && width >= 8;

    if (isRle) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          const count = buf[p++];
          if (count > 128) {
            const value = buf[p++];
            for (let i = 0; i < count - 128; i++) row[(x++) * 4 + c] = value;
          } else {
            for (let i = 0; i < count; i++) row[(x++) * 4 + c] = buf[p++];
          }
        }
      }
      rgbe.set(row, y * width * 4);
    } else {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        rgbe[o] = buf[p++];
        rgbe[o + 1] = buf[p++];
        rgbe[o + 2] = buf[p++];
        rgbe[o + 3] = buf[p++];
      }
    }
  }

  // Match three.js RGBELoader: scale = 2^(e-128) / 255
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0, n = width * height; i < n; i++) {
    const e = rgbe[i * 4 + 3];
    const scale = e === 0 ? 0 : Math.pow(2, e - 128) / 255;
    rgb[i * 3] = rgbe[i * 4] * scale;
    rgb[i * 3 + 1] = rgbe[i * 4 + 1] * scale;
    rgb[i * 3 + 2] = rgbe[i * 4 + 2] * scale;
  }

  return { width, height, rgb };
}

// ----------------------------------------------------------------- area resize

function resize(src, sw, sh, dw, dh) {
  const dst = new Float32Array(dw * dh * 3);
  const xr = sw / dw;
  const yr = sh / dh;

  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * yr;
    const y1 = (dy + 1) * yr;
    for (let dx = 0; dx < dw; dx++) {
      const x0 = dx * xr;
      const x1 = (dx + 1) * xr;

      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;

      for (let sy = Math.floor(y0); sy < Math.min(Math.ceil(y1), sh); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (wy <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.min(Math.ceil(x1), sw); sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const o = (sy * sw + sx) * 3;
          r += src[o] * w;
          g += src[o + 1] * w;
          b += src[o + 2] * w;
          weight += w;
        }
      }

      const o = (dy * dw + dx) * 3;
      dst[o] = r / weight;
      dst[o + 1] = g / weight;
      dst[o + 2] = b / weight;
    }
  }

  return dst;
}

// ----------------------------------------------------------------- RGBE write

function encodeHdr(rgb, width, height) {
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, 'latin1');
  const chunks = [header];

  const comp = [new Uint8Array(width), new Uint8Array(width), new Uint8Array(width), new Uint8Array(width)];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      const r = Math.max(rgb[o], 0);
      const g = Math.max(rgb[o + 1], 0);
      const b = Math.max(rgb[o + 2], 0);
      const v = Math.max(r, g, b);

      if (v < 1e-32) {
        comp[0][x] = comp[1][x] = comp[2][x] = comp[3][x] = 0;
        continue;
      }

      const e = Math.min(255, Math.max(0, Math.ceil(Math.log2(v)) + 128));
      const scale = 255 / Math.pow(2, e - 128);
      comp[0][x] = Math.min(255, Math.round(r * scale));
      comp[1][x] = Math.min(255, Math.round(g * scale));
      comp[2][x] = Math.min(255, Math.round(b * scale));
      comp[3][x] = e;
    }

    const out = [Buffer.from([2, 2, (width >> 8) & 0xff, width & 0xff])];
    for (let c = 0; c < 4; c++) out.push(rleScanline(comp[c], width));
    chunks.push(Buffer.concat(out));
  }

  return Buffer.concat(chunks);
}

function rleScanline(data, width) {
  const out = [];
  let x = 0;

  while (x < width) {
    let run = 1;
    while (x + run < width && data[x + run] === data[x] && run < 127) run++;

    if (run >= 4) {
      out.push(128 + run, data[x]);
      x += run;
      continue;
    }

    const start = x;
    let literal = 0;
    while (x < width && literal < 128) {
      let ahead = 1;
      while (x + ahead < width && data[x + ahead] === data[x] && ahead < 4) ahead++;
      if (ahead >= 4) break;
      x++;
      literal++;
    }
    out.push(literal);
    for (let i = 0; i < literal; i++) out.push(data[start + i]);
  }

  return Buffer.from(out);
}

// ------------------------------------------------------------------ PNG thumb

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

/** Narkowicz ACES fit, matching the viewer's tone mapping closely enough. */
function aces(x) {
  const v = Math.max(x, 0);
  return Math.min(1, Math.max(0, (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14)));
}

function toSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function encodePng(rgb, width, height) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) raw[p++] = Math.round(toSrgb(aces(rgb[o + c])) * 255);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ----------------------------------------------------------------------- main

await mkdir(OUT, { recursive: true });

for (const job of JOBS) {
  const buf = await readFile(resolve(SRC, job.src));
  if (job.out === 'interior-hall') await writeFile(resolve(OUT, 'interior-hall-full.hdr'), buf);
  const { width, height, rgb } = decodeHdr(buf);

  const scale = Math.min(MAX_W / width, MAX_H / height, 1);
  const dw = Math.max(2, Math.round(width * scale));
  const dh = Math.max(2, Math.round(height * scale));
  const small = scale < 1 ? resize(rgb, width, height, dw, dh) : rgb;

  const hdr = encodeHdr(small, dw, dh);
  await writeFile(resolve(OUT, `${job.out}.hdr`), hdr);

  const th = Math.max(2, Math.round((THUMB_W * dh) / dw));
  const thumb = encodePng(resize(small, dw, dh, THUMB_W, th), THUMB_W, th);
  await writeFile(resolve(OUT, `${job.out}.png`), thumb);

  console.log(
    `[hdri] ${job.src.padEnd(34)} ${width}x${height} ${(buf.length / 1048576).toFixed(1)}MB` +
      ` -> ${job.out}.hdr ${dw}x${dh} ${(hdr.length / 1048576).toFixed(2)}MB` +
      ` + thumb ${(thumb.length / 1024).toFixed(1)}KB`,
  );
}
