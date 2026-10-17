// 라이트 자동 보정 3모드 · DR100/200/400 숄더 · 자동 WB/채도 분리 · 후지필름 그레인 (COLOR_SCIENCE §16.12 ~ §16.13, §19.1b)
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AUTO_LIGHT_LABEL, computeAutoLightMode, type AutoLightMode } from "../src/lib/studio/auto-light";
import { computeAutoChroma, computeAutoColor, computeAutoWb, type RgbaGrid } from "../src/lib/studio/color-auto";
import { editReducer, initialEditState } from "../src/lib/studio/state";
import { diffLabel, historyReducer, historyTimeline, initialHistory } from "../src/lib/studio/history";
import { DR_SHOULDER, ispUniforms } from "../src/lib/render/isp";
import { drShoulder } from "../src/lib/render/isp-ops";
import { FUJI_GRAIN_PRESETS, GRAIN_CELL, matchFujiGrain } from "../src/lib/render/grain";
import { grainNoise, pixelPipelineFromWs, type PixelCtx } from "../src/lib/render/reference";
import { FS_MAIN_GLSL } from "../src/lib/render/glsl/fs_main";
import { FS_FINAL_GLSL } from "../src/lib/render/glsl/fs_final";
import { apply3, wbMatrix } from "../src/lib/render/wb";

/** 분위수 구간별 휘도 분포 [비율, 최소, 최대] → 결정론적 Y 배열 (n = 1000) */
function dist(parts: Array<[number, number, number]>): number[] {
  const out: number[] = [];
  for (const [frac, lo, hi] of parts) {
    const n = Math.round(frac * 1000);
    for (let i = 0; i < n; i++) out.push(lo * (hi / lo) ** (n === 1 ? 0 : i / (n - 1)));
  }
  return out;
}
const BACKLIT = dist([[0.7, 0.008, 0.04], [0.3, 1.2, 3]]);
const BRIGHT = dist([[0.3, 0.1, 0.4], [0.7, 0.9, 2.2]]);
const DARK = dist([[1, 0.004, 0.06]]);
const NORMAL = dist([[1, 0.02, 1]]);
const MODES: AutoLightMode[] = ["balanced", "highlight", "shadow"];

