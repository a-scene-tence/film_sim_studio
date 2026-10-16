// 슬라이더 방향 판별 잠금(Directional Gesture Lock): 터치는 6px 이상 움직여 방향이 정해질 때까지 값을 건드리지 않는다.
// 상하 이동이 크면 패널 스크롤로 보고 취소, 좌우 이동이 크면 포인터 캡처 후 상대 이동량으로 값을 바꾼다.

export const LOCK_PX = 6;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 10;

export interface PointerLike { pointerId: number; pointerType: string; clientX: number; clientY: number; timeStamp: number }

export interface GestureConfig {
  limits(): { min: number; max: number; step: number };
  /** 현재 슬라이더 값 */
  value(): number;
  disabled?(): boolean;
  /** 트랙의 화면 위치 (마우스 절대 좌표 → 값 변환, 터치 상대 이동량 → 비율 변환) */
  rect(): { left: number; width: number };
  /** 값을 바꾸기 직전 한 번 (드래그 시작 = 히스토리 기준 상태 기억) */
  onDragStart(): void;
  onChange(v: number): void;
  /** 손가락/버튼을 떼어 조작이 확정될 때 (드래그 1회당 1번) */
  onCommit(): void;
  /** 더블탭 */
  onReset(): void;
  capture(pointerId: number): void;
  release(pointerId: number): void;
}

export const snapValue = (v: number, min: number, max: number, step: number): number =>
  Math.min(max, Math.max(min, Math.round(v / step) * step));

/** 시작 값 + 이동 거리(px) → 값 (트랙 전체 폭 = min..max) */
export function valueFromDelta(startValue: number, dx: number, width: number, min: number, max: number, step: number): number {
  if (width <= 0) return startValue;
  return snapValue(startValue + (dx / width) * (max - min), min, max, step);
}

interface Track { id: number; type: string; x: number; y: number; startValue: number; anchorX: number; moved: boolean; locked: boolean }

export class SliderGesture {
  private t: Track | null = null;
  private last: { time: number; x: number; y: number } | null = null;
  constructor(private c: GestureConfig) {}

  /** 'idle' | 'pending'(터치, 방향 판별 대기) | 'dragging' */
  get phase(): "idle" | "pending" | "dragging" {
    return !this.t ? "idle" : this.t.locked ? "dragging" : "pending";
  }

  private lock(t: Track, x: number): void {
    t.locked = true;
    t.anchorX = x;
    this.c.capture(t.id);
    this.c.onDragStart();
  }

  down(e: PointerLike): void {
    if (this.c.disabled?.()) return;
    if (this.t) this.c.release(this.t.id);
    const t: Track = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, startValue: this.c.value(), anchorX: e.clientX, moved: false, locked: false };
    this.t = t;
    if (e.pointerType === "touch") return; // 즉시 값 변경 / 캡처 금지: 방향이 정해질 때까지 기록만 한다
    this.lock(t, e.clientX);
    this.c.onChange(this.absolute(e.clientX));
  }

  private absolute(x: number): number {
    const r = this.c.rect();
    const { min, max, step } = this.c.limits();
    const f = r.width > 0 ? Math.min(1, Math.max(0, (x - r.left) / r.width)) : 0;
    return snapValue(min + f * (max - min), min, max, step);
  }

  move(e: PointerLike): void {
    const t = this.t;
    if (!t || t.id !== e.pointerId) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    if (!t.locked) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= LOCK_PX) return;
      t.moved = true;
      if (Math.abs(dy) > Math.abs(dx)) { this.t = null; this.last = null; return; } // 세로 스크롤 의도: 값 불변
      this.lock(t, e.clientX);
      return;
    }
    if (Math.hypot(dx, dy) > LOCK_PX) t.moved = true;
    const { min, max, step } = this.c.limits();
    this.c.onChange(t.type === "touch" ? valueFromDelta(t.startValue, e.clientX - t.anchorX, this.c.rect().width, min, max, step) : this.absolute(e.clientX));
  }

  up(e: PointerLike): void {
    const t = this.t;
    if (!t || t.id !== e.pointerId) return;
    this.t = null;
    if (t.locked) {
      this.c.release(t.id);
      this.c.onCommit();
    }
    if (t.moved) { this.last = null; return; }
    // 이동 없는 순수 탭만 더블탭 후보
    const prev = this.last;
    if (prev && e.timeStamp - prev.time <= DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX) {
      this.last = null;
      this.c.onReset();
    } else this.last = { time: e.timeStamp, x: e.clientX, y: e.clientY };
  }

  cancel(e: PointerLike): void {
    const t = this.t;
    if (!t || t.id !== e.pointerId) return;
    this.t = null;
    this.last = null;
    if (t.locked) { this.c.release(t.id); this.c.onCommit(); }
  }
}
