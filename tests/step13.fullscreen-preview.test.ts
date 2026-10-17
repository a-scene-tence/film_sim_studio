import { describe, expect, it, vi } from "vitest";
import { canNativeFullscreen, enterNativeFullscreen, exitNativeFullscreen, FS_HISTORY_KEY, fsReducer, hasFsHistoryEntry, isNativeFullscreen, pushFsHistory } from "../src/lib/studio/fullscreen";

describe("전체화면 프리뷰 상태 전이", () => {
  const off = { active: false };
  const on = { active: true };
  it("열기/닫기", () => {
    expect(fsReducer(off, { type: "open" })).toEqual(on);
    expect(fsReducer(on, { type: "close" })).toEqual(off);
  });
  it("뒤로 가기: 엔트리가 사라지면 닫고, 남아 있으면 유지", () => {
    expect(fsReducer(on, { type: "popstate", hasEntry: false })).toEqual(off);
    expect(fsReducer(on, { type: "popstate", hasEntry: true })).toEqual(on);
    expect(fsReducer(off, { type: "popstate", hasEntry: false })).toEqual(off);
  });
  it("Esc·네이티브 해제로 닫힘, 다른 키는 무시", () => {
    expect(fsReducer(on, { type: "key", key: "Escape" })).toEqual(off);
    expect(fsReducer(on, { type: "key", key: "a" })).toEqual(on);
    expect(fsReducer(on, { type: "nativeExit" })).toEqual(off);
  });
});

describe("Fullscreen API 이중 방어", () => {
  it("미지원 요소 → false, 오버레이만 사용", async () => {
    expect(canNativeFullscreen({})).toBe(false);
    expect(canNativeFullscreen(null)).toBe(false);
    expect(await enterNativeFullscreen({})).toBe(false);
    expect(await enterNativeFullscreen(null)).toBe(false);
  });
  it("표준 API 호출 및 webkit 접두사 폴백", async () => {
    const std = vi.fn().mockResolvedValue(undefined);
    expect(await enterNativeFullscreen({ requestFullscreen: std })).toBe(true);
    expect(std).toHaveBeenCalledWith({ navigationUI: "hide" });
    const wk = vi.fn();
    expect(canNativeFullscreen({ webkitRequestFullscreen: wk })).toBe(true);
    expect(await enterNativeFullscreen({ webkitRequestFullscreen: wk })).toBe(true);
    expect(wk).toHaveBeenCalled();
  });
  it("요청이 거부되어도 예외 없이 false", async () => {
    expect(await enterNativeFullscreen({ requestFullscreen: () => Promise.reject(new Error("denied")) })).toBe(false);
  });
  it("해제는 전체화면 중일 때만 호출", async () => {
    const exit = vi.fn();
    await exitNativeFullscreen({ exitFullscreen: exit });
    expect(exit).not.toHaveBeenCalled();
    expect(isNativeFullscreen({ webkitFullscreenElement: {} })).toBe(true);
    await exitNativeFullscreen({ fullscreenElement: {}, exitFullscreen: exit });
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe("히스토리 엔트리 (뒤로 가기 종료)", () => {
  it("기존 state 를 보존하며 한 번만 push", () => {
    const h = { state: { __NA: true } as unknown, pushState: vi.fn((d: unknown) => { h.state = d; }) };
    expect(hasFsHistoryEntry(h)).toBe(false);
    expect(pushFsHistory(h)).toBe(true);
    expect(h.state).toEqual({ __NA: true, [FS_HISTORY_KEY]: true });
    expect(pushFsHistory(h)).toBe(false);
    expect(h.pushState).toHaveBeenCalledTimes(1);
    expect(hasFsHistoryEntry({ state: null })).toBe(false);
  });
});