describe("라이트 자동 보정 3모드", () => {
  it("빈 입력 · NaN 은 전부 0, -0 없음", () => {
    for (const m of MODES) {
      const r = computeAutoLightMode([], m);
      expect(Object.values(r).filter((v) => typeof v === "number").every((v) => v === 0 && !Object.is(v, -0))).toBe(true);
      expect(r.dRange).toBeNull();
      expect(computeAutoLightMode([NaN, Infinity], m)).toEqual(r);
    }
  });
  it("결정론 + 슬라이더 범위", () => {
    for (const m of MODES) for (const Y of [BACKLIT, BRIGHT, DARK, NORMAL]) {
      const a = computeAutoLightMode(Y, m);
      expect(computeAutoLightMode(Y, m)).toEqual(a);
      for (const k of ["contrast", "highlights", "shadows", "whites", "blacks", "brightness", "lightBalance"] as const) {
        expect(Math.abs(a[k])).toBeLessThanOrEqual(100);
        expect(Number.isInteger(a[k])).toBe(true);
      }
      expect(Math.abs(a.exposure)).toBeLessThanOrEqual(3);
    }
  });
  it("balanced: 중앙값 기준 노출 — 어두우면 올리고 밝으면 내리고 평균 장면은 거의 그대로", () => {
    expect(computeAutoLightMode(DARK, "balanced").exposure).toBeGreaterThan(0.5);
    expect(computeAutoLightMode(BRIGHT, "balanced").exposure).toBeLessThan(0);
    expect(Math.abs(computeAutoLightMode(new Array(500).fill(0.18), "balanced").exposure)).toBeLessThanOrEqual(0.05);
    expect(computeAutoLightMode(BACKLIT, "balanced").dRange).toBeNull();
  });
  it("highlight: 밝은 장면은 노출을 내리고 하이라이트·흰색을 누르며 DR 을 올린다 (밝은 비중이 크면 DR400)", () => {
    const b = computeAutoLightMode(BRIGHT, "highlight");
    expect(b.exposure).toBeLessThan(0);
    expect(b.highlights).toBeLessThan(0);
    expect(b.whites).toBeLessThan(0);
    expect(b.shadows).toBeLessThanOrEqual(0);
    expect(b.dRange).toBe(400);
    // 같은 장면에서 균형 모드보다 하이라이트 보호가 강하다
    const bal = computeAutoLightMode(BRIGHT, "balanced");
    expect(b.highlights).toBeLessThanOrEqual(bal.highlights);
    // 밝은 영역이 작으면 DR200
    expect(computeAutoLightMode(dist([[0.97, 0.05, 0.4], [0.03, 1, 1.5]]), "highlight").dRange).toBe(200);
    expect(computeAutoLightMode(DARK, "highlight").dRange).toBe(200);
    // 노출 후 P99 가 디스플레이 L=0.88 기준(0.8406)을 넘지 않는다
    const S = [...BRIGHT].sort((x, y) => x - y);
    expect(S[Math.floor(0.99 * (S.length - 1))]! * 2 ** b.exposure).toBeLessThanOrEqual(0.8406 * 1.04);
  });
  it("shadow: 역광 장면에서 하이라이트는 음수로 고정하고 쉐도우·라이트 밸런스·밝기를 리프트한다", () => {
    for (const Y of [BACKLIT, DARK, NORMAL, BRIGHT]) {
      const r = computeAutoLightMode(Y, "shadow");
      expect(r.highlights).toBeLessThan(0);
      expect(r.shadows).toBeGreaterThan(0);
      expect(r.lightBalance).toBeGreaterThan(0);
      expect(r.brightness).toBeGreaterThan(0);
      expect(r.exposure).toBeGreaterThanOrEqual(0);
      expect(r.dRange).toBeNull();
    }
    const back = computeAutoLightMode(BACKLIT, "shadow");
    expect(back.shadows).toBeGreaterThan(computeAutoLightMode(BACKLIT, "balanced").shadows - 1);
    expect(back.shadows).toBeGreaterThan(computeAutoLightMode(BACKLIT, "highlight").shadows);
    expect(back.exposure).toBeGreaterThan(computeAutoLightMode(BACKLIT, "highlight").exposure);
  });
  it("히스토리 라벨 3종 + D레인지를 같은 단계에서 바꾼다", () => {
    expect(MODES.map((m) => AUTO_LIGHT_LABEL[m])).toEqual(["라이트 자동 (전체 평균)", "라이트 자동 (하이라이트 우선)", "라이트 자동 (암부 우선)"]);
    const st = initialEditState();
    const r = computeAutoLightMode(BRIGHT, "highlight");
    const values = { exposure: r.exposure, contrast: r.contrast, highlights: r.highlights, shadows: r.shadows, whites: r.whites, blacks: r.blacks, brightness: r.brightness, lightBalance: r.lightBalance };
    const next = { ...editReducer(st, { type: "patch", values }), dRange: r.dRange! };
    const h = historyReducer(initialHistory({ edit: st, choice: "auto" }), { type: "do", label: AUTO_LIGHT_LABEL.highlight, action: { type: "replace", state: next } });
    expect(historyTimeline(h).map((e) => e.label)).toEqual(["초기 상태", "라이트 자동 (하이라이트 우선)"]);
    expect(h.present.edit.dRange).toBe(400);
    expect(h.past).toHaveLength(1);
  });
});

