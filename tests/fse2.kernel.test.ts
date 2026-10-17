// FSE-v2 색 전용 LUT 커널 (U1 커널 골든, U2 LUT 굽기, U3 manifest)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LUT_SIZE } from "@/lib/color/fse/constants.mjs";
import { FILM_SIMS } from "@/lib/color/fse/film-params.mjs";
import { tetraSample } from "@/lib/color/fse/tetra.mjs";
import { decodeBinLut } from "@/lib/lut/binLut";
import { linToOklab, renderPoint2, shaperEnc, SIMS2, srgbEnc, toneRef } from "../scripts/fse2-kernel.mjs";

type V3 = [number, number, number];
type Sim = (typeof SIMS2)[keyof typeof SIMS2];
const sim = (id: string): Sim => SIMS2[id as keyof typeof SIMS2];
const rp = (x: V3, id: string) => renderPoint2(x, sim(id)) as number[];
const near3 = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number) => {
  for (let c = 0; c < 3; c++) expect(Math.abs(a[c]! - b[c]!)).toBeLessThanOrEqual(tol);
};
const srgbDec = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

const PROBES: V3[] = [[0.580411, 0.289008, 0.210126], [0.120523, 0.184135, 0.322443], [0.427355, 0.044488, 0.05239], [0.06, 0.11, 0.035]];

