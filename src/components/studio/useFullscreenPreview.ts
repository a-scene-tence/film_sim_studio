"use client";
// 전체화면 프리뷰 훅: 네이티브 Fullscreen API(가능할 때) + position:fixed 오버레이 + 뒤로 가기/Esc 종료
import { useCallback, useEffect, useReducer, useRef, type RefObject } from "react";
import { enterNativeFullscreen, exitNativeFullscreen, fsReducer, hasFsHistoryEntry, isNativeFullscreen, pushFsHistory } from "@/lib/studio/fullscreen";

export function useFullscreenPreview(boxRef: RefObject<HTMLElement | null>) {
  const [{ active }, dispatch] = useReducer(fsReducer, { active: false });
  const native = useRef(false);
  const activeRef = useRef(false);
  useEffect(() => { activeRef.current = active; }, [active]);

  const open = useCallback(() => {
    if (activeRef.current) return;
    pushFsHistory(window.history);
    activeRef.current = true;
    dispatch({ type: "open" });
    void enterNativeFullscreen(boxRef.current).then((ok) => { native.current = ok; if (ok && !activeRef.current) void exitNativeFullscreen(document); });
  }, [boxRef]);

  const close = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    dispatch({ type: "close" });
    native.current = false;
    void exitNativeFullscreen(document);
    if (hasFsHistoryEntry(window.history)) window.history.back();
  }, []);

  useEffect(() => {
    if (!active) return;
    const onPop = () => {
      dispatch({ type: "popstate", hasEntry: hasFsHistoryEntry(window.history) });
      if (!hasFsHistoryEntry(window.history)) { native.current = false; void exitNativeFullscreen(document); }
    };
    const onFsChange = () => {
      if (native.current && !isNativeFullscreen(document)) { native.current = false; close(); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("popstate", onPop);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      window.removeEventListener("keydown", onKey);
    };
  }, [active, close]);

  return { active, open, close };
}
