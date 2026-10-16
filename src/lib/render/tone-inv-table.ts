// 섹션 8.1 — table[i] = toneInv((i/4095)^2.4), i = 0..4095 (FSE engine.mjs toneInv, 48회 이분법). 앱 수명 동안 1회 생성.
import { toneInv } from "../color/fse/engine.mjs";

export const TONE_INV_N = 4096;
let table: Float32Array | null = null;

export function toneInvTable(): Float32Array {
  if (table) return table;
  const t = new Float32Array(TONE_INV_N);
  for (let i = 0; i < TONE_INV_N; i++) t[i] = toneInv(Math.pow(i / (TONE_INV_N - 1), 2.4));
  table = t;
  return t;
}
