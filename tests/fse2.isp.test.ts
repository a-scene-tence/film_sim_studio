// FSE-v2 카메라 ISP 6단계 (U4 FS-DR, U5 HD, U6 MH, U7 ZS·팝, U8 ES, U9 ispUniforms, U10 셰이더 소스, U14 필름 없음 회귀)
import { describe, expect, it } from "vitest";
import { gamutMap, linToOklab, srgbDec } from "@/lib/color/fse/engine.mjs";
import { FS_FINAL_GLSL } from "@/lib/render/glsl/fs_final";
import { FS_MAIN_GLSL } from "@/lib/render/glsl/fs_main";
import { FS_NORMALIZE_GLSL } from "@/lib/render/glsl/fs_normalize";
import { FS_MH_EXTRACT_GLSL } from "@/lib/render/glsl/fs_small";
import { LIB_OPS_GLSL } from "@/lib/render/glsl/lib_ops";
import { PASS_NAMES } from "@/lib/render/glsl";
import { ISP_PROFILES, ISP_UO, ISP_Y88, ISP_YK, ispUniforms, MH_SIGMA_FRAC } from "@/lib/render/isp";
import { edgeSoftenL, emitMh, filmShoulder, hdL, hdOp, mhComposite, rolloffW, zoneShadowPop } from "@/lib/render/isp-ops";
import { hdfPlan, mhPlan, tilePadding } from "@/lib/render/plan";
import { baseTone, sharpenL } from "@/lib/render/reference";

type V3 = [number, number, number];
const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const near3 = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number) => { for (let i = 0; i < 3; i++) near(a[i]!, b[i]!, tol); };
const g = (Y: number): V3 => [Y, Y, Y];

describe("상수", () => {
  it("ISP_YK·ISP_Y88 = T_ref 디스플레이 L 0.70·0.88 이 되는 scene Y, ISP_UO = log2(2.04/ISP_YK)", async () => {
    const { tone } = await import("@/lib/color/fse/engine.mjs");
    near(Math.cbrt(tone(ISP_YK)), 0.7, 1e-6);
    near(Math.cbrt(tone(ISP_Y88)), 0.88, 1e-6);
    near(ISP_UO, Math.log2(2.04 / ISP_YK), 1e-8);
  });
});

describe("U4 FS-DR 필름 숄더 (5-1)", () => {
  const G: Array<[number, number, boolean, number]> = [
    [0.2, 2, true, 0.2], [1, 0, true, 1], [1, 1, true, 0.9013636], [1, 2, true, 0.8599034], [2.04, 1, true, 1.4995033], [2.04, 2, true, 1.3453431],
    [4.08, 1, true, 2.04], [8.16, 2, true, 2.04], [20, 2, true, 2.04], [1, 2, false, 1], [2.04, 2, false, 2.04],
  ];
  it.each(G)("Y=%s drStops=%s sceneRef=%s → %s", (Y, k, sr, out) => near3(filmShoulder(g(Y), k, sr), g(out), 1e-6));
  it("색 입력 [1.2,0.8,0.5] drStops 2 → [1.071563, 0.714376, 0.446485]", () => near3(filmShoulder([1.2, 0.8, 0.5], 2, true), [1.071563, 0.714376, 0.446485], 1e-6));
  it("무릎 기울기 1: u = 1e-4 에서 u'/u = 1 ± 1e-3", () => {
    for (const k of [1, 2]) for (const sr of [true, false]) {
      const u = 1e-4;
      const Y = ISP_YK * 2 ** u;
      const up = Math.log2(filmShoulder(g(Y), k, sr)[0] / ISP_YK);
      near(up / u, 1, 1e-3);
    }
  });
  it("Ui 이상 = 2.04, 디스플레이 기준 소스는 항등", () => {
    for (const k of [1, 2]) {
      const Ui = ISP_UO + k;
      for (const f of [1, 1.5, 4]) near(filmShoulder(g(ISP_YK * 2 ** (Ui * f)), k, true)[0], 2.04, 1e-9);
      for (let i = 0; i <= 100; i++) { const Y = (i / 100) * 2.04; near(filmShoulder(g(Y), k, false)[0], Math.min(Y, 2.04), 1e-6); }
    }
  });
  it("S0 롤오프 상한 uRollW: DR100 은 기존 2.04 롤오프와 같고 DR400 은 8.16 으로 접근", () => {
    near(rolloffW(g(3), 2.04)[0], 1 + 1.04 * Math.tanh(2 / 1.04), 1e-12);
    expect(rolloffW(g(100), 8.16)[0]).toBeLessThan(8.16);
    expect(rolloffW(g(100), 8.16)[0]).toBeGreaterThan(8.0);
  });
});

