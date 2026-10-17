// 컬러 탭 도구: 컬러 자동 보정(ACA-v1)과 화이트밸런스 스포이트. 입력은 모두 WB 적용 전(Pre-WB) 작업 색공간 선형 RGBA 격자다.
// 수식 정의는 docs/COLOR_SCIENCE.md §16.10 / §16.11.
import { linToOklab, srgbDec } from "../color/fse/engine.mjs";
import { SKIN_H0, SKIN_HUE_MAX, SKIN_LUM_MAX, SKIN_SAT_DOWN, SKIN_SAT_UP, skinMask } from "../render/skin";
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

/** 스포이트가 기준으로 쓸 수 있는 표본 범위: 너무 어두운 암부·완전히 날아간 순백은 역산하지 않는다 */
export const PICK_DARK_MAX = 0.005;
export const PICK_WHITE_MIN = 0.995;
export function isPickableSample(s: ArrayLike<number> | null | undefined): boolean {
  if (!s || s.length < 3) return false;
  const [r, g, b] = [s[0]!, s[1]!, s[2]!];
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return false;
  return !(Math.max(r, g, b) < PICK_DARK_MAX) && !(Math.min(r, g, b) > PICK_WHITE_MIN);
}

/** 솔버 결과 → [−100,100] 정수. 유한하지 않으면 null */
export function sanitizeWbValue(val: number): number | null {
  return Number.isFinite(val) ? nz(Math.round(clamp(val, -100, 100))) : null;
}

/** 스포이트: (u,v) 주변 5×5 평균을 중성으로 만드는 색온도·틴트. 표본이 없거나 너무 어두우면 null */
export function solveEyedropper(g: RgbaGrid, u: number, v: number): { temp: number; tint: number; sample: Rgb } | null {
  const sample = sampleWindowMean(g, u, v);
  if (!isPickableSample(sample)) return null;
  const s = solveNeutralWb(sample!);
  const temp = s ? sanitizeWbValue(s.temp) : null, tint = s ? sanitizeWbValue(s.tint) : null;
  return temp === null || tint === null ? null : { temp, tint, sample: sample! };
}

/** (temp, tint) → 필름·ISP·톤 커브 등 S0 이후 전체 픽셀 경로를 통과한 최종 표시 RGB(sRGB 인코딩, 0..1) */
export type OutputEval = (temp: number, tint: number) => ArrayLike<number>;

/** 후보 출력이 (0,0) 출력 최대 채널의 이 비율 미만이면 검정 붕괴로 본다 */
export const OUT_COLLAPSE_RATIO = 0.25;
export const OUT_WHITE_MIN = 0.995;

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
  // 유한하지 않은 출력(NaN/Infinity)은 오차 +∞ 로 두어 후보에서 탈락시킨다
  const z0 = evalOut(0, 0);
  const z0max = Math.max(z0[0]!, z0[1]!, z0[2]!), z0min = Math.min(z0[0]!, z0[1]!, z0[2]!);
  const run = (t: number, k: number) => {
    const o = evalOut(t, k);
    let e = outputNeutralError(o);
    // 출력이 검정/순백으로 붕괴한 후보는 R=G=B 오차가 0 이어도 해가 아니다 (예: 백색점이 물리 범위를 벗어난 극단 조합)
    const mx = Math.max(o[0]!, o[1]!, o[2]!), mn = Math.min(o[0]!, o[1]!, o[2]!);
    if (mx < OUT_COLLAPSE_RATIO * z0max || (mn > OUT_WHITE_MIN && z0min <= OUT_WHITE_MIN)) e = Infinity;
    return { e: Number.isFinite(e) ? e : Infinity, o: [o[0]!, o[1]!, o[2]!] as Rgb };
  };
  const z = { e: outputNeutralError(z0), o: [z0[0]!, z0[1]!, z0[2]!] as Rgb };
  if (!Number.isFinite(z.e)) z.e = Infinity;
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
  return { temp: sanitizeWbValue(best.t) ?? 0, tint: sanitizeWbValue(best.k) ?? 0, error: best.e, out: best.o };
}

/**
 * 스포이트(최종 출력 기준): (u,v) 주변 5×5 Pre-WB 평균 표본이 현재 필름·파라미터를 통과한 뒤 R=G=B 가 되도록 하는 temp·tint.
 * makeEval(sample) 은 표본(WB 적용 전 WS 선형 RGB)을 최종 표시 RGB 로 보내는 함수를 만든다. 표본이 없거나 너무 어두우면 null.
 */
export function solveEyedropperOutput(
  g: RgbaGrid, u: number, v: number, makeEval: (sample: Rgb) => OutputEval,
): { temp: number; tint: number; sample: Rgb; out: Rgb } | null {
  return solveEyedropperSample(sampleWindowMean(g, u, v), makeEval);
}

