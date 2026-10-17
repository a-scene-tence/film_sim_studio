// Step 4 §6-4 커스텀 레시피 — localStorage "filmlab.recipes.v1" (JSON 배열, 최대 200개). 순수 함수 + 주입 가능한 스토리지.
import { CURVE_PRESETS, type CurvePoint } from "../render/curve";
import { FILM_PRESETS } from "../render/film-presets";
import type { DRange } from "../render/isp";
import { normalizeDRange, normalizeValue, type CurveChoice, type EditCurve, type EditState, type ParamKey } from "./state";

export const RECIPES_KEY = "filmlab.recipes.v1";
export const RECIPES_CORRUPT_KEY = "filmlab.recipes.v1.corrupt";
export const MAX_RECIPES = 200;

export const RECIPE_PARAM_KEYS = [
  "lightBalance", "exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks", "temp", "tint", "saturation", "vibrance",
  "cce", "ccb", "monoHue", "monoAmount", "sharpness", "clarity", "dehaze", "hdfStrength", "grainAmount", "grainSize", "vignette",
] as const satisfies ReadonlyArray<ParamKey>;
type RecipeParamKey = (typeof RECIPE_PARAM_KEYS)[number];

export interface Recipe {
  v: 1; id: string; name: string; createdAt: string; simId: string | null; filmStrength: number;
  /** FSE-v2: dRange 100/200/400 (v1 레시피에 없으면 100) */
  params: Record<RecipeParamKey, number> & { dRange: DRange };
  toneCurve: { preset: CurveChoice; points: CurvePoint[]; zones: [number, number, number, number, number] };
  toggles: { hdf: boolean };
}

const SIM_IDS: ReadonlySet<string> = new Set(Object.keys(FILM_PRESETS));
const PRESET_IDS: ReadonlySet<string> = new Set<string>([...Object.keys(CURVE_PRESETS), "custom"]);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function newRecipeId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 점 정리: clamp → x 정렬 → x 간격 0.01 미만 제거 → 첫 x=0, 끝 x=1 → 2~8개가 아니면 선형 */
export function sanitizePoints(raw: unknown): CurvePoint[] {
  const linear = CURVE_PRESETS.linear.map((p) => [p[0], p[1]] as CurvePoint);
  if (!Array.isArray(raw)) return linear;
  const pts: CurvePoint[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== "number" || typeof p[1] !== "number" || Number.isNaN(p[0]) || Number.isNaN(p[1])) return linear;
    pts.push([clamp(p[0], 0, 1), clamp(p[1], 0, 1)]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const kept: CurvePoint[] = [];
  for (const p of pts) {
    const last = kept[kept.length - 1];
    if (last && p[0] - last[0] < 0.01) continue;
    kept.push(p);
  }
  if (kept.length < 2 || kept.length > 8) return linear;
  kept[0] = [0, kept[0]![1]];
  kept[kept.length - 1] = [1, kept[kept.length - 1]![1]];
  for (let i = 1; i < kept.length; i++) if (!(kept[i]![0] > kept[i - 1]![0])) return linear;
  return kept;
}

function sanitizeZones(raw: unknown): EditCurve["zones"] {
  if (!Array.isArray(raw) || raw.length !== 5 || raw.some((z) => typeof z !== "number" || Number.isNaN(z))) return [0, 0, 0, 0, 0];
  return raw.map((z: number) => {
    const r = Math.round(clamp(z, -100, 100));
    return Object.is(r, -0) ? 0 : r;
  }) as EditCurve["zones"];
}

/** 검증·정규화. 실패하면 null */
export function validateRecipe(raw: unknown): Recipe | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  if (typeof raw.name !== "string") return null;
  const name = raw.name.trim();
  const len = Array.from(name).length;
  if (len < 1 || len > 40) return null;
  let simId: string | null;
  if (raw.simId === null) simId = null;
  else if (typeof raw.simId === "string" && SIM_IDS.has(raw.simId)) simId = raw.simId;
  else return null;
  const p = isObj(raw.params) ? raw.params : {};
  const params = { dRange: normalizeDRange(p.dRange) } as Recipe["params"];
  for (const k of RECIPE_PARAM_KEYS) params[k] = normalizeValue(k, p[k]);
  const tc = isObj(raw.toneCurve) ? raw.toneCurve : {};
  const points = sanitizePoints(tc.points);
  const preset: CurveChoice = typeof tc.preset === "string" && PRESET_IDS.has(tc.preset) ? (tc.preset as CurveChoice) : "custom";
  const tg = isObj(raw.toggles) ? raw.toggles : {};
  const created = typeof raw.createdAt === "string" && !Number.isNaN(Date.parse(raw.createdAt)) ? raw.createdAt : new Date().toISOString();
  return {
    v: 1,
    id: typeof raw.id === "string" && ID_RE.test(raw.id) ? raw.id : newRecipeId(),
    name, createdAt: created, simId, filmStrength: normalizeValue("filmStrength", raw.filmStrength), params,
    toneCurve: { preset, points, zones: sanitizeZones(tc.zones) },
    toggles: { hdf: tg.hdf === true },
  };
}

