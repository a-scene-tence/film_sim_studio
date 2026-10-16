// Step 4 §8-4 히스토그램 — 8비트 표시값 빈 계산, 높이(제곱근 정규화), 클리핑 판정. 그리기는 Histogram.tsx.
export interface HistBins { R: Uint32Array; G: Uint32Array; B: Uint32Array; L: Uint32Array; n: number }

/** RGBA8 픽셀 배열 → 채널별 256 빈. L[round(0.2126r + 0.7152g + 0.0722b)]++ */
export function binPixels(rgba: ArrayLike<number>): HistBins {
  const R = new Uint32Array(256), G = new Uint32Array(256), B = new Uint32Array(256), L = new Uint32Array(256);
  const n = Math.floor(rgba.length / 4);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]!, g = rgba[i * 4 + 1]!, b = rgba[i * 4 + 2]!;
    R[r]!++; G[g]!++; B[b]!++;
    L[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]!++;
  }
  return { R, G, B, L, n };
}

/** h_i = min(1, sqrt(bins[i]/M)), M = max(bins[1..254]) (0 이면 max(bins[0..255]), 그것도 0 이면 1) */
export function histHeights(bins: ArrayLike<number>): Float32Array {
  let M = 0;
  for (let i = 1; i <= 254; i++) M = Math.max(M, bins[i]!);
  if (M === 0) for (let i = 0; i <= 255; i++) M = Math.max(M, bins[i]!);
  if (M === 0) M = 1;
  const h = new Float32Array(256);
  for (let i = 0; i < 256; i++) h[i] = Math.min(1, Math.sqrt(bins[i]! / M));
  return h;
}

/** 임계 t = 0.002·N. shadow = R/G/B[0] ≥ t, highlight = R/G/B[255] ≥ t */
export function clipFlags(b: HistBins): { shadow: boolean; highlight: boolean } {
  const t = 0.002 * b.n;
  return {
    shadow: b.R[0]! >= t || b.G[0]! >= t || b.B[0]! >= t,
    highlight: b.R[255]! >= t || b.G[255]! >= t || b.B[255]! >= t,
  };
}
