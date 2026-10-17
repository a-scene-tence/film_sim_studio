// FSE-v2 32종 필름 상세 보정 프리셋 (U11 프리셋, U12 리듀서, U13 레시피)
import { describe, expect, it } from "vitest";
import { CURVE_PRESETS } from "@/lib/render/curve";
import { FILM_PRESETS, NEUTRAL_PRESET, PRESET_KEYS, type FilmPreset } from "@/lib/render/film-presets";
import { FILM_SIMS } from "@/lib/color/fse/film-params.mjs";
import { applyRecipe, recipeFromState, validateRecipe } from "@/lib/studio/recipes";
import {
  CURVE_ID, defaultFor, editReducer, getValue, initialEditState, mediaOpenState, normalizeValue, presetToState, resetForNewMedia, selectFilm,
  stateKeyOf, type EditState, type PresetKey, type SliderKey,
} from "@/lib/studio/state";
import { historyReducer, initialHistory } from "@/lib/studio/history";

const IDS = FILM_SIMS.map((p) => p.id);
const NUM_KEYS = PRESET_KEYS.filter((k) => !["toneCurve", "hdfEnabled", "dRange", "colorChrome", "colorChromeBlue"].includes(k)) as PresetKey[];

/** EditState 의 PRESET_KEYS 값을 프리셋 단위로 되돌려 읽는다 (커브는 EditCurve 를 프리셋 형태로 비교) */
function expectMatches(st: EditState, p: FilmPreset) {
  const exp = presetToState(p);
  for (const k of PRESET_KEYS) {
    const sk = stateKeyOf(k);
    expect([k, (st as unknown as Record<string, unknown>)[sk]]).toEqual([k, (exp as unknown as Record<string, unknown>)[sk]]);
  }
}

describe("U11 프리셋 표 (6-1, 6-6)", () => {
  it("32개 = manifest 필름 id, 키 24개 전부 존재", () => {
    expect(Object.keys(FILM_PRESETS)).toEqual(IDS);
    expect(PRESET_KEYS).toHaveLength(24);
    for (const id of IDS) expect(Object.keys(FILM_PRESETS[id]!).sort()).toEqual([...PRESET_KEYS].sort());
    expect(Object.keys(NEUTRAL_PRESET).sort()).toEqual([...PRESET_KEYS].sort());
  });
  it("NEUTRAL_PRESET 값", () => {
    for (const k of NUM_KEYS) expect([k, NEUTRAL_PRESET[k]]).toEqual([k, k === "hdfStrength" ? 100 : 0]);
    expect([NEUTRAL_PRESET.colorChrome, NEUTRAL_PRESET.colorChromeBlue, NEUTRAL_PRESET.hdfEnabled, NEUTRAL_PRESET.dRange]).toEqual([0, 0, false, 100]);
    expect(NEUTRAL_PRESET.toneCurve).toEqual({ preset: "linear", points: null, zones: [0, 0, 0, 0, 0] });
  });
  it.each(IDS)("%s: 슬라이더 표 범위·step 통과 (normalizeValue(key, v) === v), 열거형·커브 규칙", (id) => {
    const p = FILM_PRESETS[id]!;
    for (const k of NUM_KEYS) {
      const sk = stateKeyOf(k) as SliderKey;
      expect([k, normalizeValue(sk, p[k])]).toEqual([k, p[k]]);
    }
    expect([0, 1, 2]).toContain(p.colorChrome);
    expect([0, 1, 2]).toContain(p.colorChromeBlue);
    expect([100, 200, 400]).toContain(p.dRange);
    expect(typeof p.hdfEnabled).toBe("boolean");
    for (const z of p.toneCurve.zones) expect(normalizeValue("zone0", z)).toBe(z);
    if (p.toneCurve.preset === "custom") {
      const pts = p.toneCurve.points!;
      expect(pts.length).toBeGreaterThanOrEqual(2);
      expect(pts.length).toBeLessThanOrEqual(8);
      expect(pts[0]![0]).toBe(0);
      expect(pts[pts.length - 1]![0]).toBe(1);
      for (let i = 1; i < pts.length; i++) expect(pts[i]![0]).toBeGreaterThan(pts[i - 1]![0]);
      for (const q of pts) { expect(q[1]).toBeGreaterThanOrEqual(0); expect(q[1]).toBeLessThanOrEqual(1); }
    } else {
      expect(p.toneCurve.points).toBeNull();
      expect(presetToState(p).curve.points).toEqual(CURVE_PRESETS[CURVE_ID[p.toneCurve.preset]]);
    }
  });
});

