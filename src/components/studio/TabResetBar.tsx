"use client";
// 탭 패널 헤더: 탭 이름 + 그 탭의 값만 기본으로 되돌리는 [초기화] 버튼 (기본값이면 비활성)
import type { TabId } from "@/lib/studio/state";
import { TABS } from "./TabBar";

export function TabResetBar({ tab, changed, disabled, onReset }: { tab: TabId; changed: boolean; disabled: boolean; onReset(): void }) {
  const name = TABS.find((t) => t.id === tab)?.label ?? "";
  return (
    <div className="sticky top-0 z-10 -mx-4 -mt-2 mb-1 flex h-11 items-center justify-between bg-[var(--panel)] px-4">
      <span className="text-[13px] font-semibold text-[var(--text)]">{name}</span>
      <button
        type="button" aria-label={`${name} 탭 초기화`} disabled={disabled || !changed}
        className="flex h-11 items-center px-2 text-[13px] disabled:opacity-40" style={{ color: changed && !disabled ? "var(--accent)" : "var(--text-2)", touchAction: "manipulation" }}
        onClick={onReset}
      >
        초기화
      </button>
    </div>
  );
}
