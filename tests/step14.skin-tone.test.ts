// STC-v1 피부톤 세부 조정 (COLOR_SCIENCE §8.8b, §16.14) — 상태·초기화 · 3D 마스크 · 3축 변환 · No-op · GLSL 동기 · 자동 보정
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { linToOklab, oklabToLin, srgbDec, srgbEnc } from "../src/lib/color/fse/engine.mjs";
import { FS_POST_GLSL } from "../src/lib/render/glsl/fs_post";
import { pixelPipelineFromWs, postChroma, type PixelCtx, type Vec3 } from "../src/lib/render/reference";
import { skinUniform } from "../src/lib/render/params";
import {
  SKIN_GLSL, SKIN_H0, SKIN_HUE_MAX, SKIN_HW_RED, SKIN_HW_YEL, SKIN_LUM_MAX, SKIN_SAT_DOWN, SKIN_SAT_LIFT, SKIN_SAT_UP, skinApply, skinHueW, skinMask, skinOn,
} from "../src/lib/render/skin";
import { computeAutoSkin } from "../src/lib/studio/color-auto";
import { historyReducer, historyTimeline, initialHistory } from "../src/lib/studio/history";
import {
  editReducer, initialEditState, isEditDefault, isTabDefault, mediaOpenState, resetTab, SKIN_KEYS, SLIDER_BY_KEY, type EditState,
} from "../src/lib/studio/state";
import { buildRenderParams, buildUniforms } from "../src/lib/studio/uniforms";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const lab8 = (rgb: [number, number, number]) => {
  const v = rgb.map((x) => x / 255);
  const [L, a, b] = linToOklab(v.map(srgbDec)) as number[];
  return { v, L: L!, a: a!, b: b!, C: Math.hypot(a!, b!), h: (Math.atan2(b!, a!) * 180) / Math.PI };
};
const maskOf = (rgb: [number, number, number]) => { const q = lab8(rgb); return skinMask(q.L, q.a, q.b, q.v); };
const hueOf = (v: ArrayLike<number>) => { const [, a, b] = linToOklab(Array.from(v, (x) => srgbDec(x))) as number[]; return (Math.atan2(b!, a!) * 180) / Math.PI; };
const LofV = (v: ArrayLike<number>) => (linToOklab(Array.from(v, (x) => srgbDec(x))) as number[])[0]!;
const CofV = (v: ArrayLike<number>) => { const [, a, b] = linToOklab(Array.from(v, (x) => srgbDec(x))) as number[]; return Math.hypot(a!, b!); };

const SKIN = { fair: [234, 192, 170], light: [224, 172, 150], medium: [198, 134, 103], tan: [176, 112, 80], deep: [120, 72, 50] } as const;
const NON_SKIN = { gray: [128, 128, 128], white: [250, 250, 250], black: [6, 6, 6], redSign: [230, 20, 20], sky: [110, 160, 230], leaf: [70, 140, 50], foliage: [200, 170, 40] } as const;
const rgbV = (c: readonly number[]) => c.map((x) => x / 255) as Vec3;

