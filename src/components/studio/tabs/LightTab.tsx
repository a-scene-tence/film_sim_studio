"use client";
import type { AutoLightMode } from "@/lib/studio/auto-light";
import { D_RANGES, type ParamKey } from "@/lib/studio/state";
import { useStudio } from "../StudioContext";
import { StateSlider } from "./common";

const KEYS: ParamKey[] = ["lightBalance", "exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks"];

/** FSE-v2 §6-4 D레인지 세그먼트 [DR100] [DR200] [DR400] (키 dRange, 기본 DR100) */
export function DRangeSegment() {
  const { state, dispatch, asset } = useStudio();
  return (
    <div className={`flex flex-col gap-1 py-1 ${asset ? "" : "opacity-40"}`}>
      <span className="text-[13px]">D레인지</span>
      <div role="radiogroup" aria-label="D레인지" className="flex h-11 overflow-hidden rounded-[10px] border border-[var(--line)]">
        {D_RANGES.map((d) => (
          <button
            key={d} type="button" role="radio" aria-checked={state.dRange === d} disabled={!asset}
            className="flex-1 text-[13px]" style={state.dRange === d ? { background: "var(--accent)", color: "#0b0b0c", fontWeight: 700 } : { color: "var(--text-2)" }}
            onClick={() => dispatch({ type: "setDRange", value: d })}
          >
            DR{d}
          </button>
        ))}
      </div>
      <p className="text-[12px] leading-snug text-[var(--text-2)]">DR200 은 Y 0.45 초과(밝은 영역), DR400 은 Y 0.30 초과(미드톤)부터 하이라이트를 부드럽게 감습니다. RAW·Log 영상은 하이라이트를 더 넓게 보존합니다.</p>
    </div>
  );
}

const AUTO_MODES: ReadonlyArray<{ mode: AutoLightMode; label: string; hint: string }> = [
  { mode: "balanced", label: "전체 평균 (균형)", hint: "중앙값·P5·P95 기준 표준 밸런스" },
  { mode: "highlight", label: "하이라이트 우선", hint: "밝은 영역 보호 + DR 연동" },
  { mode: "shadow", label: "암부·역광 우선", hint: "어두운 피사체 디테일 복원" },
];

export function LightTab({ onAuto }: { onAuto(mode: AutoLightMode): void }) {
  const { asset, renderer } = useStudio();
  return (
    <div className="flex flex-col">
      <div className="mb-1 grid grid-cols-3 gap-1" role="group" aria-label="라이트 자동 보정">
        {AUTO_MODES.map((m) => (
          <button
            key={m.mode} type="button" disabled={!asset || !renderer} onClick={() => onAuto(m.mode)} title={m.hint}
            className="min-h-11 rounded-[10px] border border-[var(--accent)] px-1 text-[13px] font-semibold leading-tight text-[var(--accent)] disabled:opacity-40"
          >
            {m.label}
          </button>
        ))}
      </div>
      <DRangeSegment />
      {KEYS.map((k) => <StateSlider key={k} k={k} />)}
    </div>
  );
}
