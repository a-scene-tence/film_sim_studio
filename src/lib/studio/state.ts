// Step 4 §6 편집 상태 모델 — SLIDERS 상수 하나가 UI·검증·레시피의 SSOT 다.
import { CURVE_PRESETS, LINEAR_CURVE, curveOn, type CurvePoint, type CurvePreset, type CurveState } from "../render/curve";
import { recipeFor, recipeGrain, RECIPES } from "../render/recipes";

export type CurveChoice = CurvePreset | "custom";
export interface EditCurve { preset: CurveChoice; points: CurvePoint[]; zones: [number, number, number, number, number] }

export type SliderKey =
  | "filmStrength" | "lightBalance" | "exposure" | "brightness" | "contrast" | "highlights" | "shadows" | "whites" | "blacks"
  | "temp" | "tint" | "saturation" | "vibrance" | "cce" | "ccb" | "monoHue" | "monoAmount"
  | "sharpness" | "clarity" | "dehaze" | "hdfStrength" | "grainAmount" | "grainSize" | "vignette"
  | "zone0" | "zone1" | "zone2" | "zone3" | "zone4";
/** EditState 의 수치 키 (구간 슬라이더 zone0..4 는 curve.zones 에 저장) */
export type ParamKey = Exclude<SliderKey, `zone${number}`>;
export type TabId = "film" | "light" | "color" | "curve" | "detail";
export type DisplayKind = "percent" | "signed" | "ev" | "level" | "degree" | "int";

export interface SliderSpec { key: SliderKey; tab: TabId; label: string; min: number; max: number; step: number; def: number; display: DisplayKind }

const s = (key: SliderKey, tab: TabId, label: string, min: number, max: number, step: number, def: number, display: DisplayKind): SliderSpec => ({ key, tab, label, min, max, step, def, display });
const S100 = (key: SliderKey, tab: TabId, label: string) => s(key, tab, label, -100, 100, 1, 0, "signed");
const ZONE_LABELS = ["블랙", "섀도", "미드톤", "라이트", "화이트"] as const;

/** §6-2 슬라이더 표 (SSOT) */
export const SLIDERS: ReadonlyArray<SliderSpec> = [
  s("filmStrength", "film", "필름 강도", 0, 100, 1, 100, "percent"),
  S100("lightBalance", "light", "라이트 밸런스"),
  s("exposure", "light", "노출", -5, 5, 0.05, 0, "ev"),
  S100("brightness", "light", "밝기"),
  S100("contrast", "light", "대비"),
  S100("highlights", "light", "하이라이트"),
  S100("shadows", "light", "쉐도우"),
  S100("whites", "light", "흰색"),
  S100("blacks", "light", "검정"),
  S100("temp", "color", "색온도"),
  S100("tint", "color", "틴트"),
  S100("saturation", "color", "채도"),
  S100("vibrance", "color", "생동감"),
  s("cce", "color", "컬러 크롬 이펙트", 0, 2, 1, 0, "level"),
  s("ccb", "color", "컬러 크롬 블루", 0, 2, 1, 0, "level"),
  s("monoHue", "color", "흑백 조색 · 색상", 0, 359, 1, 0, "degree"),
  s("monoAmount", "color", "흑백 조색 · 강도", 0, 100, 1, 0, "int"),
  s("sharpness", "detail", "선명도", 0, 150, 1, 0, "int"),
  S100("clarity", "detail", "명료도"),
  S100("dehaze", "detail", "디헤이즈"),
  s("hdfStrength", "detail", "확산 강도", 0, 200, 1, 100, "percent"),
  s("grainAmount", "detail", "그레인 강도", 0, 100, 1, 0, "int"),
  s("grainSize", "detail", "그레인 크기", 0, 100, 1, 0, "int"),
  S100("vignette", "detail", "비네팅"),
  ...ZONE_LABELS.map((l, k) => S100(`zone${k}` as SliderKey, "curve", l)),
];

export const SLIDER_BY_KEY: Readonly<Record<SliderKey, SliderSpec>> = Object.fromEntries(SLIDERS.map((x) => [x.key, x])) as Record<SliderKey, SliderSpec>;
export const LEVEL_LABELS = ["끔", "약", "강"] as const;

export interface EditState {
  /** 32개 id 중 하나, null = 필름 없음 (T_ref, uLutMode 0) */
  simId: string | null;
  filmStrength: number; lightBalance: number; exposure: number; brightness: number; contrast: number;
  highlights: number; shadows: number; whites: number; blacks: number;
  temp: number; tint: number; saturation: number; vibrance: number;
  cce: number; ccb: number; monoHue: number; monoAmount: number;
  sharpness: number; clarity: number; dehaze: number;
  hdf: boolean; hdfStrength: number; grainAmount: number; grainSize: number; vignette: number;
  curve: EditCurve;
}

export const LINEAR_POINTS: ReadonlyArray<CurvePoint> = CURVE_PRESETS.linear;
const clonePoints = (p: ReadonlyArray<CurvePoint>): CurvePoint[] => p.map((q) => [q[0], q[1]] as CurvePoint);

