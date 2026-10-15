// §3 RGB↔XYZ 행렬 유도(SMPTE RP 177) + §7 외부 LUT 입력 도메인 인코딩.

import { REF_TONE } from "./constants.mjs";
import { shaperEnc, srgbEnc, tone, toneCoeffs } from "./engine.mjs";

/** @typedef {[number, number, number]} Vec3 */
/** @typedef {[Vec3, Vec3, Vec3]} Mat3 */
/** @typedef {[number, number]} XY */
/** @typedef {"srgb-display" | "rec709-bt1886" | "fsh-v1" | "slog3-sgamut3cine"} LutInputDomain */

/** §3 원색표 (xy) */
export const PRIMARIES = Object.freeze({
  rec709: /** @type {[XY, XY, XY]} */ ([[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]]),
  sGamut3Cine: /** @type {[XY, XY, XY]} */ ([[0.766, 0.275], [0.225, 0.8], [0.089, -0.087]]),
});
/** §2 D65 */
export const WHITE_D65 = /** @type {XY} */ ([0.3127, 0.329]);

/** @param {Mat3} m @returns {Mat3} */
export function mat3Inverse(m) {
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
export function mat3Mul(m, n) {
  /** @type {Mat3} */
  const o = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r][c] = m[r][0] * n[0][c] + m[r][1] * n[1][c] + m[r][2] * n[2][c];
  return o;
}

/** @param {Mat3} m @param {ArrayLike<number>} v @returns {Vec3} */
export function mat3Apply(m, v) {
  const x = /** @type {number} */ (v[0]);
  const y = /** @type {number} */ (v[1]);
  const z = /** @type {number} */ (v[2]);
  return [m[0][0] * x + m[0][1] * y + m[0][2] * z, m[1][0] * x + m[1][1] * y + m[1][2] * z, m[2][0] * x + m[2][1] * y + m[2][2] * z];
}

/**
 * §3 M_RGB→XYZ = P·diag(S), S = P⁻¹·W
 * @param {[XY, XY, XY]} prim
 * @param {XY} white
 * @returns {Mat3}
 */
export function rgbToXyzMatrix(prim, white) {
  /** @type {Mat3} */
  const P = [
    [prim[0][0] / prim[0][1], prim[1][0] / prim[1][1], prim[2][0] / prim[2][1]],
    [1, 1, 1],
    [(1 - prim[0][0] - prim[0][1]) / prim[0][1], (1 - prim[1][0] - prim[1][1]) / prim[1][1], (1 - prim[2][0] - prim[2][1]) / prim[2][1]],
  ];
  const W = [white[0] / white[1], 1, (1 - white[0] - white[1]) / white[1]];
  const S = mat3Apply(mat3Inverse(P), W);
  return [
    [P[0][0] * S[0], P[0][1] * S[1], P[0][2] * S[2]],
    [P[1][0] * S[0], P[1][1] * S[1], P[1][2] * S[2]],
    [P[2][0] * S[0], P[2][1] * S[1], P[2][2] * S[2]],
  ];
}

const M709_TO_XYZ = rgbToXyzMatrix(PRIMARIES.rec709, WHITE_D65);
/** M_WS→S-Gamut3.Cine = (M_SG3C→XYZ)⁻¹ · M_709→XYZ */
export const M_WS_TO_SGAMUT3CINE = mat3Mul(mat3Inverse(rgbToXyzMatrix(PRIMARIES.sGamut3Cine, WHITE_D65)), M709_TO_XYZ);

const REF_K = toneCoeffs(REF_TONE);

/** §7 S-Log3 인코딩 (S-Gamut3.Cine 선형 → 코드값/1023) @param {number} xs */
function slog3Enc(xs) {
  return xs >= 0.01125 ? (420 + Math.log10((xs + 0.01) / 0.19) * 261.5) / 1023 : (xs * (171.2102946929 - 95)) / 0.01125 / 1023 + 95 / 1023;
}

/**
 * §7 외부 LUT 입력 도메인 인코딩: WS 선형 x → LUT 입력 좌표 u (범위 플래그·DOMAIN 정규화 전)
 * @param {LutInputDomain} domain
 * @param {ArrayLike<number>} x
 * @returns {Vec3}
 */
export function encodeLutInput(domain, x) {
  const x0 = /** @type {number} */ (x[0]);
  const x1 = /** @type {number} */ (x[1]);
  const x2 = /** @type {number} */ (x[2]);
  switch (domain) {
    case "srgb-display":
      return [srgbEnc(tone(x0, REF_K)), srgbEnc(tone(x1, REF_K)), srgbEnc(tone(x2, REF_K))];
    case "rec709-bt1886":
      return [Math.pow(tone(x0, REF_K), 1 / 2.4), Math.pow(tone(x1, REF_K), 1 / 2.4), Math.pow(tone(x2, REF_K), 1 / 2.4)];
    case "fsh-v1":
      return [shaperEnc(x0), shaperEnc(x1), shaperEnc(x2)];
    case "slog3-sgamut3cine": {
      const xs = mat3Apply(M_WS_TO_SGAMUT3CINE, [x0, x1, x2]);
      return [slog3Enc(xs[0]), slog3Enc(xs[1]), slog3Enc(xs[2])];
    }
  }
}
