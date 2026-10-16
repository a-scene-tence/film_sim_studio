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

// ── Step 4 §7-5 스튜디오 슬라이더 (포인터 기반 트랙) ───────────────────────────────
export interface TrackSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** 값 표시 문자열 */
  display: string;
  /** 기본값 (더블탭 리셋 값, 이 값과 다르면 값 글자가 accent) */
  defaultValue: number;
  onChange(v: number): void;
  onReset(): void;
  disabled?: boolean;
  /** 트랙 배경 그라디언트 (CSS background) */
  trackBackground?: string;
  /** 드래그 시작·끝 알림 (드래그 중 프레임마다 렌더) */
  onDragChange?(dragging: boolean): void;
}

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 10;

/**
 * 행 높이 52px. 트랙 4px, 썸 24px, touch-action none. 더블탭(300ms, 10px 미만)은 썸·트랙 모두에서 onReset,
 * min<0 이면 0 위치에서 채움이 시작되고, role="slider" + 방향키(step)를 지원한다.
 */
export function TrackSlider(p: TrackSliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const last = useRef<{ t: number; x: number; y: number } | null>(null);
  const down = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const span = p.max - p.min;
  const frac = span > 0 ? (Math.min(p.max, Math.max(p.min, p.value)) - p.min) / span : 0;
  const zeroFrac = p.min < 0 ? (0 - p.min) / span : 0;
  const lo = Math.min(frac, zeroFrac), hi = Math.max(frac, zeroFrac);
  const changed = Math.abs(p.value - p.defaultValue) > 1e-9;

  const valueAt = (clientX: number): number => {
    const r = track.current!.getBoundingClientRect();
    const f = r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
    const raw = p.min + f * span;
    return Math.min(p.max, Math.max(p.min, Math.round(raw / p.step) * p.step));
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (p.disabled) return;
    e.preventDefault();
    track.current?.setPointerCapture(e.pointerId);
    down.current = { x: e.clientX, y: e.clientY, moved: false };
    p.onDragChange?.(true);
    p.onChange(valueAt(e.clientX));
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = down.current;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= DOUBLE_TAP_PX) d.moved = true;
    p.onChange(valueAt(e.clientX));
  };
  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = down.current;
    if (!d) return;
    down.current = null;
    p.onDragChange?.(false);
    if (cancelled) return;
    const prev = last.current;
    const now = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    if (!d.moved && prev && now.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(now.x - prev.x, now.y - prev.y) < DOUBLE_TAP_PX) {
      last.current = null;
      p.onReset();
    } else last.current = d.moved ? null : now;
  };
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (p.disabled) return;
    const k = e.key;
    const dir = k === "ArrowRight" || k === "ArrowUp" ? 1 : k === "ArrowLeft" || k === "ArrowDown" ? -1 : 0;
    if (dir !== 0) { e.preventDefault(); p.onChange(Math.min(p.max, Math.max(p.min, p.value + dir * p.step))); }
    else if (k === "Home") p.onChange(p.min);
    else if (k === "End") p.onChange(p.max);
  };

  return (
    <div className={`flex h-[52px] select-none flex-col justify-center ${p.disabled ? "opacity-40" : ""}`}>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-[var(--text)]">{p.label}</span>
        <span className={`tnum ${changed ? "text-[var(--accent)]" : "text-[var(--text-2)]"}`}>{p.display}</span>
      </div>
      <div
        ref={track} role="slider" tabIndex={p.disabled ? -1 : 0} aria-label={p.label} aria-valuemin={p.min} aria-valuemax={p.max} aria-valuenow={p.value} aria-valuetext={p.display}
        aria-disabled={p.disabled === true}
        className="relative mt-1 h-6 w-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" style={{ touchAction: "none" }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={(e) => finish(e, false)} onPointerCancel={(e) => finish(e, true)} onKeyDown={onKey}
      >
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--line)]" style={p.trackBackground ? { background: p.trackBackground } : undefined} />
        {p.trackBackground ? null : <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--accent)]" style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }} />}
        <div className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f2f2f2] shadow" style={{ left: `${frac * 100}%` }} />
      </div>
    </div>
  );
}