export function recipeFromState(st: EditState, name: string, now: Date = new Date()): Recipe {
  const params = { dRange: st.dRange } as Recipe["params"];
  for (const k of RECIPE_PARAM_KEYS) params[k] = (st as unknown as Record<string, number>)[k]!;
  return {
    v: 1, id: newRecipeId(), name: name.trim(), createdAt: now.toISOString(), simId: st.simId, filmStrength: st.filmStrength, params,
    toneCurve: { preset: st.curve.preset, points: st.curve.points.map((q) => [q[0], q[1]] as CurvePoint), zones: [...st.curve.zones] as EditCurve["zones"] },
    toggles: { hdf: st.hdf },
  };
}

/** 적용: simId·filmStrength·params(dRange 포함)·toneCurve·toggles.hdf 로 EditState 를 통째로 바꾼다 (selectFilm 을 거치지 않음) */
export function applyRecipe(base: EditState, r: Recipe): EditState {
  const st: EditState = { ...base, simId: r.simId, filmStrength: r.filmStrength, hdf: r.toggles.hdf, ...r.params };
  st.curve = { preset: r.toneCurve.preset, points: r.toneCurve.points.map((q) => [q[0], q[1]] as CurvePoint), zones: [...r.toneCurve.zones] as EditCurve["zones"] };
  return st;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** 기본 이름: "{필름 한글명} {MM-DD HH:mm}" (로컬 시간), 필름이 없으면 "필름 없음 ..." */
export function defaultRecipeName(filmKo: string | null, now: Date): string {
  return `${filmKo ?? "필름 없음"} ${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** 읽기: try/catch, JSON 파싱 실패면 원문을 .corrupt 로 한 번 백업하고 빈 배열 */
export function loadRecipes(store: StorageLike): Recipe[] {
  let text: string | null;
  try { text = store.getItem(RECIPES_KEY); } catch { return []; }
  if (text === null) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    try { if (store.getItem(RECIPES_CORRUPT_KEY) === null) store.setItem(RECIPES_CORRUPT_KEY, text); } catch { /* 저장소 접근 불가 */ }
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Recipe[] = [];
  for (const x of data) {
    const r = validateRecipe(x);
    if (r && out.length < MAX_RECIPES) out.push(r);
  }
  return out;
}

export function saveRecipes(store: StorageLike, list: ReadonlyArray<Recipe>): boolean {
  try { store.setItem(RECIPES_KEY, JSON.stringify(list)); return true; } catch { return false; }
}

export const exportFileName = (now: Date): string => `filmlab-recipes-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
export const exportRecipes = (list: ReadonlyArray<Recipe>): string => JSON.stringify({ format: "filmlab-recipes", v: 1, recipes: list }, null, 2);

export interface ImportResult { recipes: Recipe[]; imported: number; skipped: number }

/** 가져오기: format·v 확인 → validateRecipe → id 충돌 시 새 id → 200개 초과는 버림 */
export function importRecipes(text: string, existing: ReadonlyArray<Recipe>): ImportResult | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  if (!isObj(data) || data.format !== "filmlab-recipes" || data.v !== 1 || !Array.isArray(data.recipes)) return null;
  const recipes = [...existing];
  const ids = new Set(recipes.map((r) => r.id));
  let imported = 0, skipped = 0;
  for (const raw of data.recipes) {
    const r = validateRecipe(raw);
    if (!r || recipes.length >= MAX_RECIPES) { skipped++; continue; }
    if (ids.has(r.id)) r.id = newRecipeId();
    ids.add(r.id);
    recipes.push(r);
    imported++;
  }
  return { recipes, imported, skipped };
}

export const importToast = (r: ImportResult): string => `레시피 ${r.imported}개 가져옴 · ${r.skipped}개 건너뜀`;
