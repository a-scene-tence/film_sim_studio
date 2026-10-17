"use client";
import { useMemo } from "react";
import { oklabToLin, srgbEnc } from "@/lib/color/fse/engine.mjs";
import { useStudio } from "../StudioContext";
import { LevelSegment, StateSlider } from "./common";

/** 흑백 조색 색상 트랙: OKLab 색상 0~359° 를 L 0.7, C 0.1 로 sRGB 변환한 12단계 그라디언트 */
export function hueGradient(): string {
  const stops: string[] = [];
  for (let i = 0; i < 12; i++) {
    const h = ((i / 11) * 359 * Math.PI) / 180;
    const rgb = (oklabToLin(0.7, 0.1 * Math.cos(h), 0.1 * Math.sin(h)) as number[]).map((v) => Math.round(Math.min(1, Math.max(0, srgbEnc(Math.min(1, Math.max(0, v))))) * 255));
    stops.push(`rgb(${rgb[0]},${rgb[1]},${rgb[2]}) ${(i / 11) * 100}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** 피부톤 슬라이더 방향 안내 (STC-v1) */
export const SKIN_HINTS = {
  skinHue: ["← 노란기 완화 (화사)", "붉은기 완화 (진정) →"],
  skinSat: ["← 차분·깨끗", "생기·혈색 →"],
  skinLum: ["← 차분하게", "화사하게 톤업 →"],
} as const;

/** 피부 색조 트랙: 피치 핑크(−) → 중립 → 아이보리 베이지(+) */
const SKIN_HUE_TRACK = "linear-gradient(90deg, #f2a7a4, #e8b9a0, #e9c9a2)";

export interface ColorTabProps { onAutoWb(): void; onAutoChroma(): void; onAutoSkin(): void; picking: boolean; onTogglePick(): void }

export function ColorTab({ onAutoWb, onAutoChroma, onAutoSkin, picking, onTogglePick }: ColorTabProps) {
  const { mono, asset, renderer } = useStudio();
  const ready = !!asset && !!renderer;
  const grad = useMemo(() => hueGradient(), []);
  return (
    <div className="flex flex-col">
      <div className="mb-1 grid grid-cols-2 gap-1">
        <button
          type="button" disabled={!ready} onClick={onAutoWb}
          className="min-h-11 rounded-[10px] border border-[var(--accent)] px-1 text-[13px] font-semibold leading-tight text-[var(--accent)] disabled:opacity-40"
        >
          자동 화이트밸런스
        </button>
        <button
          type="button" disabled={!ready} onClick={onAutoChroma}
          className="min-h-11 rounded-[10px] border border-[var(--accent)] px-1 text-[13px] font-semibold leading-tight text-[var(--accent)] disabled:opacity-40"
        >
          자동 채도·생동감
        </button>
      </div>
      <button
        type="button" disabled={!ready} onClick={onTogglePick} aria-pressed={picking}
        className="mb-1 h-11 w-full rounded-[10px] border text-[14px] disabled:opacity-40"
        style={picking ? { background: "var(--accent)", color: "#0b0b0c", borderColor: "var(--accent)", fontWeight: 700 } : { borderColor: "var(--line)", color: "var(--text)" }}
      >
        {picking ? "스포이트 (WB 피커) · 사용 중 — 눌러서 취소" : "스포이트 (WB 피커)"}
      </button>
      <StateSlider k="temp" track="linear-gradient(90deg, #4d8cff, #ffffff, #ffb24d)" />
      <StateSlider k="tint" track="linear-gradient(90deg, #4dff88, #ffffff, #ff4dd2)" />
      <StateSlider k="saturation" />
      <StateSlider k="vibrance" />
      <section aria-label="피부톤 (인물 보정)" className="mt-2 border-t border-[var(--line)] pt-1">
        <div className="flex min-h-11 items-center justify-between">
          <span className="text-[13px] font-semibold">피부톤 (인물 보정)</span>
          <button
            type="button" disabled={!ready || mono} onClick={onAutoSkin}
            className="min-h-11 rounded-[10px] border border-[var(--accent)] px-3 text-[13px] font-semibold text-[var(--accent)] disabled:opacity-40"
          >
            ✨ 피부톤 자동
          </button>
        </div>
        <StateSlider k="skinHue" disabled={mono} track={SKIN_HUE_TRACK} hint={SKIN_HINTS.skinHue} />
        <StateSlider k="skinSat" disabled={mono} hint={SKIN_HINTS.skinSat} />
        <StateSlider k="skinLum" disabled={mono} hint={SKIN_HINTS.skinLum} />
      </section>
      <LevelSegment k="cce" disabled={mono} />
      <LevelSegment k="ccb" disabled={mono} />
      {mono ? <p className="text-[12px] text-[var(--text-2)]">흑백 필름에는 적용되지 않습니다</p> : null}
      <div className="mt-2 border-t border-[var(--line)] pt-1">
        <StateSlider k="monoHue" disabled={!mono} track={grad} />
        <StateSlider k="monoAmount" disabled={!mono} />
        {!mono ? <p className="text-[12px] text-[var(--text-2)]">흑백 필름을 선택하면 사용할 수 있습니다</p> : null}
      </div>
    </div>
  );
}
