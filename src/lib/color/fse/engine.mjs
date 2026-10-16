// FSE-v1 필름 엔진 — docs/COLOR_SCIENCE.md §1, §2, §5, §6 를 연산 순서·반복 횟수 그대로 구현한다.
// 수식 변경은 사용자 승인 후 FSE-v2 로만 한다 (CLAUDE.md §0).

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
 * @typedef {object} FilmSim
 * @property {string} id
 * @property {"fujifilm" | "ricoh"} brand
 * @property {string} ko
 * @property {string} en
 * @property {boolean} mono
 * @property {ToneParams} tone
 * @property {number} [sat]
 * @property {ReadonlyArray<ReadonlyArray<number>>} [hue]
 * @property {ReadonlyArray<number>} [desat]
 * @property {ReadonlyArray<number>} [mixer]
 * @property {{ shadow: ReadonlyArray<number>, highlight: ReadonlyArray<number> } | null} split
 * @property {ReadonlyArray<number> | null} tint
 * @property {ReadonlyArray<number>} fade
 * @property {Readonly<Record<string, unknown>>} shaderHints
 */

const DEG = Math.PI / 180;

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

/**
 * §6.5 splitTone + tint (L 은 변경하지 않는다)
 * @param {FilmSim} P
 * @param {number} L
 * @param {number} a
 * @param {number} b
 * @returns {[number, number]}
 */
function splitAndTint(P, L, a, b) {
  if (P.split !== null) {
    const sh = /** @type {number} */ (P.split.shadow[0]);
    const sc = /** @type {number} */ (P.split.shadow[1]);
    const hh = /** @type {number} */ (P.split.highlight[0]);
    const hc = /** @type {number} */ (P.split.highlight[1]);
    const ms = 1 - smoothstep(0.15, 0.55, L);
    const mh = smoothstep(0.45, 0.95, L);
    a += sc * Math.cos(sh * DEG) * ms + hc * Math.cos(hh * DEG) * mh;
    b += sc * Math.sin(sh * DEG) * ms + hc * Math.sin(hh * DEG) * mh;
  }
  if (P.tint !== null) {
    const th = /** @type {number} */ (P.tint[0]);
    const tc = /** @type {number} */ (P.tint[1]);
    const m = smoothstep(0, 0.25, L) * (1 - smoothstep(0.85, 1.0, L));
    a += tc * Math.cos(th * DEG) * m;
    b += tc * Math.sin(th * DEG) * m;
  }
  return [a, b];
}

/**
 * §6 renderPoint — WS 선형(≥0) → sRGB 인코딩 [0,1]³
 * @param {ArrayLike<number>} x
 * @param {FilmSim} P
 * @param {ToneCoeffs} k toneCoeffs(P.tone)
 * @returns {Vec3}
 */
export function renderPoint(x, P, k) {
  const x0 = /** @type {number} */ (x[0]);
  const x1 = /** @type {number} */ (x[1]);
  const x2 = /** @type {number} */ (x[2]);
  let L;
  let a;
  let b;
  if (P.mono) {
    const mx = /** @type {ReadonlyArray<number>} */ (P.mixer);
    const Y = /** @type {number} */ (mx[0]) * x0 + /** @type {number} */ (mx[1]) * x1 + /** @type {number} */ (mx[2]) * x2;
    const y = tone(Y, k);
    [L, a, b] = linToOklab([y, y, y]);
  } else {
    [L, a, b] = linToOklab([tone(x0, k), tone(x1, k), tone(x2, k)]);
    // §6.4 colorOps
    const hue = /** @type {ReadonlyArray<ReadonlyArray<number>>} */ (P.hue);
    const desat = /** @type {ReadonlyArray<number>} */ (P.desat);
    const sat = /** @type {number} */ (P.sat);
    const C = Math.hypot(a, b);
    let h = Math.atan2(b, a) / DEG;
    if (h < 0) h += 360;
    const w = hueWeights(h);
    let dh = 0;
    let g = 0;
    let dl = 0;
    for (let i = 0; i < w.length; i++) {
      const wi = /** @type {number} */ (w[i]);
      const row = /** @type {ReadonlyArray<number>} */ (hue[i]);
      dh += wi * /** @type {number} */ (row[0]);
      g += wi * /** @type {number} */ (row[1]);
      dl += wi * /** @type {number} */ (row[2]);
    }
    const wc = smoothstep(0, 0.06, C);
    const h2 = h + dh * wc;
    const C2 = Math.max(
      0,
      C *
        g *
        sat *
        (1 - /** @type {number} */ (desat[0]) * smoothstep(0.88, 1.0, L)) *
        (1 - /** @type {number} */ (desat[1]) * (1 - smoothstep(0.0, 0.3, L))),
    );
    L = L + dl * wc;
    a = C2 * Math.cos(h2 * DEG);
    b = C2 * Math.sin(h2 * DEG);
  }
  [a, b] = splitAndTint(P, L, a, b);
  const rgb = gamutMap(L, a, b);
  const f0 = /** @type {number} */ (P.fade[0]);
  const f1 = /** @type {number} */ (P.fade[1]);
  return [
    clamp(f0 + (f1 - f0) * srgbEnc(rgb[0]), 0, 1),
    clamp(f0 + (f1 - f0) * srgbEnc(rgb[1]), 0, 1),
    clamp(f0 + (f1 - f0) * srgbEnc(rgb[2]), 0, 1),
  ];
}
