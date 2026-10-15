import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LUT_SIZE } from "@/lib/color/fse/constants.mjs";
import { renderPoint, shaperDec, shaperEnc, srgbDec, toneCoeffs, toneInv } from "@/lib/color/fse/engine.mjs";
import { FILM_SIMS } from "@/lib/color/fse/film-params.mjs";
import { tetraSample } from "@/lib/color/fse/tetra.mjs";
import { decodeBinLut } from "@/lib/lut/binLut";

const LUT_DIR = join(process.cwd(), "public", "luts");
const N = LUT_SIZE;

function loadBin(id: string): Float32Array {
  const b = readFileSync(join(LUT_DIR, "bin", `${id}.bin`));
  return decodeBinLut(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, N);
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toWs = (c: number[]): [number, number, number] => [
  toneInv(srgbDec(c[0]! / 255)),
  toneInv(srgbDec(c[1]! / 255)),
  toneInv(srgbDec(c[2]! / 255)),
];

function maxErr(lut: Float32Array, p: (typeof FILM_SIMS)[number], k: ReturnType<typeof toneCoeffs>, x: [number, number, number]) {
  const a = tetraSample(lut, N, [shaperEnc(x[0]), shaperEnc(x[1]), shaperEnc(x[2])]);
  const b = renderPoint(x, p, k);
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

const PATCHES = [
  [115,82,68],[194,150,130],[98,122,157],[87,108,67],[133,128,177],[103,189,170],[214,126,44],[80,91,166],
  [193,90,99],[94,60,108],[157,188,64],[224,163,46],[56,61,150],[70,148,73],[175,54,60],[231,199,31],
  [187,86,149],[8,133,161],[243,243,242],[200,200,200],[160,160,160],[122,122,121],[85,85,85],[52,52,52],
];

describe("§7 tetraSample", () => {
  it("항등 LUT(N=33) → 입력 그대로 (±1e-6)", () => {
    const id = new Float32Array(N * N * N * 3);
    let o = 0;
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      id[o++] = r / (N - 1);
      id[o++] = g / (N - 1);
      id[o++] = b / (N - 1);
    }
    const rnd = mulberry32(1);
    for (let i = 0; i < 2000; i++) {
      const u: [number, number, number] = [rnd(), rnd(), rnd()];
      const v = tetraSample(id, N, u);
      for (let c = 0; c < 3; c++) expect(Math.abs(v[c]! - u[c]!)).toBeLessThanOrEqual(1e-6);
    }
    expect(tetraSample(id, N, [1, 1, 1])).toEqual([1, 1, 1]);
    // 셰이퍼 격자 왕복
    expect(Math.abs(shaperEnc(shaperDec(0.25)) - 0.25)).toBeLessThan(1e-12);
  });
});

describe("생성된 .bin vs renderPoint", () => {
  it.each(FILM_SIMS.map((p) => [p.id, p] as const))("%s: ColorChecker 24 최대오차 ≤ 0.02, 무작위 4096색 p95 ≤ 0.016", (id, p) => {
    const lut = loadBin(id);
    const k = toneCoeffs(p.tone);
    let worst = 0;
    for (const c of PATCHES) worst = Math.max(worst, maxErr(lut, p, k, toWs(c)));
    expect(worst).toBeLessThanOrEqual(0.02);

    const rnd = mulberry32(777);
    const errs: number[] = [];
    for (let i = 0; i < 4096; i++) {
      const c = [Math.round(rnd() * 255), Math.round(rnd() * 255), Math.round(rnd() * 255)];
      errs.push(maxErr(lut, p, k, toWs(c)));
    }
    errs.sort((a, b) => a - b);
    const p95 = errs[Math.ceil(0.95 * errs.length) - 1]!;
    expect(p95).toBeLessThanOrEqual(0.016);
  });
});

describe("manifest.json", () => {
  const manifest = JSON.parse(readFileSync(join(LUT_DIR, "manifest.json"), "utf8")) as {
    sims: { id: string; order: number; cube: string; bin: string; sha256Cube: string; sha256Bin: string }[];
  };
  it("sims 32개, 순서 = FILM_SIMS", () => {
    expect(manifest.sims).toHaveLength(32);
    expect(manifest.sims.map((s) => s.id)).toEqual(FILM_SIMS.map((p) => p.id));
    manifest.sims.forEach((s, i) => expect(s.order).toBe(i));
  });
  it("파일 sha256 일치", () => {
    const sha = (rel: string) => createHash("sha256").update(readFileSync(join(process.cwd(), "public", rel))).digest("hex");
    for (const s of manifest.sims) {
      expect(sha(s.cube)).toBe(s.sha256Cube);
      expect(sha(s.bin)).toBe(s.sha256Bin);
    }
  });
});
