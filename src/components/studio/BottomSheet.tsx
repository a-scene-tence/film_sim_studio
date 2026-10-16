"use client";
// Step 4 §7-7 바텀시트: 배경 var(--panel), 위 모서리 16px, 핸들 36×4px, 바깥 탭 또는 아래로 80px 이상 스와이프로 닫기.
import { useRef, useState, type ReactNode } from "react";
import { IconClose } from "./icons";

export interface BottomSheetProps {
  open: boolean;
  onClose(): void;
  title?: ReactNode;
  children: ReactNode;
  /** 전체 화면 시트 (EXIF 인스펙터) */
  full?: boolean;
  /** 최대 높이 (기본 90dvh) */
  maxHeight?: string;
  /** 바깥 탭·스와이프로 닫지 못하게 (저장 진행 중 등) */
  locked?: boolean;
  headerExtra?: ReactNode;
}

export function BottomSheet({ open, onClose, title, children, full, maxHeight = "90dvh", locked, headerExtra }: BottomSheetProps) {
  const start = useRef<number | null>(null);
  const [dy, setDy] = useState(0);
  if (!open) return null;
  const close = () => { if (!locked) onClose(); };
  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/50" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div
        role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}
        className="studio-sheet flex w-full flex-col rounded-t-[16px] bg-[var(--panel)] text-[var(--text)]"
        style={{ height: full ? "100%" : undefined, maxHeight: full ? "100%" : maxHeight, transform: dy > 0 ? `translateY(${dy}px)` : undefined, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div
          className="flex shrink-0 flex-col items-center"
          style={{ touchAction: "none" }}
          onPointerDown={(e) => { start.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (start.current !== null) setDy(Math.max(0, e.clientY - start.current)); }}
          onPointerUp={() => { const d = dy; start.current = null; setDy(0); if (d >= 80) close(); }}
          onPointerCancel={() => { start.current = null; setDy(0); }}
        >
          <div className="mt-2 h-1 w-9 rounded-full bg-[var(--line)]" />
          {title !== undefined ? (
            <div className="flex w-full items-center justify-between px-4 pb-1 pt-1">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">{title}</h2>
              <div className="flex items-center gap-1">
                {headerExtra}
                {locked ? null : <button type="button" aria-label="닫기" className="flex h-11 w-11 items-center justify-center text-[var(--text-2)]" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}><IconClose /></button>}
              </div>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4" style={{ touchAction: "pan-y" }}>{children}</div>
      </div>
    </div>
  );
}
