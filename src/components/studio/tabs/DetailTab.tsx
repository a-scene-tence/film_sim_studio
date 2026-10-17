"use client";
import { GRAIN_ROUGHNESS_AMOUNT, GRAIN_SIZE_VALUE, grainRoughnessOf, grainSizeChoiceOf } from "@/lib/render/grain";
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

const segStyle = (on: boolean) => (on ? { background: "var(--accent)", color: "#0b0b0c", fontWeight: 700 } : { color: "var(--text-2)" });

/** 후지필름 그레인 이펙트 메뉴와 같은 2단 스위치: 거칠기 OFF/약/강, 크기 소/대. 거칠기 슬라이더로 미세 조절하면 거칠기 선택 표시만 해제된다 */
export function GrainSwitches() {
  const { state, dispatch, asset } = useStudio();
  const rough = grainRoughnessOf(state.grainAmount);
  const size = grainSizeChoiceOf(state.grainSize);
  return (
    <div className={`flex flex-col gap-1 py-1 ${asset ? "" : "opacity-40"}`}>
      <span className="text-[13px]">그레인 이펙트 · 거칠기</span>
      <div role="radiogroup" aria-label="그레인 거칠기" className="flex h-11 overflow-hidden rounded-[10px] border border-[var(--line)]">
        {([["off", "OFF", 0], ["weak", "약 (Weak)", GRAIN_ROUGHNESS_AMOUNT.weak], ["strong", "강 (Strong)", GRAIN_ROUGHNESS_AMOUNT.strong]] as const).map(([id, label, amount]) => (
          <button
            key={id} type="button" role="radio" aria-checked={rough === id} disabled={!asset}
            className="flex-1 text-[13px]" style={segStyle(rough === id)}
            onClick={() => dispatch({ type: "set", key: "grainAmount", value: amount })}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="mt-1 text-[13px]">그레인 이펙트 · 크기</span>
      <div role="radiogroup" aria-label="그레인 크기" className="flex h-11 overflow-hidden rounded-[10px] border border-[var(--line)]">
        {([["small", "소 (Small)"], ["large", "대 (Large)"]] as const).map(([id, label]) => (
          <button
            key={id} type="button" role="radio" aria-checked={size === id} disabled={!asset}
            className="flex-1 text-[13px]" style={segStyle(size === id)}
            onClick={() => dispatch({ type: "set", key: "grainSize", value: GRAIN_SIZE_VALUE[id] })}
          >
            {label}
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
      <GrainSwitches />
      <StateSlider k="grainAmount" />
      <StateSlider k="vignette" />
    </div>
  );
}
