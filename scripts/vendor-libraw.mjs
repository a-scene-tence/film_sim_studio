// libraw-wasm 1.6.0 을 번들러 밖의 정적 경로로 복사한다 (CLAUDE.md §2-11). 결정론적: 같은 입력 → 같은 출력.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "1.6.0";
const pkgDir = join(root, "node_modules", "libraw-wasm");
const FILES = ["index.js", "libraw.js", "libraw.wasm", "worker.js"];

let installed;
try {
  installed = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
} catch {
  console.error("vendor-libraw: node_modules/libraw-wasm 을 찾을 수 없습니다. npm ci 를 먼저 실행하세요.");
  process.exit(1);
}
if (installed !== VERSION) {
  console.error(`vendor-libraw: libraw-wasm 버전이 ${installed} 입니다. 정확히 ${VERSION} 이어야 합니다.`);
  process.exit(1);
}

const outDir = join(root, "public", "vendor", "libraw-wasm", VERSION);
mkdirSync(outDir, { recursive: true });
/** @type {Record<string, string>} */
const files = {};
for (const f of FILES) {
  copyFileSync(join(pkgDir, "dist", f), join(outDir, f));
  files[f] = createHash("sha256").update(readFileSync(join(outDir, f))).digest("hex");
}
const meta = { package: "libraw-wasm", version: VERSION, files };
writeFileSync(join(outDir, "VERSION.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(`vendor-libraw: ${VERSION} → public/vendor/libraw-wasm/${VERSION}/ (${FILES.length}개)`);
