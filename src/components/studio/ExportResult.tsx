"use client";
// Step 4 §12 완료 카드: 썸네일(사진)/아이콘(동영상), 파일명, 실제 크기, 해상도, 경고, [사진첩에 저장 · 공유], [파일 다운로드]
import { useEffect, useState } from "react";
import { fmtActualBytes } from "@/lib/export/estimate";
import { canShareFile, downloadBlob, IOS_SHARE_HINT, shareFile, SHARE_FAILED_MSG } from "@/lib/export/share";
import { isIos } from "@/lib/pwa/install-hints";
import { IconDownload, IconShare, IconVideo } from "./icons";

export interface ExportDone { file: File; blob: Blob; width: number; height: number; isVideo: boolean; warnings: string[] }

export function ExportResult({ done, onClose, toast }: { done: ExportDone; onClose(): void; toast(m: string): void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    if (!done.isVideo) { u = URL.createObjectURL(done.blob); queueMicrotask(() => setUrl(u)); }
    queueMicrotask(() => { setCanShare(canShareFile(done.file)); setIos(isIos(navigator)); });
    return () => { if (u) URL.revokeObjectURL(u); }; // 모달을 닫으면 objectURL 을 해제한다
  }, [done]);

  const share = async () => {
    const r = await shareFile(done.file);
    if (r === "failed") toast(SHARE_FAILED_MSG);
  };

  return (
    <div className="flex flex-col gap-3 pb-2">
      <div className="flex items-center gap-3 rounded-[12px] bg-[var(--panel-2)] p-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-black text-[var(--text-2)]">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="저장한 사진 미리보기" className="h-full w-full object-cover" />
          ) : <IconVideo size={32} />}
        </div>
        <dl className="min-w-0 text-[13px]">
          <dd className="break-all font-medium">{done.file.name}</dd>
          <dd className="tnum mt-1 text-[var(--text-2)]">{fmtActualBytes(done.file.size)} · {done.width} × {done.height}</dd>
        </dl>
      </div>
      {done.warnings.map((w) => <p key={w} className="text-[12px] text-[var(--accent)]">{w}</p>)}
      {canShare ? (
        <>
          <button type="button" className="flex h-12 items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] text-[15px] font-semibold text-[#0b0b0c]" onClick={() => void share()}>
            <IconShare size={20} />사진첩에 저장 · 공유
          </button>
          {ios ? <p className="text-[12px] text-[var(--text-2)]">{IOS_SHARE_HINT}</p> : null}
        </>
      ) : null}
      <button type="button" className="flex h-12 items-center justify-center gap-2 rounded-[12px] border border-[var(--line)] text-[15px]" onClick={() => downloadBlob(done.blob, done.file.name)}>
        <IconDownload size={20} />파일 다운로드
      </button>
      <button type="button" className="min-h-11 text-[13px] text-[var(--text-2)]" onClick={onClose}>닫기</button>
    </div>
  );
}
