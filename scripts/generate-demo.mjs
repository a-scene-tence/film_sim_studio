// scripts/generate-demo.mjs — 데모 사진 생성 (결정론). 사용: node scripts/generate-demo.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { scenePixel } from './demo-scene.mjs';
import encode, { init } from '@jsquash/jpeg/encode.js';
const require = createRequire(import.meta.url);
const piexif = require('piexifjs');
const W = 3000, H = 2000;
const OUT = path.resolve('public/demo/demo-scene.jpg');
const a = 1.3, ad = 1.196, b = 0.884006171, c = 0.452670345;
const tone = (x) => (x <= 0 ? 0 : x >= 2.04 ? 1 : Math.min(1, x ** a / (x ** ad * b + c)));
const enc = (y) => (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
const rgba = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const p = scenePixel(x, y, W, H); const o = (y * W + x) * 4;
  for (let i = 0; i < 3; i++) rgba[o + i] = Math.round(Math.min(1, Math.max(0, enc(tone(p[i])))) * 255);
  rgba[o + 3] = 255;
}
const wasmPath = require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm');
await init(await WebAssembly.compile(fs.readFileSync(wasmPath)));
const jpg = new Uint8Array(await encode({ data: rgba, width: W, height: H }, { quality: 90, auto_subsample: false, chroma_subsample: 1, progressive: true, optimize_coding: true }));
const exif = {
  '0th': { 271: 'FILM LAB', 272: 'Demo Scene', 274: 1, 282: [72, 1], 283: [72, 1], 296: 2, 305: 'Film Lab generate-demo 1.0', 306: '2026:10:16 06:39:00' },
  Exif: { 33434: [1, 250], 33437: [28, 10], 34855: 200, 36867: '2026:10:16 06:39:00', 36880: '+09:00', 36881: '+09:00', 37380: [0, 3], 37386: [35, 1], 40961: 1, 40962: W, 40963: H, 41989: 35, 42035: 'FILM LAB', 42036: 'Procedural 35mm F2' },
  GPS: { 0: [2, 3, 0, 0], 1: 'N', 2: [[37, 1], [33, 1], [5868, 100]], 3: 'E', 4: [[126, 1], [58, 1], [4044, 100]] },
  Interop: {}, '1st': {}, thumbnail: null,
};
piexif.TAGS.Exif[36880] = { name: 'OffsetTime', type: 'Ascii' };
piexif.TAGS.Exif[36881] = { name: 'OffsetTimeOriginal', type: 'Ascii' };
const bin = Array.from(jpg, (v) => String.fromCharCode(v)).join('');
const out = piexif.insert(piexif.dump(exif), bin);
const bytes = Uint8Array.from(out, (ch) => ch.charCodeAt(0));
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? crypto.createHash('sha256').update(fs.readFileSync(OUT)).digest('hex') : '';
  if (cur !== sha) { console.error(`demo mismatch: ${cur} != ${sha}`); process.exit(1); }
  console.log('demo ok', sha);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bytes);
  console.log('wrote', OUT, bytes.length, sha);
}
