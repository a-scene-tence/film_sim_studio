"use client";
import { FUJI_GRAIN_PRESETS, matchFujiGrain } from "@/lib/render/grain";
import { useStudio } from "../StudioContext";
import { StateSlider } from "./common";

export function HdfSwitchRow() {
  const { state, dispatch, asset } = useStudio();
  return (
    <div className={`flex h-[52px] items-center justify-between ${asset ? "" : "opacity-40"}`}>
      <span className="text-[13px]">HDF 광학 확산</span>
      <button
        type="button" role="switch" aria-checked={state.hdf} aria-label="HDF" disabled={!asset}
        className="flex h-11 w-14 items-center justify-center" onClick={() => dispatch({ type: "toggleHdf" })}
      >
        <span className="relative h-6 w-11 rounded-full transition-colors" style={{ background: state.hdf ? "var(--accent)" : "var(--line)" }}>
          <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: state.hdf ? 22 : 2 }} />
        </span>
      </button>
    </div>
  );
}

/** 후지필름 그레인 이펙트: 거칠기(OFF/약/강) × 크기(소/대) 원터치. 아래 슬라이더로 미세 조절하면 선택 표시는 해제된다 */
export function GrainPresetRow() {
  const { state, dispatch, asset } = useStudio();
  const cur = matchFujiGrain(state.grainAmount, state.grainSize);
  return (
    <div className={`flex flex-col gap-1 py-1 ${asset ? "" : "opacity-40"}`}>
      <span className="text-[13px]">그레인 이펙트 (거칠기 · 크기)</span>
      <div role="radiogroup" aria-label="그레인 이펙트" className="flex h-11 overflow-hidden rounded-[10px] border border-[var(--line)]">
        {FUJI_GRAIN_PRESETS.map((g) => (
          <button
            key={g.id} type="button" role="radio" aria-checked={cur === g.id} disabled={!asset}
            className="flex-1 text-[13px]" style={cur === g.id ? { background: "var(--accent)", color: "#0b0b0c", fontWeight: 700 } : { color: "var(--text-2)" }}
            onClick={() => dispatch({ type: "patch", values: { grainAmount: g.amount, grainSize: g.size } })}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DetailTab() {
  const { state } = useStudio();
  return (
    <div className="flex flex-col">
      <StateSlider k="sharpness" />
      <StateSlider k="clarity" />
      <StateSlider k="dehaze" />
      <HdfSwitchRow />
      <StateSlider k="hdfStrength" disabled={!state.hdf} />
      <GrainPresetRow />
      <StateSlider k="grainAmount" />
      <StateSlider k="grainSize" />
      <StateSlider k="vignette" />
    </div>
  );
}