// 4-4 골든: skin | sky | red | foliage
const GOLDEN: Record<string, number[][]> = {
  "fuji-provia": [[0.760553, 0.588426, 0.509247], [0.381154, 0.478453, 0.620354], [0.686269, 0.211745, 0.235467], [0.260040, 0.364933, 0.174115]],
  "fuji-velvia": [[0.770138, 0.563207, 0.481218], [0.322060, 0.424492, 0.592787], [0.699534, 0.087969, 0.201263], [0.240763, 0.358615, 0.110262]],
  "fuji-astia": [[0.765281, 0.596519, 0.515108], [0.357909, 0.460068, 0.606650], [0.690625, 0.217880, 0.230256], [0.261199, 0.363236, 0.176422]],
  "fuji-classic-chrome": [[0.731301, 0.587541, 0.506299], [0.388284, 0.476859, 0.565565], [0.629971, 0.255883, 0.226479], [0.270596, 0.326233, 0.198223]],
  "fuji-reala-ace": [[0.762133, 0.578257, 0.494247], [0.354481, 0.457516, 0.606559], [0.693808, 0.161597, 0.206423], [0.250245, 0.362112, 0.156410]],
  "fuji-pro-neg-hi": [[0.757572, 0.599867, 0.520725], [0.388414, 0.479372, 0.612194], [0.673316, 0.241728, 0.237879], [0.267135, 0.360224, 0.193057]],
  "fuji-pro-neg-std": [[0.751835, 0.602517, 0.526759], [0.396094, 0.479756, 0.602650], [0.660454, 0.259388, 0.246981], [0.257894, 0.360113, 0.215454]],
  "fuji-classic-neg": [[0.759504, 0.568905, 0.486644], [0.377625, 0.471394, 0.580513], [0.667388, 0.168609, 0.282451], [0.216468, 0.356695, 0.206827]],
  "fuji-nostalgic-neg": [[0.785309, 0.595291, 0.465958], [0.382731, 0.478351, 0.592605], [0.695757, 0.226291, 0.196850], [0.280499, 0.359870, 0.184913]],
  "fuji-eterna": [[0.741058, 0.597534, 0.525187], [0.399715, 0.485034, 0.583543], [0.641493, 0.273561, 0.267932], [0.262181, 0.355365, 0.234176]],
  "fuji-eterna-bleach-bypass": [[0.750019, 0.595492, 0.526549], [0.399897, 0.482211, 0.605375], [0.667736, 0.256651, 0.264783], [0.261750, 0.355171, 0.206513]],
  "fuji-acros": [[0.632873, 0.632873, 0.632873], [0.473893, 0.473893, 0.473893], [0.394411, 0.394411, 0.394411], [0.334561, 0.334561, 0.334561]],
  "fuji-acros-ye": [[0.656349, 0.656349, 0.656349], [0.458943, 0.458943, 0.458943], [0.456229, 0.456229, 0.456229], [0.328496, 0.328496, 0.328496]],
  "fuji-acros-r": [[0.692033, 0.692033, 0.692033], [0.441158, 0.441158, 0.441158], [0.546093, 0.546093, 0.546093], [0.307029, 0.307029, 0.307029]],
  "fuji-acros-g": [[0.622192, 0.622192, 0.622192], [0.476029, 0.476029, 0.476029], [0.358528, 0.358528, 0.358528], [0.341681, 0.341681, 0.341681]],
  "fuji-monochrome": [[0.632873, 0.632873, 0.632873], [0.473893, 0.473893, 0.473893], [0.394411, 0.394411, 0.394411], [0.334561, 0.334561, 0.334561]],
  "fuji-monochrome-ye": [[0.656349, 0.656349, 0.656349], [0.458943, 0.458943, 0.458943], [0.456229, 0.456229, 0.456229], [0.328496, 0.328496, 0.328496]],
  "fuji-monochrome-r": [[0.692033, 0.692033, 0.692033], [0.441158, 0.441158, 0.441158], [0.546093, 0.546093, 0.546093], [0.307029, 0.307029, 0.307029]],
  "fuji-monochrome-g": [[0.622192, 0.622192, 0.622192], [0.476029, 0.476029, 0.476029], [0.358528, 0.358528, 0.358528], [0.341681, 0.341681, 0.341681]],
  "fuji-sepia": [[0.709342, 0.615130, 0.517502], [0.545820, 0.456488, 0.363060], [0.463606, 0.377155, 0.286038], [0.401408, 0.317394, 0.228074]],
  "ricoh-standard": [[0.760784, 0.588236, 0.509804], [0.384313, 0.478431, 0.615686], [0.686274, 0.211765, 0.235293], [0.260037, 0.364933, 0.174118]],
  "ricoh-vivid": [[0.775335, 0.581126, 0.489369], [0.345401, 0.456936, 0.614888], [0.714960, 0.152644, 0.197053], [0.251352, 0.371989, 0.145573]],
  "ricoh-positive-film": [[0.768967, 0.570774, 0.453277], [0.319349, 0.437058, 0.597278], [0.696461, 0.124367, 0.142803], [0.226595, 0.360313, 0.164606]],
  "ricoh-negative-film": [[0.751828, 0.594719, 0.509714], [0.394411, 0.483496, 0.588636], [0.652475, 0.264808, 0.251884], [0.251201, 0.360209, 0.227511]],
  "ricoh-bleach-bypass": [[0.750020, 0.595492, 0.526549], [0.399897, 0.482211, 0.605375], [0.667877, 0.256501, 0.264643], [0.260780, 0.356224, 0.195748]],
  "ricoh-retro": [[0.767489, 0.593839, 0.479312], [0.402426, 0.479628, 0.562203], [0.659075, 0.261966, 0.263723], [0.287726, 0.355853, 0.199244]],
  "ricoh-cross-process": [[0.779109, 0.584155, 0.423908], [0.335608, 0.484563, 0.609334], [0.712086, 0.130747, 0.185958], [0.275328, 0.380572, 0.178468]],
  "ricoh-hdr-tone": [[0.760784, 0.588236, 0.509804], [0.384313, 0.478431, 0.615686], [0.686274, 0.211765, 0.235293], [0.256187, 0.365552, 0.180367]],
  "ricoh-monotone": [[0.632873, 0.632873, 0.632873], [0.473893, 0.473893, 0.473893], [0.394411, 0.394411, 0.394411], [0.334561, 0.334561, 0.334561]],
  "ricoh-soft-monotone": [[0.632873, 0.632873, 0.632873], [0.473893, 0.473893, 0.473893], [0.394411, 0.394411, 0.394411], [0.334561, 0.334561, 0.334561]],
  "ricoh-hard-monotone": [[0.632873, 0.632873, 0.632873], [0.473893, 0.473893, 0.473893], [0.394411, 0.394411, 0.394411], [0.334561, 0.334561, 0.334561]],
  "ricoh-hi-contrast-bw": [[0.632873, 0.632873, 0.632873], [0.473893, 0.473893, 0.473893], [0.394411, 0.394411, 0.394411], [0.334561, 0.334561, 0.334561]],
};

// 4-4 split·tint 필름 회색 출력 (0.18 | 0.01)
const GREY_SPLIT: Record<string, [number[], number[]]> = {
  "fuji-classic-chrome": [[0.474483, 0.472912, 0.470852], [0.050515, 0.070289, 0.071225]],
  "fuji-pro-neg-std": [[0.473121, 0.473121, 0.473121], [0.054799, 0.069371, 0.068055]],
  "fuji-classic-neg": [[0.477152, 0.472234, 0.468231], [0.025010, 0.077194, 0.070282]],
  "fuji-nostalgic-neg": [[0.478178, 0.472435, 0.463926], [0.073915, 0.063249, 0.059576]],
  "fuji-eterna": [[0.474322, 0.472980, 0.470816], [0.041838, 0.072406, 0.073935]],
  "fuji-eterna-bleach-bypass": [[0.473121, 0.473121, 0.473121], [0.054673, 0.068911, 0.071539]],
  "fuji-sepia": [[0.545023, 0.455717, 0.362311], [0.105446, 0.052596, 0.004338]],
  "ricoh-positive-film": [[0.475543, 0.472704, 0.469388], [0.049854, 0.069029, 0.080770]],
  "ricoh-negative-film": [[0.475642, 0.472660, 0.469428], [0.027831, 0.075415, 0.077975]],
  "ricoh-retro": [[0.479123, 0.472677, 0.459501], [0.081661, 0.061455, 0.045620]],
  "ricoh-cross-process": [[0.475027, 0.474467, 0.458215], [0.025524, 0.069249, 0.115051]],
};

