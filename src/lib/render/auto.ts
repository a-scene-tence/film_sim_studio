// 섹션 9.3 자동 보정 / COLOR_SCIENCE §12 — S0 직후 긴 변 256px 프록시에서 사용자 슬라이더 값을 계산한다.
import { linToOklab } from "../color/fse/engine.mjs";
import { toWorkingSpaceBuffer } from "../color/source/normalize.mjs";
import type { MediaAsset } from "../media-loader";
import { ZERO_ADJUST, type Adjust } from "./params";
import { apply3, wbMatrix } from "./wb";

const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** 장축 ≤ 256 표본 격자 (각 출력 칸의 중심 텍셀) */
function sample256(src: { width: number; height: number; data: Float32Array }): Float32Array {
  const L = Math.max(src.width, src.height);
  const s = Math.min(1, 256 / L);
  const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor(((y + 0.5) * src.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor(((x + 0.5) * src.width) / w));
      out.set(src.data.subarray((sy * src.width + sx) * 4, (sy * src.width + sx) * 4 + 4), (y * w + x) * 4);
    }
  }
  return out;
}

function quantile(sorted: Float64Array, q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i]!;
}

export interface AutoResult { adjust: Adjust; report: string[] }

/** sourceLut 는 samsunglog/dlogm 일 때 필요하다 (없으면 예외) */
export function computeAuto(asset: Pick<MediaAsset, "proxy" | "descriptor">, sourceLut?: { size: number; data: Float32Array }): AutoResult {
  const src = sample256(asset.proxy);
  const ws = new Float32Array(src.length);
  toWorkingSpaceBuffer(src, ws, asset.descriptor, sourceLut);
  const n = ws.length / 4;
  const Y = new Float64Array(n);
  let sumLn = 0;
  for (let i = 0; i < n; i++) {
    const y = Math.max(LUMA[0] * ws[i * 4]! + LUMA[1] * ws[i * 4 + 1]! + LUMA[2] * ws[i * 4 + 2]!, 1e-6);
    Y[i] = y;
    sumLn += Math.log(y);
  }
  const logAvg = Math.exp(sumLn / n);
  const EV = Math.min(2, Math.max(-2, 0.8 * Math.log2(0.18 / logAvg)));
  const g = Math.pow(2, EV);
  const sorted = Float64Array.from(Y, (y) => y * g).sort();
  const p995 = quantile(sorted, 0.995);
  const p2 = quantile(sorted, 0.02);
  const adjust: Adjust = { ...ZERO_ADJUST, exposure: Math.round(EV * 100) / 100, vibrance: 15 };
  const report = [`logAvg ${logAvg.toFixed(4)}, EV ${EV.toFixed(2)}, p99.5 ${p995.toFixed(3)}, p2 ${p2.toFixed(4)}`];
  if (p995 > 2.04) adjust.highlights = Math.round(-Math.min(60, Math.max(0, 40 * Math.log2(p995 / 2.04))));
  const black = 0.18 * 2 ** -5;
  if (p2 < black) adjust.shadows = Math.round(Math.min(50, Math.max(0, 20 * Math.log2(black / Math.max(p2, 1e-12)))));
  // WB: 무채색 후보(OKLab C < 0.08, 0.05 < Y < 0.9) 가 1% 이상이면 격자 탐색
  let cnt = 0;
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const rgb = [ws[i * 4]! * g, ws[i * 4 + 1]! * g, ws[i * 4 + 2]! * g];
    const y = Y[i]! * g;
    if (!(y > 0.05 && y < 0.9)) continue;
    const [, a, b] = linToOklab(rgb);
    if (Math.hypot(a, b) >= 0.08) continue;
    cnt++;
    s0 += rgb[0]!; s1 += rgb[1]!; s2 += rgb[2]!;
  }
  if (cnt >= 0.01 * n && cnt > 0) {
    const mean = [s0 / cnt, s1 / cnt, s2 / cnt];
    let best = { e: Infinity, t: 0, n: 0 };
    for (let t = -100; t <= 100; t += 2) {
      for (let k = -100; k <= 100; k += 2) {
        const [, a, b] = linToOklab(apply3(wbMatrix(t, k), mean));
        const e = a * a + b * b;
        if (e < best.e || (e === best.e && Math.abs(t) + Math.abs(k) < Math.abs(best.t) + Math.abs(best.n))) best = { e, t, n: k };
      }
    }
    adjust.temp = best.t;
    adjust.tint = best.n;
    report.push(`WB 후보 ${cnt}/${n}px → 색온도 ${best.t}, 틴트 ${best.n}`);
  } else {
    report.push(`WB 후보 부족 (${cnt}/${n}px) — 색온도·틴트 0`);
  }
  return { adjust, report };
}
