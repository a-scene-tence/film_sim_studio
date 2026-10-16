// 새 미디어 열기 완전 초기화 + FSE-v2 (떡보정 제거) 회귀 테스트
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SKIN_PROTECT } from "../src/lib/color/fse/constants.mjs";
import { filmTone, linToOklab, renderPoint, skinWeight, srgbDec, tone, toneCoeffs, toneInv } from "../src/lib/color/fse/engine.mjs";
import { FILM_SIMS } from "../src/lib/color/fse/film-params.mjs";
import { historyReducer, historyTimeline, initialHistory, type HistoryState } from "../src/lib/studio/history";
import { DEMO_SIM_ID, getValue, initialEditState, mediaOpenState, selectSim, SLIDERS } from "../src/lib/studio/state";

describe("새 미디어 열기 = 완전 초기화", () => {
  it("사용자 파일: 필름 없음, 필름 강도 100%, 모든 슬라이더 기본값, HDF 끔, 톤 커브 linear", () => {
    const st = mediaOpenState(false);
    expect(st).toEqual(initialEditState());
    expect(st.simId).toBeNull();
    expect(st.filmStrength).toBe(100);
    expect(st.hdf).toBe(false);
    expect(st.curve.preset).toBe("linear");
    expect(st.curve.zones).toEqual([0, 0, 0, 0, 0]);
    for (const sp of SLIDERS) expect([sp.key, getValue(st, sp.key)]).toEqual([sp.key, sp.def]);
  });
  it("데모만 소개용 필름 + HDF 로 시작", () => {
    expect(mediaOpenState(true)).toEqual({ ...initialEditState(), simId: DEMO_SIM_ID, hdf: true });
  });
  it("편집 이력이 쌓인 뒤 새 미디어 → 히스토리는 '초기 상태' 1개", () => {
    let h: HistoryState = initialHistory({ edit: initialEditState(), choice: "auto" });
    h = historyReducer(h, { type: "do", action: { type: "selectSim", simId: "fuji-velvia", iso: null } });
    h = historyReducer(h, { type: "do", action: { type: "set", key: "exposure", value: 1 } });
    h = historyReducer(h, { type: "do", action: { type: "toggleHdf" } });
    h = historyReducer(h, { type: "do", action: { type: "choice", choice: "slog3" } });
    h = historyReducer(h, { type: "undo" });
    h = historyReducer(h, { type: "begin" });
    h = historyReducer(h, { type: "live", action: { type: "set", key: "contrast", value: 30 } });
    expect(h.past.length).toBeGreaterThan(0);
    h = historyReducer(h, { type: "reset", snap: { edit: mediaOpenState(false), choice: "auto" } });
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(h.pending).toBeNull();
    expect(h.present.edit).toEqual(initialEditState());
    expect(h.present.choice).toBe("auto");
    expect(historyTimeline(h).map((e) => e.label)).toEqual(["초기 상태"]);
  });
  it("Studio.openFile: 이전 필름을 이어받지 않고 비교·스포이트를 끄고 히스토리를 초기화한다", () => {
    const src = readFileSync(new URL("../src/components/studio/Studio.tsx", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("const openFile = useCallback"), src.indexOf("const openDemo = useCallback"));
    expect(body).toContain('histDispatch({ type: "reset", snap: { edit: mediaOpenState(demo), choice: "auto" } })');
    expect(body).toContain("setCompare(false)");
    expect(body).toContain("setPicking(false)");
    expect(body).not.toContain("state.simId");
    // 줌/팬은 Preview 가 asset.id 변경 시 1× 로 되돌린다
    const preview = readFileSync(new URL("../src/components/studio/Preview.tsx", import.meta.url), "utf8");
    expect(preview).toContain("useEffect(() => { zoomRef.current = ONE; queueMicrotask(() => setZoom(ONE)); }, [assetId]);");
  });
  it("필름을 골라도 상세 조정 슬라이더는 중립 그대로", () => {
    for (const P of FILM_SIMS) expect({ ...selectSim(initialEditState(), P.id, 6400), simId: null }).toEqual(initialEditState());
  });
});

const oklabC = (rgb: ArrayLike<number>) => {
  const l = linToOklab([srgbDec(rgb[0]!), srgbDec(rgb[1]!), srgbDec(rgb[2]!)]);
  return Math.hypot(l[1], l[2]);
};
const fromSrgb8 = (c: number[]): [number, number, number] => [toneInv(srgbDec(c[0]! / 255)), toneInv(srgbDec(c[1]! / 255)), toneInv(srgbDec(c[2]! / 255))];
const COLOR = FILM_SIMS.filter((p) => !p.mono);
const PATCHES = [[115,82,68],[194,150,130],[98,122,157],[87,108,67],[133,128,177],[103,189,170],[214,126,44],[80,91,166],[193,90,99],[94,60,108],[157,188,64],[224,163,46],[56,61,150],[70,148,73],[175,54,60],[231,199,31],[187,86,149],[8,133,161]];
const SKIN = [[115,82,68],[194,150,130],[224,172,140],[160,110,85],[240,200,175]];

describe("FSE-v2 컬러 사이언스 보장", () => {
  it("피부톤 보호 대역: 대역 중심 가중치 1, 대역 밖 0, 억제 비율 ≥ 50%", () => {
    expect(skinWeight(45, 0.7, 0.08)).toBe(1);
    expect(skinWeight(200, 0.7, 0.08)).toBe(0);
    expect(skinWeight(45, 0.1, 0.08)).toBe(0);
    expect(skinWeight(45, 0.7, 0.3)).toBe(0);
    expect(SKIN_PROTECT).toBeGreaterThanOrEqual(0.5);
  });
  it.each(FILM_SIMS.map((p) => [p.id, p] as const))("%s: 톤 단조 증가 + 소프트 니", (_id, p) => {
    const k = toneCoeffs(p.tone);
    let prev = -1;
    for (let i = 0; i <= 4000; i++) {
      const x = 2.6 * (i / 4000) ** 3;
      const y = filmTone(x, k);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = y;
    }
    // 섀도 끝(L_ref ≤ 0.05)·하이라이트 끝(L_ref ≥ 0.98)에서 필름 톤은 기준 톤 쪽으로 50% 이상 되돌아간다
    for (const x of [0.00002, 0.00005, 1.75]) {
      expect(Math.cbrt(tone(x)) <= 0.05 || Math.cbrt(tone(x)) >= 0.98).toBe(true);
      const yr = tone(x);
      expect(Math.abs(filmTone(x, k) - yr)).toBeLessThanOrEqual(0.5 * Math.abs(tone(x, k) - yr) + 1e-12);
    }
  });
  it.each(COLOR.map((p) => [p.id, p] as const))("%s: 최심부 블랙·최상단 화이트는 중립 수렴", (_id, p) => {
    const k = toneCoeffs(p.tone);
    for (const x of [0.0003, p.tone.hdrMax]) {
      const v = renderPoint([x, x, x], p, k);
      expect(Math.max(...v) - Math.min(...v)).toBeLessThanOrEqual(0.004);
    }
    expect(p.desat![0]).toBeGreaterThanOrEqual(0.3);
    expect(p.desat![1]).toBeGreaterThanOrEqual(0.3);
  });
  it.each(COLOR.map((p) => [p.id, p] as const))("%s: 과채도 가드 (ColorChecker 평균 채도비 ≤ 1.2, 피부 채도비 ≤ 1.25)", (_id, p) => {
    const k = toneCoeffs(p.tone);
    const ratio = (set: number[][]) => set.reduce((s, c) => s + oklabC(renderPoint(fromSrgb8(c), p, k)) / oklabC(c.map((v) => v / 255)), 0) / set.length;
    expect(ratio(PATCHES)).toBeLessThanOrEqual(1.2);
    expect(ratio(SKIN)).toBeLessThanOrEqual(1.25);
  });
});
