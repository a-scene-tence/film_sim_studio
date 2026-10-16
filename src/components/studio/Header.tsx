"use client";
import { useRef } from "react";
import { IconInfo, IconOpen } from "./icons";

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
      <div className="flex-1" />
      <button type="button" aria-label="EXIF 정보" disabled={!p.hasMedia} className="flex h-11 w-11 items-center justify-center text-[var(--text)] disabled:opacity-40" onClick={p.onExif}><IconInfo /></button>
      <button type="button" disabled={!p.hasMedia || p.busy} className="flex h-11 shrink-0 items-center disabled:opacity-40" onClick={p.onSave}>
        <span className="flex h-9 items-center whitespace-nowrap rounded-[18px] bg-[var(--accent)] px-4 text-[14px] font-semibold text-[#0b0b0c]">저장하기</span>
      </button>
    </header>
  );
}