describe("STC-v1 상태 모델 · 초기화", () => {
  it("슬라이더 3종: 컬러 탭, −100..100, step 1, 기본 0", () => {
    expect([...SKIN_KEYS]).toEqual(["skinHue", "skinSat", "skinLum"]);
    for (const k of SKIN_KEYS) {
      const s = SLIDER_BY_KEY[k];
      expect([s.tab, s.min, s.max, s.step, s.def, s.display]).toEqual(["color", -100, 100, 1, 0, "signed"]);
    }
    expect(SLIDER_BY_KEY.skinHue.label).toBe("피부 색조");
    expect(SLIDER_BY_KEY.skinSat.label).toBe("피부 혈색 (채도)");
    expect(SLIDER_BY_KEY.skinLum.label).toBe("피부 투명도 (밝기)");
  });
  it("초기 상태·새 파일(mediaOpenState) 은 세 값 모두 0", () => {
    for (const st of [initialEditState(), mediaOpenState(false), mediaOpenState(true)]) expect([st.skinHue, st.skinSat, st.skinLum]).toEqual([0, 0, 0]);
  });
  const dirty = (): EditState => {
    let st = initialEditState();
    st = editReducer(st, { type: "patch", values: { skinHue: 40, skinSat: -30, skinLum: 25, temp: 10, exposure: 1 } });
    return st;
  };
  it("set 은 범위로 clamp 되고 reset(더블탭) 은 0", () => {
    let st = editReducer(initialEditState(), { type: "set", key: "skinHue", value: 250 });
    expect(st.skinHue).toBe(100);
    st = editReducer(st, { type: "set", key: "skinLum", value: -12.6 });
    expect(st.skinLum).toBe(-13);
    st = editReducer(st, { type: "reset", key: "skinHue" });
    expect(st.skinHue).toBe(0);
  });
  it("[컬러 탭 초기화] 는 피부톤 3값을 0 으로, 다른 탭 값은 그대로", () => {
    const st = dirty();
    expect(isTabDefault(st, "color")).toBe(false);
    const r = resetTab(st, "color");
    expect([r.skinHue, r.skinSat, r.skinLum, r.temp]).toEqual([0, 0, 0, 0]);
    expect(r.exposure).toBe(1);
    expect(isTabDefault(r, "color")).toBe(true);
    // 피부톤 하나만 바뀌어도 컬러 탭은 변경 상태
    expect(isTabDefault(editReducer(initialEditState(), { type: "set", key: "skinSat", value: 5 }), "color")).toBe(false);
  });
  it("다른 탭 초기화는 피부톤을 건드리지 않는다", () => {
    const st = dirty();
    for (const t of ["film", "light", "curve", "detail"] as const) expect([resetTab(st, t).skinHue, resetTab(st, t).skinSat, resetTab(st, t).skinLum]).toEqual([40, -30, 25]);
  });
  it("[전체 초기화] 는 세 값을 0 으로, 히스토리 스택을 모두 비움", () => {
    let h = initialHistory({ edit: dirty(), choice: "auto" });
    expect(isEditDefault(h.present.edit)).toBe(false);
    h = historyReducer(h, { type: "clearAll" });
    expect([h.present.edit.skinHue, h.present.edit.skinSat, h.present.edit.skinLum]).toEqual([0, 0, 0]);
    expect(isEditDefault(h.present.edit)).toBe(true);
    expect(h.past.length).toBe(0);
    expect(h.future.length).toBe(0);
  });
  it("새 파일: 히스토리 reset 스냅샷은 0", () => {
    let h = initialHistory({ edit: dirty(), choice: "auto" });
    h = historyReducer(h, { type: "reset", snap: { edit: mediaOpenState(false), choice: "auto" } });
    expect([h.present.edit.skinHue, h.present.edit.skinSat, h.present.edit.skinLum]).toEqual([0, 0, 0]);
    expect(h.past.length).toBe(0);
  });
  it("자동 보정 기록: '피부톤 자동 보정' 1단계", () => {
    let h = initialHistory({ edit: initialEditState(), choice: "auto" });
    h = historyReducer(h, { type: "do", label: "피부톤 자동 보정", action: { type: "patch", values: { skinHue: 20, skinSat: -10, skinLum: 15 } } });
    expect(h.past.length).toBe(1);
    expect(historyTimeline(h).at(-1)!.label).toBe("피부톤 자동 보정");
  });
});

