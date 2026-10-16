// scripts/serve-out.mjs — out/ 정적 미리보기 서버 (Vercel cleanUrls + 헤더 재현). 사용: node scripts/serve-out.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve('out');
const PORT = Number(process.argv[2] || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bin': 'application/octet-stream', '.cube': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
const BASE = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' };
function resolve(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.includes('..')) return null;
  if (p === '/') return path.join(ROOT, 'index.html');
  const direct = path.join(ROOT, p);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  const html = path.join(ROOT, p.replace(/\/$/, '') + '.html');
  if (fs.existsSync(html)) return html;
  return null;
}
http.createServer((req, res) => {
  const u = req.url || '/';
  const pathname = u.split('?')[0];
  if (pathname.endsWith('.html')) {
    const clean = pathname === '/index.html' ? '/' : pathname.slice(0, -5);
    res.writeHead(308, Object.assign({}, BASE, { Location: clean })); res.end(); return;
  }
  const file = resolve(u);
  const headers = Object.assign({}, BASE);
  if (pathname === '/sw.js') { headers['Cache-Control'] = 'no-cache'; headers['Service-Worker-Allowed'] = '/'; }
  if (!file) { const nf = path.join(ROOT, '404.html'); res.writeHead(404, Object.assign({}, headers, { 'Content-Type': TYPES['.html'] })); res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'Not Found'); return; }
  res.writeHead(200, Object.assign({}, headers, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }));
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`serving out/ at http://localhost:${PORT}`));
