"use client";
// Step 4 §7-3 입력 색공간 시트: Auto + 주요 6개 라디오, 접이식 기타, Samsung Log / D-Log M 의 공식 LUT 등록·해제
import { useEffect, useRef, useState } from "react";
import type { LogDetection, SourceProfileId } from "@/lib/media-loader";
import { findSourceLut, registerSourceLut, removeSourceLut, type OfficialProfile } from "@/lib/lut/sourceLut";
import { choiceLabel, detectedLabel, MAIN_CHOICES, MORE_CHOICES, profileNote, type InputChoice } from "@/lib/studio/input-profile";
import { BottomSheet } from "./BottomSheet";
import { IconChevron } from "./icons";

export interface ProfileSheetProps {
  open: boolean;
  onClose(): void;
  current: InputChoice;
  detection: LogDetection | null;
  onSelect(c: InputChoice): void;
  /** 공식 LUT 등록·해제 후 (렌더러 새로고침) */
  onLutChanged(): void;
  onError(msg: string): void;
}

export function ProfileSheet(p: ProfileSheetProps) {
  const [luts, setLuts] = useState<Record<OfficialProfile, string | null>>({ samsunglog: null, dlogm: null });
  const [more, setMore] = useState(false);
  const files = { samsunglog: useRef<HTMLInputElement>(null), dlogm: useRef<HTMLInputElement>(null) };

  const refresh = () => Promise.all([findSourceLut("samsunglog"), findSourceLut("dlogm")]).then(([a, b]) => setLuts({ samsunglog: a?.name ?? null, dlogm: b?.name ?? null }));
  useEffect(() => {
    if (!p.open) return;
    let alive = true;
    void Promise.all([findSourceLut("samsunglog"), findSourceLut("dlogm")]).then(([a, b]) => { if (alive) setLuts({ samsunglog: a?.name ?? null, dlogm: b?.name ?? null }); });
    return () => { alive = false; };
  }, [p.open]);

  const row = (id: InputChoice, label: string, sub?: string | null) => {
    const official = id === "samsunglog" || id === "dlogm" ? (id as OfficialProfile) : null;
    return (
      <div key={id} className="border-b border-[var(--line)] py-1">
        <button type="button" role="radio" aria-checked={p.current === id} className="flex min-h-11 w-full items-center gap-3 text-left" onClick={() => p.onSelect(id)}>
          <span className="flex h-5 w-5 items-center justify-center rounded-full border-2" style={{ borderColor: p.current === id ? "var(--accent)" : "var(--text-2)" }}>
            {p.current === id ? <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" /> : null}
          </span>
          <span className="text-[15px]">{label}</span>
        </button>
        {official ? (
          <div className="pb-2 pl-8">
            <p className="text-[12px] text-[var(--text-2)]">{profileNote(official, luts[official])}</p>
            <div className="mt-1 flex gap-2">
              <button type="button" className="min-h-11 rounded-[10px] border border-[var(--line)] px-3 text-[13px]" onClick={() => files[official].current?.click()}>공식 LUT 등록</button>
              {luts[official] ? (
                <button type="button" className="min-h-11 rounded-[10px] border border-[var(--line)] px-3 text-[13px] text-[var(--danger)]"
                  onClick={() => { void removeSourceLut(official).then(refresh).then(p.onLutChanged); }}>LUT 해제</button>
              ) : null}
              <input ref={files[official]} type="file" accept=".cube,.png" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void registerSourceLut(official, f).then(refresh).then(p.onLutChanged).catch((err: unknown) => p.onError(err instanceof Error ? err.message : String(err)));
                }} />
            </div>
          </div>
        ) : sub ? <p className="pb-2 pl-8 text-[12px] text-[var(--text-2)]">{sub}</p> : null}
      </div>
    );
  };

  return (
    <BottomSheet open={p.open} onClose={p.onClose} title="입력 색공간">
      <div role="radiogroup" aria-label="입력 색공간">
        {row("auto", `Auto (감지: ${detectedLabel(p.detection)})`)}
        {MAIN_CHOICES.map((id: SourceProfileId) => row(id, choiceLabel(id)))}
        <button type="button" className="flex min-h-11 w-full items-center gap-2 text-left text-[14px] text-[var(--text-2)]" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          <span style={{ transform: more ? "rotate(90deg)" : undefined }}><IconChevron size={18} /></span>
          기타 프로파일
        </button>
        {more ? MORE_CHOICES.map((id) => row(id, choiceLabel(id))) : null}
      </div>
    </BottomSheet>
  );
}
