// Step 4 §10-6 예상 용량
export type PhotoFormat = "jpeg" | "png";
const GAMMA: Record<PhotoFormat, number> = { jpeg: 0.9, png: 0.95 };

/** est = round(bytesProxy·(N_out/N_proxy)^γ) + exifLen */
export function estimateBytes(bytesProxy: number, nProxy: number, nOut: number, format: PhotoFormat, exifLen: number): number {
  return Math.round(bytesProxy * Math.pow(nOut / nProxy, GAMMA[format])) + exifLen;
}

/** kb = round(b/1000): kb < 1000 이면 "약 N KB"(최소 1), 아니면 "약 X.X MB" */
export function fmtBytes(b: number): string {
  const kb = Math.round(b / 1000);
  return kb < 1000 ? `약 ${Math.max(1, kb)} KB` : `약 ${(b / 1e6).toFixed(1)} MB`;
}

/** 완료 카드의 실제 크기 (§12-1): 1e6 이상이면 "X.XX MB", 미만이면 "N KB" */
export function fmtActualBytes(b: number): string {
  return b >= 1e6 ? `${(b / 1e6).toFixed(2)} MB` : `${Math.round(b / 1e3)} KB`;
}

export interface MemoryPlan { need: number; fits: boolean }

/** §10-4 (1) 메모리 검사: need > 0.8·budget 이면 저장 불가 */
export function photoMemoryPlan(W: number, H: number, W2: number, H2: number, est: number, budgetBytes: number): MemoryPlan {
  const need = W2 === W ? W * H * 4 * 2 + est : W * 1024 * 4 + W2 * H2 * 4 * 2 + est;
  return { need, fits: need <= 0.8 * budgetBytes };
}
