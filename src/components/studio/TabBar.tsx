"use client";
import type { ReactNode } from "react";
import type { TabId } from "@/lib/studio/state";
import { IconColor, IconCurve, IconDetail, IconFilm, IconLight } from "./icons";

export const TABS: ReadonlyArray<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: "film", label: "필름", icon: <IconFilm /> },
  { id: "light", label: "라이트", icon: <IconLight /> },
  { id: "color", label: "컬러", icon: <IconColor /> },
  { id: "curve", label: "커브", icon: <IconCurve /> },
  { id: "detail", label: "디테일·효과", icon: <IconDetail /> },
];

/** 높이 56px + safe-area-inset-bottom, 탭 5개 같은 폭, 아이콘 22px + 라벨 11px */
export function TabBar({ active, onChange, disabled }: { active: TabId; onChange(t: TabId): void; disabled: boolean }) {
  return (
    <nav
      role="tablist" aria-label="편집 탭"
      className={`flex shrink-0 border-t border-[var(--line)] bg-[var(--panel)] ${disabled ? "opacity-40" : ""}`}
      style={{ height: "calc(56px + env(safe-area-inset-bottom))", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map((t) => (
        <button
          key={t.id} type="button" role="tab" aria-selected={active === t.id} disabled={disabled}
          className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5"
          style={{ color: active === t.id ? "var(--accent)" : "var(--text-2)" }} onClick={() => onChange(t.id)}
        >
          {t.icon}
          <span className="text-[11px] leading-none">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
