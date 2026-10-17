// 필름 선택 불변 · 탭별 초기화 5종 · 전체 초기화 (히스토리 기록/되돌리기) · Studio 연결
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { historyReducer, historyTimeline, initialHistory, type HistoryState } from "../src/lib/studio/history";
import {
  editReducer, initialEditState, isEditDefault, isTabDefault, RESET_ALL_LABEL, resetTab, TAB_RESET_LABEL, type EditState, type SliderKey, type TabId,
} from "../src/lib/studio/state";

/** 모든 탭의 값을 기본에서 벗어나게 만든 상태 */
function dirty(): EditState {
  let st = editReducer(initialEditState(), { type: "selectFilm", simId: "fuji-velvia" });
  const set = (key: SliderKey, value: number) => { st = editReducer(st, { type: "set", key, value }); };
  set("filmStrength", 60);
  set("lightBalance", 10); set("exposure", 1); set("brightness", 5); set("contrast", 20); set("highlights", -15); set("shadows", 12); set("whites", 3); set("blacks", -7);
  st = editReducer(st, { type: "setDRange", value: 400 });
  set("temp", 8); set("tint", -4); set("saturation", 9); set("vibrance", 11); set("cce", 2); set("ccb", 1); set("monoHue", 120); set("monoAmount", 40);
  st = editReducer(st, { type: "curvePreset", preset: "strong-contrast" });
  set("zone2", 30);
  set("sharpness", 40); set("clarity", 20); set("dehaze", 10); set("grainAmount", 70); set("grainSize", 100); set("vignette", -20); set("hdfStrength", 40);
  st = editReducer(st, { type: "setHdf", value: true });
  return st;
}

const LIGHT = ["lightBalance", "exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks"] as const;
const COLOR = ["temp", "tint", "saturation", "vibrance", "cce", "ccb", "monoHue", "monoAmount"] as const;
const DETAIL = ["sharpness", "clarity", "dehaze", "grainAmount", "grainSize", "vignette"] as const;

describe("필름 선택은 simId 만 바꾼다", () => {
  it("상세 조정이 모두 바뀐 상태에서 필름 20+12+원본을 눌러도 simId 외에는 그대로", () => {
    const base = { ...dirty(), simId: null };
    for (const id of [null, "fuji-provia", "fuji-acros", "ricoh-hdr-tone", "ricoh-hi-contrast-bw"]) {
      const n = editReducer(base, { type: "selectFilm", simId: id });
      expect(n.simId).toBe(id);
      expect({ ...n, simId: null }).toEqual(base);
    }
  });
  it("초기 상태에서 필름을 골라도 0 / OFF / DR100 유지", () => {
    const n = editReducer(initialEditState(), { type: "selectFilm", simId: "fuji-classic-chrome" });
    expect({ ...n, simId: null }).toEqual(initialEditState());
    expect([n.grainAmount, n.cce, n.ccb, n.dRange, n.hdf, n.curve.preset]).toEqual([0, 0, 0, 100, false, "linear"]);
  });
});

describe("탭별 초기화", () => {
  const TABS: TabId[] = ["film", "light", "color", "curve", "detail"];
  it("기본 상태는 모든 탭이 기본값(버튼 비활성), 변경하면 해당 탭만 변경됨으로 표시", () => {
    for (const t of TABS) expect(isTabDefault(initialEditState(), t)).toBe(true);
    for (const t of TABS) expect(isTabDefault(dirty(), t)).toBe(false);
    expect(isTabDefault(editReducer(initialEditState(), { type: "set", key: "exposure", value: 1 }), "light")).toBe(false);
    expect(isTabDefault(editReducer(initialEditState(), { type: "set", key: "exposure", value: 1 }), "color")).toBe(true);
  });
  it("필름 탭: film = 없음, 강도 100. 다른 탭은 그대로", () => {
    const d = dirty(), n = resetTab(d, "film");
    expect([n.simId, n.filmStrength]).toEqual([null, 100]);
    expect({ ...n, simId: d.simId, filmStrength: d.filmStrength }).toEqual(d);
  });
  it("라이트 탭: D레인지 DR100 + 8개 슬라이더 0. 다른 탭은 그대로", () => {
    const d = dirty(), n = resetTab(d, "light");
    expect(n.dRange).toBe(100);
    for (const k of LIGHT) expect(n[k]).toBe(0);
    expect({ ...n, dRange: d.dRange, ...Object.fromEntries(LIGHT.map((k) => [k, d[k]])) }).toEqual(d);
  });
  it("컬러 탭: 색온도·틴트·채도·생동감·흑백 조색 0, 컬러 크롬 OFF. 다른 탭은 그대로", () => {
    const d = dirty(), n = resetTab(d, "color");
    for (const k of COLOR) expect(n[k]).toBe(0);
    expect({ ...n, ...Object.fromEntries(COLOR.map((k) => [k, d[k]])) }).toEqual(d);
  });
  it("커브 탭: 프리셋·포인트·5구간 모두 선형. 다른 탭은 그대로", () => {
    const d = dirty(), n = resetTab(d, "curve");
    expect(n.curve).toEqual(initialEditState().curve);
    expect(n.curve.preset).toBe("linear");
    expect({ ...n, curve: d.curve }).toEqual(d);
  });
  it("디테일·효과 탭: 선명도·명료도·디헤이즈·그레인·비네팅 0, HDF 끔(강도 기본). 다른 탭은 그대로", () => {
    const d = dirty(), n = resetTab(d, "detail");
    for (const k of DETAIL) expect(n[k]).toBe(0);
    expect([n.hdf, n.hdfStrength]).toEqual([false, initialEditState().hdfStrength]);
    expect({ ...n, hdf: d.hdf, hdfStrength: d.hdfStrength, ...Object.fromEntries(DETAIL.map((k) => [k, d[k]])) }).toEqual(d);
  });
  it("히스토리에 '… 탭 초기화' 라벨로 1단계 기록되고 되돌릴 수 있다", () => {
    const labels = ["필름 탭 초기화", "라이트 탭 초기화", "컬러 탭 초기화", "커브 탭 초기화", "디테일 탭 초기화"];
    expect(TABS.map((t) => TAB_RESET_LABEL[t])).toEqual(labels);
    let h: HistoryState = initialHistory({ edit: dirty(), choice: "auto" });
    for (const t of TABS) {
      const before = h.present.edit;
      h = historyReducer(h, { type: "do", label: TAB_RESET_LABEL[t], action: { type: "resetTab", tab: t } });
      expect(historyTimeline(h).at(-1)!.label).toBe(TAB_RESET_LABEL[t]);
      expect(h.present.edit).not.toEqual(before);
    }
    expect(h.past.length).toBe(5);
    expect(h.present.edit).toEqual(initialEditState());
    h = historyReducer(h, { type: "undo" });
    expect(isTabDefault(h.present.edit, "detail")).toBe(false);
  });
  it("이미 기본인 탭의 초기화는 히스토리에 쌓이지 않는다", () => {
    let h = initialHistory({ edit: initialEditState(), choice: "auto" });
    h = historyReducer(h, { type: "do", label: TAB_RESET_LABEL.light, action: { type: "resetTab", tab: "light" } });
    expect(h.past.length).toBe(0);
  });
});

