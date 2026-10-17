// 컬러 탭 도구: 컬러 자동 보정(ACA-v1)과 화이트밸런스 스포이트. 입력은 모두 WB 적용 전(Pre-WB) 작업 색공간 선형 RGBA 격자다.
// 수식 정의는 docs/COLOR_SCIENCE.md §16.10 / §16.11.
import { linToOklab } from "../color/fse/engine.mjs";
import { apply3, wbMatrix } from "../render/wb";
import { normalizeValue } from "./state";

export interface RgbaGrid { width: number; height: number; data: ArrayLike<number> }
export type Rgb = [number, number, number];

/** 스포이트 표본 반경: 5×5 = 반경 2 */
export const PICK_RADIUS = 2;
const EPS = 1e-6;

export interface AutoColorResult { temp: number; tint: number; vibrance: number; saturation: number; /** 분석에 쓰인 픽셀 수 */ used: number }

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const nz = (x: number) => (Object.is(x, -0) || x === 0 ? 0 : x);

/** 정규화 좌표 (u, v ∈ [0,1], 표시 방향) → 격자 중심 픽셀 */
export function uvToPixel(u: number, v: number, w: number, h: number): { x: number; y: number } {
  return { x: clamp(Math.floor(u * w), 0, w - 1), y: clamp(Math.floor(v * h), 0, h - 1) };
}

/** (u,v) 주변 (2r+1)² 창의 선형 RGB 평균. 창은 이미지 경계 안으로 잘라낸다. 유한하지 않은 값은 제외, 표본이 없으면 null */
export function sampleWindowMean(g: RgbaGrid, u: number, v: number, r = PICK_RADIUS): Rgb | null {
  const { x, y } = uvToPixel(u, v, g.width, g.height);
  let n = 0, sr = 0, sg = 0, sb = 0;
  for (let j = Math.max(0, y - r); j <= Math.min(g.height - 1, y + r); j++) {
    for (let i = Math.max(0, x - r); i <= Math.min(g.width - 1, x + r); i++) {
      const o = (j * g.width + i) * 4;
      const R = g.data[o]!, G = g.data[o + 1]!, B = g.data[o + 2]!;
      if (!Number.isFinite(R) || !Number.isFinite(G) || !Number.isFinite(B)) continue;
      sr += R; sg += G; sb += B; n++;
    }
  }
  return n === 0 ? null : [sr / n, sg / n, sb / n];
}

/** 무채색 오차: 채널 로그비의 제곱합 (밝기에 무관) */
export function neutralError(rgb: ArrayLike<number>): number {
  const r = Math.log(Math.max(rgb[0]!, EPS)), g = Math.log(Math.max(rgb[1]!, EPS)), b = Math.log(Math.max(rgb[2]!, EPS));
  return (r - g) ** 2 + (b - g) ** 2;
}

/**
 * wbMatrix(temp, tint)·rgb 가 R=G=B 에 가장 가까운 (temp, tint) ∈ [−100,100]² 정수.
 * 격자 10 → 3 → 1 단계로 좁혀 가는 탐색. 동률이면 |temp|+|tint| 가 작은 쪽. rgb 가 거의 검정이면 null.
 */
export function solveNeutralWb(rgb: ArrayLike<number>): { temp: number; tint: number; error: number } | null {
  const m = Math.max(rgb[0]!, rgb[1]!, rgb[2]!);
  if (!(m > EPS) || !Number.isFinite(m)) return null;
  const err = (t: number, k: number) => neutralError(apply3(wbMatrix(t, k), rgb));
  let best = { t: 0, k: 0, e: err(0, 0) };
  const consider = (t: number, k: number) => {
    const tt = clamp(t, -100, 100), kk = clamp(k, -100, 100);
    const e = err(tt, kk);
    if (e < best.e - 1e-15 || (Math.abs(e - best.e) <= 1e-15 && Math.abs(tt) + Math.abs(kk) < Math.abs(best.t) + Math.abs(best.k))) best = { t: tt, k: kk, e };
  };
  for (let t = -100; t <= 100; t += 10) for (let k = -100; k <= 100; k += 10) consider(t, k);
  for (const step of [3, 1]) {
    const c = { ...best };
    const span = step === 3 ? 9 : 3;
    for (let t = c.t - span; t <= c.t + span; t += step) for (let k = c.k - span; k <= c.k + span; k += step) consider(t, k);
  }
  return { temp: nz(normalizeValue("temp", best.t)), tint: nz(normalizeValue("tint", best.k)), error: best.e };
}

