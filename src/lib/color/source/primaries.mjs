// docs/COLOR_SCIENCE.md §3 — RGB↔XYZ 행렬 (SMPTE RP 177 유도). 외부 의존성 없음.

/** @typedef {[number, number]} XY */
/** @typedef {[number, number, number]} Vec3 */
/** @typedef {[Vec3, Vec3, Vec3]} Mat3 */
/** @typedef {"srgb" | "display-p3" | "adobe-rgb" | "rec2020" | "s-gamut3-cine" | "s-gamut3" | "cinema-gamut" | "v-gamut" | "d-gamut" | "f-gamut-c"} PrimariesId */

/** §3 원색표 (xy). 백색은 전부 D65. */
export const PRIMARY_TABLE = Object.freeze({
  srgb: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]],
  "display-p3": [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]],
  "adobe-rgb": [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]],
  rec2020: [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]],
  "s-gamut3-cine": [[0.766, 0.275], [0.225, 0.8], [0.089, -0.087]],
  "s-gamut3": [[0.73, 0.28], [0.14, 0.855], [0.1, -0.05]],
  "cinema-gamut": [[0.74, 0.27], [0.17, 1.14], [0.08, -0.1]],
  "v-gamut": [[0.73, 0.28], [0.165, 0.84], [0.1, -0.03]],
  "d-gamut": [[0.71, 0.31], [0.21, 0.88], [0.09, -0.08]],
  "f-gamut-c": [[0.7347, 0.2653], [0.0263, 0.9737], [0.1173, -0.0224]],
});

/** D65 백색 (§2) */
export const WHITE_D65 = /** @type {XY} */ ([0.3127, 0.329]);

/** 3×3 역행렬 (여인수 공식) @param {Mat3} m @returns {Mat3} */
export function inv3(m) {
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

/** @param {Mat3} m @param {Mat3} n @returns {Mat3} */
export function mul3(m, n) {
  /** @type {Mat3} */
  const o = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r][c] = m[r][0] * n[0][c] + m[r][1] * n[1][c] + m[r][2] * n[2][c];
  return o;
}

/** @param {Mat3} m @param {ArrayLike<number>} v @returns {Vec3} */
export function apply3(m, v) {
  const x = /** @type {number} */ (v[0]);
  const y = /** @type {number} */ (v[1]);
  const z = /** @type {number} */ (v[2]);
  return [m[0][0] * x + m[0][1] * y + m[0][2] * z, m[1][0] * x + m[1][1] * y + m[1][2] * z, m[2][0] * x + m[2][1] * y + m[2][2] * z];
}

/**
 * M_RGB→XYZ = P·diag(S), S = P⁻¹·W
 * @param {ReadonlyArray<XY>} prim
 * @param {XY} [white]
 * @returns {Mat3}
 */
export function rgbToXyz(prim, white = WHITE_D65) {
  /** @type {Mat3} */
  const P = [[0, 0, 0], [1, 1, 1], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    const [x, y] = /** @type {XY} */ (prim[i]);
    P[0][i] = x / y;
    P[2][i] = (1 - x - y) / y;
  }
  const W = /** @type {Vec3} */ ([white[0] / white[1], 1, (1 - white[0] - white[1]) / white[1]]);
  const S = apply3(inv3(P), W);
  return [
    [P[0][0] * S[0], P[0][1] * S[1], P[0][2] * S[2]],
    [P[1][0] * S[0], P[1][1] * S[1], P[1][2] * S[2]],
    [P[2][0] * S[0], P[2][1] * S[1], P[2][2] * S[2]],
  ];
}

/** M_709→XYZ */
export const M_709_TO_XYZ = rgbToXyz(PRIMARY_TABLE.srgb);

/**
 * M_src→WS = (M_709→XYZ)⁻¹ · M_src→XYZ
 * @param {PrimariesId} primaries
 * @returns {Mat3}
 */
export function matrixToWS(primaries) {
  const prim = PRIMARY_TABLE[primaries];
  if (!prim) throw new Error(`알 수 없는 원색: ${primaries}`);
  return mul3(inv3(M_709_TO_XYZ), rgbToXyz(prim));
}