describe("STC-v1 렌더 매핑 (uSkin)", () => {
  it("buildRenderParams → uSkin = 값/100, 흑백 필름은 (0,0,0)", () => {
    const st = { ...initialEditState(), skinHue: 50, skinSat: -100, skinLum: 30 };
    const p = buildRenderParams(st);
    expect([p.skinHue, p.skinSat, p.skinLum]).toEqual([50, -100, 30]);
    expect(buildUniforms(st, false).uSkin).toEqual([0.5, -1, 0.3]);
    expect(buildUniforms(st, true).uSkin).toEqual([0, 0, 0]);
    expect(buildUniforms(initialEditState(), false).uSkin).toEqual([0, 0, 0]);
    expect(skinUniform(false, 400, -400, NaN)).toEqual([1, -1, 0]);
    expect(skinOn([0, 0, 0])).toBe(false);
    expect(skinOn([0, 0.01, 0])).toBe(true);
  });
});

describe("STC-v1 3D 피부 마스크 wSkin", () => {
  it("실제 피부 표본(밝은 ~ 어두운 피부)은 강하게 잡힌다", () => {
    for (const [k, c] of Object.entries(SKIN)) expect(maskOf(c as unknown as [number, number, number]), k).toBeGreaterThan(0.75);
  });
  it("무채색·순백·순흑·원색 간판·하늘·잎·노란 단풍은 0 에 가깝다", () => {
    for (const [k, c] of Object.entries(NON_SKIN)) expect(maskOf(c as unknown as [number, number, number]), k).toBeLessThan(0.05);
  });
  it("색상 창: 중심 47° = 1, 붉은 쪽 9° · 노란 쪽 95° 에서 0, 중심 부근 평탄 · 연속", () => {
    expect(skinHueW(SKIN_H0)).toBe(1);
    expect(skinHueW(SKIN_H0 - SKIN_HW_RED)).toBeCloseTo(0, 12);
    expect(skinHueW(SKIN_H0 + SKIN_HW_YEL)).toBeCloseTo(0, 12);
    expect(skinHueW(200)).toBe(0);
    let prev = skinHueW(-180);
    for (let h = -180; h <= 180; h += 0.25) {
      const w = skinHueW(h);
      expect(Math.abs(w - prev)).toBeLessThan(0.011);
      prev = w;
    }
  });
  it("채도 창 0.08·0.72, 명도 창 0.06·0.92 근처에서 50 % 로 부드럽게 전이 (계단 없음)", () => {
    // 같은 색상·명도에서 채도만 바꾸는 RGB 램프 (R 고정, G·B 를 섞음)
    let prev = -1, maxStep = 0;
    for (let s = 0; s <= 1; s += 0.001) {
      const v: Vec3 = [0.8, 0.8 * (1 - 0.6 * s), 0.8 * (1 - s)];
      const [L, a, b] = linToOklab(v.map(srgbDec)) as number[];
      const w = skinMask(L!, a!, b!, v);
      if (prev >= 0) maxStep = Math.max(maxStep, Math.abs(w - prev));
      prev = w;
    }
    expect(maxStep).toBeLessThan(0.02);
  });
});

