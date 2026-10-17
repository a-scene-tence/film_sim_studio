"use client";
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
      <p className="text-[12px] leading-snug text-[var(--text-2)]">RAW·Log 영상은 하이라이트를 더 넓게 보존합니다. JPEG 은 하이라이트 밀도만 바뀝니다.</p>
    </div>
  );
}

export function LightTab({ onAuto }: { onAuto(): void }) {
  const { asset, renderer } = useStudio();
  return (
    <div className="flex flex-col">
      <button
        type="button" disabled={!asset || !renderer} onClick={onAuto}
        className="mb-1 h-11 w-full rounded-[10px] border border-[var(--accent)] text-[14px] font-semibold text-[var(--accent)] disabled:opacity-40"
      >
        자동 보정
      </button>
      <DRangeSegment />
      {KEYS.map((k) => <StateSlider key={k} k={k} />)}
    </div>
  );
}
