"use client";
// Step 4 §8-5 HDF 토글: 프리뷰 우상단 64×32 pill, 항상 표시 (터치 영역은 44px 이상으로 확장)
export function HdfToggle({ on, onToggle, disabled }: { on: boolean; onToggle(): void; disabled?: boolean }) {
  return (
    <button
      type="button" aria-pressed={on} aria-label="HDF" disabled={disabled}
      className={`absolute right-0 top-0 z-10 flex h-[48px] w-[72px] items-center justify-center ${disabled ? "opacity-40" : ""}`}
      onClick={() => { onToggle(); navigator.vibrate?.(10); }}
    >
      <span
        className="flex h-8 w-16 items-center justify-center gap-1 rounded-full text-[12px] font-bold"
        style={on ? { background: "#ff6a1a", color: "#0b0b0c" } : { background: "#2a2a2e", color: "#9a9aa0" }}
      >
        {on ? <span className="h-1.5 w-1.5 rounded-full bg-black" /> : null}
        HDF
      </span>
    </button>
  );
}
