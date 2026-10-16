"use client";

import { useRef } from "react";

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(v: number): void;
  /** 레시피가 더해진 실효값 (다르면 함께 표시) */
  effective?: number;
}

const fmt = (v: number, step: number) => (step < 1 ? v.toFixed(2) : String(Math.round(v)));

/** 더블탭(300ms 이내 두 번 탭 또는 dblclick) = 0 */
export function Slider({ label, value, min, max, step, onChange, effective }: SliderProps) {
  const lastTap = useRef(0);
  const onPointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    const now = e.timeStamp;
    if (now - lastTap.current < 300) {
      onChange(0);
      lastTap.current = 0;
    } else lastTap.current = now;
  };
  return (
    <label className="flex min-h-11 flex-col gap-1 py-1" onDoubleClick={() => onChange(0)}>
      <span className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-neutral-400">
          {fmt(value, step)}
          {effective !== undefined && effective !== value ? <span className="ml-1 text-amber-400">→ {fmt(effective, step)}</span> : null}
        </span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value} aria-label={label}
        className="h-11 w-full accent-amber-400"
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onPointerUp}
      />
    </label>
  );
}
