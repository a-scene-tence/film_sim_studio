// Step 4 §14 PWA · 자산 · 정적 라우팅 — T19 T20 T21 T22
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildSw, cleanUrl } from "../scripts/build-sw.mjs";

const ROOT = resolve(".");
const put = (root: string, rel: string, data: string | Uint8Array = "x") => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
};
const tmp = () => mkdtempSync(join(tmpdir(), "filmlab-pwa-"));

describe("T19 build-sw", () => {
  const fake = (): string => {
    const out = tmp();
    for (const f of ["index.html", "404.html", "lab/renderer.html", "luts/bin/a.bin", "luts/cube/a.cube", "_next/static/a.js", "_next/static/a.js.map", "sw.js"]) put(out, f, f);
    return out;
  };
  it("FILES 목록과 깨끗한 URL", () => {
    const out = fake();
    buildSw(out, join(ROOT, "scripts/sw-template.js"));
    const code = readFileSync(join(out, "sw.js"), "utf8");
    const files = JSON.parse(/const FILES = (\[[^\n]*\]);/.exec(code)![1]!);
    expect(files).toEqual(["/404", "/_next/static/a.js", "/", "/lab/renderer", "/luts/bin/a.bin"]);
    expect(code).not.toContain("__VERSION__");
    expect(code).not.toContain("__FILES__");
  });
  it("버전은 16자리 16진수, 결정론적, 내용이 바뀌면 달라진다", () => {
    const a = fake(), b = fake();
    const va = buildSw(a, join(ROOT, "scripts/sw-template.js")).version;
    const vb = buildSw(b, join(ROOT, "scripts/sw-template.js")).version;
    expect(va).toMatch(/^[0-9a-f]{16}$/);
    expect(va).toBe(vb);
    put(b, "luts/bin/a.bin", "changed");
    expect(buildSw(b, join(ROOT, "scripts/sw-template.js")).version).not.toBe(va);
    // 다시 빌드해도(out/sw.js 가 이미 있어도) 같은 버전
    expect(buildSw(a, join(ROOT, "scripts/sw-template.js")).version).toBe(va);
  });
  it("cleanUrl", () => {
    expect(cleanUrl("/index.html")).toBe("/");
    expect(cleanUrl("/a/b.html")).toBe("/a/b");
    expect(cleanUrl("/x/index.html")).toBe("/x");
    expect(cleanUrl("/a.js")).toBe("/a.js");
  });
});

describe("T20 sw-template", () => {
  const load = () => {
    const out = fake2();
    buildSw(out, join(ROOT, "scripts/sw-template.js"));
    const code = readFileSync(join(out, "sw.js"), "utf8");
    const listeners: string[] = [];
    const ctx = vm.createContext({ self: { addEventListener: (t: string) => listeners.push(t), location: { origin: "http://localhost" } }, Response, Request, URL });
    new vm.Script(code).runInContext(ctx);
    return { ctx: ctx as unknown as { navKey(p: string): string }, listeners, code };
  };
  const fake2 = () => { const out = tmp(); put(out, "index.html"); put(out, "404.html"); return out; };
  it("치환한 코드를 vm.Script 로 컴파일하고 이벤트를 등록한다", () => {
    const { listeners, code } = load();
    expect(listeners).toEqual(["install", "message", "activate", "fetch"]);
    expect(code).toMatch(/const VERSION = "[0-9a-f]{16}";/);
  });
  it("navKey", () => {
    const { ctx } = load();
    expect(ctx.navKey("/")).toBe("/");
    expect(ctx.navKey("/index.html")).toBe("/");
    expect(ctx.navKey("/lab/renderer/")).toBe("/lab/renderer");
    expect(ctx.navKey("/lab/renderer.html")).toBe("/lab/renderer");
    expect(ctx.navKey("")).toBe("/");
  });
  it("구버전 캐시 전량 삭제·skipWaiting·clients.claim, 문서/매니페스트는 네트워크 우선", () => {
    const { code } = load();
    expect(code).toContain("self.skipWaiting()");
    expect(code).toContain("self.clients.claim()");
    expect(code).toContain("keys.filter((k) => k !== PRECACHE && k !== RUNTIME)");
    expect(code).toContain("const CACHE_GEN = 'v2'");
    expect(code).toContain("'/manifest.webmanifest', '/manifest.json'");
    const nav = code.slice(code.indexOf("req.mode === 'navigate'"), code.indexOf("NETWORK_FIRST_PATHS.includes"));
    expect(nav.indexOf("await fetch(req")).toBeGreaterThan(-1);
    expect(nav.indexOf("await fetch(req")).toBeLessThan(nav.indexOf("cache.match(navKey"));
  });
  it("워커 스크립트는 #params 를 잃지 않도록 URL 없는 새 Response 로 돌려준다 (Turbopack 워커 부트스트랩)", () => {
    expect(load().code).toContain("forWorker");
  });
});

describe("T21 자산", () => {
  const sof = (b: Buffer) => {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1]!;
      if (m === 0xc0 || m === 0xc1 || m === 0xc2) return { w: (b[i + 7]! << 8) | b[i + 8]!, h: (b[i + 5]! << 8) | b[i + 6]! };
      i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
    }
    return null;
  };
  it("데모 JPEG: 3000×2000, EXIF", async () => {
    const b = readFileSync("public/demo/demo-scene.jpg");
    expect(sof(b)).toEqual({ w: 3000, h: 2000 });
    const exifr = (await import("exifr")).default;
    const t = (await exifr.parse(b, { gps: true, translateKeys: true, translateValues: false, reviveValues: true, mergeOutput: true } as never)) as Record<string, unknown>;
    expect(t.Make).toBe("FILM LAB");
    expect(t.Model).toBe("Demo Scene");
    expect(t.FNumber).toBe(2.8);
    expect(t.ExposureTime).toBe(0.004);
    expect(t.ISO).toBe(200);
    expect(Math.abs(Number(t.latitude) - 37.5663)).toBeLessThan(1e-4);
    expect(Math.abs(Number(t.longitude) - 126.9779)).toBeLessThan(1e-4);
  });
  it("아이콘 PNG IHDR 크기", () => {
    for (const [f, n] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable-512.png", 512], ["apple-touch-icon.png", 180]] as const) {
      const b = readFileSync(join("public/icons", f));
      expect(b.subarray(1, 4).toString()).toBe("PNG");
      expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([n, n]);
    }
  });
});

