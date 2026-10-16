// 섹션 7.1 크기·반경, 5.6/8.6 HDF 레벨, 8.5 그레인 유니폼 — 렌더 그래프가 쓰는 순수 계산.
export interface Size { width: number; height: number }
export type MediaMode = "photo" | "video";

/** 장축 target 으로 축소한 크기: 각 축 = max(1, round(R·target/R_long)) */
export function scaledSize(R: Size, longTarget: number): Size {
  const L = Math.max(R.width, R.height);
  if (longTarget >= L) return { width: R.width, height: R.height };
  return { width: Math.max(1, Math.round((R.width * longTarget) / L)), height: Math.max(1, Math.round((R.height * longTarget) / L)) };
}

/** 긴 변을 정확히 longTarget 으로 맞춘 크기 (Step 4 §8-4, §9-1): 짧은 변 = max(1, round(longTarget·짧은/긴)). 확대도 허용 */
export function fixedLongSize(R: Size, longTarget: number): Size {
  const L = Math.max(R.width, R.height);
  return { width: Math.max(1, Math.round((R.width * longTarget) / L)), height: Math.max(1, Math.round((R.height * longTarget) / L)) };
}

export interface GraphSizes {
  R: Size; A: Size; D: Size; aLong: number; dLong: number;
  /** 가이드 반경: 베이스 톤, 명료도, 디헤이즈 */
  rT: number; rC: number; rDz: number;
}

export function graphSizes(R: Size, mode: MediaMode): GraphSizes {
  const rLong = Math.max(R.width, R.height);
  const aLong = Math.min(rLong, mode === "photo" ? 1024 : 256);
  const dLong = Math.min(rLong, mode === "photo" ? 512 : 256);
  const A = scaledSize(R, aLong);
  const D = scaledSize(R, dLong);
  return {
    R, A, D, aLong: Math.max(A.width, A.height), dLong: Math.max(D.width, D.height),
    rT: Math.max(1, Math.round((20 * aLong) / 1024)),
    rC: Math.max(1, Math.round((30 * aLong) / 1024)),
    rDz: Math.max(1, Math.round((16 * dLong) / 512)),
  };
}

export interface BlurLevel { sigma: number; level: number; sigmaN: number; radius: number }

/** 섹션 5.6: n = max(1, floor(log2(σ/2))), σn = max(σ/2ⁿ, 0.5), r = min(12, ceil(3σn)) */
export function blurLevel(sigma: number): BlurLevel {
  const level = Math.max(1, Math.floor(Math.log2(sigma / 2)));
  const sigmaN = Math.max(sigma / 2 ** level, 0.5);
  return { sigma, level, sigmaN, radius: Math.min(12, Math.ceil(3 * sigmaN)) };
}

export interface HdfPlan { diag: number; core: BlurLevel; halo: BlurLevel; maxLevel: number }

/** 섹션 8.6: σc = 0.0035·D, σh = 0.022·D, D = sqrt(W²+H²) */
export function hdfPlan(full: Size): HdfPlan {
  const diag = Math.hypot(full.width, full.height);
  const core = blurLevel(0.0035 * diag);
  const halo = blurLevel(0.022 * diag);
  return { diag, core, halo, maxLevel: Math.max(core.level, halo.level) };
}

/** 피라미드 레벨 n 의 크기: L1 = ceil(R/2), Ln = ceil(L(n−1)/2) */
export function levelSize(R: Size, n: number): Size {
  let w = R.width, h = R.height;
  for (let i = 0; i < n; i++) { w = Math.ceil(w / 2); h = Math.ceil(h / 2); }
  return { width: w, height: h };
}

const frac = (x: number) => x - Math.floor(x);

/** 섹션 8.5 그레인 오프셋 (CPU double) */
export function grainOffset(seed: number): [number, number] {
  return [frac(seed * 0.754877666) * 1000, frac(seed * 0.569840291) * 1000];
}

/** 섹션 8.5: g0 = max(1, outLong/3000), scale = g0·(1 + 1.5·Sz/100) */
export function grainScaleFull(outLong: number, size: number): number {
  return Math.max(1, outLong / 3000) * (1 + (1.5 * size) / 100);
}

/** 미리보기: f = outLong/R_long, uGrainScale = max(0.5, scale/f) */
export function grainScalePreview(outLong: number, rLong: number, size: number): number {
  const f = outLong / rLong;
  return Math.max(0.5, grainScaleFull(outLong, size) / f);
}

/** 섹션 12: 패딩 P = ceil(3·σc_out) + 8 */
export function tilePadding(outFull: Size): number {
  return Math.ceil(3 * 0.0035 * Math.hypot(outFull.width, outFull.height)) + 8;
}
