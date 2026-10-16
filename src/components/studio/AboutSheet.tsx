"use client";
// 정보 · 고지 시트: 앱 소개와 비공식 면책(상표) 고지
import { BottomSheet } from "./BottomSheet";

export const TRADEMARK_DISCLAIMER =
  "본 웹 애플리케이션은 독립 개발 프로젝트이며 Fujifilm Corporation 및 Ricoh Company, Ltd.와 제휴, 보증 또는 후원 관계가 없습니다. 앱 내에 표기된 카메라 및 필름 시뮬레이션 명칭은 각 소유자의 상표이며, 독자적인 수학적 컬러 모델링의 색감 스타일을 식별·설명하기 위한 참조 목적으로만 사용되었습니다.";

export function AboutSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="정보 · 고지" maxHeight="70dvh">
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-[var(--text)]">
        <p>Film Lab 은 사진과 영상을 이 기기 안에서만 처리합니다. 파일은 서버로 업로드되지 않습니다.</p>
        <section aria-label="상표권 면책 고지">
          <h3 className="mb-1 text-[13px] font-semibold">상표권 면책 고지</h3>
          <p className="text-[var(--text-2)]">{TRADEMARK_DISCLAIMER}</p>
        </section>
      </div>
    </BottomSheet>
  );
}

/** 하단 한 줄 고지 + 정보 시트 열기 링크 (빈 상태 화면·필름 탭 하단) */
export function DisclaimerFootnote({ onOpen }: { onOpen(): void }) {
  return (
    <p className="text-center text-[11px] leading-snug text-[var(--text-2)]">
      비공식 독립 프로젝트 · Fujifilm, Ricoh 와 무관합니다.{" "}
      <button type="button" className="inline-flex min-h-11 items-center px-1 text-[var(--accent)] underline" onClick={onOpen}>자세히</button>
    </p>
  );
}
