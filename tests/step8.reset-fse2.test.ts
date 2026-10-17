// 새 미디어 열기 완전 초기화 + FSE-v2 (떡보정 제거) 회귀 테스트
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