describe("U5 HD 하이라이트 밀도 (5-2)", () => {
  const enc = (L: number) => { const y = L * L * L; return y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055; };
  const G: Array<[number, number, number]> = [[0.6, 0.6, 0.502111], [0.75, 0.743056, 0.672829], [0.85, 0.8275, 0.77765], [0.95, 0.943056, 0.925447], [1, 1, 1]];
  it.each(G)("회색 L=%s hd 1.2 → L'=%s, v'=%s", (L, Lp, v) => {
    near(hdL(L, 1.2), Lp, 1e-5);
    near3(hdOp(g(enc(L)), 1.2, gamutMap), g(v), 1e-5);
  });
  it("색 v=[0.95,0.80,0.60]: hd 1.2 / 0.9", () => {
    near3(hdOp([0.95, 0.8, 0.6], 1.2, gamutMap), [0.921202, 0.772123, 0.572991], 1e-5);
    near3(hdOp([0.95, 0.8, 0.6], 0.9, gamutMap), [0.928386, 0.779076, 0.579727], 1e-5);
  });
  it("단조 증가 (L 0.70~1.0, 0.001 간격, hd 1.2), 백점 유지", () => {
    let prev = -1;
    for (let i = 0; i <= 300; i++) { const L = 0.7 + i * 0.001; const y = hdL(L, 1.2); expect(y).toBeGreaterThan(prev); prev = y; }
    near(hdL(1, 1.2), 1, 1e-12);
    const L = (linToOklab(hdOp([1, 1, 1], 1.2, gamutMap).map(srgbDec)) as number[])[0]!;
    near(L, 1, 1e-6);
  });
});

describe("U6 MH 마이크로 할레이션 (5-3)", () => {
  it("emitMh 골든", () => {
    near3(emitMh(g(0.84)), [0, 0, 0], 1e-6);
    near3(emitMh(g(1.5)), g(0.861617), 1e-6);
    near3(emitMh([3, 2, 1]), [3, 2, 1], 1e-6);
  });
  it("합성 골든 (FUJIFILM 0.10 / RICOH 0.07)", () => {
    near3(mhComposite(g(1.5), g(0.6), ISP_PROFILES.fujifilm.mh, ISP_PROFILES.fujifilm.mhTint), [1.53846, 1.52526, 1.51326], 1e-6);
    near3(mhComposite(g(0.05), [0.3, 0.2, 0.1], ISP_PROFILES.ricoh.mh, ISP_PROFILES.ricoh.mhTint), [0.071, 0.06204, 0.05504], 1e-6);
  });
  it("블러 단계: 6000×4000 → σ 7.2111, ℓ 1, 반경 11", () => {
    const p = mhPlan({ width: 6000, height: 4000 });
    near(p.sigma, 7.2111, 1e-4);
    expect(p.level).toBe(1);
    expect(p.radius).toBe(11);
    expect(Math.ceil((3 * p.sigma) / 2)).toBe(11);
  });
  it("모든 크기에서 반경 ≤ 12, 3σ_mh < halo 블러 범위·타일 패딩, ℓ ≤ HDF core 레벨(타일 정렬 공유)", () => {
    for (const s of [[64, 48], [640, 480], [2048, 1365], [4032, 3024], [6000, 4000], [8192, 5464], [11648, 8736]] as const) {
      const full = { width: s[0], height: s[1] };
      const p = mhPlan(full);
      const h = hdfPlan(full);
      expect(p.radius).toBeLessThanOrEqual(12);
      expect(MH_SIGMA_FRAC * h.diag).toBeCloseTo(p.sigma, 9);
      expect(3 * p.sigma).toBeLessThan(3 * h.halo.sigma);
      expect(3 * p.sigma).toBeLessThan(tilePadding(full));
      expect(p.level).toBeLessThanOrEqual(h.core.level);
    }
  });
});

describe("U7 ZS 암부 밀도 + 3D 팝 (5-4, 슬라이더 0)", () => {
  const S0 = { sh: 0, hi: 0, wh: 0, bk: 0, br: 0, lb: 0 };
  const run = (Y: number, B: number, sd: number, pop: number) => {
    // 가이드 필터 계수 (a=0, b=log2 B) 로 Bs = log2(B)
    return baseTone(g(Y), [0, Math.log2(B)], S0, { sd, pop })[0];
  };
  const G: Array<[number, number, number, number, number]> = [
    [0.0159, 0.0159, 0.3, 0, 0.0129148], [0.0159, 0.0159, 0.45, 0, 0.0116395], [0.18, 0.18, 0.3, 0, 0.1799181],
    [0.06, 0.05, 0, 0.25, 0.0622403], [0.06, 0.05, 0, 0.35, 0.0631597], [0.5, 0.25, 0, 0.25, 0.5059636],
  ];
  it.each(G)("Y=%s Bs=log2(%s) sd=%s pop=%s → %s", (Y, B, sd, pop, out) => near(run(Y, B, sd, pop), out, 1e-6));
  it("sd = pop = 0 이면 항등 (기존 베이스 톤과 같음)", () => {
    const z = zoneShadowPop(-3, 0.4, 0, 0);
    expect(z).toEqual({ dB: -0, Dt: 0.4 });
    near(run(0.06, 0.05, 0, 0), 0.06, 1e-12);
  });
});