describe("전체 초기화", () => {
  it("필름·모든 탭·커브·HDF·그레인을 초기 상태로 되돌린다", () => {
    const n = editReducer(dirty(), { type: "resetAll" });
    expect(n).toEqual(initialEditState());
    expect(isEditDefault(n)).toBe(true);
    expect(isEditDefault(dirty())).toBe(false);
  });
  it("'전체 초기화' 1단계로 기록 → 되돌리기로 복구, 다시 실행 가능. 입력 색공간 선택은 유지", () => {
    let h: HistoryState = initialHistory({ edit: dirty(), choice: "slog3" });
    const before = h.present.edit;
    h = historyReducer(h, { type: "do", label: RESET_ALL_LABEL, action: { type: "resetAll" } });
    expect(historyTimeline(h).at(-1)!.label).toBe("전체 초기화");
    expect(h.present.edit).toEqual(initialEditState());
    expect(h.present.choice).toBe("slog3");
    h = historyReducer(h, { type: "undo" });
    expect(h.present.edit).toEqual(before);
    h = historyReducer(h, { type: "redo" });
    expect(h.present.edit).toEqual(initialEditState());
  });
});

describe("Studio / Header / 탭 UI 연결", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  it("Studio: 탭 초기화·전체 초기화를 히스토리 라벨과 함께 dispatch", () => {
    const src = read("../src/components/studio/Studio.tsx");
    expect(src).toContain('action: { type: "resetTab", tab }');
    expect(src).toContain('action: { type: "resetAll" }');
    expect(src).toContain("TAB_RESET_LABEL[tab]");
    expect(src).toContain("RESET_ALL_LABEL");
    expect(src).toContain("<TabResetBar");
    expect(src).toContain("resetAllEnabled={!isEditDefault(state)}");
  });
  it("Header: 전체 초기화 버튼, 기본 상태에서는 비활성", () => {
    const src = read("../src/components/studio/Header.tsx");
    expect(src).toContain('aria-label="전체 초기화"');
    expect(src).toContain("!p.resetAllEnabled");
  });
  it("TabResetBar: [초기화] 버튼은 변경된 항목이 있을 때만 활성", () => {
    const src = read("../src/components/studio/TabResetBar.tsx");
    expect(src).toContain("초기화");
    expect(src).toContain("disabled={disabled || !changed}");
  });
  it("필름 탭: 필름 카드와 필름 강도 외 컨트롤 없음", () => {
    const src = read("../src/components/studio/tabs/FilmTab.tsx");
    expect(src.match(/<StateSlider/g)?.length).toBe(1);
    expect(src).toContain('<StateSlider k="filmStrength"');
  });
  it("디테일 탭: 그레인 크기 슬라이더 없음, 거칠기(OFF/약/강) · 크기(소/대) 스위치", () => {
    const src = read("../src/components/studio/tabs/DetailTab.tsx");
    expect(src).not.toContain('k="grainSize"');
    for (const t of ["OFF", "약 (Weak)", "강 (Strong)", "소 (Small)", "대 (Large)"]) expect(src).toContain(t);
    expect(src).toContain('<StateSlider k="grainAmount" />');
  });
});
