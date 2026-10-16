// scripts/build-sw.mjs — out/ 를 스캔해 out/sw.js 생성 (next build 직후 실행)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
export const EXCLUDE = [/\.map$/, /^\/luts\/cube\//, /^\/sw\.js$/, /^\/\.DS_Store$/, /\/\.DS_Store$/];
export function listFiles(root) {
  const out = [];
  const walk = (dir) => { for (const name of fs.readdirSync(dir).sort()) { const p = path.join(dir, name); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else out.push('/' + path.relative(root, p).split(path.sep).join('/')); } };
  walk(root);
  return out.filter((u) => !EXCLUDE.some((re) => re.test(u)));
}
export function cleanUrl(u) {
  if (!u.endsWith('.html')) return u;
  const p = u.slice(0, -5);
  return p === '/index' ? '/' : p.endsWith('/index') ? p.slice(0, -6) : p;
}
export function computeVersion(root, files) {
  const h = crypto.createHash('sha256');
  for (const u of files) { h.update(u); h.update('\0'); h.update(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, u.slice(1)))).digest('hex')); h.update('\n'); }
  return h.digest('hex').slice(0, 16);
}
export function buildSw(root, templatePath) {
  const files = listFiles(root);
  const version = computeVersion(root, files);
  const tpl = fs.readFileSync(templatePath, 'utf8');
  const urls = files.map(cleanUrl);
  const code = tpl.replace("'__VERSION__'", JSON.stringify(version)).replace('__FILES__', JSON.stringify(urls));
  fs.writeFileSync(path.join(root, 'sw.js'), code);
  return { version, count: files.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve('out');
  const r = buildSw(root, path.resolve('scripts/sw-template.js'));
  console.log(`sw.js: ${r.count} files, version ${r.version}`);
}
