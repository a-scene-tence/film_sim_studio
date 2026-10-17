// 섹션 9 레시피 보조 — FSE-v2 에서 숨은 레시피 레이어(중립 RECIPES 표·shaderHints 연동 키)는 삭제되었다.
// 필름별 빛·톤·질감은 film-presets.ts 의 FILM_PRESETS 가 SSOT 이며, 필름 선택 시 슬라이더 값으로 통째로 들어간다(studio/state.ts selectFilm).
export { FILM_PRESETS, NEUTRAL_PRESET, PRESET_KEYS, type FilmPreset } from "./film-presets";

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

/** "acros-iso" 규칙: ISO = EXIF 0x8827(없으면 200), amount = clamp(round(8·log2(ISO/160)), 0, 45), size = ISO ≥ 3200 ? 60 : 25 */
export function acrosGrain(iso: number | null): { amount: number; size: number } {
  const I = iso ?? 200;
  return { amount: Math.min(45, Math.max(0, Math.round(8 * Math.log2(I / 160)))), size: I >= 3200 ? 60 : 25 };
}

export function recipeGrain(rc: Recipe, iso: number | null): { amount: number; size: number } {
  return rc.grain === "acros-iso" ? acrosGrain(iso) : rc.grain;
}
