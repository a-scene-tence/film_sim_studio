import type { HistogramStats } from "./types";

/** 11.2-D logLike 판정 */
export function isLogLike(s: Pick<HistogramStats, "p0_1" | "p50" | "p99_9">): boolean {
  return s.p0_1 >= 0.025 && s.p99_9 <= 0.95 && s.p50 >= 0.15 && s.p50 <= 0.65;
}

/** 11.3-3 분위수: 누적 개수 ≥ q·N 인 첫 빈의 (idx+0.5)/1024 */
function quantile(bins: Uint32Array, n: number, q: number): number {
  let acc = 0;
  for (let i = 0; i < bins.length; i++) {
    acc += bins[i]!;
    if (acc >= q * n) return (i + 0.5) / 1024;
  }
  return (bins.length - 0.5) / 1024;
}

export function statsFromBins(bins1024: Uint32Array): HistogramStats {
  let n = 0;
  for (let i = 0; i < bins1024.length; i++) n += bins1024[i]!;
  const s = {
    bins1024, sampleCount: n,
    p0_1: quantile(bins1024, n, 0.001), p0_5: quantile(bins1024, n, 0.005), p50: quantile(bins1024, n, 0.5),
    p99_5: quantile(bins1024, n, 0.995), p99_9: quantile(bins1024, n, 0.999), logLike: false,
  };
  s.logLike = isLogLike(s);
  return s;
}

/** 표본 간격 step = max(1, ceil(sqrt(W·H/1e6))) (가로·세로 모두). getV(x,y) 는 0~1 값. */
export function computeStats(width: number, height: number, getV: (x: number, y: number) => number): HistogramStats {
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / 1e6)));
  const bins = new Uint32Array(1024);
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const v = getV(x, y);
      bins[Math.min(1023, Math.max(0, Math.floor(v * 1024)))]!++;
    }
  }
  return statsFromBins(bins);
}

/** Rec.709 휘도식 */
export const luma709 = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
