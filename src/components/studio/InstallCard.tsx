"use client";
import { useState, useSyncExternalStore } from "react";
import { IOS_MANUAL_INSTALL_TEXT, isIos, isStandalone, OTHER_MANUAL_INSTALL_TEXT, resetAppCaches, type BeforeInstallPromptEvent } from "@/lib/pwa/install-hints";

/** 일반 브라우저 탭에서만 보이는 전체화면 앱 설치 안내 카드 */
export function InstallCard({ getPrompt }: { getPrompt(): BeforeInstallPromptEvent | null }) {
  const show = useSyncExternalStore(() => () => {}, () => !isStandalone(), () => false);
  const [manual, setManual] = useState<string | null>(null);
  if (!show) return null;
  const install = () => {
    const p = getPrompt();
    if (p) { void p.prompt(); return; }
    setManual(isIos(navigator) ? IOS_MANUAL_INSTALL_TEXT : OTHER_MANUAL_INSTALL_TEXT);
  };
  return (
    <div className="flex w-full max-w-[300px] flex-col items-center gap-2 rounded-[12px] border border-[var(--line)] p-3">
      <button type="button" className="min-h-11 w-full rounded-[10px] border border-[var(--accent)] text-[14px] font-semibold text-[var(--accent)]" onClick={install}>📲 앱으로 설치하기 (전체화면)</button>
      {manual ? (
        <>
          <p className="text-[12px] text-[var(--text-2)]">{manual}</p>
          <button type="button" className="min-h-11 w-full rounded-[10px] text-[12px] text-[var(--text-2)] underline" onClick={() => { void resetAppCaches(); }}>🔄 전체화면이 안 뜰 때: 구버전 캐시 초기화</button>
        </>
      ) : null}
    </div>
  );
}
