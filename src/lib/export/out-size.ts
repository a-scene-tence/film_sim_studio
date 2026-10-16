// Step 4 §10-2 출력 크기 outSize(W, H, opt)
export type SizeOption = "full" | 4096 | 2048;

export function outSize(W: number, H: number, opt: SizeOption): { width: number; height: number } {
  if (opt === "full") return { width: W, height: H };
  const m = Math.max(W, H);
  if (m <= opt) return { width: W, height: H };
  const s = opt / m;
  return W >= H ? { width: opt, height: Math.max(1, Math.round(H * s)) } : { width: Math.max(1, Math.round(W * s)), height: opt };
}
