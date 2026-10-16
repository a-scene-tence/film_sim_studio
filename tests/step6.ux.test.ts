// 모바일 UX: 슬라이더 방향 판별 잠금 + 트랜잭션 기반 Undo/Redo 히스토리.
import { describe, expect, it, vi } from "vitest";
import { SliderGesture, valueFromDelta, type PointerLike } from "../src/lib/studio/slider-gesture";
import { diffLabel, HISTORY_LIMIT, historyReducer, initialHistory, redoLabel, undoLabel, type HistoryAction, type HistoryState } from "../src/lib/studio/history";
import { initialEditState } from "../src/lib/studio/state";

function rig(value = 0) {
  const calls = { start: vi.fn(), change: vi.fn(), commit: vi.fn(), reset: vi.fn(), capture: vi.fn(), release: vi.fn() };
  const cur = { value };
  const g = new SliderGesture({
    limits: () => ({ min: -100, max: 100, step: 1 }), value: () => cur.value, rect: () => ({ left: 0, width: 200 }),
    onDragStart: calls.start, onChange: (v) => { cur.value = v; calls.change(v); }, onCommit: calls.commit, onReset: calls.reset, capture: calls.capture, release: calls.release,
  });
  let t = 0;
  const ev = (x: number, y: number, type = "touch", pid = 1, dt = 0): PointerLike => ({ pointerId: pid, pointerType: type, clientX: x, clientY: y, timeStamp: (t += dt) });
  return { g, calls, ev, cur, tick: (ms: number) => { t += ms; } };
}

describe("슬라이더 방향 판별 잠금", () => {
  it("valueFromDelta: 트랙 폭 비율 + step 스냅 + clamp", () => {
    expect(valueFromDelta(0, 20, 200, -100, 100, 1)).toBe(20);
    expect(valueFromDelta(90, 100, 200, -100, 100, 1)).toBe(100);
    expect(valueFromDelta(0, 10, 0, -100, 100, 1)).toBe(0);
  });

  it("터치 down: 값 변경·캡처 없이 대기", () => {
    const { g, calls, ev } = rig();
    g.down(ev(100, 10));
    expect(g.phase).toBe("pending");
    expect(calls.change).not.toHaveBeenCalled();
    expect(calls.capture).not.toHaveBeenCalled();
    expect(calls.start).not.toHaveBeenCalled();
  });

  it("상하 이동이 크면 취소: 값 불변, 커밋 없음, 캡처 없음", () => {
    const { g, calls, ev } = rig(10);
    g.down(ev(100, 10));
    g.move(ev(102, 30));
    g.move(ev(103, 80));
    g.up(ev(103, 80));
    expect(g.phase).toBe("idle");
    expect(calls.change).not.toHaveBeenCalled();
    expect(calls.commit).not.toHaveBeenCalled();
    expect(calls.capture).not.toHaveBeenCalled();
  });

  it("임계값(6px) 이내에서는 대기, 좌우 이동이 크면 캡처 후 상대 이동으로 값 변경 + onCommit 1회", () => {
    const { g, calls, ev, cur } = rig(10);
    g.down(ev(100, 10));
    g.move(ev(104, 11));
    expect(g.phase).toBe("pending");
    g.move(ev(108, 12)); // dx 8 > 6, dx >= dy → 잠금
    expect(g.phase).toBe("dragging");
    expect(calls.capture).toHaveBeenCalledTimes(1);
    expect(calls.start).toHaveBeenCalledTimes(1);
    expect(calls.change).not.toHaveBeenCalled(); // 잠금 순간엔 값이 튀지 않는다
    g.move(ev(128, 12)); // 잠금 지점에서 +20px = 트랙 200px 기준 +20
    expect(cur.value).toBe(30);
    g.move(ev(118, 40)); // 잠금 후엔 세로로 움직여도 슬라이더 유지
    expect(cur.value).toBe(20);
    g.up(ev(118, 40));
    expect(calls.commit).toHaveBeenCalledTimes(1);
    expect(calls.release).toHaveBeenCalledTimes(1);
    expect(calls.reset).not.toHaveBeenCalled();
  });

  it("마우스: 클릭 즉시 점프 + 드래그 + 커밋 1회", () => {
    const { g, calls, ev, cur } = rig();
    g.down(ev(150, 5, "mouse"));
    expect(cur.value).toBe(50);
    expect(calls.start).toHaveBeenCalledTimes(1);
    g.move(ev(100, 5, "mouse"));
    expect(cur.value).toBe(0);
    g.up(ev(100, 5, "mouse"));
    expect(calls.commit).toHaveBeenCalledTimes(1);
  });

  it("더블탭: 이동 없는 탭 2회만 초기화, 스크롤 후 탭은 후보가 아니다", () => {
    const a = rig();
    a.g.down(a.ev(50, 5)); a.g.up(a.ev(50, 5, "touch", 1, 50));
    a.g.down(a.ev(51, 5, "touch", 1, 100)); a.g.up(a.ev(51, 5, "touch", 1, 50));
    expect(a.calls.reset).toHaveBeenCalledTimes(1);
    expect(a.calls.change).not.toHaveBeenCalled();

    const b = rig();
    b.g.down(b.ev(50, 5)); b.g.up(b.ev(50, 5, "touch", 1, 50));
    b.g.down(b.ev(50, 5, "touch", 1, 50)); b.g.move(b.ev(52, 40, "touch", 1, 20)); b.g.up(b.ev(52, 40, "touch", 1, 20)); // 스크롤
    b.g.down(b.ev(50, 5, "touch", 1, 50)); b.g.up(b.ev(50, 5, "touch", 1, 20));
    expect(b.calls.reset).not.toHaveBeenCalled(); // 스크롤이 사이에 있었으므로 연속 2탭이 아니다

    const c = rig();
    c.g.down(c.ev(50, 5)); c.g.up(c.ev(50, 5, "touch", 1, 50));
    c.g.down(c.ev(50, 5, "touch", 1, 400)); c.g.up(c.ev(50, 5, "touch", 1, 50)); // 300ms 초과
    expect(c.calls.reset).not.toHaveBeenCalled();
  });

  it("pointercancel: 대기 중이면 아무 일 없음, 드래그 중이면 커밋", () => {
    const a = rig();
    a.g.down(a.ev(50, 5)); a.g.cancel(a.ev(50, 30));
    expect(a.calls.commit).not.toHaveBeenCalled();
    const b = rig();
    b.g.down(b.ev(50, 5)); b.g.move(b.ev(70, 5)); b.g.cancel(b.ev(70, 5));
    expect(b.calls.commit).toHaveBeenCalledTimes(1);
  });
});

