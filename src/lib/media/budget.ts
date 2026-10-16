/** 10.4 메모리 예산 (메인에서 계산해 워커에 전달) */
export interface Budget { budgetBytes: number; isIOS: boolean; isAndroid: boolean }

export function computeBudget(ua: string, platform: string, maxTouchPoints: number): Budget {
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const MB = 2 ** 20;
  return { isIOS, isAndroid, budgetBytes: isIOS ? 320 * MB : isAndroid ? 448 * MB : 1024 * MB };
}

export function getBudget(): Budget {
  const n = typeof navigator !== "undefined" ? navigator : undefined;
  return computeBudget(n?.userAgent ?? "", n?.platform ?? "", n?.maxTouchPoints ?? 0);
}

/** 이미지: 2×W×H×4 > budget/2 이면 축소 디코드 */
export function needsReducedDecode(w: number, h: number, budgetBytes: number): boolean {
  return 2 * w * h * 4 > budgetBytes / 2;
}

/** 풀해상도 RAW: W×H×14 ≤ 예산 */
export function rawFullFits(w: number, h: number, budgetBytes: number): boolean {
  return w * h * 14 <= budgetBytes;
}
