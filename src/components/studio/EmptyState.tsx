"use client";
import { DisclaimerFootnote } from "./AboutSheet";
import { AppMark } from "./icons";

/** Step 4 §7-4 빈 상태 카드 */
export function EmptyState({ onOpen, onAbout, busy }: { onOpen(): void; onAbout(): void; busy: boolean }) {
  return (
    <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 px-6 text-center">
      <AppMark size={64} />
      <h1 className="text-[20px] font-bold text-[var(--text)]">Film Lab</h1>
      <p className="text-[13px] text-[var(--text-2)]">FUJIFILM 20종 · RICOH GR 12종 필름 시뮬레이션</p>
      <button type="button" disabled={busy} className="h-12 w-[240px] rounded-[12px] bg-[var(--accent)] text-[15px] font-semibold text-[#0b0b0c] disabled:opacity-50" onClick={onOpen}>사진·영상 열기</button>
      <p className="max-w-[300px] text-[12px] text-[var(--text-2)]">RAW · JPG · PNG · HEIC · MP4 · MOV 파일을 불러올 수 있습니다. 모든 처리는 이 기기 안에서만 이루어집니다. 사진과 영상은 업로드되지 않습니다.</p>
      <div className="max-w-[300px]"><DisclaimerFootnote onOpen={onAbout} /></div>
    </div>
  );
}