describe("STC-v1 3축 변환 (OKLab, 마스크 w = 1)", () => {
  const L = 0.7, a = 0.07, b = 0.06;
  it("색조: L·C 불변, 최대 회전 ±14°, + 는 노란 쪽(색상 ↑), − 는 붉은/핑크 쪽(색상 ↓)", () => {
    const h0 = Math.atan2(b, a) * 180 / Math.PI;
    for (const k of [1, -1, 0.5]) {
      const [L2, a2, b2] = skinApply(L, a, b, 1, [k, 0, 0]);
      expect(L2).toBeCloseTo(L, 12);
      expect(Math.hypot(a2, b2)).toBeCloseTo(Math.hypot(a, b), 12);
      expect(Math.atan2(b2, a2) * 180 / Math.PI - h0).toBeCloseTo(k * SKIN_HUE_MAX, 9);
    }
  });
  it("혈색(채도): −100 → 크로마 −45 %, 명도 +1.5 % 보전 · +100 → 크로마 +35 %", () => {
    const C = Math.hypot(a, b);
    const lo = skinApply(L, a, b, 1, [0, -1, 0]);
    expect(Math.hypot(lo[1], lo[2]) / C).toBeCloseTo(1 - SKIN_SAT_DOWN, 12);
    expect(lo[0] / L).toBeCloseTo(1 + SKIN_SAT_LIFT, 12);
    const hi = skinApply(L, a, b, 1, [0, 1, 0]);
    expect(Math.hypot(hi[1], hi[2]) / C).toBeCloseTo(1 + SKIN_SAT_UP, 12);
    expect(hi[0]).toBe(L);
  });
  it("투명도(밝기): 중간톤 L 0.5 에서 ±18 %, 0·1 고정, 하이라이트 숄더(L 0.84 → ≤ 3.5 %), 어디서도 ±18 % 를 넘지 않고 단조", () => {
    expect(skinApply(0.84, a, b, 1, [0, 0, 1])[0] / 0.84 - 1).toBeLessThan(0.035);
    expect(skinApply(0.84, a, b, 1, [0, 0, 1])[0]).toBeGreaterThan(0.84);
    expect(skinApply(0.5, a, b, 1, [0, 0, 1])[0]).toBeCloseTo(0.5 * (1 + SKIN_LUM_MAX), 12);
    expect(skinApply(0.5, a, b, 1, [0, 0, -1])[0]).toBeCloseTo(0.5 * (1 - SKIN_LUM_MAX), 12);
    expect(skinApply(1, a, b, 1, [0, 0, 1])[0]).toBe(1);
    for (const k of [1, -1]) {
      let prev = -Infinity;
      for (let x = 0.001; x <= 1; x += 0.001) {
        const y = skinApply(x, a, b, 1, [0, 0, k])[0];
        expect(Math.abs(y / x - 1)).toBeLessThanOrEqual(SKIN_LUM_MAX + 1e-12);
        expect(y).toBeGreaterThan(prev);
        prev = y;
      }
    }
  });
  it("w = 0 이면 그대로", () => {
    expect(skinApply(L, a, b, 0, [1, 1, 1])).toEqual([L, a, b]);
  });
});

