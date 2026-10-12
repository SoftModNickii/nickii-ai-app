// Writes placeholder app icons (a soft dotted head shape on the Ghost background) as PNG.
// Replace the files in apps/*/public/icons with Nickii's real icon when it exists.
// Usage: node scripts/make_placeholder_icons.mjs <output dir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const BG = [0xfc, 0xf5, 0xf6];
const DOT = [0xb2, 0x3e, 0x66];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, padding) {
  const px = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) BG.forEach((v, j) => (px[i * 3 + j] = v));
  // Dots on an egg-shaped head outline and a few inside, like a sparse point cloud.
  const cx = size / 2, cy = size / 2;
  const inner = size / 2 - padding;
  const rx = inner * 0.62, ry = inner * 0.8;
  const r = Math.max(1, size / 90);
  const dots = [];
  for (let ring = 0; ring < 7; ring++) {
    const f = 1 - ring * 0.14;
    const n = Math.round(48 * f);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + ring * 0.37;
      const squash = 1 + 0.12 * Math.sin(a); // narrower chin
      dots.push([cx + Math.cos(a) * rx * f / squash, cy + Math.sin(a) * ry * f, 1 - ring * 0.11]);
    }
  }
  for (const [x, y, alpha] of dots) {
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) {
      for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const d = Math.hypot(xx - x, yy - y);
        if (d > r) continue;
        const a = alpha * Math.min(1, r - d + 0.5);
        const i = (yy * size + xx) * 3;
        DOT.forEach((v, j) => (px[i + j] = Math.round(px[i + j] * (1 - a) + v * a)));
      }
    }
  }
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = process.argv[2];
if (!out) throw new Error('usage: node scripts/make_placeholder_icons.mjs <output dir>');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon-192.png'), png(192, 20));
writeFileSync(join(out, 'icon-512.png'), png(512, 50));
writeFileSync(join(out, 'icon-maskable-512.png'), png(512, 110)); // content inside the safe zone
writeFileSync(join(out, 'apple-touch-icon-180.png'), png(180, 22));
console.log('icons written to', out);
