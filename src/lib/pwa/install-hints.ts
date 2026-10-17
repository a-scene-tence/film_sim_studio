// Step 4 §14-5 설치 안내 (각각 1회, localStorage 키). 모든 localStorage 접근은 try/catch.
export const IOS_HINT_KEY = "filmlab.iosHintShown";
export const INSTALL_HINT_KEY = "filmlab.installHintShown";
export const OFFLINE_READY_KEY = "filmlab.offlineReady";

export interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void> }

export function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* 저장소 접근 불가 */ }
}

export function isIos(nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">): boolean {
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

export const IOS_HINT_TEXT = "홈 화면에 추가하면 전체 화면 · 오프라인으로 사용할 수 있어요: 공유 버튼 → 홈 화면에 추가";
export const INSTALL_HINT_TEXT = "앱으로 설치하면 오프라인에서도 사용할 수 있어요";
export const OFFLINE_READY_TEXT = "오프라인 사용 준비 완료: 32종 필름과 코덱이 이 기기에 저장되었습니다";

/** 첫 미디어 로드 후 보여 줄 설치 안내. 이미 보여 준 안내는 null (호출 시 표시한 것으로 기록한다) */
export function nextInstallHint(deferred: BeforeInstallPromptEvent | null): { text: string; action?: { label: string; run(): void } } | null {
  if (isIos(navigator) && !isStandalone() && lsGet(IOS_HINT_KEY) === null) {
    lsSet(IOS_HINT_KEY, "1");
    return { text: IOS_HINT_TEXT };
  }
  if (deferred && lsGet(INSTALL_HINT_KEY) === null) {
    lsSet(INSTALL_HINT_KEY, "1");
    return { text: INSTALL_HINT_TEXT, action: { label: "설치", run: () => { void deferred.prompt(); } } };
  }
  return null;
}
