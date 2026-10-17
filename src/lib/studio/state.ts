// Step 4 §6 편집 상태 모델 — SLIDERS 상수 하나가 UI·검증·레시피의 SSOT 다.
import { CURVE_PRESETS, LINEAR_CURVE, curveOn, type CurvePoint, type CurvePreset, type CurveState } from "../render/curve";
import { FILM_PRESETS, NEUTRAL_PRESET, PRESET_KEYS, type CurvePresetId, type FilmPreset } from "../render/film-presets";
import type { DRange } from "../render/isp";

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
  /** FSE-v2 D레인지 (DR100 / DR200 / DR400) */
  dRange: DRange;
}

export const LINEAR_POINTS: ReadonlyArray<CurvePoint> = CURVE_PRESETS.linear;
const clonePoints = (p: ReadonlyArray<CurvePoint>): CurvePoint[] => p.map((q) => [q[0], q[1]] as CurvePoint);

export function defaultCurve(): EditCurve {
  return { preset: "linear", points: clonePoints(LINEAR_POINTS), zones: [0, 0, 0, 0, 0] };
}

const PARAM_KEYS: ReadonlyArray<ParamKey> = SLIDERS.filter((x) => !x.key.startsWith("zone")).map((x) => x.key as ParamKey);

export function initialEditState(): EditState {
  const st = { simId: null, hdf: false, curve: defaultCurve(), dRange: 100 } as unknown as EditState;
  for (const k of PARAM_KEYS) (st as unknown as Record<string, number>)[k] = SLIDER_BY_KEY[k].def;
  return st;
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

// ── 필름 프리셋 (FSE-v2 §6) ───────────────────────────────────────────────
export type PresetKey = (typeof PRESET_KEYS)[number];
export type PresetStateKey = "lightBalance" | "exposure" | "brightness" | "contrast" | "highlights" | "shadows" | "whites" | "blacks"
  | "temp" | "tint" | "saturation" | "vibrance" | "cce" | "ccb" | "clarity" | "sharpness" | "dehaze" | "grainAmount" | "grainSize" | "vignette"
  | "curve" | "hdf" | "hdfStrength" | "dRange";

/** §6-2 키 대응: 프리셋 키 → EditState 키 (표에 없는 키는 같은 이름) */
const STATE_KEY: Readonly<Partial<Record<PresetKey, PresetStateKey>>> = {
  temperature: "temp", colorChrome: "cce", colorChromeBlue: "ccb", sharpen: "sharpness", hdfEnabled: "hdf", toneCurve: "curve",
};
export function stateKeyOf(k: PresetKey): PresetStateKey {
  return STATE_KEY[k] ?? (k as PresetStateKey);
}

/** 프리셋 커브 id → Step 3 CURVE_PRESETS 키 (medium = 약한 대비 S-커브, strong = 강한 대비, softHighlight = 소프트 하이라이트) */
export const CURVE_ID: Readonly<Record<Exclude<CurvePresetId, "custom">, CurvePreset>> = {
  linear: "linear", medium: "weak-contrast", strong: "strong-contrast", matte: "matte", softHighlight: "soft-highlight",
};

export type PresetState = Pick<EditState, PresetStateKey>;

/** 프리셋 → EditState 값 (커브: custom 이면 points 그대로, 아니면 Step 3 PRESETS[preset], zones 그대로) */
export function presetToState(p: FilmPreset): PresetState {
  const tc = p.toneCurve;
  const src: ReadonlyArray<CurvePoint> = tc.preset === "custom" ? (tc.points ?? LINEAR_POINTS) : CURVE_PRESETS[CURVE_ID[tc.preset]];
  const points = clonePoints(src);
  const out = {} as Record<PresetStateKey, unknown>;
  for (const k of PRESET_KEYS) out[stateKeyOf(k)] = p[k];
  out.curve = { preset: presetOfPoints(points), points, zones: [...tc.zones] as EditCurve["zones"] } satisfies EditCurve;
  return out as PresetState;
}

/** 필름 id 의 프리셋 (null = 필름 없음 → NEUTRAL_PRESET) */
export function presetOf(simId: string | null): FilmPreset {
  if (simId === null) return NEUTRAL_PRESET;
  const p = FILM_PRESETS[simId];
  if (!p) throw new Error(`필름 프리셋이 없는 시뮬레이션입니다: ${simId} — src/lib/render/film-presets.ts 표에 추가하세요.`);
  return p;
}

/**
 * 필름 선택: simId 만 교체한다. 노출·대비·커브·그레인 등 모든 상세 조정값은 사용자가 둔 값 그대로 유지한다.
 * (FILM_PRESETS 는 레시피·Lab·테스트용 참고 수치이며 편집 상태로 복사하지 않는다)
 */
export function selectFilm(state: EditState, id: string | null): EditState {
  return state.simId === id ? state : { ...state, simId: id };
}

/** 새 파일·데모를 열 때: 필름 없음 + 모든 값 기본 (입력 색공간 Auto 는 히스토리 스냅샷이 담당) */
export function resetForNewMedia(): EditState {
  return initialEditState();
}

/** 데모 사진 전용 시작 필름 (필름 소개용) */
export const DEMO_SIM_ID = "fuji-classic-chrome";

/** 새 미디어를 열 때의 편집 상태: resetForNewMedia(), 데모는 이어서 selectFilm('fuji-classic-chrome') 만 */
export function mediaOpenState(demo: boolean): EditState {
  const st = resetForNewMedia();
  return demo ? selectFilm(st, DEMO_SIM_ID) : st;
}

/** 더블탭 기본값: 필름과 무관하게 §6-2 표 기본값 */
export function defaultFor(key: SliderKey): number {
  return SLIDER_BY_KEY[key].def;
}

export const D_RANGES: ReadonlyArray<DRange> = [100, 200, 400];
/** D레인지 정규화: 100/200/400 이 아니면 100 */
export const normalizeDRange = (v: unknown): DRange => (v === 200 || v === 400 ? v : 100);

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
/** simRecipe(simId): manifest 의 brand·mono·한글명. 필름 없음은 brand null, mono=false */
export function simRecipe(simId: string | null, sims: ReadonlyArray<SimInfo>): { brand: SimInfo["brand"] | null; mono: boolean; ko: string } {
  const info = simId === null ? null : (sims.find((x) => x.id === simId) ?? null);
  return { brand: info?.brand ?? null, mono: info?.mono ?? false, ko: info?.ko ?? "필름 없음" };
}

// ── reducer ───────────────────────────────────────────────────────────────
export type EditAction =
  | { type: "set"; key: SliderKey; value: number }
  | { type: "reset"; key: SliderKey }
  | { type: "selectFilm"; simId: string | null }
  | { type: "setDRange"; value: DRange }
  | { type: "toggleHdf" }
  | { type: "setHdf"; value: boolean }
  | { type: "curve"; curve: EditCurve }
  | { type: "curvePreset"; preset: CurvePreset }
  | { type: "curveReset" }
  | { type: "patch"; values: Partial<Record<ParamKey, number>> }
  | { type: "replace"; state: EditState }
  | { type: "resetTab"; tab: TabId }
  | { type: "resetAll" };

export function editReducer(st: EditState, a: EditAction): EditState {
  switch (a.type) {
    case "set": return setValue(st, a.key, a.value);
    case "reset": return setValue(st, a.key, defaultFor(a.key));
    case "selectFilm": return selectFilm(st, a.simId);
    case "setDRange": return { ...st, dRange: normalizeDRange(a.value) };
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
    case "resetTab": return resetTab(st, a.tab);
    case "resetAll": return initialEditState();
  }
}

/** 곡선이 선형이고 구간이 모두 0 인가 (uCurveOn 의 반대) */
export const isCurveIdentity = (c: EditCurve): boolean => !curveOn(toCurveState(c));

// ── 탭별 초기화 / 전체 초기화 ──────────────────────────────────────────────
/** 히스토리에 남기는 탭 초기화 라벨 */
export const TAB_RESET_LABEL: Readonly<Record<TabId, string>> = {
  film: "필름 탭 초기화", light: "라이트 탭 초기화", color: "컬러 탭 초기화", curve: "커브 탭 초기화", detail: "디테일 탭 초기화",
};
export const RESET_ALL_LABEL = "전체 초기화";

/** 탭 초기화: 그 탭이 다루는 값만 initialEditState() 값으로 되돌린다. 다른 탭의 값은 그대로 */
export function resetTab(st: EditState, tab: TabId): EditState {
  const init = initialEditState();
  const pick = (keys: ReadonlyArray<keyof EditState>): EditState => {
    const out = { ...st } as Record<string, unknown>;
    for (const k of keys) out[k] = init[k];
    return out as unknown as EditState;
  };
  switch (tab) {
    case "film": return pick(["simId", "filmStrength"]);
    case "light": return pick(["dRange", "lightBalance", "exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks"]);
    case "color": return pick(["temp", "tint", "saturation", "vibrance", "monoHue", "monoAmount", "cce", "ccb"]);
    case "curve": return pick(["curve"]);
    case "detail": return pick(["sharpness", "clarity", "dehaze", "hdf", "hdfStrength", "grainAmount", "grainSize", "vignette"]);
  }
}

/** 그 탭이 이미 기본값인가 (초기화 버튼 비활성 판정) */
export const isTabDefault = (st: EditState, tab: TabId): boolean => JSON.stringify(resetTab(st, tab)) === JSON.stringify(st);
/** 전체가 초기 상태와 같은가 */
export const isEditDefault = (st: EditState): boolean => JSON.stringify(st) === JSON.stringify(initialEditState());
