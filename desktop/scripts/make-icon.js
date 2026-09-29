// Generates build/icon.png (512) and build/icon.ico (256/128/64/48/32/16, PNG-embedded)
// Hexagon (amber rim, dark core) with a cyan "Y". Pure Node — no dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'build');
fs.mkdirSync(OUT, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// geometry in unit space [0,1]
function hexPts(r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 90);
    pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  return pts;
}
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const OUTER = hexPts(0.48), INNER = hexPts(0.40);
const AMBER = [245, 166, 35], CORE = [16, 24, 38], CYAN = [34, 211, 238];
const Y_W = 0.055; // half stroke width
const cx = 0.5, cy = 0.53;
const SEGS = [
  [cx - 0.17, cy - 0.20, cx, cy],
  [cx + 0.17, cy - 0.20, cx, cy],
  [cx, cy, cx, cy + 0.21],
];
function sample(x, y) {
  if (!inPoly(x, y, OUTER)) return null;
  if (!inPoly(x, y, INNER)) return AMBER;
  for (const s of SEGS) if (segDist(x, y, ...s) <= Y_W) return CYAN;
  return CORE;
}
function render(size) {
  const SS = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const o = (py * size + px) * 4;
      if (a) { buf[o] = r / a; buf[o + 1] = g / a; buf[o + 2] = b / a; buf[o + 3] = Math.round((255 * a) / (SS * SS)); }
    }
  }
  return encodePNG(size, buf);
}

const sizes = [256, 128, 64, 48, 32, 16];
const pngs = sizes.map(render);
fs.writeFileSync(path.join(OUT, 'icon.png'), render(512));
fs.writeFileSync(path.join(OUT, 'tray.png'), render(32));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let offset = 6 + dir.length;
sizes.forEach((s, i) => {
  const o = i * 16;
  dir[o] = s >= 256 ? 0 : s; dir[o + 1] = s >= 256 ? 0 : s; dir[o + 2] = 0; dir[o + 3] = 0;
  dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(pngs[i].length, o + 8); dir.writeUInt32LE(offset, o + 12);
  offset += pngs[i].length;
});
fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([header, dir, ...pngs]));
console.log('icon: wrote build/icon.png, build/icon.ico, build/tray.png');