/** 이미 계산된 Pre-WB 표본(5×5 평균)으로 풀이: 범위 밖 표본은 null, 결과는 항상 유한한 [−100,100] 정수 */
export function solveEyedropperSample(
  sample: Rgb | null, makeEval: (sample: Rgb) => OutputEval,
): { temp: number; tint: number; sample: Rgb; out: Rgb } | null {
  if (!sample || !isPickableSample(sample)) return null;
  const inner = makeEval(sample);
  // WB 행렬이 표본을 음수·비유한으로 보내는 후보(백색점이 물리 범위 밖)는 평가하지 않고 탈락시킨다
  const guarded: OutputEval = (t, k) => {
    const x = apply3(wbMatrix(t, k), sample);
    return x.every((q) => Number.isFinite(q) && q > 0) ? inner(t, k) : [NaN, NaN, NaN];
  };
  const r = solveNeutralOutput(guarded);
  if (!Number.isFinite(r.temp) || !Number.isFinite(r.tint) || !Number.isFinite(r.error)) return null;
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

interface ValidPx { rgb: Rgb; c: number }

/** 유한하고 모든 채널이 [ACA_MIN, ACA_MAX] 안인 픽셀(순백·순흑·클리핑 제외). 유효 비율 < 2% 면 null */
function validPixels(g: RgbaGrid): ValidPx[] | null {
  const n = g.width * g.height;
  if (n === 0) return null;
  const px: ValidPx[] = [];
  for (let i = 0; i < n; i++) {
    const r = g.data[i * 4]!, gg = g.data[i * 4 + 1]!, b = g.data[i * 4 + 2]!;
    if (!Number.isFinite(r) || !Number.isFinite(gg) || !Number.isFinite(b)) continue;
    if (Math.min(r, gg, b) < ACA_MIN || Math.max(r, gg, b) > ACA_MAX) continue;
    const lab = linToOklab([r, gg, b]) as number[];
    px.push({ rgb: [r, gg, b], c: Math.hypot(lab[1]!, lab[2]!) });
  }
  return px.length < ACA_MIN_FRACTION * n ? null : px;
}

function wbOf(px: ValidPx[]): { temp: number; tint: number } {
  const sorted = [...px].sort((p, q) => p.c - q.c);
  const keep = Math.max(1, Math.floor(sorted.length * ACA_NEUTRAL_FRACTION));
  const mean: Rgb = [0, 0, 0];
  for (let i = 0; i < keep; i++) for (let c = 0; c < 3; c++) mean[c]! += sorted[i]!.rgb[c]!;
  for (let c = 0; c < 3; c++) mean[c]! /= keep;
  const wb = solveNeutralWb(mean);
  return { temp: wb?.temp ?? 0, tint: wb?.tint ?? 0 };
}

function chromaOf(px: ValidPx[], temp: number, tint: number): { vibrance: number; saturation: number } {
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
    vibrance: nz(normalizeValue("vibrance", clamp(Math.round(60 * d), -20, 60))),
    saturation: nz(normalizeValue("saturation", clamp(Math.round(15 * d * (1 - Math.min(1, 2 * fs))), -10, 15))),
  };
}

/** 자동 화이트밸런스: Robust Gray-World 광원 추정 → temp·tint 만 (채도·생동감은 건드리지 않는다) */
export function computeAutoWb(g: RgbaGrid): { temp: number; tint: number; used: number } | null {
  const px = validPixels(g);
  return px ? { ...wbOf(px), used: px.length } : null;
}

/** 자동 채도·생동감: 현재 (temp, tint) 를 적용한 상태의 채도 분포·피부톤 비중으로 vibrance·saturation 만 결정 */
export function computeAutoChroma(g: RgbaGrid, temp: number, tint: number): { vibrance: number; saturation: number; used: number } | null {
  const px = validPixels(g);
  return px ? { ...chromaOf(px, temp, tint), used: px.length } : null;
}

/**
 * 컬러 자동 보정(WB + 채도·생동감 한 번에). Robust Gray-World:
 *  1) 유효 픽셀(위) 2) 채도 아래 50% 평균 RGB → solveNeutralWb 3) 확정 WB 적용 후 chromaOf
 *  d = clamp((0.09 − mC)/0.09, −1, 1), vibrance = clamp(round(60·d), −20, 60),
 *  saturation = clamp(round(15·d·(1 − min(1, 2·fs))), −10, 15)
 */
export function computeAutoColor(g: RgbaGrid): AutoColorResult | null {
  const px = validPixels(g);
  if (!px) return null;
  const wb = wbOf(px);
  return { ...wb, ...chromaOf(px, wb.temp, wb.tint), used: px.length };
}

