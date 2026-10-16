// Step 4 §8-2 제스처 순수 함수 — 핀치·팬·더블탭·보이는 영역. 좌표는 모두 컨테이너 기준 CSS px.
export interface Vec2 { x: number; y: number }
export interface ZoomState { z: number; t: Vec2 }
/** Wc×Hc = 프리뷰 컨테이너, bw×bh = contain 으로 맞춘 기준 이미지 CSS 크기 */
export interface Geometry { Wc: number; Hc: number; bw: number; bh: number }

export const Z_MIN = 1;
export const Z_MAX = 8;
export const DOUBLE_TAP_ZOOM = 2.5;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function clampPan(t: Vec2, z: number, g: Geometry): Vec2 {
  const mx = Math.max(0, (g.bw * z - g.Wc) / 2);
  const my = Math.max(0, (g.bh * z - g.Hc) / 2);
  return { x: clamp(t.x, -mx, mx) + 0, y: clamp(t.y, -my, my) + 0 };
}

export interface PinchStart { z0: number; t0: Vec2; mid0: Vec2; d0: number }

/** 핀치: z = clamp(z0·d/d0, 1, 8), t = mid − c − (mid0 − c − t0)·(z/z0), 그다음 clampPan */
export function pinch(start: PinchStart, mid: Vec2, d: number, g: Geometry): ZoomState {
  const z = clamp(start.z0 * (d / start.d0), Z_MIN, Z_MAX);
  const c = { x: g.Wc / 2, y: g.Hc / 2 };
  const k = z / start.z0;
  const t = { x: mid.x - c.x - (start.mid0.x - c.x - start.t0.x) * k, y: mid.y - c.y - (start.mid0.y - c.y - start.t0.y) * k };
  return { z, t: clampPan(t, z, g) };
}

/** 팬: 포인터 1개이고 z > 1 일 때만 */
export function pan(cur: ZoomState, dx: number, dy: number, g: Geometry): ZoomState {
  if (!(cur.z > 1)) return cur;
  return { z: cur.z, t: clampPan({ x: cur.t.x + dx, y: cur.t.y + dy }, cur.z, g) };
}

/** 더블탭: z < 1.01 이면 tap 지점 기준 2.5×, 아니면 1×·(0,0) */
export function doubleTapZoom(cur: ZoomState, tap: Vec2, g: Geometry): ZoomState {
  if (cur.z < 1.01) {
    const z = DOUBLE_TAP_ZOOM;
    return pinch({ z0: cur.z, t0: cur.t, mid0: tap, d0: 1 }, tap, z / cur.z, g);
  }
  return { z: 1, t: { x: 0, y: 0 } };
}

export const isDoubleTap = (prev: { time: number; x: number; y: number } | null, cur: { time: number; x: number; y: number }): boolean =>
  prev !== null && cur.time - prev.time <= 300 && Math.hypot(cur.x - prev.x, cur.y - prev.y) < 10;

/** 길게 누르기: 350ms 동안 이동 8px 미만 */
export const LONG_PRESS_MS = 350;
export const LONG_PRESS_SLOP = 8;

export interface VisibleRegion { u0: number; u1: number; v0: number; v1: number; /** 컨테이너 안 CSS 사각형 */ rect: { x: number; y: number; w: number; h: number } }

/** §8-6: 이미지 사각형 좌상단 = c + t − (bw·z, bh·z)/2 와 화면 [0,Wc]×[0,Hc] 의 교집합을 정규화 이미지 좌표로 */
export function visibleRegion(s: ZoomState, g: Geometry): VisibleRegion | null {
  const iw = g.bw * s.z, ih = g.bh * s.z;
  const left = g.Wc / 2 + s.t.x - iw / 2, top = g.Hc / 2 + s.t.y - ih / 2;
  const x0 = Math.max(0, left), y0 = Math.max(0, top);
  const x1 = Math.min(g.Wc, left + iw), y1 = Math.min(g.Hc, top + ih);
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { u0: (x0 - left) / iw, u1: (x1 - left) / iw, v0: (y0 - top) / ih, v1: (y1 - top) / ih, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/** §8-1 contain 크기와 백킹 크기 */
export function containSize(Wd: number, Hd: number, Wc: number, Hc: number): { bw: number; bh: number } {
  const b = Math.min(Wc / Wd, Hc / Hd);
  return { bw: Wd * b, bh: Hd * b };
}