describe("U12 리듀서 골든 (6-7)", () => {
  it("1) resetForNewMedia() → simId null, PRESET_KEYS 전부 NEUTRAL_PRESET", () => {
    const st = resetForNewMedia();
    expect(st.simId).toBeNull();
    expectMatches(st, NEUTRAL_PRESET);
    expect([st.filmStrength, st.monoHue, st.monoAmount]).toEqual([100, 0, 0]);
    expect(st).toEqual(initialEditState());
    expect(mediaOpenState(false)).toEqual(st);
  });
  it("2) selectFilm('fuji-classic-chrome') → simId 만 바뀌고 모든 상세 조정은 초기값(0 / OFF / DR100) 유지", () => {
    const base = resetForNewMedia();
    const st = selectFilm(base, "fuji-classic-chrome");
    expect(st.simId).toBe("fuji-classic-chrome");
    expect({ ...st, simId: null }).toEqual(base);
    expect([st.contrast, st.cce, st.grainAmount, st.vignette, st.dRange]).toEqual([0, 0, 0, 0, 100]);
    expectMatches(st, NEUTRAL_PRESET);
  });
  it("3) clarity 40, grainAmount 20 으로 바꾼 뒤 velvia → 사용자 값 그대로", () => {
    let st = selectFilm(resetForNewMedia(), "fuji-classic-chrome");
    st = editReducer(st, { type: "set", key: "clarity", value: 40 });
    st = editReducer(st, { type: "set", key: "grainAmount", value: 20 });
    st = editReducer(st, { type: "setDRange", value: 400 });
    st = editReducer(st, { type: "selectFilm", simId: "fuji-velvia" });
    expect(st.simId).toBe("fuji-velvia");
    expect([st.clarity, st.grainAmount, st.grainSize, st.vignette, st.cce, st.curve.preset, st.dRange]).toEqual([40, 20, 0, 0, 0, "linear", 400]);
  });
  it("4) selectFilm(null) → simId 만 null, 상세 조정은 유지", () => {
    const edited = editReducer(selectFilm(resetForNewMedia(), "ricoh-hi-contrast-bw"), { type: "set", key: "contrast", value: 25 });
    const st = selectFilm(edited, null);
    expect(st.simId).toBeNull();
    expect({ ...st, simId: edited.simId }).toEqual(edited);
    expect(st.contrast).toBe(25);
  });
  it("5) 슬라이더 더블탭은 필름과 무관하게 §6-2 기본값(0)으로", () => {
    let st = editReducer(selectFilm(resetForNewMedia(), "fuji-velvia"), { type: "set", key: "clarity", value: 33 });
    st = editReducer(st, { type: "reset", key: "clarity" });
    expect(st.clarity).toBe(0);
    expect(defaultFor("clarity")).toBe(0);
    expect(defaultFor("filmStrength")).toBe(100);
  });
  it("6) 같은 필름 카드를 다시 탭해도 사용자가 조절한 값은 그대로 (히스토리 기록 없음)", () => {
    let h = initialHistory({ edit: resetForNewMedia(), choice: "auto" });
    h = historyReducer(h, { type: "do", action: { type: "selectFilm", simId: "fuji-velvia" } });
    h = historyReducer(h, { type: "do", action: { type: "set", key: "clarity", value: 20 } });
    h = historyReducer(h, { type: "do", action: { type: "selectFilm", simId: "fuji-velvia" } });
    expect(h.present.edit.clarity).toBe(20);
    expect(h.past.length).toBe(2);
  });
  it("7) filmStrength 70, monoAmount 30 은 selectFilm 을 여러 번 해도 그대로", () => {
    let st: EditState = { ...resetForNewMedia(), filmStrength: 70, monoAmount: 30 };
    for (const id of ["fuji-acros", "ricoh-retro", null, "fuji-velvia", "fuji-velvia"]) st = selectFilm(st, id);
    expect([st.filmStrength, st.monoAmount]).toEqual([70, 30]);
  });
  it("모든 필름 32종 + 필름 없음: 선택해도 simId 외 편집 값이 변하지 않는다", () => {
    const edited = editReducer(editReducer(resetForNewMedia(), { type: "set", key: "exposure", value: 1.5 }), { type: "toggleHdf" });
    for (const id of [null, ...Object.keys(FILM_PRESETS)]) expect({ ...selectFilm(edited, id), simId: null }).toEqual({ ...edited, simId: null });
  });
  it("데모: resetForNewMedia() 다음 selectFilm('fuji-classic-chrome') 만 (상세 조정은 초기값)", () => {
    expect(mediaOpenState(true)).toEqual(selectFilm(resetForNewMedia(), "fuji-classic-chrome"));
    expect({ ...mediaOpenState(true), simId: null }).toEqual(initialEditState());
  });
  it("setDRange 는 100/200/400 만", () => {
    expect(editReducer(resetForNewMedia(), { type: "setDRange", value: 400 }).dRange).toBe(400);
    expect(getValue(selectFilm(resetForNewMedia(), "fuji-eterna"), "hdfStrength")).toBe(100);
  });
});

describe("U13 레시피 dRange (6-5)", () => {
  it("저장·복원", () => {
    const st = editReducer(selectFilm(resetForNewMedia(), "fuji-classic-neg"), { type: "setDRange", value: 400 });
    const r = recipeFromState(st, "DR 테스트");
    expect(r.params.dRange).toBe(400);
    const back = validateRecipe(JSON.parse(JSON.stringify(r)))!;
    expect(back.params.dRange).toBe(400);
    expect(applyRecipe(resetForNewMedia(), back)).toEqual(st);
  });
  it("v1 레시피(dRange 없음) → 100, 잘못된 값 → 100", () => {
    const r = recipeFromState(resetForNewMedia(), "구버전");
    const raw = JSON.parse(JSON.stringify(r)) as { params: Record<string, unknown> };
    delete raw.params.dRange;
    expect(validateRecipe(raw)!.params.dRange).toBe(100);
    raw.params.dRange = 300;
    expect(validateRecipe(raw)!.params.dRange).toBe(100);
    expect(applyRecipe({ ...resetForNewMedia(), dRange: 400 }, validateRecipe(raw)!).dRange).toBe(100);
  });
});