describe("STC-v1 postChroma (표시 인코딩 → OKLab → gamutMap)", () => {
  it("세 값이 0 이면 No-op: 비트 단위 동일 (피부·무채색·원색)", () => {
    for (const c of [...Object.values(SKIN), ...Object.values(NON_SKIN)]) {
      const v = rgbV(c);
      expect(postChroma(v, 0, 0, 0, null, null, [0, 0, 0])).toEqual([v[0], v[1], v[2]]);
      expect(postChroma(v, 20, -10, 0, null, null, [0, 0, 0])).toEqual(postChroma(v, 20, -10, 0, null, null, null));
    }
  });
  it("피부: +는 붉은기 완화(색상 ↑ 노란 쪽), −는 노란기 완화(색상 ↓ 핑크 쪽), 회전은 14° 이내", () => {
    for (const c of Object.values(SKIN)) {
      const v = rgbV(c);
      const h0 = hueOf(v);
      const hp = hueOf(postChroma(v, 0, 0, 0, null, null, [1, 0, 0]));
      const hm = hueOf(postChroma(v, 0, 0, 0, null, null, [-1, 0, 0]));
      expect(hp).toBeGreaterThan(h0 + 4);
      expect(hm).toBeLessThan(h0 - 4);
      expect(hp - h0).toBeLessThanOrEqual(SKIN_HUE_MAX + 0.5);
      expect(h0 - hm).toBeLessThanOrEqual(SKIN_HUE_MAX + 0.5);
      // 명도 유지
      expect(Math.abs(LofV(postChroma(v, 0, 0, 0, null, null, [1, 0, 0])) - LofV(v))).toBeLessThan(0.003);
    }
  });
  it("혈색 −100 은 채도를 낮추되 잿빛으로 죽지 않게 명도를 보전, 투명도 +100 은 밝히되 하이라이트를 날리지 않는다", () => {
    const v = rgbV(SKIN.tan);
    const d = postChroma(v, 0, 0, 0, null, null, [0, -1, 0]);
    expect(CofV(d)).toBeLessThan(CofV(v) * 0.7);
    expect(LofV(d)).toBeGreaterThan(LofV(v));
    const fair = rgbV(SKIN.fair);
    const u = postChroma(fair, 0, 0, 0, null, null, [0, 0, 1]);
    expect(LofV(u)).toBeGreaterThan(LofV(fair));
    expect(Math.max(...u)).toBeLessThan(0.97);
    expect(LofV(postChroma(rgbV(SKIN.medium), 0, 0, 0, null, null, [0, 0, 1])) / LofV(rgbV(SKIN.medium))).toBeLessThan(1.18);
  });
  it("피부가 아닌 색(무채색·원색·하늘·잎)은 최대 설정에서도 그대로 (마스크 0 → 입력 그대로, ≤ 0.5/255)", () => {
    for (const c of Object.values(NON_SKIN)) {
      const v = rgbV(c);
      for (const k of [[1, 1, 1], [-1, -1, -1]] as const) {
        const o = postChroma(v, 0, 0, 0, null, null, k);
        for (let i = 0; i < 3; i++) expect(Math.abs(o[i]! - v[i]!) * 255).toBeLessThan(0.5);
      }
    }
  });
  it("밴딩·얼룩 없음: 색상·크로마·명도 스윕에서 국소 ΔE 이득이 유한 (계단이면 무한대), 명도 방향은 단조", () => {
    const labOf = (v: ArrayLike<number>) => linToOklab(Array.from(v, (x) => srgbDec(x))) as number[];
    const sweep = (k: readonly number[], pts: Array<[number, number, number]>) => {
      let gain = 0, pi: number[] | null = null, po: number[] | null = null;
      for (const [L, C, h] of pts) {
        const r = (h * Math.PI) / 180;
        const lin = oklabToLin(L, C * Math.cos(r), C * Math.sin(r)) as number[];
        if (lin.some((x) => x < 0 || x > 1)) { pi = null; continue; }
        const v = lin.map(srgbEnc);
        const li = labOf(v), lo = labOf(postChroma(v, 0, 0, 0, null, null, k));
        if (pi && po) {
          const di = Math.hypot(li[0]! - pi[0]!, li[1]! - pi[1]!, li[2]! - pi[2]!);
          gain = Math.max(gain, Math.hypot(lo[0]! - po[0]!, lo[1]! - po[1]!, lo[2]! - po[2]!) / di);
        }
        pi = li; po = lo;
      }
      return gain;
    };
    const range = (a: number, b: number, d: number) => Array.from({ length: Math.round((b - a) / d) + 1 }, (_, i) => a + i * d);
    for (const k of [[1, 1, 1], [-1, -1, 1], [1, -1, -1], [-1, 1, -1], [0, 0, 1]] as const) {
      for (const L of [0.15, 0.5, 0.7, 0.9]) {
        for (const C of [0.01, 0.03, 0.06, 0.1]) expect(sweep(k, range(-30, 130, 0.2).map((h) => [L, C, h]))).toBeLessThan(6);
        for (const h of [20, 47, 80]) expect(sweep(k, range(0, 0.22, 0.001).map((C) => [L, C, h]))).toBeLessThan(6);
      }
      for (const C of [0.03, 0.08]) for (const h of [20, 47, 80]) expect(sweep(k, range(0, 1, 0.002).map((L) => [L, C, h]))).toBeLessThan(2.5);
      let prevL = -1;
      for (let t = 0.02; t <= 1; t += 0.01) {
        const Lo = LofV(postChroma(rgbV(SKIN.medium).map((x) => x * t) as Vec3, 0, 0, 0, null, null, k));
        expect(Lo).toBeGreaterThan(prevL);
        prevL = Lo;
      }
    }
  });
});

