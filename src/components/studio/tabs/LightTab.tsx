"use client";
import type { ParamKey } from "@/lib/studio/state";
import { useStudio } from "../StudioContext";
import { StateSlider } from "./common";

const KEYS: ParamKey[] = ["lightBalance", "exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks"];

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
      {KEYS.map((k) => <StateSlider key={k} k={k} />)}
    </div>
  );
}
