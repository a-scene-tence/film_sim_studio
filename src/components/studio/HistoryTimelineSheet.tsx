"use client";
// 히스토리 타임라인: 항목을 탭하면 그 시점의 상태로 즉시 점프한다 (최신이 위).
import { useEffect, useRef } from "react";
import type { TimelineEntry } from "@/lib/studio/history";
import { BottomSheet } from "./BottomSheet";

export interface HistoryTimelineSheetProps {
  open: boolean;
  entries: ReadonlyArray<TimelineEntry>;
  onJump(index: number): void;
  onClose(): void;
}

export function HistoryTimelineSheet({ open, entries, onJump, onClose }: HistoryTimelineSheetProps) {
  const cur = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) cur.current?.scrollIntoView({ block: "center" }); }, [open]);
  const rows = [...entries].reverse();
  return (
    <BottomSheet open={open} onClose={onClose} title="변경 내역" maxHeight="70dvh">
      <ul className="flex flex-col overflow-y-auto px-3 pb-3" role="listbox" aria-label="변경 내역">
        {rows.map((e) => (
          <li key={e.index}>
            <button
              ref={e.kind === "current" ? cur : undefined} type="button" role="option" aria-selected={e.kind === "current"}
              className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[14px]"
              style={e.kind === "current" ? { background: "var(--panel-2)", color: "var(--accent)" } : e.kind === "future" ? { opacity: 0.6 } : undefined}
              onClick={() => (e.kind === "current" ? onClose() : onJump(e.index))}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: e.kind === "current" ? "var(--accent)" : "var(--line)" }} />
              <span className="min-w-0 flex-1 truncate">{e.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
