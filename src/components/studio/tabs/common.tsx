"use client";
import { TrackSlider } from "@/components/editor/Slider";
import { defaultFor, formatValue, getValue, SLIDER_BY_KEY, type SliderKey } from "@/lib/studio/state";
import { useStudio } from "../StudioContext";

/** SLIDERS 표(SSOT)에서 라벨·범위·표시·기본값을 읽는 슬라이더 행 */
export function StateSlider({ k, disabled, track }: { k: SliderKey; disabled?: boolean; track?: string }) {
  const { state, dispatch, live, beginEdit, commitEdit, iso } = useStudio();
  const sp = SLIDER_BY_KEY[k];
  const v = getValue(state, k);
  return (
    <TrackSlider
      label={sp.label} value={v} min={sp.min} max={sp.max} step={sp.step} display={formatValue(k, v)} defaultValue={defaultFor(k, state.simId, iso)}
      disabled={disabled} trackBackground={track} onChange={(x) => live({ type: "set", key: k, value: x })} onDragStart={beginEdit} onCommit={commitEdit} onReset={() => dispatch({ type: "reset", key: k, iso })}
    />
  );
}

/** 끔/약/강 세그먼트 */
export function LevelSegment({ k, disabled }: { k: "cce" | "ccb"; disabled?: boolean }) {
  const { state, dispatch } = useStudio();
  const sp = SLIDER_BY_KEY[k];
  const cur = state[k];
  return (
    <div className={`flex flex-col gap-1 py-1 ${disabled ? "opacity-40" : ""}`}>
      <span className="text-[13px]">{sp.label}</span>
      <div role="radiogroup" aria-label={sp.label} className="flex h-11 overflow-hidden rounded-[10px] border border-[var(--line)]">
        {["끔", "약", "강"].map((l, i) => (
          <button
            key={l} type="button" role="radio" aria-checked={cur === i} disabled={disabled}
            className="flex-1 text-[13px]" style={cur === i ? { background: "var(--accent)", color: "#0b0b0c", fontWeight: 700 } : { color: "var(--text-2)" }}
            onClick={() => dispatch({ type: "set", key: k, value: i })}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export const chip = (on: boolean) =>
  `inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-4 text-[13px] ${on ? "bg-[var(--accent)] font-semibold text-[#0b0b0c]" : "bg-[var(--panel-2)] text-[var(--text)]"}`;