describe("DR100 / DR200 / DR400 숄더", () => {
  const g = (y: number): [number, number, number] => [y, y, y];
  it("ispUniforms: 표시 기준 소스(JPEG)만 켜지고 DR100·RAW 는 꺼짐", () => {
    const u = (dRange: 100 | 200 | 400, profile: number) => ispUniforms({ brand: null, filmStrength: 100, dRange, profile, renderScale: 1 });
    expect([u(100, 0).uDrY0, u(100, 0).uDrS]).toEqual([0, 0]);
    expect([u(200, 0).uDrY0, u(200, 0).uDrS]).toEqual([0.45, 0.75]);
    expect([u(400, 0).uDrY0, u(400, 0).uDrS]).toEqual([0.3, 0.6]);
    expect([u(400, 1).uDrY0, u(400, 1).uDrS]).toEqual([0.3, 0.6]);
    expect([u(400, 12).uDrY0, u(400, 12).uDrS]).toEqual([0, 0]); // RAW 는 기존 filmShoulder
    expect(DR_SHOULDER[200].y0).toBeGreaterThan(DR_SHOULDER[400].y0);
  });
  it("골든 · 무릎 아래 항등 · 색비 보존", () => {
    expect(drShoulder(g(0.84), 0.45, 0.75)[0]).toBeCloseTo(0.796015, 6);
    expect(drShoulder(g(1.2), 0.3, 0.6)[0]).toBeCloseTo(0.79923, 6);
    expect(drShoulder([0.3, 0.2, 0.1], 0.3, 0.6)).toEqual([0.3, 0.2, 0.1]);
    expect(drShoulder(g(2), 0, 0)).toEqual(g(2));
    const c = drShoulder([1.5, 1, 0.5], 0.3, 0.6);
    expect(c[0] / c[1]).toBeCloseTo(1.5, 9);
    expect(c[1] / c[2]).toBeCloseTo(2, 9);
  });
  it("단조 증가 · 무릎에서 매끄러움(기울기 1) · DR400 ≤ DR200 ≤ DR100", () => {
    let p2 = -1, p4 = -1;
    for (let i = 0; i <= 204; i++) {
      const Y = i / 100;
      const a = drShoulder(g(Y), 0.45, 0.75)[0], b = drShoulder(g(Y), 0.3, 0.6)[0];
      expect(a).toBeGreaterThanOrEqual(p2); expect(b).toBeGreaterThanOrEqual(p4);
      expect(a).toBeLessThanOrEqual(Y + 1e-12); expect(b).toBeLessThanOrEqual(a + 1e-12);
      p2 = a; p4 = b;
    }
    const e = 1e-6;
    expect((drShoulder(g(0.45 + e), 0.45, 0.75)[0] - 0.45) / e).toBeCloseTo(1, 4);
  });
  it("픽셀 경로(JPEG, 필름 없음): 하이라이트는 DR 이 높을수록 확실히 어둡고 미드톤은 그대로", () => {
    const ctx = (dr: 100 | 200 | 400): PixelCtx => {
      const u = ispUniforms({ brand: null, filmStrength: 100, dRange: dr, profile: 0, renderScale: 1 });
      return {
        norm: { profile: 0, limitedCV: false, srcToWS: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], rawScale: 1, srcLut: null, samsungFix: false, rgc: false, rolloff: false, wb: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], expGain: 1 },
        ct: 0, vig: 0, aspect: 1, lut: { mode: 0 }, mono: false, ke: 0, kb: 0, curve: null, sat: 0, vib: 0, grain: null,
        isp: { drStops: u.uDrStops, sceneRef: u.uSceneRef, hd: u.uIspHd, drY0: u.uDrY0, drS: u.uDrS },
      };
    };
    const out = (Y: number, dr: 100 | 200 | 400) => pixelPipelineFromWs(g(Y), 0.5, 0.5, 0.5, 0.5, ctx(dr))[1] * 255;
    expect(out(0.2, 400)).toBeCloseTo(out(0.2, 100), 6);
    for (const Y of [0.84, 1.2, 1.6]) {
      expect(out(Y, 200)).toBeLessThan(out(Y, 100) - 2);
      expect(out(Y, 400)).toBeLessThan(out(Y, 200) - 4);
    }
  });
  it("셰이더: filmShoulder 직후 drShoulder, 같은 수식·가드", () => {
    const m = FS_MAIN_GLSL.slice(FS_MAIN_GLSL.indexOf("void main()"));
    expect(m.indexOf("x = filmShoulder(x);")).toBeGreaterThanOrEqual(0);
    expect(m.indexOf("x = drShoulder(x);")).toBeGreaterThan(m.indexOf("x = filmShoulder(x);"));
    expect(m.indexOf("vec3 v = lutStage(x);")).toBeGreaterThan(m.indexOf("x = drShoulder(x);"));
    expect(FS_MAIN_GLSL).toContain("if (uDrS <= 0.0) return x;");
    expect(FS_MAIN_GLSL).toContain("uDrY0 + uDrS * nd / sqrt(1.0 + nd * nd)");
    expect(FS_MAIN_GLSL).toContain("uniform float uDrY0;");
  });
});