// ── 피부톤 자동 보정 STC-v1 (COLOR_SCIENCE §16.14) ──────────────────────────
/** 피부 후보: skinMask ≥ 0.25 인 픽셀 (가중치 = wSkin) */
export const SKIN_AUTO_MIN_W = 0.25;
/** 피부 후보의 가중 면적이 분석 픽셀의 이 비율 미만이면 보정하지 않는다 */
export const SKIN_AUTO_MIN_FRACTION = 0.015;
/** 목표: 색상 = 마스크 중심(47°), 크로마 상한 0.095, 명도 하한 0.62 → 0.66 */
export const SKIN_AUTO_C_MAX = 0.095;
export const SKIN_AUTO_C_PALE = 0.045;
export const SKIN_AUTO_L_MIN = 0.62;
export const SKIN_AUTO_L_TARGET = 0.66;
/** 자연스러움을 위해 계산된 교정량의 일부만 적용한다 */
export const SKIN_AUTO_GAIN = 0.8;

export interface AutoSkinResult {
  skinHue: number; skinSat: number; skinLum: number;
  /** 피부 후보의 가중 면적 비율 (0..1) */
  fraction: number;
  /** 가중 평균 OKLab 명도·크로마·색상° */
  meanL: number; meanC: number; meanH: number;
}

/**
 * 피부톤 자동 보정. 입력 = 피부톤 3값을 0 으로 둔 현재 최종 출력(표시 인코딩 RGBA8, 필름·WB 적용 상태).
 *  1) 각 픽셀 w = skinMask(OKLab, v), w ≥ 0.25 만 가중치 w 로 누적 → 가중 평균 (a, b), L, C
 *  2) 가중 면적 Σw / N < 1.5 % 면 null (피부가 거의 없음)
 *  3) 색조: dh = wrap180(h̄ − 47°), |dh| < 1.5° 면 0, 아니면 skinHue = clamp(round(−0.8·dh/14·100), −70, 70)
 *     (붉게 치우침 dh < 0 → +, 누렇게 치우침 dh > 0 → −)
 *  4) 채도: C̄ > 0.095 → g = 0.095/C̄, skinSat = max(−40, round(0.8·(g − 1)/0.45·100)),
 *           C̄ < 0.045 → g = 0.045/C̄, skinSat = min(15, round(0.8·(g − 1)/0.35·100)), 그 외 0
 *  5) 밝기: L̄ < 0.62 → skinLum = clamp(round(0.8·(0.66/L̄ − 1)/(0.18·4L̄(1 − L̄))·100), 0, 50), 그 외 0
 */
export function computeAutoSkin(g: { width: number; height: number; data: ArrayLike<number> }, scale = 255): AutoSkinResult | null {
  const n = g.width * g.height;
  if (n === 0) return null;
  let sw = 0, sa = 0, sb = 0, sL = 0, sC = 0, used = 0;
  for (let i = 0; i < n; i++) {
    const v = [g.data[i * 4]! / scale, g.data[i * 4 + 1]! / scale, g.data[i * 4 + 2]! / scale];
    if (!v.every(Number.isFinite)) continue;
    used++;
    const [L, a, b] = linToOklab(v.map((q) => srgbDec(Math.min(1, Math.max(0, q))))) as number[];
    const w = skinMask(L!, a!, b!, v);
    if (w < SKIN_AUTO_MIN_W) continue;
    sw += w; sa += w * a!; sb += w * b!; sL += w * L!; sC += w * Math.hypot(a!, b!);
  }
  if (used === 0) return null;
  const fraction = sw / used;
  if (fraction < SKIN_AUTO_MIN_FRACTION) return null;
  const meanL = sL / sw, meanC = sC / sw;
  const meanH = ((Math.atan2(sb / sw, sa / sw) * 180) / Math.PI + 360) % 360;
  const dh = ((meanH - SKIN_H0 + 540) % 360) - 180;
  const hue = Math.abs(dh) < 1.5 ? 0 : clamp(Math.round((-SKIN_AUTO_GAIN * dh / SKIN_HUE_MAX) * 100), -70, 70);
  let sat = 0;
  if (meanC > SKIN_AUTO_C_MAX) sat = Math.max(-40, Math.round((SKIN_AUTO_GAIN * (SKIN_AUTO_C_MAX / meanC - 1)) / SKIN_SAT_DOWN * 100));
  else if (meanC < SKIN_AUTO_C_PALE) sat = Math.min(15, Math.round((SKIN_AUTO_GAIN * (SKIN_AUTO_C_PALE / meanC - 1)) / SKIN_SAT_UP * 100));
  let lum = 0;
  if (meanL < SKIN_AUTO_L_MIN) lum = clamp(Math.round((SKIN_AUTO_GAIN * (SKIN_AUTO_L_TARGET / meanL - 1)) / (SKIN_LUM_MAX * 4 * meanL * (1 - meanL)) * 100), 0, 50);
  return {
    skinHue: nz(normalizeValue("skinHue", hue)), skinSat: nz(normalizeValue("skinSat", sat)), skinLum: nz(normalizeValue("skinLum", lum)),
    fraction, meanL, meanC, meanH,
  };
}
