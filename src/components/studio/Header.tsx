"use client";
import { useRef } from "react";
import type { OutputSpace } from "@/lib/render/output-space";
import { IconHistory, IconInfo, IconOpen, IconRedo, IconUndo } from "./icons";

export const ACCEPT_FALLBACK = "image/*,video/*,.dng,.arw,.cr2,.cr3,.nef,.raf,.orf,.rw2,.pef,.srw,.heic,.heif,.mov,.mp4,.webm";

export interface HeaderProps {
  onFile(f: File): void;
  accept: string;
  badge: string | null;
  badgeDisabled: boolean;
  approximate: boolean;
  onBadge(): void;
  demo: boolean;
  onExif(): void;
  onSave(): void;
  hasMedia: boolean;
  busy: boolean;
  /** Step 5: Display P3 출력을 쓸 수 있을 때만 전환 버튼을 보인다 */
  p3Available?: boolean;
  outSpace?: OutputSpace;
  onOutSpace?(s: OutputSpace): void;
  /** 히스토리: 되돌릴/다시 실행할 항목 라벨(없으면 null → 비활성) */
  undoLabel?: string | null;
  redoLabel?: string | null;
  /** 되돌릴 수 있는 단계 수 (뱃지) */
  undoDepth?: number;
  onUndo?(): void;
  onRedo?(): void;
  /** 단계 기록 버튼(한 번 탭): 히스토리 타임라인 열기 */
  onTimeline?(): void;
  /** 기록된 전체 단계 수 (뱃지, 초기 상태 제외) */
  historyCount?: number;
}

/** Step 4 §7-3 ① 헤더: 높이 52px + safe-area 위쪽, 좌우 12px */
export function Header(p: HeaderProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <header className="flex shrink-0 items-center gap-2 bg-[var(--bg)] px-3" style={{ height: "calc(52px + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)" }}>
      <button type="button" disabled={p.busy} className="flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-2 text-[14px] text-[var(--text)] disabled:opacity-50" onClick={() => input.current?.click()}>
        <IconOpen size={20} />
        열기
      </button>
      <input ref={input} type="file" accept={p.accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onFile(f); e.target.value = ""; }} />
      {p.badge ? (
        <button type="button" aria-label="입력 색공간" disabled={p.badgeDisabled} className="flex h-11 min-w-0 items-center disabled:opacity-60" onClick={p.onBadge}>
          <span className="flex h-8 max-w-[40vw] items-center truncate whitespace-nowrap rounded-full border border-[var(--line)] bg-[var(--panel-2)] px-3 text-[12px] text-[var(--text)]">
            <span className="truncate">{p.badge}</span>
          </span>
        </button>
      ) : null}
      {p.demo ? <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--panel-2)] px-2 py-0.5 text-[11px] text-[var(--accent)]">데모</span> : null}
      {p.p3Available ? (
        <button
          type="button" aria-label={`색공간 출력: ${p.outSpace === "display-p3" ? "Display P3" : "sRGB"} (탭하여 전환)`} aria-pressed={p.outSpace === "display-p3"}
          className="flex h-11 shrink-0 items-center" onClick={() => p.onOutSpace?.(p.outSpace === "display-p3" ? "srgb" : "display-p3")}
        >
          <span className="flex h-8 items-center whitespace-nowrap rounded-full border border-[var(--line)] bg-[var(--panel-2)] px-3 text-[12px]" style={p.outSpace === "display-p3" ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}>
            {p.outSpace === "display-p3" ? "P3" : "sRGB"}
          </span>
        </button>
      ) : null}
      <div className="flex-1" />
      <button
        type="button" aria-label={p.undoLabel ? `되돌리기: ${p.undoLabel}` : "되돌리기"} title="되돌리기 (Ctrl/⌘+Z)" disabled={!p.undoLabel || p.busy}
        className="relative flex h-11 w-11 shrink-0 select-none items-center justify-center text-[var(--accent)] transition-opacity disabled:text-[var(--text)] disabled:opacity-30"
        style={{ touchAction: "manipulation" }}
        onClick={p.onUndo}
      >
        <IconUndo />
        {p.undoLabel && (p.undoDepth ?? 0) > 0 ? (
          <span className="absolute right-0.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold leading-none text-[#0b0b0c]">{p.undoDepth}</span>
        ) : null}
      </button>
      <button
        type="button" aria-label={p.redoLabel ? `다시 실행: ${p.redoLabel}` : "다시 실행"} title="다시 실행 (Ctrl/⌘+Shift+Z)" disabled={!p.redoLabel || p.busy}
        className="flex h-11 w-11 shrink-0 items-center justify-center text-[var(--accent)] transition-opacity disabled:text-[var(--text)] disabled:opacity-30" onClick={p.onRedo}
      >
        <IconRedo />
      </button>
      <button
        type="button" aria-label={`단계 기록 보기 (${p.historyCount ?? 0}단계)`} title="단계 기록" disabled={!p.hasMedia || p.busy}
        className="relative flex h-11 w-11 shrink-0 items-center justify-center text-[var(--text)] transition-opacity disabled:opacity-30"
        style={{ touchAction: "manipulation" }} onClick={p.onTimeline}
      >
        <IconHistory />
        {(p.historyCount ?? 0) > 0 ? (
          <span className="absolute right-0.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--panel-2)] px-1 text-[10px] font-bold leading-none text-[var(--text)]">{p.historyCount}</span>
        ) : null}
      </button>
      <button type="button" aria-label="EXIF 정보" disabled={!p.hasMedia} className="flex h-11 w-11 items-center justify-center text-[var(--text)] disabled:opacity-40" onClick={p.onExif}><IconInfo /></button>
      <button type="button" disabled={!p.hasMedia || p.busy} className="flex h-11 shrink-0 items-center disabled:opacity-40" onClick={p.onSave}>
        <span className="flex h-9 items-center whitespace-nowrap rounded-[18px] bg-[var(--accent)] px-4 text-[14px] font-semibold text-[#0b0b0c]">저장하기</span>
      </button>
    </header>
  );
}
