// Genera los íconos PNG de la PWA (sin dependencias: encoder PNG propio con zlib)
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Dibuja una mira/objetivo sobre fondo oscuro
function draw(N) {
  const rgba = Buffer.alloc(N * N * 4);
  const cx = N / 2, cy = N / 2;
  const ringR = N * 0.33, ringT = N * 0.05;
  const lineT = N * 0.022, lineLen = N * 0.46;
  const dotR = N * 0.055;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const t = y / N;
    let r = 12 + t * 10, g = 16 + t * 12, b = 24 + t * 18; // fondo degradado
    const dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy);
    if (Math.abs(dist - ringR) < ringT) { r = 248; g = 197; b = 55; }
    if ((Math.abs(dx) < lineT && dist < lineLen) || (Math.abs(dy) < lineT && dist < lineLen)) { r = 248; g = 197; b = 55; }
    if (dist < dotR) { r = 226; g = 59; b = 46; }
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  return rgba;
}

const dir = path.join(root, 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const N of [192, 512]) {
  fs.writeFileSync(path.join(dir, `icon-${N}.png`), png(N, N, draw(N)));
  console.log(`icon-${N}.png generado`);
}
