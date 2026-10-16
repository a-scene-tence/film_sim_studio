"use client";
import { useEffect, useRef, useState } from "react";
import { ToneCurveGraph } from "@/components/editor/ToneCurveGraph";
import type { CurvePreset } from "@/lib/render/curve";
import { fromCurveState, toCurveState } from "@/lib/studio/state";
import { useStudio } from "../StudioContext";
import { chip, StateSlider } from "./common";

const PRESETS: ReadonlyArray<[CurvePreset, string]> = [
  ["linear", "선형"], ["weak-contrast", "필름 S-커브"], ["matte", "매트 페이드"], ["soft-highlight", "소프트 하이라이트"], ["strong-contrast", "고대비"],
];

export function CurveTab() {
  const { state, dispatch, live, beginEdit, commitEdit } = useStudio();
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(280);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.min(el.clientWidth, 280)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={wrap} className="flex flex-col gap-2">
      <div className="hide-scrollbar flex gap-2 overflow-x-auto" style={{ touchAction: "pan-x" }}>
        {PRESETS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={state.curve.preset === id} className={chip(state.curve.preset === id)} onClick={() => dispatch({ type: "curvePreset", preset: id })}>{label}</button>
        ))}
      </div>
      <div style={{ width: w }} className="mx-auto">
        <ToneCurveGraph value={toCurveState(state.curve)} onChange={(c) => live({ type: "curve", curve: fromCurveState(c) })} onDragStart={beginEdit} onCommit={commitEdit} />
      </div>
      {(["zone0", "zone1", "zone2", "zone3", "zone4"] as const).map((k) => <StateSlider key={k} k={k} />)}
      <button type="button" className="min-h-11 self-start px-1 text-[13px] text-[var(--text-2)] underline" onClick={() => dispatch({ type: "curveReset" })}>커브 초기화</button>
    </div>
  );
}
