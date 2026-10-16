// 편집 히스토리: 트랜잭션(commit) 단위 Undo/Redo 스택 (최대 50단계). 순수 리듀서라 UI 와 무관하게 테스트한다.
import { editReducer, getValue, SLIDERS, type EditAction, type EditState } from "./state";

export const HISTORY_LIMIT = 50;

/** 히스토리가 되돌리는 단위: 편집 상태 + 입력 색공간 선택(InputChoice 문자열) */
export interface Snap { edit: EditState; choice: string }
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
  | { type: "do"; action: SnapAction }
  | { type: "begin" }
  | { type: "commit" }
  | { type: "undo" }
  | { type: "redo" }
  /** 새 미디어: 스택을 비우고 기준 상태를 바꾼다 */
  | { type: "reset"; snap: Snap };

export function initialHistory(snap: Snap): HistoryState {
  return { present: snap, past: [], future: [], pending: null };
}

export function snapsEqual(a: Snap, b: Snap): boolean {
  return a === b || (a.choice === b.choice && JSON.stringify(a.edit) === JSON.stringify(b.edit));
}

function applySnap(s: Snap, a: SnapAction): Snap {
  if (a.type === "choice") return a.choice === s.choice ? s : { ...s, choice: a.choice };
  const edit = editReducer(s.edit, a);
  return edit === s.edit ? s : { ...s, edit };
}

const pushPast = (past: Snap[], s: Snap): Snap[] => [...past, s].slice(-HISTORY_LIMIT);

export function historyReducer(h: HistoryState, a: HistoryAction): HistoryState {
  switch (a.type) {
    case "live": {
      const present = applySnap(h.present, a.action);
      return present === h.present ? h : { ...h, present };
    }
    case "do": {
      const present = applySnap(h.present, a.action);
      if (snapsEqual(present, h.present)) return h;
      // 드래그 중 단발 조작이 끼어들면 드래그 기준 상태를 기록해 한 단계로 묶는다
      const base = h.pending && !snapsEqual(h.pending, h.present) ? h.pending : h.present;
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
    case "reset": return initialHistory(a.snap);
  }
}

/** 두 스냅샷 사이에서 바뀐 항목의 한국어 라벨 ("노출", "필름 변경", "노출 외 2개") */
export function diffLabel(from: Snap, to: Snap): string {
  if (from.edit.simId !== to.edit.simId) return "필름 변경";
  const names: string[] = [];
  if (from.choice !== to.choice) names.push("입력 색공간");
  for (const sp of SLIDERS) if (getValue(from.edit, sp.key) !== getValue(to.edit, sp.key)) names.push(sp.label);
  if (from.edit.hdf !== to.edit.hdf) names.push("HDF");
  if (JSON.stringify(from.edit.curve.points) !== JSON.stringify(to.edit.curve.points)) names.push("톤 커브");
  if (names.length === 0) return "변경";
  return names.length === 1 ? names[0]! : `${names[0]} 외 ${names.length - 1}개`;
}

/** 다음 Undo 가 되돌릴 항목 라벨 (없으면 null) */
export const undoLabel = (h: HistoryState): string | null => (h.past.length > 0 ? diffLabel(h.past[h.past.length - 1]!, h.present) : null);
/** 다음 Redo 가 다시 적용할 항목 라벨 (없으면 null) */
export const redoLabel = (h: HistoryState): string | null => (h.future.length > 0 ? diffLabel(h.present, h.future[0]!) : null);