describe("STC-v1 CPU 참조 파이프라인 · GLSL 동기", () => {
  const ctx = (skin?: [number, number, number], mono = false): PixelCtx => ({
    norm: { profile: 0, limitedCV: false, srcToWS: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], rawScale: 1, srcLut: null, samsungFix: false, rgc: false, rolloff: false, wb: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], expGain: 1 },
    ct: 0, vig: 0, aspect: 1.5, lut: { mode: 0 }, mono, ke: 0, kb: 0, curve: null, sat: 0, vib: 0, grain: null, ...(skin ? { skin } : {}),
  });
  const x: Vec3 = [0.35, 0.2, 0.13];
  it("skin (0,0,0) 은 skin 생략과 비트 단위 동일, 흑백 필름은 skin 무시", () => {
    expect(pixelPipelineFromWs(x, 0.5, 0.5, 1, 1, ctx([0, 0, 0]))).toEqual(pixelPipelineFromWs(x, 0.5, 0.5, 1, 1, ctx()));
    expect(pixelPipelineFromWs(x, 0.5, 0.5, 1, 1, ctx([1, 1, 1], true))).toEqual(pixelPipelineFromWs(x, 0.5, 0.5, 1, 1, ctx(undefined, true)));
    expect(pixelPipelineFromWs(x, 0.5, 0.5, 1, 1, ctx([1, 0, 0]))).not.toEqual(pixelPipelineFromWs(x, 0.5, 0.5, 1, 1, ctx()));
  });
  it("fs_post: uSkin 유니폼, !uMono 바이패스 조건, skin.ts 상수로 생성된 함수 포함", () => {
    expect(FS_POST_GLSL).toContain("uniform vec3 uSkin;");
    expect(FS_POST_GLSL).toContain("bool skin = !uMono && (uSkin.x != 0.0 || uSkin.y != 0.0 || uSkin.z != 0.0);");
    expect(FS_POST_GLSL).toContain("float wS = skin ? skinMask(lab, v) : 0.0;");
    expect(FS_POST_GLSL).toContain("if (wS > 0.0) lab = skinApply(lab, wS, uSkin);");
    expect(FS_POST_GLSL).toContain("else if (wS > 0.0) v = srgbEnc(clamp(oklabToLin(lab), 0.0, 1.0));");
    expect(FS_POST_GLSL).toContain(SKIN_GLSL);
    expect(SKIN_GLSL).toContain(`wrap180(hDeg - ${SKIN_H0}.0)`);
    expect(SKIN_GLSL).toContain(`k.x * ${SKIN_HUE_MAX}.0 * w * DEG`);
    expect(SKIN_GLSL).toContain(`${SKIN_SAT_UP} : ${SKIN_SAT_DOWN}`);
    expect(SKIN_GLSL).toContain(`1.0 + ${SKIN_LUM_MAX} * k.z`);
    expect(SKIN_GLSL).toContain("(1.0 - sstep(0.6, 1.0, L))");
    // 피부톤은 흑백 조색 뒤, 채도·생동감 앞
    const i = FS_POST_GLSL.indexOf("if (wS > 0.0) lab"), j = FS_POST_GLSL.indexOf("if (tint) lab"), m = FS_POST_GLSL.indexOf("if (chroma) {");
    expect(j).toBeLessThan(i);
    expect(i).toBeLessThan(m);
  });
  it("그래프 post 패스와 렌더러 참조 컨텍스트가 uSkin 을 전달한다", () => {
    expect(read("../src/lib/render/graph.ts")).toContain("v3: { uSkin: c.s.uSkin }");
    expect(read("../src/lib/render/renderer.ts")).toContain("skin: s.uSkin");
  });
});

