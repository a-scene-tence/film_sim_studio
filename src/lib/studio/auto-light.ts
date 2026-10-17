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

// ── 라이트 자동 보정 3모드 (COLOR_SCIENCE §16.12) ──────────────────────────
export type AutoLightMode = "balanced" | "highlight" | "shadow";
export interface AutoLightModeResult extends Omit<AutoLightResult, "brightness" | "lightBalance"> {
  brightness: number; lightBalance: number;
  /** 모드가 정하는 D레인지 (하이라이트 우선 모드만 DR200/DR400, 나머지는 현재 값 유지 = null) */
  dRange: 100 | 200 | 400 | null;
}
export const AUTO_LIGHT_LABEL: Readonly<Record<AutoLightMode, string>> = {
  balanced: "라이트 자동 (전체 평균)", highlight: "라이트 자동 (하이라이트 우선)", shadow: "라이트 자동 (암부 우선)",
};
/** 하이라이트 보호 기준: T_ref 디스플레이 L = 0.88 이 되는 scene Y (isp.ts ISP_Y88 과 같은 값) */
const HI_REF = 0.840607362;

const roundEv = (ev: number) => Math.round(Math.round(ev / 0.05) * 0.05 * 100) / 100;
const pct = (x: number) => nz(Math.round(100 * x));

function sortedValues(Y: ArrayLike<number>): Float64Array | null {
  const vals: number[] = [];
  for (let i = 0; i < Y.length; i++) { const y = Y[i]!; if (Number.isFinite(y)) vals.push(Math.max(y, 0)); }
  return vals.length === 0 ? null : Float64Array.from(vals).sort();
}

/**
 * 모드별 라이트 자동 보정. 입력은 computeAutoLight 와 같은 S0 직후 휘도 배열(노출 이득 1).
 * 모든 모드가 같은 순서로 계산한다: EV 결정 → Z = Y·2^EV 의 백분위로 나머지 슬라이더 결정.
 *  - balanced : EV = 0.8·log2(0.18/P50). hi/sh/ct 는 P95·P5·(P95/P5) 로.
 *  - highlight: P99 가 HI_REF 를 넘지 않도록 EV 를 낮추고(−1.5 ~ +0.3), P90~P99 를 하이라이트·흰색으로 눌러 보호. D레인지 연동.
 *  - shadow   : P25 를 0.09 로 끌어올리는 EV(P99·2^EV ≤ 1.2 제한). 하이라이트는 항상 음수로 고정, 쉐도우·라이트 밸런스·밝기를 리프트.
 */
export function computeAutoLightMode(Y: ArrayLike<number>, mode: AutoLightMode): AutoLightModeResult {
  const zero: AutoLightModeResult = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, brightness: 0, lightBalance: 0, dRange: null };
  const S = sortedValues(Y);
  if (!S) return zero;
  const raw = (q: number) => Math.max(percentile(S, q), FLA_FLOOR);
  let EV: number;
  if (mode === "balanced") EV = clamp(0.8 * Math.log2(0.18 / raw(50)), -3, 3);
  else if (mode === "highlight") {
    EV = clamp(Math.min(Math.log2(HI_REF / raw(99)), 0.3), -1.5, 0.3); // 너무 어두워지지 않게 -1.5EV 까지만, 나머지는 하이라이트·흰색이 보호
  } else {
    EV = Math.log2(0.09 / raw(25)) * 0.6;
    EV = clamp(Math.min(EV, Math.log2(1.2 / raw(99))), 0, 2);
  }
  EV = roundEv(EV);
  const g = 2 ** EV;
  const P = (q: number) => Math.max(percentile(S, q) * g, FLA_FLOOR);
  const out = { ...zero, exposure: nz(EV) };

  if (mode === "balanced") {
    const p95 = P(95), p5 = P(5), p50 = P(50);
    out.highlights = pct(p95 > 0.6 ? -Math.min(0.6, 0.35 * Math.log2(p95 / 0.6) + 0.1) : 0);
    out.shadows = pct(p5 < 0.02 ? Math.min(0.5, 0.25 * Math.log2(0.02 / p5)) : 0);
    out.contrast = pct(clamp(0.6 * (7.5 / Math.max(Math.log2(p95 / p5), 1) - 1), -0.25, 0.25));
    out.lightBalance = pct(clamp(0.5 * Math.log2(0.18 / p50), -0.3, 0.3));
    out.whites = pct(clamp(0.3 * Math.log2(1 / P(99.5)), -0.3, 0.3));
  } else if (mode === "highlight") {
    const p90 = P(90), p99 = P(99);
    out.highlights = pct(-clamp(0.35 + 0.45 * Math.log2(Math.max(p99, p90) / 0.5), 0.35, 0.9));
    out.whites = pct(-clamp(0.2 + 0.35 * Math.log2(Math.max(p99, 0.5) / 0.5), 0.2, 0.6));
    out.blacks = pct(-0.1);
    out.contrast = pct(0.1);
    out.shadows = pct(-0.05);
    const share = highShare(S);
    out.dRange = share >= 0.12 ? 400 : 200;
  } else {
    const p99 = P(99), p25 = P(25), p50 = P(50);
    out.highlights = pct(-clamp(0.25 + 0.35 * Math.max(0, Math.log2(p99 / 0.6)), 0.25, 0.7));
    out.shadows = pct(clamp(0.4 + 0.3 * Math.max(0, Math.log2(0.09 / p25)), 0.4, 1));
    out.lightBalance = pct(clamp(0.3 + 0.2 * Math.max(0, Math.log2(0.18 / p50)), 0.3, 0.8));
    out.brightness = pct(clamp(0.1 + 0.15 * Math.max(0, Math.log2(0.18 / p50)), 0.1, 0.5));
    out.blacks = pct(0.1);
  }
  return out;
}

/** 원본 장면에서 Y > HI_REF(디스플레이 L > 0.88) 인 픽셀 비율 — 고휘도 비중 (오름차순 배열 이분 탐색) */
function highShare(S: Float64Array): number {
  const lim = HI_REF;
  let lo = 0, hi = S.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (S[m]! <= lim) lo = m + 1; else hi = m; }
  return (S.length - lo) / S.length;
}
