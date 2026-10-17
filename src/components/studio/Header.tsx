"use client";
import { useRef } from "react";
import type { OutputSpace } from "@/lib/render/output-space";
import { IconHistory, IconInfo, IconOpen, IconRedo, IconResetAll, IconUndo } from "./icons";

export const ACCEPT_FALLBACK = "image/*,video/*,.dng,.arw,.cr2,.cr3,.nef,.raf,.orf,.rw2,.pef,.srw,.heic,.heif,.mov,.mp4,.webm";

export interface HeaderProps {
  onFile(f: File): void;
  accept: string;
  badge: string | null;
  badgeDisabled: boolean;
  approximate: boolean;
  onBadge(): void;
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
  /** 전체 초기화: 현재 편집 상태가 초기 상태와 다를 때만 활성 */
  resetAllEnabled?: boolean;
  onResetAll?(): void;
  /** 기록된 전체 단계 수 (뱃지, 초기 상태 제외) */
  historyCount?: number;
}

/** 캡슐 그룹 안 버튼 공통: 높이 44px(터치 타깃), 폭은 좁은 화면(320px)에서도 한 줄에 들어오도록 40px */
const CAPSULE_BTN = "relative flex h-11 shrink-0 select-none items-center justify-center transition-opacity disabled:opacity-30";

/**
 * 헤더 2단 구조 (Lightroom Mobile 스타일)
 * 1열 메인 액션 바: [열기] | 캡슐(↩ ↪ 🕘 ↺초기화) | [저장]  — 좌우 12px, 폭 100%, 저장은 shrink-0 로 고정
 * 2열 슬림 정보 바: [EXIF] [입력 색공간 배지] [P3/sRGB] — 넘치면 가로 스크롤 없이 배지만 줄어듦(truncate)
 */
export function Header(p: HeaderProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <header className="flex w-full shrink-0 flex-col bg-[var(--bg)]" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex h-12 w-full items-center justify-between gap-1 overflow-hidden px-3">
        <button type="button" disabled={p.busy} className="flex h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-[10px] pr-1 text-[14px] text-[var(--text)] disabled:opacity-50" onClick={() => input.current?.click()}>
          <IconOpen size={20} />
          열기
        </button>
        <input ref={input} type="file" accept={p.accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onFile(f); e.target.value = ""; }} />
        <div className="flex min-w-0 items-center rounded-lg border border-zinc-800 bg-zinc-900/80">
          <button
            type="button" aria-label={p.undoLabel ? `되돌리기: ${p.undoLabel}` : "되돌리기"} title="되돌리기 (Ctrl/⌘+Z)" disabled={!p.undoLabel || p.busy}
            className={`${CAPSULE_BTN} w-10 text-[var(--accent)] disabled:text-[var(--text)]`}
            style={{ touchAction: "manipulation" }}
            onClick={p.onUndo}
          >
            <IconUndo />
            {p.undoLabel && (p.undoDepth ?? 0) > 0 ? (
              <span className="absolute right-0 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold leading-none text-[#0b0b0c]">{p.undoDepth}</span>
            ) : null}
          </button>
          <button
            type="button" aria-label={p.redoLabel ? `다시 실행: ${p.redoLabel}` : "다시 실행"} title="다시 실행 (Ctrl/⌘+Shift+Z)" disabled={!p.redoLabel || p.busy}
            className={`${CAPSULE_BTN} w-10 text-[var(--accent)] disabled:text-[var(--text)]`} onClick={p.onRedo}
          >
            <IconRedo />
          </button>
          <button
            type="button" aria-label={`단계 기록 보기 (${p.historyCount ?? 0}단계)`} title="단계 기록" disabled={!p.hasMedia || p.busy}
            className={`${CAPSULE_BTN} w-10 text-[var(--text)]`}
            style={{ touchAction: "manipulation" }} onClick={p.onTimeline}
          >
            <IconHistory />
            {(p.historyCount ?? 0) > 0 ? (
              <span className="absolute right-0 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--panel-2)] px-1 text-[10px] font-bold leading-none text-[var(--text)]">{p.historyCount}</span>
            ) : null}
          </button>
          <button
            type="button" aria-label="전체 초기화" title="전체 초기화" disabled={!p.hasMedia || p.busy || !p.resetAllEnabled}
            className={`${CAPSULE_BTN} gap-0.5 whitespace-nowrap border-l border-zinc-800 px-2 text-[12px] text-[var(--text)]`}
            style={{ touchAction: "manipulation" }} onClick={p.onResetAll}
          >
            <IconResetAll size={18} />
            <span className="max-[339px]:hidden">초기화</span>
          </button>
        </div>
        <button type="button" aria-label="저장하기" disabled={!p.hasMedia || p.busy} className="flex h-11 shrink-0 items-center disabled:opacity-40" onClick={p.onSave}>
          <span className="flex h-9 shrink-0 items-center whitespace-nowrap rounded-[18px] bg-[var(--accent)] px-3.5 text-[14px] font-semibold text-[#0b0b0c]">저장</span>
        </button>
      </div>
      <div className="flex h-11 w-full items-center gap-2 overflow-hidden px-3">
        <button type="button" aria-label="EXIF 정보" disabled={!p.hasMedia} className="flex h-11 shrink-0 items-center gap-1 whitespace-nowrap text-[12px] text-[var(--text)] disabled:opacity-40" onClick={p.onExif}>
          <IconInfo size={18} />
          촬영정보
        </button>
        {p.badge ? (
          <button type="button" aria-label="입력 색공간" disabled={p.badgeDisabled} className="flex h-11 min-w-0 items-center disabled:opacity-60" onClick={p.onBadge}>
            <span className="flex h-7 max-w-[55vw] items-center truncate whitespace-nowrap rounded-full border border-[var(--line)] bg-[var(--panel-2)] px-3 text-[12px] text-[var(--text)]">
              <span className="truncate">{p.badge}</span>
            </span>
          </button>
        ) : null}
        {p.p3Available ? (
          <button
            type="button" aria-label={`색공간 출력: ${p.outSpace === "display-p3" ? "Display P3" : "sRGB"} (탭하여 전환)`} aria-pressed={p.outSpace === "display-p3"}
            className="flex h-11 shrink-0 items-center" onClick={() => p.onOutSpace?.(p.outSpace === "display-p3" ? "srgb" : "display-p3")}
          >
            <span className="flex h-7 items-center whitespace-nowrap rounded-full border border-[var(--line)] bg-[var(--panel-2)] px-3 text-[12px]" style={p.outSpace === "display-p3" ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}>
              {p.outSpace === "display-p3" ? "P3" : "sRGB"}
            </span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