describe("컬러 자동 보정 분리", () => {
  const grid = (w: number, h: number, f: (x: number, y: number) => [number, number, number]): RgbaGrid => {
    const data = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...f(x, y), 1], (y * w + x) * 4);
    return { width: w, height: h, data };
  };
  const inv = (m: ReturnType<typeof wbMatrix>) => {
    const [[a, b, c], [d, e, f], [g2, h, i]] = m;
    const det = a * (e * i - f * h) - b * (d * i - f * g2) + c * (d * h - e * g2);
    return [
      [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
      [(f * g2 - d * i) / det, (a * i - c * g2) / det, (c * d - a * f) / det],
      [(d * h - e * g2) / det, (b * g2 - a * h) / det, (a * e - b * d) / det],
    ] as ReturnType<typeof wbMatrix>;
  };
  const cast = grid(32, 32, (x, y) => { const k = 0.15 + 0.6 * ((x + y) / 62); return apply3(inv(wbMatrix(40, 0)), [k, k, k]) as [number, number, number]; });
  const vivid = grid(16, 16, (x) => (x % 2 ? [0.7, 0.05, 0.05] : [0.05, 0.05, 0.7]));
  it("자동 WB 는 temp·tint 만 돌려준다 (채도·생동감 키 없음)", () => {
    const r = computeAutoWb(cast)!;
    expect(Object.keys(r).sort()).toEqual(["temp", "tint", "used"]);
    expect(Math.abs(r.temp - 40)).toBeLessThanOrEqual(3);
    expect(computeAutoWb(grid(4, 4, () => [1, 1, 1]))).toBeNull();
  });
  it("자동 채도·생동감은 vibrance·saturation 만 돌려주고 현재 WB 를 입력으로 쓴다", () => {
    const r = computeAutoChroma(vivid, 0, 0)!;
    expect(Object.keys(r).sort()).toEqual(["saturation", "used", "vibrance"]);
    const flat = computeAutoChroma(grid(16, 16, (x) => { const k = 0.1 + 0.02 * x; return [k, k, k]; }), 0, 0)!;
    expect(flat.vibrance).toBeGreaterThan(r.vibrance);
    // 다른 WB 값이면 다른 분석 결과 (WB 슬라이더를 건드리지 않고 그 값을 존중)
    expect(computeAutoChroma(cast, 40, 0)!.vibrance).not.toBe(computeAutoChroma(cast, 0, 0)!.vibrance);
    expect(computeAutoChroma(grid(4, 4, () => [1, 1, 1]), 0, 0)).toBeNull();
  });
  it("computeAutoColor = 자동 WB + 확정 WB 로 계산한 채도·생동감 (기존 동작 보존)", () => {
    for (const g of [cast, vivid]) {
      const all = computeAutoColor(g)!, wb = computeAutoWb(g)!, ch = computeAutoChroma(g, wb.temp, wb.tint)!;
      expect([all.temp, all.tint, all.vibrance, all.saturation]).toEqual([wb.temp, wb.tint, ch.vibrance, ch.saturation]);
    }
  });
  it("히스토리 라벨과 패치 범위: WB 패치는 채도·생동감을, 채도 패치는 temp·tint 를 바꾸지 않는다", () => {
    const st = { ...initialEditState(), temp: 12, tint: -3, saturation: 7, vibrance: 9 };
    const a = editReducer(st, { type: "patch", values: { temp: 30, tint: 5 } });
    expect([a.saturation, a.vibrance]).toEqual([7, 9]);
    const b = editReducer(st, { type: "patch", values: { vibrance: 40, saturation: 10 } });
    expect([b.temp, b.tint]).toEqual([12, -3]);
    let h = initialHistory({ edit: st, choice: "auto" });
    h = historyReducer(h, { type: "do", label: "자동 화이트밸런스", action: { type: "patch", values: { temp: 30 } } });
    h = historyReducer(h, { type: "do", label: "자동 채도·생동감", action: { type: "patch", values: { vibrance: 40 } } });
    expect(historyTimeline(h).map((e) => e.label)).toEqual(["초기 상태", "자동 화이트밸런스", "자동 채도·생동감"]);
  });
  it("UI 소스: 라이트 탭 버튼 3개, 컬러 탭 버튼 2개", () => {
    const light = readFileSync("src/components/studio/tabs/LightTab.tsx", "utf8");
    for (const t of ["전체 평균 (균형)", "하이라이트 우선", "암부·역광 우선"]) expect(light).toContain(t);
    const color = readFileSync("src/components/studio/tabs/ColorTab.tsx", "utf8");
    expect(color).toContain("자동 화이트밸런스");
    expect(color).toContain("자동 채도·생동감");
    expect(color).not.toContain("컬러 자동 보정");
  });
});

