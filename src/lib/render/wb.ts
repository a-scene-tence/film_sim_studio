// 섹션 8.3 / COLOR_SCIENCE §8.1 — 화이트밸런스 행렬 (Kang 2002 흑체 궤적, CIE1960 uv, 틴트 법선, Bradford).
export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

/** M_709→XYZ (RP177 유도, 섹션 8.3 고정값) */
export const M_709_TO_XYZ: Mat3 = [
  [0.412391, 0.357584, 0.180481],
  [0.212639, 0.715169, 0.072192],
  [0.019331, 0.119195, 0.950532],
];

const M_BRADFORD: Mat3 = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];

/** 3×3 역행렬 (여인수 공식) */
export function inv3(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

export function mul3(m: Mat3, n: Mat3): Mat3 {
  const e = (r: 0 | 1 | 2, c: 0 | 1 | 2) => m[r][0] * n[0][c] + m[r][1] * n[1][c] + m[r][2] * n[2][c];
  return [[e(0, 0), e(0, 1), e(0, 2)], [e(1, 0), e(1, 1), e(1, 2)], [e(2, 0), e(2, 1), e(2, 2)]];
}

export function apply3(m: Mat3, v: ArrayLike<number>): [number, number, number] {
  const x = v[0] ?? 0, y = v[1] ?? 0, z = v[2] ?? 0;
  return [m[0][0] * x + m[0][1] * y + m[0][2] * z, m[1][0] * x + m[1][1] * y + m[1][2] * z, m[2][0] * x + m[2][1] * y + m[2][2] * z];
}

export const IDENTITY3: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** 섹션 4.2-5: uniformMatrix3fv(loc, false, 열 우선 9개) */
export function colMajor(m: Mat3): Float32Array {
  return new Float32Array([m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]]);
}

type UV = [number, number];
function uvFromXy(x: number, y: number): UV {
  const d = -2 * x + 12 * y + 3;
  return [(4 * x) / d, (6 * y) / d];
}
function xyFromUv(u: number, v: number): [number, number] {
  const d = 2 * u - 8 * v + 4;
  return [(3 * u) / d, (2 * v) / d];
}
/** Kang/Kim 2002 흑체 궤적 → CIE1960 uv */
function locusUv(T: number): UV {
  const x = T <= 4000
    ? -0.2661239e9 / T ** 3 - 0.2343589e6 / T ** 2 + 0.8776956e3 / T + 0.17991
    : -3.0258469e9 / T ** 3 + 2.1070379e6 / T ** 2 + 0.2226347e3 / T + 0.24039;
  const y = T <= 2222
    ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
    : T <= 4000
      ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return uvFromXy(x, y);
}
const xyzFromXy = (x: number, y: number): [number, number, number] => [x / y, 1, (1 - x - y) / y];

const D65_XY: [number, number] = [0.3127, 0.329];

/** COLOR_SCIENCE §8.1 M_wb (709 선형 → 709 선형), temp·tint ∈ [−100, 100] */
export function wbMatrix(temp: number, tint: number): Mat3 {
  const Ts = Math.min(25000, Math.max(2000, 1e6 / (1e6 / 6504 - 0.9 * temp)));
  const d65 = uvFromXy(D65_XY[0], D65_XY[1]);
  const L = locusUv(Ts);
  const L0 = locusUv(6504);
  const a = locusUv(Ts + 10);
  const b = locusUv(Ts - 10);
  const tl = Math.hypot(a[0] - b[0], a[1] - b[1]);
  const t: UV = [(a[0] - b[0]) / tl, (a[1] - b[1]) / tl];
  let n: UV = [-t[1], t[0]];
  if (n[1] < 0) n = [-n[0], -n[1]];
  const us: UV = [d65[0] + L[0] - L0[0] + (tint / 100) * 0.02 * n[0], d65[1] + L[1] - L0[1] + (tint / 100) * 0.02 * n[1]];
  const [sx, sy] = xyFromUv(us[0], us[1]);
  const rs = apply3(M_BRADFORD, xyzFromXy(sx, sy));
  const rd = apply3(M_BRADFORD, xyzFromXy(D65_XY[0], D65_XY[1]));
  const D: Mat3 = [[rd[0] / rs[0], 0, 0], [0, rd[1] / rs[1], 0], [0, 0, rd[2] / rs[2]]];
  const cat = mul3(inv3(M_BRADFORD), mul3(D, M_BRADFORD));
  return mul3(inv3(M_709_TO_XYZ), mul3(cat, M_709_TO_XYZ));
}