describe("U8 ES 광학 윤곽 완화 (5-5)", () => {
  it("골든", () => {
    near(edgeSoftenL(0.5, 0.06, 0.35), 0.479, 1e-6);
    near(edgeSoftenL(0.5, 0.02, 0.35), 0.498965, 1e-6);
    near(edgeSoftenL(0.5, 0.005, 0.35), 0.5, 1e-6);
    near(edgeSoftenL(0.5, -0.06, 0.25), 0.515, 1e-6);
    near(sharpenL(0.5, 0.44, 0, 0.35), 0.479, 1e-6);
  });
  it("게이팅: RAW·Log(profile 12) → 0, renderScale 0.5 → 절반", () => {
    expect(ispUniforms({ brand: "fujifilm", filmStrength: 100, dRange: 100, profile: 12, renderScale: 1 }).uIspEs).toBe(0);
    expect(ispUniforms({ brand: "fujifilm", filmStrength: 100, dRange: 100, profile: 3, renderScale: 1 }).uIspEs).toBe(0);
    near(ispUniforms({ brand: "fujifilm", filmStrength: 100, dRange: 100, profile: 0, renderScale: 0.5 }).uIspEs, 0.175, 1e-12);
    near(ispUniforms({ brand: "ricoh", filmStrength: 100, dRange: 100, profile: 1, renderScale: 2 }).uIspEs, 0.25, 1e-12);
  });
});

describe("U9 ispUniforms 골든 (5-6)", () => {
  const close = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(b)) {
      if (Array.isArray(v)) near3(a[k] as number[], v as number[], 1e-12);
      else if (typeof v === "number") near(a[k] as number, v, 1e-12);
      else expect(a[k]).toBe(v);
    }
  };
  it("fujifilm 100% DR200 profile 0 scale 1", () => close(ispUniforms({ brand: "fujifilm", filmStrength: 100, dRange: 200, profile: 0, renderScale: 1 }),
    { uIspHd: 1.2, uIspMh: 0.1, uIspMhTint: [1, 0.78, 0.58], uIspSd: 0.3, uIspPop: 0.25, uIspEs: 0.35, uDrStops: 1, uSceneRef: false, uRollW: 4.08 }));
  it("ricoh 50% DR400 profile 12 scale 1", () => close(ispUniforms({ brand: "ricoh", filmStrength: 50, dRange: 400, profile: 12, renderScale: 1 }),
    { uIspHd: 0.45, uIspMh: 0.035, uIspMhTint: [1, 0.86, 0.72], uIspSd: 0.225, uIspPop: 0.175, uIspEs: 0, uDrStops: 2, uSceneRef: true, uRollW: 8.16 }));
  it("필름 없음 DR100 profile 0", () => close(ispUniforms({ brand: null, filmStrength: 100, dRange: 100, profile: 0, renderScale: 1 }),
    { uIspHd: 0, uIspMh: 0, uIspMhTint: [1, 1, 1], uIspSd: 0, uIspPop: 0, uIspEs: 0, uDrStops: 0, uSceneRef: false, uRollW: 2.04 }));
  it("fujifilm 100% DR100 profile 1 scale 0.5", () => close(ispUniforms({ brand: "fujifilm", filmStrength: 100, dRange: 100, profile: 1, renderScale: 0.5 }),
    { uIspEs: 0.175, uDrStops: 0, uRollW: 2.04 }));
  it("필름 강도 0 → 브랜드 ISP 전부 0", () => close(ispUniforms({ brand: "ricoh", filmStrength: 0, dRange: 100, profile: 0, renderScale: 1 }),
    { uIspHd: 0, uIspMh: 0, uIspSd: 0, uIspPop: 0, uIspEs: 0 }));
});