const IDS = FILM_SIMS.map((p) => p.id);
const hasSplitOrTint = (id: string) => { const s = sim(id) as { split: unknown; tint?: unknown }; return s.split !== null || (s.tint ?? null) !== null; };

describe("U1 FSE-v2 커널 골든 (4-4, 1e-6)", () => {
  it("골든 표 = 32종 = SIMS2 키", () => {
    expect(Object.keys(GOLDEN)).toEqual(IDS);
    expect(Object.keys(SIMS2).sort()).toEqual([...IDS].sort());
  });
  it.each(IDS)("%s: skin | sky | red | foliage", (id) => {
    PROBES.forEach((x, i) => near3(rp(x, id), GOLDEN[id]![i]!, 1e-6));
  });
  it("T_ref 기준값: 0.18 → 0.473121, 0.01 → 0.065758", () => {
    expect(Math.abs(srgbEnc(toneRef(0.18)) - 0.473121)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(srgbEnc(toneRef(0.01)) - 0.065758)).toBeLessThanOrEqual(1e-6);
  });
  it.each(IDS.filter((id) => !hasSplitOrTint(id)))("%s: split·tint 없음 → 회색 출력 = srgbEnc(T_ref(g))", (id) => {
    for (const g of [0.01, 0.18, 2.04]) {
      const e = srgbEnc(toneRef(g));
      near3(rp([g, g, g], id), [e, e, e], 1e-6);
    }
  });
  it("split·tint 필름 목록이 골든 표와 같다", () => {
    expect(IDS.filter(hasSplitOrTint)).toEqual(Object.keys(GREY_SPLIT));
  });
  it.each(Object.keys(GREY_SPLIT))("%s: 회색 0.18 | 0.01 골든", (id) => {
    near3(rp([0.18, 0.18, 0.18], id), GREY_SPLIT[id]![0], 1e-6);
    near3(rp([0.01, 0.01, 0.01], id), GREY_SPLIT[id]![1], 1e-6);
  });
  it.each(IDS)("%s: 회색 출력 OKLab L 이 cbrt(T_ref(g)) 와 0.01 이내 (g = 2.04·(i/200)³)", (id) => {
    for (let i = 1; i <= 200; i++) {
      const g = 2.04 * (i / 200) ** 3;
      const L = (linToOklab(rp([g, g, g], id).map(srgbDec) as V3) as number[])[0]!;
      expect(Math.abs(L - Math.cbrt(toneRef(g)))).toBeLessThanOrEqual(0.01);
    }
  });
});

const LUT_DIR = join(process.cwd(), "public", "luts");
const loadBin = (id: string): Float32Array => {
  const b = readFileSync(join(LUT_DIR, "bin", `${id}.bin`));
  return decodeBinLut(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, LUT_SIZE);
};

describe("U2 LUT 굽기: .bin 테트라 조회 vs 커널 (7 프로브, ≤ 0.005)", () => {
  const BAKE: V3[] = [[0.18, 0.18, 0.18], ...PROBES, [0.01, 0.01, 0.01], [0.9, 0.9, 0.9]];
  it.each(IDS)("%s", (id) => {
    const lut = loadBin(id);
    for (const x of BAKE) near3(tetraSample(lut, LUT_SIZE, x.map((v) => shaperEnc(v))), rp(x, id), 0.005);
  });
});

describe("U3 manifest (FSE-v2)", () => {
  const m = JSON.parse(readFileSync(join(LUT_DIR, "manifest.json"), "utf8")) as { engine: string; sims: Array<Record<string, unknown>> };
  it("32 항목, engine FSE-v2, tone/sat/fade/preGain/shaderHints 없음, SIMS2 와 1:1", () => {
    expect(m.engine).toBe("FSE-v2");
    expect(m.sims).toHaveLength(32);
    for (const s of m.sims) {
      expect(s.engine).toBe("FSE-v2");
      for (const k of ["tone", "sat", "fade", "preGain", "shaderHints"]) expect(s).not.toHaveProperty(k);
      for (const k of ["id", "brand", "ko", "en", "mono", "cube", "bin", "sha256Cube", "sha256Bin"]) expect(s).toHaveProperty(k);
      expect(s.mono).toBe(sim(s.id as string).mono);
    }
    expect(m.sims.map((s) => s.id).sort()).toEqual(Object.keys(SIMS2).sort());
  });
});
