// 편집 히스토리: 트랜잭션(commit) 단위 Undo/Redo 스택 (최대 50단계). 순수 리듀서라 UI 와 무관하게 테스트한다.
import { editReducer, getValue, initialEditState, SLIDERS, type EditAction, type EditState } from "./state";

export const HISTORY_LIMIT = 50;

/** 히스토리가 되돌리는 단위: 편집 상태 + 입력 색공간 선택(InputChoice 문자열) */
export interface Snap {
  edit: EditState;
  choice: string;
  /** 이 상태를 만든 조작의 명시적 이름 ("컬러 자동 보정" 등). 없으면 변경 항목에서 유추한다 */
  label?: string;
}
export type SnapAction = EditAction | { type: "choice"; choice: string };

export interface HistoryState {
  present: Snap;
  past: Snap[];
  future: Snap[];
  /** 드래그 시작 시점의 스냅샷 (commit 때 present 와 비교해 1단계로 푸시) */
  pending: Snap | null;
}

export type HistoryAction =
  /** 드래그 중 실시간 갱신: 히스토리에 쌓지 않는다 */
  | { type: "live"; action: SnapAction }
  /** 단발성 조작: 즉시 1단계 기록 */
  | { type: "do"; action: SnapAction; label?: string }
  | { type: "begin" }
  | { type: "commit" }
  | { type: "undo" }
  | { type: "redo" }
  /** 타임라인 점프: 전체 타임라인([...past, present, ...future]) 의 index 상태로 즉시 이동 */
  | { type: "jump"; index: number }
  /** 전체 초기화: 편집값을 기본값으로 되돌리고 undo/redo 스택을 모두 비운다 (입력 색공간 선택은 유지, 단계로 기록하지 않음) */
  | { type: "clearAll" }
  /** 새 미디어: 스택을 비우고 기준 상태를 바꾼다 */
  | { type: "reset"; snap: Snap };

export function initialHistory(snap: Snap): HistoryState {
  return { present: snap, past: [], future: [], pending: null };
}

export function snapsEqual(a: Snap, b: Snap): boolean {
  return a === b || (a.choice === b.choice && JSON.stringify(a.edit) === JSON.stringify(b.edit));
}

function applySnap(s: Snap, a: SnapAction): Snap {
  if (a.type === "choice") return a.choice === s.choice ? s : { edit: s.edit, choice: a.choice };
  const edit = editReducer(s.edit, a);
  return edit === s.edit ? s : { edit, choice: s.choice };
}

const pushPast = (past: Snap[], s: Snap): Snap[] => [...past, s].slice(-HISTORY_LIMIT);

export function historyReducer(h: HistoryState, a: HistoryAction): HistoryState {
  switch (a.type) {
    case "live": {
      const present = applySnap(h.present, a.action);
      return present === h.present ? h : { ...h, present };
    }
    case "do": {
      const applied = applySnap(h.present, a.action);
      if (snapsEqual(applied, h.present)) return h;
      const present: Snap = a.label ? { ...applied, label: a.label } : applied;
      // 드래그 중 단발 조작이 끼어들면 드래그 기준 상태를 기록해 한 단계로 묶는다
      const base = h.pending && !snapsEqual(h.pending, h.present) ? h.pending : h.present;
      // 드래그 기준 상태로 되돌아왔다면 실질 변화가 없으므로 기록하지 않는다
      if (snapsEqual(present, base)) return { ...h, present, pending: null };
      return { present, past: pushPast(h.past, base), future: [], pending: null };
    }
    case "begin": return h.pending ? h : { ...h, pending: h.present };
    case "commit": {
      if (!h.pending) return h;
      if (snapsEqual(h.pending, h.present)) return { ...h, pending: null };
      return { present: h.present, past: pushPast(h.past, h.pending), future: [], pending: null };
    }
    case "undo": {
      if (h.past.length === 0) return h;
      return { present: h.past[h.past.length - 1]!, past: h.past.slice(0, -1), future: [h.present, ...h.future], pending: null };
    }
    case "redo": {
      if (h.future.length === 0) return h;
      return { present: h.future[0]!, past: pushPast(h.past, h.present), future: h.future.slice(1), pending: null };
    }
    case "jump": return jumpToHistoryIndex(h, a.index);
    case "clearAll": return initialHistory({ edit: initialEditState(), choice: h.present.choice });
    case "reset": return initialHistory(a.snap);
  }
}

