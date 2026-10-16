// 섹션 9 원터치 마스터 레시피 — 실기 SOOC 공장 기본값 표. 이 파일이 유일 기준이다(COLOR_SCIENCE §15).
// 톤과 색 성격은 FSE-v1 LUT 가 담당하고, 레시피는 LUT 밖의 ISP 단계만 정의한다.
// manifest 의 shaderHints 는 이 표에 이미 포함되어 있으므로 렌더러는 shaderHints 를 읽지 않는다(이중 적용 금지).

export type RecipeGrain = { amount: number; size: number } | "acros-iso";
export interface Recipe {
  sharpen: number;
  clarity: number;
  highlights: number;
  shadows: number;
  vignette: number;
  grain: RecipeGrain;
  /** 0 끔 / 1 약 / 2 강 */
  cce: 0 | 1 | 2;
  fxb: 0 | 1 | 2;
  hdf: boolean;
}

/** 필드 순서: sharpen, clarity, highlights, shadows, vignette, grain, cce, fxb, hdf */
const r = (sharpen: number, clarity: number, highlights: number, shadows: number, vignette: number, grain: RecipeGrain, cce: 0 | 1 | 2, fxb: 0 | 1 | 2, hdf: boolean): Recipe =>
  Object.freeze({ sharpen, clarity, highlights, shadows, vignette, grain, cce, fxb, hdf });

const G0 = { amount: 0, size: 0 } as const;
const FUJI_COLOR = r(35, 0, 0, 0, 0, G0, 0, 0, false);
const FUJI_ACROS = r(45, 0, 0, 0, 0, "acros-iso", 0, 0, false);
const FUJI_MONO = r(35, 0, 0, 0, 0, G0, 0, 0, false);
const RICOH_STD = r(50, 0, 0, 0, 0, G0, 0, 0, false);

export const RECIPES: Readonly<Record<string, Recipe>> = Object.freeze({
  none: r(0, 0, 0, 0, 0, G0, 0, 0, false),
  "fuji-provia": FUJI_COLOR,
  "fuji-velvia": FUJI_COLOR,
  "fuji-astia": FUJI_COLOR,
  "fuji-classic-chrome": FUJI_COLOR,
  "fuji-reala-ace": FUJI_COLOR,
  "fuji-pro-neg-hi": FUJI_COLOR,
  "fuji-pro-neg-std": FUJI_COLOR,
  "fuji-classic-neg": FUJI_COLOR,
  "fuji-nostalgic-neg": FUJI_COLOR,
  "fuji-eterna": FUJI_COLOR,
  "fuji-eterna-bleach-bypass": FUJI_COLOR,
  "fuji-acros": FUJI_ACROS,
  "fuji-acros-ye": FUJI_ACROS,
  "fuji-acros-r": FUJI_ACROS,
  "fuji-acros-g": FUJI_ACROS,
  "fuji-monochrome": FUJI_MONO,
  "fuji-monochrome-ye": FUJI_MONO,
  "fuji-monochrome-r": FUJI_MONO,
  "fuji-monochrome-g": FUJI_MONO,
  "fuji-sepia": FUJI_MONO,
  "ricoh-standard": RICOH_STD,
  "ricoh-vivid": RICOH_STD,
  "ricoh-positive-film": RICOH_STD,
  "ricoh-negative-film": RICOH_STD,
  "ricoh-bleach-bypass": RICOH_STD,
  "ricoh-cross-process": RICOH_STD,
  "ricoh-retro": r(50, 0, 0, 0, -25, G0, 0, 0, false),
  "ricoh-hdr-tone": r(50, 70, -50, 40, 0, G0, 0, 0, false),
  "ricoh-monotone": r(50, 0, 0, 0, 0, G0, 0, 0, false),
  "ricoh-soft-monotone": r(40, 0, 0, 0, 0, G0, 0, 0, false),
  "ricoh-hard-monotone": r(55, 0, 0, 0, 0, G0, 0, 0, false),
  "ricoh-hi-contrast-bw": r(55, 0, 0, 0, -45, { amount: 55, size: 45 }, 0, 0, false),
});

/** "acros-iso" 규칙: ISO = EXIF 0x8827(없으면 200), amount = clamp(round(8·log2(ISO/160)), 0, 45), size = ISO ≥ 3200 ? 60 : 25 */
export function acrosGrain(iso: number | null): { amount: number; size: number } {
  const I = iso ?? 200;
  return { amount: Math.min(45, Math.max(0, Math.round(8 * Math.log2(I / 160)))), size: I >= 3200 ? 60 : 25 };
}

export function recipeGrain(rc: Recipe, iso: number | null): { amount: number; size: number } {
  return rc.grain === "acros-iso" ? acrosGrain(iso) : rc.grain;
}

export function recipeFor(simId: string): Recipe {
  const rc = RECIPES[simId];
  if (!rc) throw new Error(`레시피가 없는 시뮬레이션입니다: ${simId} — recipes.ts 표에 추가하세요.`);
  return rc;
}