describe("후지필름 그레인 이펙트", () => {
  it("프리셋 5종: OFF / 약·소 / 약·대 / 강·소 / 강·대", () => {
    expect(FUJI_GRAIN_PRESETS.map((p) => p.label)).toEqual(["OFF", "약·소", "약·대", "강·소", "강·대"]);
    const [off, ws, wl, ss, sl] = FUJI_GRAIN_PRESETS;
    expect(off!.amount).toBe(0);
    expect(ws!.amount).toBe(wl!.amount); expect(ss!.amount).toBe(sl!.amount);
    expect(ss!.amount).toBeGreaterThan(ws!.amount);
    expect(wl!.size).toBeGreaterThan(ws!.size); expect(sl!.size).toBeGreaterThan(ss!.size);
    for (const p of FUJI_GRAIN_PRESETS) expect(matchFujiGrain(p.amount, p.size)).toBe(p.id);
    expect(matchFujiGrain(0, 100)).toBe("off");
    expect(matchFujiGrain(36, 0)).toBeNull(); // 미세 조절 중
  });
  it("버튼 = 강도·크기 슬라이더 값을 한 번에 설정하고 이후 슬라이더로 미세 조절 가능, 히스토리 라벨 '그레인'", () => {
    const st = initialEditState();
    const p = FUJI_GRAIN_PRESETS[4]!;
    const a = editReducer(st, { type: "patch", values: { grainAmount: p.amount, grainSize: p.size } });
    expect([a.grainAmount, a.grainSize]).toEqual([70, 100]);
    expect(matchFujiGrain(a.grainAmount, a.grainSize)).toBe("strong-large");
    const b = editReducer(a, { type: "set", key: "grainAmount", value: 62 });
    expect(matchFujiGrain(b.grainAmount, b.grainSize)).toBeNull();
    expect(diffLabel({ edit: st, choice: "auto" }, { edit: a, choice: "auto" })).toBe("그레인");
    expect(diffLabel({ edit: a, choice: "auto" }, { edit: b, choice: "auto" })).toBe("그레인 강도");
  });
  it("은염 입자 노이즈: 결정론 · 평균 0 · 표준편차 ≈ 0.26 · 이웃 픽셀 상관이 높다(부드러운 응집)", () => {
    expect(grainNoise(10.5, 20.5, 1, [3, 4])).toBe(grainNoise(10.5, 20.5, 1, [3, 4]));
    const N = 160, v = new Float64Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) v[y * N + x] = grainNoise(x + 0.5, y + 0.5, 1, [3.3, 7.7], 0);
    const mean = v.reduce((s, q) => s + q, 0) / v.length;
    const varr = v.reduce((s, q) => s + (q - mean) ** 2, 0) / v.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.sqrt(varr)).toBeGreaterThan(0.2); expect(Math.sqrt(varr)).toBeLessThan(0.32);
    let c = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N - 1; x++) c += (v[y * N + x]! - mean) * (v[y * N + x + 1]! - mean);
    expect(c / (N * (N - 1)) / varr).toBeGreaterThan(0.5); // 픽셀 단위 salt-and-pepper 는 ≈ 0
    // 크기 대(scale 2.5)는 더 응집
    let c2 = 0;
    const w = new Float64Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) w[y * N + x] = grainNoise(x + 0.5, y + 0.5, 2.5, [3.3, 7.7], 1);
    const m2 = w.reduce((s, q) => s + q, 0) / w.length, v2 = w.reduce((s, q) => s + (q - m2) ** 2, 0) / w.length;
    for (let y = 0; y < N; y++) for (let x = 0; x < N - 1; x++) c2 += (w[y * N + x]! - m2) * (w[y * N + x + 1]! - m2);
    expect(c2 / (N * (N - 1)) / v2).toBeGreaterThan(c / (N * (N - 1)) / varr);
  });
  it("셰이더: 값 노이즈 + quintic 보간, 심플렉스 snoise 없음, GRAIN_CELL 주입", () => {
    expect(FS_FINAL_GLSL).toContain("float valueNoise(vec2 q, uint seed)");
    expect(FS_FINAL_GLSL).toContain("t * t * t * (t * (t * 6.0 - 15.0) + 10.0)");
    expect(FS_FINAL_GLSL).toContain(`px / (uGrainScale * ${GRAIN_CELL})`);
    expect(FS_FINAL_GLSL).not.toContain("snoise");
    expect(FS_FINAL_GLSL).toContain("v = clamp(v + 0.205 * (uGrainAmt / 100.0) * resp * n, 0.0, 1.0);");
  });
});
