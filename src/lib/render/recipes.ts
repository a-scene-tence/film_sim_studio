// 섹션 9 원터치 마스터 레시피 — 이 파일이 유일 기준이다(COLOR_SCIENCE §15).
// FSE-v2: 필름의 톤·색 성격은 오직 3D LUT 가 담당한다. 필름을 고를 때 LUT 위에 선명도·명료도·하이라이트·쉐도우·비네팅·그레인을
// 숨은 레이어로 덧입히면 이중 적용(떡보정)이 되므로, 모든 시뮬레이션의 레시피는 중립(0/끔)이다. 추가 보정은 사용자가 슬라이더로만 한다.
// manifest 의 shaderHints 도 비어 있으며 렌더러는 shaderHints 를 읽지 않는다.

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
/** 중립 레시피: 슬라이더를 건드리지 않는다 (FSE-v2, 이중 적용 금지) */
const NEUTRAL = r(0, 0, 0, 0, 0, G0, 0, 0, false);

export const RECIPES: Readonly<Record<string, Recipe>> = Object.freeze({
  none: NEUTRAL,
  "fuji-provia": NEUTRAL,
  "fuji-velvia": NEUTRAL,
  "fuji-astia": NEUTRAL,
  "fuji-classic-chrome": NEUTRAL,
  "fuji-reala-ace": NEUTRAL,
  "fuji-pro-neg-hi": NEUTRAL,
  "fuji-pro-neg-std": NEUTRAL,
  "fuji-classic-neg": NEUTRAL,
  "fuji-nostalgic-neg": NEUTRAL,
  "fuji-eterna": NEUTRAL,
  "fuji-eterna-bleach-bypass": NEUTRAL,
  "fuji-acros": NEUTRAL,
  "fuji-acros-ye": NEUTRAL,
  "fuji-acros-r": NEUTRAL,
  "fuji-acros-g": NEUTRAL,
  "fuji-monochrome": NEUTRAL,
  "fuji-monochrome-ye": NEUTRAL,
  "fuji-monochrome-r": NEUTRAL,
  "fuji-monochrome-g": NEUTRAL,
  "fuji-sepia": NEUTRAL,
  "ricoh-standard": NEUTRAL,
  "ricoh-vivid": NEUTRAL,
  "ricoh-positive-film": NEUTRAL,
  "ricoh-negative-film": NEUTRAL,
  "ricoh-bleach-bypass": NEUTRAL,
  "ricoh-retro": NEUTRAL,
  "ricoh-cross-process": NEUTRAL,
  "ricoh-hdr-tone": NEUTRAL,
  "ricoh-monotone": NEUTRAL,
  "ricoh-soft-monotone": NEUTRAL,
  "ricoh-hard-monotone": NEUTRAL,
  "ricoh-hi-contrast-bw": NEUTRAL,
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