describe("U10 셰이더 소스 (5-7)", () => {
  const all = LIB_OPS_GLSL + FS_MAIN_GLSL + FS_NORMALIZE_GLSL + FS_FINAL_GLSL + FS_MH_EXTRACT_GLSL;
  it.each(["uIspSd * msd", "Dt2", "filmShoulder", "hdOp", "mhComposite", "uRollW", "uIspEs * sstep(0.012, 0.045"])("%s", (s) => expect(all).toContain(s));
  it("상수 0.328679008, 0.840607362 (= isp.ts)", () => {
    expect(FS_MAIN_GLSL).toContain(`const float ISP_YK = ${ISP_YK};`);
    expect(LIB_OPS_GLSL).toContain(`const float ISP_Y88 = ${ISP_Y88};`);
    expect(FS_MAIN_GLSL).toContain(`const float ISP_UO = ${ISP_UO};`);
    expect(String(ISP_YK)).toBe("0.328679008");
    expect(String(ISP_Y88)).toBe("0.840607362");
  });
  it("프로그램 목록에 mh_extract (17개)", () => {
    expect(PASS_NAMES).toContain("mh_extract");
    expect(PASS_NAMES).toHaveLength(17);
  });
  it("main() 순서: hdfComposite → mhComposite → … → clipNeg → filmShoulder → lutStage → hdOp", () => {
    const m = FS_MAIN_GLSL.slice(FS_MAIN_GLSL.indexOf("void main()"));
    const order = ["hdfComposite(x", "mhComposite(x", "dehazeApply(x", "baseTone(x", "contrastOp(x", "clipNeg(x)", "filmShoulder(x)", "lutStage(x)", "hdOp(v)"].map((k) => m.indexOf(k));
    expect(order.every((v) => v >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("U14 회귀: 필름 없음 → ISP 분기 전부 꺼짐", () => {
  for (const profile of [0, 1, 2, 3, 12, 13, 14]) {
    it(`profile ${profile}`, () => {
      const u = ispUniforms({ brand: null, filmStrength: 100, dRange: 100, profile, renderScale: 1 });
      expect([u.uIspHd, u.uIspMh, u.uIspSd, u.uIspPop, u.uIspEs, u.uDrStops]).toEqual([0, 0, 0, 0, 0, 0]);
      expect(u.uRollW).toBe(2.04);
    });
  }
  it("셰이더 가드: uDrStops ≤ 0 · uIspMh ≤ 0 · uIspHd > 0 · uIspEs 항", () => {
    expect(FS_MAIN_GLSL).toContain("if (uDrStops <= 0.0) return x;");
    expect(FS_MAIN_GLSL).toContain("if (uIspHd > 0.0) v = hdOp(v);");
    expect(LIB_OPS_GLSL).toContain("if (uIspMh <= 0.0) return x;");
    expect(FS_FINAL_GLSL).toContain("if (uSharpen > 0.0 || uIspEs > 0.0) {");
  });
  it("CPU 미러: 0 유니폼이면 모든 단계 항등", () => {
    const x: V3 = [1.7, 0.9, 0.3];
    expect(filmShoulder(x, 0, true)).toEqual(x);
    expect(mhComposite(x, [5, 5, 5], 0, [1, 1, 1])).toEqual(x);
    expect(hdOp([0.9, 0.8, 0.7], 0, gamutMap).map((v) => Math.round(v * 1e5) / 1e5)).toEqual([0.9, 0.8, 0.7]);
    expect(edgeSoftenL(0.5, 0.06, 0)).toBe(0.5);
  });
});

describe("gamutMap tanh 오버플로 가드 (GPU NaN → 회색 점 방지)", () => {
  it("common.glsl gamutMap: tanh 인자를 15 로 묶는다 (float32 에서 tanh(15) = 1 이라 결과 동일)", async () => {
    const { COMMON_GLSL } = await import("@/lib/render/glsl/common");
    expect(COMMON_GLSL).toContain("tanh(min((C - t) / r, 15.0))");
    expect(Math.fround(Math.tanh(15))).toBe(1);
  });
});

describe("rolloffY tanh 오버플로 가드 (5-7-7, 사용자 확정)", () => {
  it("fs_normalize: tanh(min((Y - 1.0) / (uRollW - 1.0), 15.0))", () => {
    expect(FS_NORMALIZE_GLSL).toContain("tanh(min((Y - 1.0) / (uRollW - 1.0), 15.0))");
  });
  it("CPU 미러: 고휘도에서 유한하고 상한 uRollW 이하, 가드 전과 1e-11 이내 (float32 정밀도보다 훨씬 작음)", () => {
    for (const W of [2.04, 4.08, 8.16]) for (const Y of [50, 1e3, 1e6, 1e30]) {
      const y = rolloffW(g(Y), W)[0];
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeLessThanOrEqual(W);
      near(y, 1 + (W - 1) * Math.tanh((Y - 1) / (W - 1)), 1e-11);
    }
    near(rolloffW(g(3), 2.04)[0], 1 + 1.04 * Math.tanh(2 / 1.04), 1e-15);
  });
});