describe("Undo/Redo 히스토리 (트랜잭션 단위, 최대 50단계)", () => {
  const start = () => initialHistory({ edit: initialEditState(), choice: "auto" });
  const run = (h: HistoryState, ...as: HistoryAction[]) => as.reduce(historyReducer, h);
  const set = (key: "exposure" | "contrast" | "shadows", value: number): HistoryAction => ({ type: "live", action: { type: "set", key, value } });

  it("드래그 중 live 는 쌓이지 않고 commit 에서 1단계만 푸시, redo 비움", () => {
    let h = run(start(), { type: "begin" }, set("exposure", 0.5), set("exposure", 1), set("exposure", 1.5));
    expect(h.past.length).toBe(0);
    h = run(h, { type: "commit" });
    expect(h.past.length).toBe(1);
    expect(h.present.edit.exposure).toBe(1.5);
    h = run(h, { type: "undo" });
    expect(h.present.edit.exposure).toBe(0);
    expect(h.future.length).toBe(1);
    h = run(h, { type: "begin" }, set("contrast", 10), { type: "commit" });
    expect(h.future.length).toBe(0);
  });

  it("값이 달라지지 않은 드래그는 기록하지 않는다", () => {
    const h = run(start(), { type: "begin" }, set("exposure", 1), set("exposure", 0), { type: "commit" });
    expect(h.past.length).toBe(0);
    expect(h.pending).toBeNull();
  });

  it("단발성 조작은 즉시 기록, 변화 없으면 기록 안 함", () => {
    let h = run(start(), { type: "do", action: { type: "toggleHdf" } });
    expect(h.past.length).toBe(1);
    expect(h.present.edit.hdf).toBe(true);
    h = run(h, { type: "do", action: { type: "setHdf", value: true } });
    expect(h.past.length).toBe(1);
    h = run(h, { type: "do", action: { type: "selectSim", simId: "fuji-classic-chrome", iso: null } }, { type: "do", action: { type: "choice", choice: "slog3" } });
    expect(h.past.length).toBe(3);
    expect(h.present.choice).toBe("slog3");
    h = run(h, { type: "undo" }, { type: "undo" });
    expect(h.present.edit.simId).toBeNull();
    expect(h.present.choice).toBe("auto");
    h = run(h, { type: "redo" });
    expect(h.present.edit.simId).toBe("fuji-classic-chrome");
  });

  it("undo/redo 가 비어 있으면 무시 (동일 참조)", () => {
    const h = start();
    expect(historyReducer(h, { type: "undo" })).toBe(h);
    expect(historyReducer(h, { type: "redo" })).toBe(h);
  });

  it("최대 50단계: 오래된 것부터 버린다", () => {
    let h = start();
    for (let i = 1; i <= 60; i++) h = run(h, { type: "begin" }, set("exposure", i / 20), { type: "commit" });
    expect(h.past.length).toBe(HISTORY_LIMIT);
    for (let i = 0; i < 100; i++) h = run(h, { type: "undo" });
    expect(h.present.edit.exposure).toBeCloseTo(10 / 20); // 처음 10단계는 사라졌다
  });

  it("새 미디어(reset)는 스택을 비운다", () => {
    let h = run(start(), { type: "do", action: { type: "toggleHdf" } });
    h = run(h, { type: "reset", snap: { edit: initialEditState(), choice: "auto" } });
    expect(h.past.length + h.future.length).toBe(0);
    expect(h.present.edit.hdf).toBe(false);
  });

  it("라벨: 항목 이름 / 다중 변경 / 필름 변경", () => {
    let h = run(start(), { type: "begin" }, set("exposure", 1), { type: "commit" });
    expect(undoLabel(h)).toBe("노출");
    expect(redoLabel(h)).toBeNull();
    h = run(h, { type: "undo" });
    expect(redoLabel(h)).toBe("노출");
    h = run(h, { type: "do", action: { type: "patch", values: { exposure: 1, contrast: 5 } } });
    expect(undoLabel(h)).toBe("노출 외 1개");
    h = run(h, { type: "do", action: { type: "selectSim", simId: "fuji-classic-chrome", iso: null } });
    expect(undoLabel(h)).toBe("필름 변경");
    expect(diffLabel(h.present, h.present)).toBe("변경");
  });
});