export function defaultCurve(): EditCurve {
  return { preset: "linear", points: clonePoints(LINEAR_POINTS), zones: [0, 0, 0, 0, 0] };
}

const PARAM_KEYS: ReadonlyArray<ParamKey> = SLIDERS.filter((x) => !x.key.startsWith("zone")).map((x) => x.key as ParamKey);

export function initialEditState(): EditState {
  const st = { simId: null, hdf: false, curve: defaultCurve() } as unknown as EditState;
  for (const k of PARAM_KEYS) (st as unknown as Record<string, number>)[k] = SLIDER_BY_KEY[k].def;
  return st;
}

/** 데모 사진 전용 시작 상태 (필름 소개용) */
export const DEMO_SIM_ID = "fuji-classic-chrome";

/**
 * 새 미디어를 열 때의 편집 상태. 사용자 파일(사진·RAW·동영상)은 이전 미디어의 필름·슬라이더·HDF·톤 커브를 하나도 이어받지 않고
 * 완전한 초기 상태(필름 없음, 필름 강도 100%, 모든 보정 0, HDF 끔, 톤 커브 linear)에서 시작한다. 데모만 소개용 필름 + HDF 로 시작한다.
 */
export function mediaOpenState(demo: boolean): EditState {
  const st = initialEditState();
  return demo ? { ...st, simId: DEMO_SIM_ID, hdf: true } : st;
}

/** 값 정규화: 숫자가 아니거나 NaN 이면 기본값, 그 외 clamp(min,max) → step 반올림 → step 소수 자릿수로 toFixed */
export function normalizeValue(key: SliderKey, v: unknown): number {
  const sp = SLIDER_BY_KEY[key];
  if (typeof v !== "number" || Number.isNaN(v)) return sp.def;
  const c = Math.min(sp.max, Math.max(sp.min, v));
  const r = Math.round(c / sp.step) * sp.step;
  const dec = (String(sp.step).split(".")[1] ?? "").length;
  const out = Number(r.toFixed(dec));
  return Object.is(out, -0) ? 0 : out;
}

// ── 필름 연동 (§6-3) ──────────────────────────────────────────────────────
export type SimDefaults = Partial<Pick<EditState, "sharpness" | "clarity" | "highlights" | "shadows" | "vignette" | "grainAmount" | "grainSize" | "cce" | "ccb" | "hdf">>;

/**
 * Step 3 마스터 레시피 표(recipes.ts)의 값이 0/false 가 아닌 항목이 연동 키다. FSE-v2 에서는 표가 전부 중립이라 항상 {} 이다
 * (필름 선택이 슬라이더를 건드리지 않음 — LUT 위 이중 적용 금지).
 * 대응: sharpen→sharpness, grain.amount→grainAmount, grain.size→grainSize, fxb→ccb, 그 밖의 키는 같은 이름.
 */
export function simDefaults(simId: string | null, iso: number | null = null): SimDefaults {
  if (simId === null || !(simId in RECIPES)) return {};
  const rc = recipeFor(simId);
  const g = recipeGrain(rc, iso);
  const out: SimDefaults = {};
  if (rc.sharpen !== 0) out.sharpness = rc.sharpen;
  if (rc.clarity !== 0) out.clarity = rc.clarity;
  if (rc.highlights !== 0) out.highlights = rc.highlights;
  if (rc.shadows !== 0) out.shadows = rc.shadows;
  if (rc.vignette !== 0) out.vignette = rc.vignette;
  if (g.amount !== 0) out.grainAmount = g.amount;
  if (g.size !== 0) out.grainSize = g.size;
  if (rc.cce !== 0) out.cce = rc.cce;
  if (rc.fxb !== 0) out.ccb = rc.fxb;
  if (rc.hdf) out.hdf = true;
  return out;
}

/** 더블탭 기본값: 연동값이 있으면 그 값, 없으면 §6-2 표의 기본값 */
export function defaultFor(key: SliderKey, simId: string | null, iso: number | null = null): number {
  if (!key.startsWith("zone")) {
    const d = simDefaults(simId, iso) as Record<string, unknown>;
    const v = d[key];
    if (typeof v === "number") return v;
  }
  return SLIDER_BY_KEY[key].def;
}

/** 필름 선택: prev 연동 키 ∪ next 연동 키를 next 연동값 또는 §6-2 기본값으로 덮어쓰고, 나머지(필름 강도 포함)는 그대로 둔다 */
export function selectSim(state: EditState, next: string | null, iso: number | null = null): EditState {
  const prev = simDefaults(state.simId, iso) as Record<string, unknown>;
  const nd = simDefaults(next, iso) as Record<string, unknown>;
  const out: EditState = { ...state, curve: state.curve };
  const o = out as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(prev), ...Object.keys(nd)])) {
    if (key in nd) o[key] = nd[key];
    else o[key] = key === "hdf" ? false : SLIDER_BY_KEY[key as SliderKey].def;
  }
  out.simId = next;
  return out;
}