/** 스포이트: (u,v) 주변 5×5 평균을 중성으로 만드는 색온도·틴트. 표본이 없거나 너무 어두우면 null */
export function solveEyedropper(g: RgbaGrid, u: number, v: number): { temp: number; tint: number; sample: Rgb } | null {
  const sample = sampleWindowMean(g, u, v);
  if (!sample) return null;
  const s = solveNeutralWb(sample);
  return s ? { temp: s.temp, tint: s.tint, sample } : null;
}

/** (temp, tint) → 필름·ISP·톤 커브 등 S0 이후 전체 픽셀 경로를 통과한 최종 표시 RGB(sRGB 인코딩, 0..1) */
export type OutputEval = (temp: number, tint: number) => ArrayLike<number>;

/** 최종 출력 무채색 오차: 표시 RGB 채널 차이의 제곱합 */
export function outputNeutralError(rgb: ArrayLike<number>): number {
  return (rgb[0]! - rgb[1]!) ** 2 + (rgb[2]! - rgb[1]!) ** 2;
}

/**
 * 최종 렌더링 RGB 가 R=G=B 가 되는 (temp, tint) ∈ [−100,100]² 정수 탐색.
 * 격자 10 → (best ± 9, 3) → (best ± 3, 1) 의 다단계 좌표 격자 탐색. 동률이면 |temp|+|tint| 가 작은 쪽.
 * 필름 LUT 가 중성을 틴트해도 그 틴트까지 상쇄하는 값을 찾는다. 출력이 거의 검정/백이면 오차가 0 이어도 (0,0) 이 선택된다.
 */
export function solveNeutralOutput(evalOut: OutputEval): { temp: number; tint: number; error: number; out: Rgb } {
  const run = (t: number, k: number) => { const o = evalOut(t, k); return { e: outputNeutralError(o), o: [o[0]!, o[1]!, o[2]!] as Rgb }; };
  const z = run(0, 0);
  let best = { t: 0, k: 0, e: z.e, o: z.o };
  const consider = (t: number, k: number) => {
    const tt = clamp(t, -100, 100), kk = clamp(k, -100, 100);
    const r = run(tt, kk);
    if (r.e < best.e - 1e-12 || (Math.abs(r.e - best.e) <= 1e-12 && Math.abs(tt) + Math.abs(kk) < Math.abs(best.t) + Math.abs(best.k))) best = { t: tt, k: kk, e: r.e, o: r.o };
  };
  for (let t = -100; t <= 100; t += 10) for (let k = -100; k <= 100; k += 10) consider(t, k);
  for (const [step, span] of [[3, 9], [1, 3]] as const) {
    const c = { ...best };
    for (let t = c.t - span; t <= c.t + span; t += step) for (let k = c.k - span; k <= c.k + span; k += step) consider(t, k);
  }
  return { temp: nz(normalizeValue("temp", best.t)), tint: nz(normalizeValue("tint", best.k)), error: best.e, out: best.o };
}

/**
 * 스포이트(최종 출력 기준): (u,v) 주변 5×5 Pre-WB 평균 표본이 현재 필름·파라미터를 통과한 뒤 R=G=B 가 되도록 하는 temp·tint.
 * makeEval(sample) 은 표본(WB 적용 전 WS 선형 RGB)을 최종 표시 RGB 로 보내는 함수를 만든다. 표본이 없거나 너무 어두우면 null.
 */
export function solveEyedropperOutput(
  g: RgbaGrid, u: number, v: number, makeEval: (sample: Rgb) => OutputEval,
): { temp: number; tint: number; sample: Rgb; out: Rgb } | null {
  const sample = sampleWindowMean(g, u, v);
  if (!sample || !(Math.max(sample[0], sample[1], sample[2]) > EPS)) return null;
  const r = solveNeutralOutput(makeEval(sample));
  return { temp: r.temp, tint: r.tint, sample, out: r.out };
}

