// Step 4 §9 자동 보정 FLA-v1 — S0 직후 휘도 배열(긴 변 256)에서 라이트 탭 8개 값을 계산한다. 눈대중 상수 없음.
export const FLA_FLOOR = 2 ** -14;

export interface AutoLightResult {
  exposure: number; contrast: number; highlights: number; shadows: number; whites: number; blacks: number;
  brightness: 0; lightBalance: 0;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const nz = (x: number) => (Object.is(x, -0) || x === 0 ? 0 : x);

/** 선형보간 백분위: idx = q/100·(n−1), lo = floor(idx), hi = min(lo+1, n−1) */
export function percentile(Z: ArrayLike<number>, q: number): number {
  const n = Z.length;
  const idx = (q / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, n - 1);
  return Z[lo]! + (Z[hi]! - Z[lo]!) * (idx - lo);
}

export function computeAutoLight(Y: ArrayLike<number>): AutoLightResult {
  const vals: number[] = [];
  for (let i = 0; i < Y.length; i++) {
    const y = Y[i]!;
    if (Number.isFinite(y)) vals.push(Math.max(y, 0));
  }
  const zero: AutoLightResult = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, brightness: 0, lightBalance: 0 };
  if (vals.length === 0) return zero;
  let sumLn = 0;
  for (const y of vals) sumLn += Math.log(Math.max(y, FLA_FLOOR));
  const key = Math.exp(sumLn / vals.length);
  let EV = clamp(0.8 * Math.log2(0.18 / key), -3, 3);
  EV = Math.round(EV / 0.05) * 0.05;
  EV = Math.round(EV * 100) / 100;
  const g = 2 ** EV;
  const Z = Float64Array.from(vals, (y) => y * g).sort();
  const P = (q: number) => Math.max(percentile(Z, q), FLA_FLOOR);
  const p995 = P(99.5);
  const hi = p995 > 1 ? -Math.min(0.6, 0.4 * Math.log2(p995)) : 0;
  const p5 = P(5);
  const sh = p5 < 0.01125 ? Math.min(0.5, 0.25 * Math.log2(0.01125 / p5)) : 0;
  const wh = clamp(0.3 * Math.log2(1 / P(99.9)), -0.3, 0.3);
  const p05 = P(0.5);
  const bk = p05 > 0.0028125 ? -Math.min(0.3, 0.15 * Math.log2(p05 / 0.0028125)) : 0;
  const S = Math.log2(P(99) / P(1));
  const ct = clamp(0.6 * (7.5 / Math.max(S, 1) - 1), -0.25, 0.25);
  return {
    exposure: nz(EV), contrast: nz(Math.round(100 * ct)), highlights: nz(Math.round(100 * hi)), shadows: nz(Math.round(100 * sh)),
    whites: nz(Math.round(100 * wh)), blacks: nz(Math.round(100 * bk)), brightness: 0, lightBalance: 0,
  };
}