// ── 값 읽기/쓰기 ──────────────────────────────────────────────────────────
export function getValue(st: EditState, key: SliderKey): number {
  if (key.startsWith("zone")) return st.curve.zones[Number(key.slice(4))]!;
  return (st as unknown as Record<string, number>)[key]!;
}

export function setValue(st: EditState, key: SliderKey, v: number): EditState {
  const n = normalizeValue(key, v);
  if (key.startsWith("zone")) {
    const zones = [...st.curve.zones] as EditCurve["zones"];
    zones[Number(key.slice(4))] = n;
    return { ...st, curve: { ...st.curve, zones } };
  }
  return { ...st, [key]: n };
}

/** 표시 문자열 (§6-2 "표시" 열). 부호는 U+2212 */
export function formatValue(key: SliderKey, v: number): string {
  const sp = SLIDER_BY_KEY[key];
  const signed = (x: number, text: string) => (x > 0 ? `+${text}` : x < 0 ? `−${text.replace("-", "")}` : text);
  switch (sp.display) {
    case "percent": return `${Math.round(v)}%`;
    case "signed": return signed(v, String(Math.round(v)));
    case "ev": return `${signed(v, v.toFixed(2))} EV`;
    case "level": return LEVEL_LABELS[Math.min(2, Math.max(0, Math.round(v)))]!;
    case "degree": return `${Math.round(v)}°`;
    default: return String(Math.round(v));
  }
}

// ── 톤 커브 변환 (Step 3 CurveState ↔ EditCurve) ───────────────────────────
const samePoints = (a: ReadonlyArray<CurvePoint>, b: ReadonlyArray<CurvePoint>) =>
  a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i]![0]) < 1e-9 && Math.abs(p[1] - b[i]![1]) < 1e-9);

/** points 가 어떤 프리셋과 같으면 그 프리셋 키, 아니면 'custom' */
export function presetOfPoints(points: ReadonlyArray<CurvePoint>): CurveChoice {
  for (const k of Object.keys(CURVE_PRESETS) as CurvePreset[]) if (samePoints(points, CURVE_PRESETS[k])) return k;
  return "custom";
}

export function toCurveState(c: EditCurve): CurveState {
  const hit = presetOfPoints(c.points);
  if (hit !== "custom") return { preset: hit, points: null, zones: c.zones };
  return { preset: "linear", points: clonePoints(c.points), zones: c.zones };
}

export function fromCurveState(c: CurveState): EditCurve {
  const points = clonePoints(c.points ?? CURVE_PRESETS[c.preset]);
  return { preset: presetOfPoints(points), points, zones: [...c.zones] as EditCurve["zones"] };
}

export { curveOn, LINEAR_CURVE };

// ── 필름 조회 (F) ─────────────────────────────────────────────────────────
export interface SimInfo { id: string; ko: string; en?: string; brand: "fujifilm" | "ricoh"; mono: boolean }
/** simRecipe(simId): Step 3 마스터 레시피 + manifest 의 mono 여부. 필름 없음은 mono=false */
export function simRecipe(simId: string | null, sims: ReadonlyArray<SimInfo>): { recipe: ReturnType<typeof recipeFor>; mono: boolean; ko: string } {
  const info = simId === null ? null : (sims.find((x) => x.id === simId) ?? null);
  return { recipe: recipeFor(simId ?? "none"), mono: info?.mono ?? false, ko: info?.ko ?? "필름 없음" };
}

// ── reducer ───────────────────────────────────────────────────────────────
export type EditAction =
  | { type: "set"; key: SliderKey; value: number }
  | { type: "reset"; key: SliderKey; iso: number | null }
  | { type: "selectSim"; simId: string | null; iso: number | null }
  | { type: "toggleHdf" }
  | { type: "setHdf"; value: boolean }
  | { type: "curve"; curve: EditCurve }
  | { type: "curvePreset"; preset: CurvePreset }
  | { type: "curveReset" }
  | { type: "patch"; values: Partial<Record<ParamKey, number>> }
  | { type: "replace"; state: EditState };

export function editReducer(st: EditState, a: EditAction): EditState {
  switch (a.type) {
    case "set": return setValue(st, a.key, a.value);
    case "reset": return setValue(st, a.key, defaultFor(a.key, st.simId, a.iso));
    case "selectSim": return selectSim(st, a.simId, a.iso);
    case "toggleHdf": return { ...st, hdf: !st.hdf };
    case "setHdf": return { ...st, hdf: a.value };
    case "curve": return { ...st, curve: a.curve };
    case "curvePreset": return { ...st, curve: { ...st.curve, preset: a.preset, points: clonePoints(CURVE_PRESETS[a.preset]) } };
    case "curveReset": return { ...st, curve: defaultCurve() };
    case "patch": {
      let n = st;
      for (const [k, v] of Object.entries(a.values) as Array<[ParamKey, number]>) n = setValue(n, k, v);
      return n;
    }
    case "replace": return a.state;
  }
}

/** 곡선이 선형이고 구간이 모두 0 인가 (uCurveOn 의 반대) */
export const isCurveIdentity = (c: EditCurve): boolean => !curveOn(toCurveState(c));