// ── 컬러 자동 보정 ACA-v1 ──────────────────────────────────────────────────
/** 클리핑·너무 어두운 픽셀 제외 기준 (선형 RGB) */
export const ACA_MIN = 0.01;
export const ACA_MAX = 0.98;
/** 광원 추정에 쓰는 저채도 픽셀 비율 */
export const ACA_NEUTRAL_FRACTION = 0.5;
/** 사진의 OKLab 평균 채도 목표 */
export const ACA_TARGET_CHROMA = 0.09;
export const ACA_MIN_FRACTION = 0.02;

const hueDeg = (a: number, b: number) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
/** 피부톤 후보: OKLab 색상 20°~70°, 채도 0.04~0.14, 명도 0.3~0.9 */
export const isSkinLike = (L: number, a: number, b: number): boolean => {
  const C = Math.hypot(a, b), h = hueDeg(a, b);
  return L >= 0.3 && L <= 0.9 && C >= 0.04 && C <= 0.14 && h >= 20 && h <= 70;
};

/**
 * 컬러 자동 보정. Robust Gray-World:
 *  1) 유한하고 모든 채널이 [ACA_MIN, ACA_MAX] 안인 픽셀만 유효(순백·순흑·클리핑 제외). 유효 비율 < 2% 면 null
 *  2) 유효 픽셀을 OKLab 채도 오름차순으로 정렬해 아래 50% 의 평균 RGB 를 광원 추정치로 → solveNeutralWb
 *  3) 확정 WB 를 적용한 유효 픽셀의 평균 OKLab 채도 mC, 피부톤 비율 fs 로 생동감·채도 결정:
 *     d = clamp((0.09 − mC)/0.09, −1, 1), vibrance = clamp(round(60·d), −20, 60),
 *     saturation = clamp(round(15·d·(1 − min(1, 2·fs))), −10, 15)
 */
export function computeAutoColor(g: RgbaGrid): AutoColorResult | null {
  const n = g.width * g.height;
  if (n === 0) return null;
  const px: Array<{ rgb: Rgb; c: number }> = [];
  for (let i = 0; i < n; i++) {
    const r = g.data[i * 4]!, gg = g.data[i * 4 + 1]!, b = g.data[i * 4 + 2]!;
    if (!Number.isFinite(r) || !Number.isFinite(gg) || !Number.isFinite(b)) continue;
    if (Math.min(r, gg, b) < ACA_MIN || Math.max(r, gg, b) > ACA_MAX) continue;
    const lab = linToOklab([r, gg, b]) as number[];
    px.push({ rgb: [r, gg, b], c: Math.hypot(lab[1]!, lab[2]!) });
  }
  if (px.length < ACA_MIN_FRACTION * n) return null;
  const sorted = [...px].sort((p, q) => p.c - q.c);
  const keep = Math.max(1, Math.floor(sorted.length * ACA_NEUTRAL_FRACTION));
  const mean: Rgb = [0, 0, 0];
  for (let i = 0; i < keep; i++) for (let c = 0; c < 3; c++) mean[c]! += sorted[i]!.rgb[c]!;
  for (let c = 0; c < 3; c++) mean[c]! /= keep;
  const wb = solveNeutralWb(mean);
  const temp = wb?.temp ?? 0, tint = wb?.tint ?? 0;
  const M = wbMatrix(temp, tint);
  let sumC = 0, skin = 0;
  for (const p of px) {
    const lab = linToOklab(apply3(M, p.rgb)) as number[];
    sumC += Math.hypot(lab[1]!, lab[2]!);
    if (isSkinLike(lab[0]!, lab[1]!, lab[2]!)) skin++;
  }
  const mC = sumC / px.length, fs = skin / px.length;
  const d = clamp((ACA_TARGET_CHROMA - mC) / ACA_TARGET_CHROMA, -1, 1);
  return {
    temp, tint, used: px.length,
    vibrance: nz(normalizeValue("vibrance", clamp(Math.round(60 * d), -20, 60))),
    saturation: nz(normalizeValue("saturation", clamp(Math.round(15 * d * (1 - Math.min(1, 2 * fs))), -10, 15))),
  };
}
