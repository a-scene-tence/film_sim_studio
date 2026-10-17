// 결과물 전체화면 프리뷰: Fullscreen API(접두사 포함) + 히스토리 엔트리 헬퍼. DOM 전역에 의존하지 않도록 객체를 주입받는다.

export const FS_HISTORY_KEY = "fsPreview";

interface FsElement {
  requestFullscreen?: (opts?: { navigationUI?: "hide" | "show" | "auto" }) => Promise<void> | void;
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface FsDocument {
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void> | void;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface HistoryLike { state: unknown; pushState(data: unknown, unused: string): void }

/** 실제 Fullscreen API 지원 여부 (미지원이면 CSS 오버레이만 사용) */
export function canNativeFullscreen(el: FsElement | null | undefined): boolean {
  return !!el && (typeof el.requestFullscreen === "function" || typeof el.webkitRequestFullscreen === "function");
}

/** 네이티브 전체화면 진입. 성공 true, 미지원·거부·예외는 false (오버레이로 계속 동작) */
export async function enterNativeFullscreen(el: FsElement | null | undefined): Promise<boolean> {
  if (!el) return false;
  try {
    if (typeof el.requestFullscreen === "function") await el.requestFullscreen({ navigationUI: "hide" });
    else if (typeof el.webkitRequestFullscreen === "function") await el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}

export function isNativeFullscreen(doc: FsDocument): boolean {
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/** 네이티브 전체화면 중일 때만 해제 */
export async function exitNativeFullscreen(doc: FsDocument): Promise<void> {
  if (!isNativeFullscreen(doc)) return;
  try {
    if (typeof doc.exitFullscreen === "function") await doc.exitFullscreen();
    else if (typeof doc.webkitExitFullscreen === "function") await doc.webkitExitFullscreen();
  } catch { /* 이미 해제됨 */ }
}

export function hasFsHistoryEntry(h: Pick<HistoryLike, "state">): boolean {
  const s = h.state as Record<string, unknown> | null;
  return !!s && typeof s === "object" && s[FS_HISTORY_KEY] === true;
}

/** 뒤로 가기로 닫을 수 있도록 히스토리 엔트리를 하나 쌓는다 (기존 state 보존: Next.js 내부 키 유지). 중복 push 방지 */
export function pushFsHistory(h: HistoryLike): boolean {
  if (hasFsHistoryEntry(h)) return false;
  const base = h.state && typeof h.state === "object" ? (h.state as Record<string, unknown>) : {};
  h.pushState({ ...base, [FS_HISTORY_KEY]: true }, "");
  return true;
}

export interface FsState { active: boolean }

export type FsEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "popstate"; hasEntry: boolean }
  | { type: "nativeExit" }
  | { type: "key"; key: string };

/** 전체화면 상태 전이 (순수) */
export function fsReducer(s: FsState, e: FsEvent): FsState {
  switch (e.type) {
    case "open": return { active: true };
    case "close": return { active: false };
    case "popstate": return s.active && !e.hasEntry ? { active: false } : s;
    case "nativeExit": return { active: false };
    case "key": return e.key === "Escape" ? { active: false } : s;
  }
}