describe("T22 정적 라우팅 회귀 (check-export)", () => {
  const run = (proj: string) => spawnSync(process.execPath, [join(ROOT, "scripts/check-export.mjs")], { cwd: proj, encoding: "utf8" });
  const project = (opts: { index: boolean }): string => {
    const p = tmp();
    put(p, "src/app/page.tsx");
    put(p, "src/app/lab/renderer/page.tsx");
    const pub: Record<string, string | Uint8Array> = {
      "luts/manifest.json": "{}", "icons/icon-192.png": "x", "icons/icon-512.png": "x", "icons/icon-maskable-512.png": "x", "icons/apple-touch-icon.png": "x",
      "vendor/jsquash-jpeg/1.6.0/mozjpeg_enc.wasm": "wasm",
    };
    for (let i = 0; i < 32; i++) pub[`luts/bin/s${i}.bin`] = "b";
    const demo = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from("Exif\0\0FILM LAB"), Buffer.alloc(120000, 1)]);
    pub["demo/demo-scene.jpg"] = demo;
    for (const [k, v] of Object.entries(pub)) { put(p, join("public", k), v); put(p, join("out", k), v); }
    if (opts.index) put(p, "out/index.html", '<html><head><link rel="manifest" href="/manifest.webmanifest"/><meta name="apple-mobile-web-app-capable" content="yes"/><meta name="mobile-web-app-capable" content="yes"/><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/><meta name="viewport" content="viewport-fit=cover"/><link rel="apple-touch-icon" href="/i.png"/></head></html>');
    put(p, "out/lab/renderer.html", "<html/>");
    put(p, "out/404.html", "<html/>");
    const mf = JSON.stringify({
      name: "Film Lab", short_name: "Film Lab", start_url: "/", scope: "/", display: "standalone", background_color: "#09090b", theme_color: "#09090b",
      icons: [{ src: "/icons/icon-192.png" }, { src: "/icons/icon-512.png" }, { src: "/icons/icon-maskable-512.png", purpose: "maskable" }],
    });
    put(p, "out/manifest.webmanifest", mf);
    put(p, "out/manifest.json", mf);
    const files = ["/", "/404", "/manifest.webmanifest", "/luts/manifest.json", "/demo/demo-scene.jpg", "/icons/icon-192.png", "/vendor/jsquash-jpeg/1.6.0/mozjpeg_enc.wasm", ...Array.from({ length: 32 }, (_, i) => `/luts/bin/s${i}.bin`)];
    put(p, "out/sw.js", `const FILES = ${JSON.stringify(files)};\n`);
    return p;
  };
  it("out/index.html 이 없으면 exit 1", () => {
    const r = run(project({ index: false }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("missing out/index.html");
  });
  it("모두 갖추면 exit 0", () => {
    const r = run(project({ index: true }));
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("check-export ok");
  });
  it("프로젝트 자체 public/ 의 필수 자산이 존재한다", () => {
    for (const f of ["demo/demo-scene.jpg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "luts/manifest.json"]) expect(existsSync(join("public", f))).toBe(true);
  });
});

describe("standalone PWA 메타 · 데모 버튼 제거 (빌드 산출물)", () => {
  const html = existsSync("out/index.html") ? readFileSync("out/index.html", "utf8") : null;
  it.skipIf(html === null)("out/index.html 에 standalone 태그가 있다", () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style" content="black-translucent"');
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain('rel="apple-touch-icon"');
  });
  it("out/manifest.json 이 webmanifest 와 동일하고 WebAPK 규격을 따른다", () => {
    if (!existsSync("out/manifest.json")) return;
    const a = JSON.parse(readFileSync("out/manifest.json", "utf8"));
    expect(a).toEqual(JSON.parse(readFileSync("out/manifest.webmanifest", "utf8")));
    expect(a).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone", display_override: ["standalone", "fullscreen"], orientation: "portrait", background_color: "#09090b", theme_color: "#09090b" });
    expect(a.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });
  it.skipIf(html === null)("메타 태그는 <head> 안에 있다", () => {
    const head = html!.slice(html!.indexOf("<head"), html!.indexOf("</head>"));
    for (const t of ['rel="manifest"', 'name="apple-mobile-web-app-capable" content="yes"', 'name="mobile-web-app-capable" content="yes"']) expect(head).toContain(t);
  });
  it("시작 화면에 설치 카드·캐시 초기화 버튼이 있다", () => {
    const src = readFileSync("src/components/studio/InstallCard.tsx", "utf8");
    expect(src).toContain("앱으로 설치하기 (전체화면)");
    expect(src).toContain("구버전 캐시 초기화");
    expect(readFileSync("src/lib/pwa/install-hints.ts", "utf8")).toContain("unregister()");
  });
  it("시작 화면 소스에 데모 버튼이 없다", () => {
    const src = readFileSync("src/components/studio/EmptyState.tsx", "utf8");
    expect(src).not.toContain("데모");
    expect(src).not.toContain("onDemo");
  });
});
