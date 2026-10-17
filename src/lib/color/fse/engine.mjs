// 앱 공용 색 수학 — docs/COLOR_SCIENCE.md §1, §2, §5, §6.1~§6.6 (T_ref 톤, 셰이퍼, OKLab, gamutMap, Tref⁻¹).
// 필름 색 커널(FSE-v2)은 scripts/fse2-kernel.mjs 에만 있다(Node 생성기 전용, 앱 번들 미포함).
// 수식 변경은 사용자 승인 후 버전을 올려서만 한다 (CLAUDE.md §0).

import {
  MID_IN,
  SHAPER_C,
  SHAPER_L,
  HUE_ANCHORS,
  HUE_SIGMA,
  GAMUT_KNEE,
  GAMUT_EPS,
  MAXCHROMA_ITERS,
  TONE_INV_ITERS,
  REF_TONE,
} from "./constants.mjs";

/** @typedef {[number, number, number]} Vec3 */
/** @typedef {{ a: number, d: number, hdrMax: number, midOut: number }} ToneParams */
/** @typedef {{ a: number, d: number, hdrMax: number, midOut: number, ad: number, b: number, c: number }} ToneCoeffs */
/**
 * FSE-v2 필름 메타데이터 (색 파라미터는 scripts/fse2-kernel.mjs SIMS2)
 * @typedef {object} FilmSim
 * @property {string} id
 * @property {"fujifilm" | "ricoh"} brand
 * @property {string} ko
 * @property {string} en
 * @property {boolean} mono
 */


/** §1 @param {number} x @param {number} a @param {number} b */
export function clamp(x, a, b) {
  return Math.min(b, Math.max(a, x));
}

/** §1 @param {number} e0 @param {number} e1 @param {number} x */
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** §1 @param {number} t */
export function wrap180(t) {
  return (((t % 360) + 540) % 360) - 180;
}

/** §2 @param {number} y */
export function srgbEnc(y) {
  return y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
}

/** §2 @param {number} v */
export function srgbDec(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** §5 enc(x) @param {number} x */
export function shaperEnc(x) {
  return Math.log2((Math.max(x, 0) + SHAPER_C) / SHAPER_C) / SHAPER_L;
}

/** §5 dec(u) @param {number} u */
export function shaperDec(u) {
  return SHAPER_C * (Math.pow(2, u * SHAPER_L) - 1);
}

/**
 * §6.1 톤 계수
 * @param {ToneParams} T
 * @returns {ToneCoeffs}
 */
export function toneCoeffs(T) {
  const { a, d, hdrMax, midOut } = T;
  const ad = a * d;
  const b = (Math.pow(hdrMax, a) - Math.pow(MID_IN, a) / midOut) / (Math.pow(hdrMax, ad) - Math.pow(MID_IN, ad));
  const c = Math.pow(hdrMax, a) - Math.pow(hdrMax, ad) * b;
  return Object.freeze({ a, d, hdrMax, midOut, ad, b, c });
}

const REF_K = toneCoeffs(REF_TONE);

/**
 * §6.1 tone(x)
 * @param {number} x
 * @param {ToneCoeffs} [k] 기본값 T_ref
 */
export function tone(x, k = REF_K) {
  if (x <= 0) return 0;
  if (x >= k.hdrMax) return 1;
  return Math.min(1, Math.pow(x, k.a) / (Math.pow(x, k.ad) * k.b + k.c));
}

/**
 * §4.11 Tref⁻¹ — [0, hdrMax] 이분법 48회
 * @param {number} d
 * @param {ToneCoeffs} [k] 기본값 T_ref
 */
export function toneInv(d, k = REF_K) {
  if (d <= 0) return 0;
  if (d >= 1) return k.hdrMax;
  let lo = 0;
  let hi = k.hdrMax;
  for (let i = 0; i < TONE_INV_ITERS; i++) {
    const m = (lo + hi) / 2;
    if (tone(m, k) < d) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * §6.3 선형 sRGB → OKLab
 * @param {ArrayLike<number>} rgb
 * @returns {Vec3}
 */
export function linToOklab(rgb) {
  const r = /** @type {number} */ (rgb[0]);
  const g = /** @type {number} */ (rgb[1]);
  const b = /** @type {number} */ (rgb[2]);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

/**
 * §6.3 OKLab → 선형 sRGB
 * @param {number} L
 * @param {number} a
 * @param {number} b
 * @returns {Vec3}
 */
export function oklabToLin(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** §6.6 inGamut @param {Vec3} v */
function inGamut(v) {
  for (let i = 0; i < 3; i++) {
    const c = /** @type {number} */ (v[i]);
    if (!(c >= -GAMUT_EPS && c <= 1 + GAMUT_EPS)) return false;
  }
  return true;
}

/**
 * §6.6 maxChroma — lo=0, hi=0.5 에서 24회 이분법, 결과 lo
 * @param {number} L
 * @param {number} hr 라디안
 */
export function maxChroma(L, hr) {
  const ch = Math.cos(hr);
  const sh = Math.sin(hr);
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < MAXCHROMA_ITERS; i++) {
    const m = (lo + hi) / 2;
    if (inGamut(oklabToLin(L, m * ch, m * sh))) lo = m;
    else hi = m;
  }
  return lo;
}

/** @param {Vec3} v @returns {Vec3} */
function clamp01v(v) {
  return [clamp(v[0], 0, 1), clamp(v[1], 0, 1), clamp(v[2], 0, 1)];
}

/**
 * §6.6 gamutMap (소프트 채도 압축) → 선형 sRGB [0,1]³
 * @param {number} L
 * @param {number} a
 * @param {number} b
 * @returns {Vec3}
 */
export function gamutMap(L, a, b) {
  L = clamp(L, 0, 1);
  const C = Math.hypot(a, b);
  if (C < 1e-9) return clamp01v(oklabToLin(L, 0, 0));
  const hr = Math.atan2(b, a);
  const Cm = maxChroma(L, hr);
  const t = GAMUT_KNEE * Cm;
  let Co;
  if (C > t) {
    const r = Cm - t;
    Co = r > 1e-9 ? t + r * Math.tanh((C - t) / r) : t;
  } else {
    Co = C;
  }
  return clamp01v(oklabToLin(L, Co * Math.cos(hr), Co * Math.sin(hr)));
}

/**
 * §6.4 정규화된 색상 앵커 가중치 w_i
 * @param {number} h 도
 * @returns {number[]}
 */
export function hueWeights(h) {
  const raw = HUE_ANCHORS.map((H) => {
    const d = Math.abs(wrap180(h - H)) / HUE_SIGMA;
    return Math.exp(-0.5 * d * d);
  });
  let sum = 0;
  for (const v of raw) sum += v;
  return raw.map((v) => v / sum);
}