describe("STC-v1 피부톤 자동 보정 (computeAutoSkin)", () => {
  /** 64×64 격자: 중앙 skinFrac 비율을 피부색, 나머지는 회색·하늘 */
  const grid = (skin: readonly number[], skinFrac = 0.4) => {
    const W = 64, H = 64, data = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const c = i / (W * H) < skinFrac ? skin : i % 2 ? NON_SKIN.gray : NON_SKIN.sky;
      data.set([c[0]!, c[1]!, c[2]!, 255], i * 4);
    }
    return { width: W, height: H, data };
  };
  it("붉은 홍조 피부 → skinHue +, 노란 피부 → skinHue −", () => {
    const red = computeAutoSkin(grid([220, 140, 130]))!;
    expect(red.skinHue).toBeGreaterThan(20);
    const yel = computeAutoSkin(grid([215, 175, 120]))!;
    expect(yel.skinHue).toBeLessThan(-20);
    for (const r of [red, yel]) for (const v of [r.skinHue, r.skinSat, r.skinLum]) { expect(Number.isInteger(v)).toBe(true); expect(Math.abs(v)).toBeLessThanOrEqual(100); }
  });
  it("자동 결과를 적용하면 평균 색상이 중심(47°)에 가까워진다", () => {
    for (const c of [[220, 140, 130], [215, 175, 120]] as const) {
      const r = computeAutoSkin(grid(c))!;
      const v = rgbV(c);
      const after = hueOf(postChroma(v, 0, 0, 0, null, null, [r.skinHue / 100, r.skinSat / 100, r.skinLum / 100]));
      expect(Math.abs(after - SKIN_H0)).toBeLessThan(Math.abs(hueOf(v) - SKIN_H0));
    }
  });
  it("중심에 가까운 자연스러운 피부는 색조를 거의 건드리지 않는다", () => {
    const r = computeAutoSkin(grid(SKIN.medium))!;
    expect(Math.abs(r.skinHue)).toBeLessThanOrEqual(5);
    expect(r.skinLum).toBe(0);
  });
  it("어두운 피부는 은은하게 밝히고(+, ≤ 50), 과하게 탄 주황 피부는 채도를 진정(−)", () => {
    const dark = computeAutoSkin(grid(SKIN.deep))!;
    expect(dark.skinLum).toBeGreaterThan(0);
    expect(dark.skinLum).toBeLessThanOrEqual(50);
    const tanned = computeAutoSkin(grid([210, 120, 60]))!;
    expect(tanned.skinSat).toBeLessThan(0);
    expect(tanned.skinSat).toBeGreaterThanOrEqual(-40);
  });
  it("피부 픽셀이 너무 적으면 null (안내 토스트)", () => {
    expect(computeAutoSkin(grid(SKIN.medium, 0))).toBeNull();
    expect(computeAutoSkin(grid(SKIN.medium, 0.005))).toBeNull();
    expect(computeAutoSkin({ width: 0, height: 0, data: new Uint8Array(0) })).toBeNull();
  });
});

describe("STC-v1 UI 연결", () => {
  it("컬러 탭: '피부톤 (인물 보정)' 섹션, 슬라이더 3개와 방향 안내, [✨ 피부톤 자동]", () => {
    const src = read("../src/components/studio/tabs/ColorTab.tsx");
    expect(src).toContain("피부톤 (인물 보정)");
    expect(src).toContain("✨ 피부톤 자동");
    for (const k of SKIN_KEYS) expect(src).toContain(`<StateSlider k="${k}"`);
    for (const t of ["← 노란기 완화 (화사)", "붉은기 완화 (진정) →", "← 차분·깨끗", "생기·혈색 →", "← 차분하게", "화사하게 톤업 →"]) expect(src).toContain(t);
  });
  it("Studio: 피부톤 3값만 0 으로 둔 출력으로 분석, 히스토리 라벨, 피부 부족 토스트", () => {
    const src = read("../src/components/studio/Studio.tsx");
    expect(src).toContain("computeAutoSkin(renderer.readOutputWithoutSkin())");
    expect(src).toContain('label: "피부톤 자동 보정"');
    expect(src).toContain("onAutoSkin={runAutoSkin}");
    expect(src).toContain("피부톤으로 보이는 영역이 너무 적습니다");
  });
});
