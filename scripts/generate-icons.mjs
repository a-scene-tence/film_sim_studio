// scripts/generate-icons.mjs — 앱 아이콘 생성 (결정론, 4x4 슈퍼샘플)
import fs from 'node:fs';
import path from 'node:path';
import { encode } from 'fast-png';
const BG = [11, 11, 12], RING = [242, 242, 242], DOT = [255, 106, 26];
function shade(u, v, maskable) {
  // u,v in [0,1]; icon content scale: maskable keeps content within the 80% safe zone
  const s = maskable ? 0.8 : 1.0;
  const x = (u - 0.5) / s, y = (v - 0.5) / s, r = Math.hypot(x, y);
  if (!maskable) { const R = 0.5, cr = 0.22; const ax = Math.max(Math.abs(u - 0.5) - (R - cr), 0), ay = Math.max(Math.abs(v - 0.5) - (R - cr), 0); if (Math.hypot(ax, ay) > cr) return null; }
  if (r >= 0.255 && r <= 0.315) return RING;
  if (r <= 0.165) return [RING[0] * 0.92, RING[1] * 0.92, RING[2] * 0.92];
  if (Math.hypot(x - 0.3, y + 0.3) <= 0.055) return DOT;
  return BG;
}
function render(size, maskable) {
  const data = new Uint8Array(size * size * 4); const S = 4;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const c = shade((px + (sx + 0.5) / S) / size, (py + (sy + 0.5) / S) / size, maskable);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
    }
    const n = S * S, o = (py * size + px) * 4;
    data[o] = a ? Math.round(r / (a / 255)) : 0; data[o + 1] = a ? Math.round(g / (a / 255)) : 0; data[o + 2] = a ? Math.round(b / (a / 255)) : 0; data[o + 3] = Math.round(a / n);
  }
  return encode({ width: size, height: size, data, channels: 4, depth: 8 });
}
const dir = path.resolve('public/icons'); fs.mkdirSync(dir, { recursive: true });
for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
  fs.writeFileSync(path.join(dir, name), render(size, maskable)); console.log('wrote', name);
}