/** 두 스냅샷 사이에서 바뀐 항목의 한국어 라벨 ("노출", "필름 변경", "노출 외 2개") */
export function diffLabel(from: Snap, to: Snap): string {
  if (to.label) return to.label;
  if (from.edit.simId !== to.edit.simId) return "필름 변경";
  const names: string[] = [];
  if (from.choice !== to.choice) names.push("입력 색공간");
  for (const sp of SLIDERS) if (getValue(from.edit, sp.key) !== getValue(to.edit, sp.key)) names.push(sp.label);
  if (from.edit.hdf !== to.edit.hdf) names.push("HDF");
  if (from.edit.dRange !== to.edit.dRange) names.push("D레인지");
  if (JSON.stringify(from.edit.curve.points) !== JSON.stringify(to.edit.curve.points)) names.push("톤 커브");
  if (names.includes("그레인 강도") && names.includes("그레인 크기")) names.splice(names.indexOf("그레인 강도"), 2, "그레인");
  if (names.length === 0) return "변경";
  return names.length === 1 ? names[0]! : `${names[0]} 외 ${names.length - 1}개`;
}

/** 다음 Undo 가 되돌릴 항목 라벨 (없으면 null) */
export const undoLabel = (h: HistoryState): string | null => (h.past.length > 0 ? diffLabel(h.past[h.past.length - 1]!, h.present) : null);
/** 다음 Redo 가 다시 적용할 항목 라벨 (없으면 null) */
export const redoLabel = (h: HistoryState): string | null => (h.future.length > 0 ? diffLabel(h.present, h.future[0]!) : null);

/** 전체 타임라인 [...past, present, ...future] 에서 현재 위치 */
export const currentHistoryIndex = (h: HistoryState): number => h.past.length;

/**
 * 타임라인의 index 상태로 즉시 점프 (Undo/Redo 를 여러 번 누른 것과 동일한 결과).
 * 범위를 벗어나거나 현재 위치면 동일 참조를 돌려준다. 거쳐 간 상태는 past/future 에 그대로 남아 계속 이동할 수 있다.
 */
export function jumpToHistoryIndex(h: HistoryState, index: number): HistoryState {
  const timeline = [...h.past, h.present, ...h.future];
  if (!Number.isInteger(index) || index < 0 || index >= timeline.length || index === h.past.length) return h;
  return { present: timeline[index]!, past: timeline.slice(0, index), future: timeline.slice(index + 1), pending: null };
}

export interface TimelineEntry {
  /** jumpToHistoryIndex 에 넘길 타임라인 인덱스 */
  index: number;
  /** "초기 상태" 또는 이 상태를 만든 조작 라벨 */
  label: string;
  /** 현재 위치 기준 몇 단계 떨어졌는지 (과거 음수, 미래 양수, 현재 0) */
  offset: number;
  kind: "past" | "current" | "future";
  /** 화면 표시용: "1단계 전: 노출" / "현재: 노출" / "1단계 후: 대비" */
  text: string;
}

/** 히스토리 타임라인 목록 (오래된 것 → 최신 순) */
export function historyTimeline(h: HistoryState): TimelineEntry[] {
  const snaps = [...h.past, h.present, ...h.future];
  const cur = h.past.length;
  return snaps.map((s, index) => {
    const label = index === 0 ? "초기 상태" : diffLabel(snaps[index - 1]!, s);
    const offset = index - cur;
    const kind = offset < 0 ? "past" : offset > 0 ? "future" : "current";
    const text = kind === "current" ? `현재: ${label}` : kind === "past" ? `${-offset}단계 전: ${label}` : `${offset}단계 후: ${label}`;
    return { index, label, offset, kind, text };
  });
}
