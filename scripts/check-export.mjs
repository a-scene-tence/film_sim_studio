// scripts/check-export.mjs — 정적 export 산출물 검증 (npm run build 직후 실행, npm run verify 에 포함)
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('out'), PUB = path.resolve('public'), APP = path.resolve('src/app');
const errors = [];
const exists = (rel) => fs.existsSync(path.join(OUT, rel));
const must = (rel) => { if (!exists(rel)) errors.push('missing out/' + rel); };
function walk(dir, base, acc) { if (!fs.existsSync(dir)) return acc; for (const n of fs.readdirSync(dir).sort()) { const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) walk(p, base, acc); else acc.push(path.relative(base, p).split(path.sep).join('/')); } return acc; }
// 1) src/app 의 모든 page.tsx → out/<route>.html (trailingSlash:false 규칙)
for (const f of walk(APP, APP, [])) {
  if (!/(^|\/)page\.tsx$/.test(f)) continue;
  const segs = f.split('/').slice(0, -1).filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  if (segs.some((s) => s.startsWith('[') || s.startsWith('@'))) { errors.push('dynamic/parallel route is not allowed in static export: src/app/' + f); continue; }
  must(segs.length ? segs.join('/') + '.html' : 'index.html');
}
// 2) 고정 산출물
for (const rel of ['404.html', 'manifest.webmanifest', 'sw.js', 'luts/manifest.json', 'demo/demo-scene.jpg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'vendor/jsquash-jpeg/1.6.0/mozjpeg_enc.wasm']) must(rel);
// 3) public/ 전체가 out/ 에 복사되었는지
for (const rel of walk(PUB, PUB, [])) { if (rel.endsWith('.DS_Store')) continue; must(rel); }
// 4) LUT 바이너리 32개
const bins = walk(path.join(OUT, 'luts/bin'), path.join(OUT, 'luts/bin'), []).filter((f) => f.endsWith('.bin'));
if (bins.length !== 32) errors.push('out/luts/bin/*.bin count ' + bins.length + ' != 32');
// 5) 데모 JPEG: SOI + EXIF(APP1 'Exif') + 크기
if (exists('demo/demo-scene.jpg')) {
  const b = fs.readFileSync(path.join(OUT, 'demo/demo-scene.jpg'));
  if (!(b[0] === 0xff && b[1] === 0xd8)) errors.push('demo-scene.jpg is not a JPEG');
  if (b.indexOf(Buffer.from('Exif\0\0', 'binary')) < 0) errors.push('demo-scene.jpg has no EXIF');
  if (b.indexOf(Buffer.from('FILM LAB', 'binary')) < 0) errors.push('demo-scene.jpg EXIF Make missing');
  if (b.length < 100000) errors.push('demo-scene.jpg too small: ' + b.length);
}
// 6) manifest.webmanifest 필수 필드
if (exists('manifest.webmanifest')) {
  const m = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.webmanifest'), 'utf8'));
  for (const [k, v] of [['name', 'Film Lab'], ['short_name', 'Film Lab'], ['start_url', '/'], ['scope', '/'], ['display', 'standalone'], ['background_color', '#09090b'], ['theme_color', '#09090b']]) if (m[k] !== v) errors.push('manifest.' + k + ' = ' + JSON.stringify(m[k]) + ' (expected ' + JSON.stringify(v) + ')');
  const icons = Array.isArray(m.icons) ? m.icons : [];
  for (const src of ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png']) if (!icons.some((i) => i.src === src)) errors.push('manifest icon missing: ' + src);
  if (!icons.some((i) => i.purpose === 'maskable')) errors.push('manifest has no maskable icon');
}
// 6b) standalone PWA 메타 태그 (index.html)
if (exists('index.html')) {
  const h = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  for (const t of ['rel="manifest"', 'name="apple-mobile-web-app-capable" content="yes"', 'name="mobile-web-app-capable" content="yes"', 'name="apple-mobile-web-app-status-bar-style" content="black-translucent"', 'viewport-fit=cover', 'rel="apple-touch-icon"']) if (!h.includes(t)) errors.push('index.html missing ' + t);
}
// 7) sw.js 프리캐시 목록
if (exists('sw.js')) {
  const code = fs.readFileSync(path.join(OUT, 'sw.js'), 'utf8');
  if (code.includes('__VERSION__') || code.includes('__FILES__')) errors.push('sw.js placeholders not replaced');
  const m = code.match(/const FILES = (\[[^\n]*\]);/);
  if (!m) errors.push('sw.js FILES array not found');
  else {
    const files = new Set(JSON.parse(m[1]));
    for (const b of bins) if (!files.has('/luts/bin/' + b)) errors.push('sw.js missing /luts/bin/' + b);
    for (const w of walk(OUT, OUT, []).filter((f) => f.endsWith('.wasm'))) if (!files.has('/' + w)) errors.push('sw.js missing /' + w);
    for (const u of ['/', '/404', '/manifest.webmanifest', '/luts/manifest.json', '/demo/demo-scene.jpg', '/icons/icon-192.png']) if (!files.has(u)) errors.push('sw.js missing ' + u);
    for (const u of files) if (u.endsWith('.html')) errors.push('sw.js must use clean URLs, found ' + u);
  }
}
if (errors.length) { console.error('check-export FAILED (' + errors.length + ')'); for (const e of errors) console.error(' - ' + e); process.exit(1); }
console.log('check-export ok: ' + bins.length + ' LUT bins, sw/manifest/demo/icons verified');
