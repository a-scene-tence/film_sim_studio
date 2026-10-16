import { srgbDec, srgbEnc } from "../color/fse/engine.mjs";

/** 10.3 목표 크기: 장축 ≤ 2048 이면 그대로, 아니면 장축 정확히 2048 */
export function proxySize(W: number, H: number, limit = 2048): { width: number; height: number } {
  const L = Math.max(W, H);
  if (L <= limit) return { width: W, height: H };
  const s = limit / L;
  const w = W >= H ? limit : Math.max(1, Math.round(W * s));
  const h = H > W ? limit : Math.max(1, Math.round(H * s));
  return { width: w, height: h };
}

export type ResampleMode = "srgb-image" | "linear";

/**
 * 10.3 영역 평균 축소 (스트리밍). 입력 행(표시 방향, RGB 0~1)은 getRow 로 한 줄씩 받는다.
 * 추가 메모리: 출력 버퍼 + 입력 1행 가로 축소본. 출력은 RGBA(A=1).
 */
export function resampleRows(
  W: number, H: number, w: number, h: number, mode: ResampleMode,
  getRow: (y: number, row: Float32Array) => void,
): Float32Array {
  const out = new Float32Array(w * h * 4);
  const row = new Float32Array(W * 3);
  const srgb = mode === "srgb-image";
  const identity = w === W && h === H;
  const decode = srgb && !identity;
  const sx = W / w;
  const sy = H / h;
  const hrow = new Float32Array(w * 3);
  for (let j = 0; j < H; j++) {
    getRow(j, row);
    if (decode) for (let k = 0; k < row.length; k++) row[k] = srgbDec(row[k]!);
    // 가로 축소
    if (w === W) hrow.set(row);
    else {
      for (let i = 0; i < w; i++) {
        const a = i * sx, b = (i + 1) * sx;
        let r = 0, g = 0, bl = 0;
        for (let x = Math.floor(a); x < Math.min(W, Math.ceil(b)); x++) {
          const wt = Math.max(0, Math.min(x + 1, b) - Math.max(x, a));
          r += wt * row[x * 3]!; g += wt * row[x * 3 + 1]!; bl += wt * row[x * 3 + 2]!;
        }
        hrow[i * 3] = r / sx; hrow[i * 3 + 1] = g / sx; hrow[i * 3 + 2] = bl / sx;
      }
    }
    // 세로 누적: 입력 행 j 가 기여하는 출력 행 i
    for (let i = Math.floor(j / sy); i < Math.min(h, Math.ceil((j + 1) / sy)); i++) {
      const wt = Math.max(0, Math.min(j + 1, (i + 1) * sy) - Math.max(j, i * sy));
      if (wt <= 0) continue;
      const f = wt / sy;
      let o = i * w * 4;
      for (let x = 0; x < w; x++, o += 4) {
        out[o] = out[o]! + f * hrow[x * 3]!;
        out[o + 1] = out[o + 1]! + f * hrow[x * 3 + 1]!;
        out[o + 2] = out[o + 2]! + f * hrow[x * 3 + 2]!;
      }
    }
  }
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    if (decode) { out[o] = srgbEnc(out[o]!); out[o + 1] = srgbEnc(out[o + 1]!); out[o + 2] = srgbEnc(out[o + 2]!); }
    out[o + 3] = 1;
  }
  return out;
}

/** 메모리 내 RGBA(또는 임의 stride) 배열용 편의 함수 (테스트·소형 입력). 입력 channels 는 1 또는 3 또는 4. */
export function resampleArray(src: ArrayLike<number>, W: number, H: number, w: number, h: number, channels: number, mode: ResampleMode): Float32Array {
  return resampleRows(W, H, w, h, mode, (y, row) => {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * channels;
      row[x * 3] = src[i]!;
      row[x * 3 + 1] = channels >= 3 ? src[i + 1]! : src[i]!;
      row[x * 3 + 2] = channels >= 3 ? src[i + 2]! : src[i]!;
    }
  });
}
