// 섹션 9.3 실효값 — 사용자 슬라이더 + 레시피(숨은 레이어) → 셰이더 전달 값.
import { LINEAR_CURVE, type CurveState } from "./curve";
import { recipeFor, recipeGrain } from "./recipes";

export type AdjustKey =
  | "exposure" | "lightBalance" | "brightness" | "contrast" | "highlights" | "shadows" | "whites" | "blacks"
  | "temp" | "tint" | "saturation" | "vibrance" | "clarity" | "sharpen" | "dehaze" | "vignette" | "grainAmount" | "grainSize";

export type Adjust = Record<AdjustKey, number>;

export interface SliderSpec { key: AdjustKey; label: string; min: number; max: number; step: number }

const S100 = (key: AdjustKey, label: string): SliderSpec => ({ key, label, min: -100, max: 100, step: 1 });

/** 섹션 14-5 슬라이더 순서 */
export const ADJUST_SLIDERS: ReadonlyArray<SliderSpec> = [
  { key: "exposure", label: "노출", min: -5, max: 5, step: 0.01 },
  S100("lightBalance", "라이트 밸런스"),
  S100("brightness", "밝기"),
  S100("contrast", "대비"),
  S100("highlights", "하이라이트"),
  S100("shadows", "쉐도우"),
  S100("whites", "흰색"),
  S100("blacks", "검정"),
  S100("temp", "색온도"),
  S100("tint", "틴트"),
  S100("saturation", "채도"),
  S100("vibrance", "생동감"),
  S100("clarity", "명료도"),
  { key: "sharpen", label: "선명도", min: 0, max: 150, step: 1 },
  S100("dehaze", "디헤이즈"),
  S100("vignette", "비네팅"),
];

export const GRAIN_SLIDERS: ReadonlyArray<SliderSpec> = [
  { key: "grainAmount", label: "그레인 강도", min: 0, max: 100, step: 1 },
  { key: "grainSize", label: "그레인 크기", min: 0, max: 100, step: 1 },
];

export const SLIDER_RANGE: Readonly<Record<AdjustKey, [number, number]>> = Object.fromEntries(
  [...ADJUST_SLIDERS, ...GRAIN_SLIDERS].map((s) => [s.key, [s.min, s.max]]),
) as Record<AdjustKey, [number, number]>;

export const ZERO_ADJUST: Adjust = {
  exposure: 0, lightBalance: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temp: 0, tint: 0, saturation: 0, vibrance: 0, clarity: 0, sharpen: 0, dehaze: 0, vignette: 0, grainAmount: 0, grainSize: 0,
};

export type Level = 0 | 1 | 2;

export interface RenderParams {
  /** "none"(원본) 또는 manifest sims id */
  sim: string;
  /** 외부 Look LUT (lutStore role "look") id. 있으면 uLutMode 2 */
  lookLutId: string | null;
  /** Samsung Log / D-Log M 소스 변환 LUT id. null 이면 sourceProfile 일치하는 첫 LUT */
  sourceLutId: string | null;
  adjust: Adjust;
  cce: "recipe" | Level;
  fxb: "recipe" | Level;
  hdf: "recipe" | boolean;
  curve: CurveState;
  /** EXIF 0x8827 (acros-iso 규칙) */
  iso: number | null;
}

export const DEFAULT_PARAMS: RenderParams = {
  sim: "none", lookLutId: null, sourceLutId: null, adjust: ZERO_ADJUST, cce: "recipe", fxb: "recipe", hdf: "recipe", curve: LINEAR_CURVE, iso: null,
};

export interface Effective {
  adjust: Adjust;
  cce: Level;
  fxb: Level;
  hdf: boolean;
  mono: boolean;
}

const clampTo = (k: AdjustKey, v: number) => Math.min(SLIDER_RANGE[k][1], Math.max(SLIDER_RANGE[k][0], v));

/** 실효 수치 = clamp(사용자 + 레시피, 범위). grainSize = 사용자 > 0 ? 사용자 : 레시피. 흑백은 cce·fxb = 0 */
export function effectiveParams(p: RenderParams, mono: boolean): Effective {
  const rc = recipeFor(p.sim);
  const g = recipeGrain(rc, p.iso);
  const u = p.adjust;
  const adjust: Adjust = {
    ...u,
    sharpen: clampTo("sharpen", u.sharpen + rc.sharpen),
    clarity: clampTo("clarity", u.clarity + rc.clarity),
    highlights: clampTo("highlights", u.highlights + rc.highlights),
    shadows: clampTo("shadows", u.shadows + rc.shadows),
    vignette: clampTo("vignette", u.vignette + rc.vignette),
    grainAmount: clampTo("grainAmount", u.grainAmount + g.amount),
    grainSize: u.grainSize > 0 ? u.grainSize : g.size,
  };
  return {
    adjust,
    cce: mono ? 0 : p.cce === "recipe" ? rc.cce : p.cce,
    fxb: mono ? 0 : p.fxb === "recipe" ? rc.fxb : p.fxb,
    hdf: p.hdf === "recipe" ? rc.hdf : p.hdf,
    mono,
  };
}

export const KE_LEVELS = [0, 0.1, 0.2] as const;
export const KB_LEVELS = [0, 0.12, 0.24] as const;

/** 셰이더 전달용 스칼라 (섹션 9.3) */
export interface ScalarUniforms {
  uSh: number; uHi: number; uWh: number; uBk: number; uBr: number; uLb: number; uCt: number;
  uVig: number; uSat: number; uVib: number; uClarity: number; uSharpen: number; uGrainAmt: number; uDehaze: number;
  uKe: number; uKb: number; uExpGain: number;
}

export function scalarUniforms(e: Effective): ScalarUniforms {
  const a = e.adjust;
  return {
    uSh: a.shadows / 100, uHi: a.highlights / 100, uWh: a.whites / 100, uBk: a.blacks / 100, uBr: a.brightness / 100, uLb: a.lightBalance / 100, uCt: a.contrast / 100,
    uVig: a.vignette, uSat: a.saturation, uVib: a.vibrance, uClarity: a.clarity, uSharpen: a.sharpen, uGrainAmt: a.grainAmount, uDehaze: a.dehaze,
    uKe: KE_LEVELS[e.cce], uKb: KB_LEVELS[e.fxb], uExpGain: Math.pow(2, Math.min(5, Math.max(-5, a.exposure))),
  };
}

/** 베이스 톤 단계 실행 여부 (섹션 7.2-4) */
export function toneOpsOn(e: Effective): boolean {
  const a = e.adjust;
  return a.shadows !== 0 || a.highlights !== 0 || a.whites !== 0 || a.blacks !== 0 || a.brightness !== 0 || a.lightBalance !== 0;
}

/** EXIF 요약 "ISO N" → N */
export function isoFromSummary(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(iso);
  return m ? Number(m[1]) : null;
}
