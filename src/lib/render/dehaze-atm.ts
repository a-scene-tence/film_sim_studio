// 섹션 5.7 / 8.4 — 대기광 A: tDzA(D 해상도, rgb = HDF 합성 후 WS, a = min(r,g,b)) 판독값에서 계산.
export type Vec3 = [number, number, number];

/** 비디오 첫 A 전 기본값 (섹션 10.6) */
export const DEFAULT_ATM: Vec3 = [0.9, 0.9, 0.9];

/**
 * 1. 어두운 채널 = min(r,g,b) (= 알파)  2. 7×7 최소 필터(가장자리 clamp)
 * 3. 값 상위 max(1, floor(0.001·N)) 픽셀의 rgb 평균  4. 채널별 max(A, 0.05)
 */
export function computeAtmosphere(rgba: ArrayLike<number>, width: number, height: number): Vec3 {
  const N = width * height;
  const dark = new Float32Array(N);
  for (let i = 0; i < N; i++) dark[i] = rgba[i * 4 + 3]!;
  // 분리형 7탭 최소 (가로 → 세로), 가장자리 clamp
  const tmp = new Float32Array(N);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = Infinity;
      for (let k = -3; k <= 3; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        const v = dark[y * width + xx]!;
        if (v < m) m = v;
      }
      tmp[y * width + x] = m;
    }
  }
  const mins = new Float32Array(N);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = Infinity;
      for (let k = -3; k <= 3; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        const v = tmp[yy * width + x]!;
        if (v < m) m = v;
      }
      mins[y * width + x] = m;
    }
  }
  const count = Math.max(1, Math.floor(0.001 * N));
  // 값 내림차순, 동률은 인덱스 오름차순 (결정론)
  const idx = new Uint32Array(N);
  for (let i = 0; i < N; i++) idx[i] = i;
  const order = Array.from(idx).sort((a, b) => (mins[b]! - mins[a]!) || a - b);
  let r = 0, g = 0, bl = 0;
  for (let k = 0; k < count; k++) {
    const i = order[k]!;
    r += rgba[i * 4]!;
    g += rgba[i * 4 + 1]!;
    bl += rgba[i * 4 + 2]!;
  }
  return [Math.max(r / count, 0.05), Math.max(g / count, 0.05), Math.max(bl / count, 0.05)];
}
