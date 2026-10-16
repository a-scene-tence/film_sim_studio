"use client";
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

export function DetailTab() {
  const { state } = useStudio();
  return (
    <div className="flex flex-col">
      <StateSlider k="sharpness" />
      <StateSlider k="clarity" />
      <StateSlider k="dehaze" />
      <HdfSwitchRow />
      <StateSlider k="hdfStrength" disabled={!state.hdf} />
      <StateSlider k="grainAmount" />
      <StateSlider k="grainSize" />
      <StateSlider k="vignette" />
    </div>
  );
}
