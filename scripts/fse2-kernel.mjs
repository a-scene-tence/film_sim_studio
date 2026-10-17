// scripts/fse2-kernel.mjs — FSE-v2 필름 색 커널 (3D LUT 전용: 염료 간섭 · 3차원 색회전 · 색분리)
// 톤(대비·하이라이트·쉐도우·커브)은 이 커널에 없다. 모든 필름이 같은 T_ref 톤 하나만 쓰고, 톤 성격은 FILM_PRESETS 슬라이더가 담당한다.
export const SH_C = 0.00140625;
export const SH_XMAX = 16;
export const SH_L = Math.log2((SH_XMAX + SH_C) / SH_C);
export const shaperEnc = (x) => Math.log2((Math.max(x, 0) + SH_C) / SH_C) / SH_L;
export const shaperDec = (u) => SH_C * (Math.pow(2, u * SH_L) - 1);
export const TREF = { a: 1.3, ad: 1.196, b: 0.884006171, c: 0.452670345, hdrMax: 2.04 };
export function toneRef(x) {
  if (x <= 0) return 0;
  if (x >= TREF.hdrMax) return 1;
  return Math.min(1, Math.pow(x, TREF.a) / (Math.pow(x, TREF.ad) * TREF.b + TREF.c));
}
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const srgbEnc = (y) => (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
export function linToOklab([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_, 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_, 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_];
}
export function oklabToLin([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (c) => c[0] >= -1e-6 && c[1] >= -1e-6 && c[2] >= -1e-6 && c[0] <= 1 + 1e-6 && c[1] <= 1 + 1e-6 && c[2] <= 1 + 1e-6;
export function gamutMap([L, a, b]) {
  L = clamp(L, 0, 1);
  const C = Math.hypot(a, b);
  if (C < 1e-9) return oklabToLin([L, 0, 0]).map((v) => clamp(v, 0, 1));
  const h = Math.atan2(b, a), ca = Math.cos(h), sb = Math.sin(h);
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 24; i++) { const m = 0.5 * (lo + hi); if (inGamut(oklabToLin([L, m * ca, m * sb]))) lo = m; else hi = m; }
  const t = 0.85 * lo; let Co = C;
  if (C > t) { const r = lo - t; Co = r > 1e-9 ? t + r * Math.tanh((C - t) / r) : t; }
  return oklabToLin([L, Co * ca, Co * sb]).map((v) => clamp(v, 0, 1));
}
export const LUMA = [0.2126, 0.7152, 0.0722];
export function clipNegLum(x) {
  const n = Math.min(x[0], x[1], x[2]);
  if (n >= 0) return x.slice();
  const Y = LUMA[0] * x[0] + LUMA[1] * x[1] + LUMA[2] * x[2];
  if (Y <= 0) return [0, 0, 0];
  const t = Y / (Y - n);
  return x.map((v) => Y + t * (v - Y));
}
export const HUE_ANCHORS = [29, 60, 110, 142, 195, 264, 300, 328]; // R, O(피부), Y, G, C, B, P, M — OKLab 색상각(도)
export const HUE_SIGMA = 22;
export function hueWeights(hDeg) {
  const w = HUE_ANCHORS.map((ha) => { const d = Math.abs((((hDeg - ha) % 360) + 540) % 360 - 180); return Math.exp(-0.5 * (d / HUE_SIGMA) * (d / HUE_SIGMA)); });
  const s = w[0] + w[1] + w[2] + w[3] + w[4] + w[5] + w[6] + w[7];
  return w.map((v) => v / s);
}
export const tau = (L) => clamp((L - 0.55) / 0.30, -1, 1); // −1 = 암부, +1 = 명부
const DEG = Math.PI / 180;
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const N = [0, 0, 1, 0];
// hue 행: [기본 색상 회전(도), 명부-암부 기울기(도), 채도 배율, 명도 오프셋] — 앵커 순서 R, O, Y, G, C, B, P, M
export const SIMS2 = {
  // ---------------- FUJIFILM (20) ----------------
  // PROVIA: 기준 렌더링. 염료 간섭 없음, 녹색 −2°, 하늘 채도 1.04, 피부 명부만 +1° 따뜻하게
  'fuji-provia': { mono: false, dye: I3,
    hue: [[0, 0, 1.00, 0], [0, 1, 1.00, 0], [0, 0, 1.00, 0], [-2, 0, 1.02, 0], [0, 0, 1.00, 0], [0, 0, 1.04, 0], N, N], desat: [0.30, 0.20], split: null },
  // Velvia: 음의 염료 간섭(층간 효과)으로 원색 분리 강화, 레드→마젠타, 하늘 청색 밀도(명도 −0.05)
  'fuji-velvia': { mono: false, dye: [[1.06, -0.04, -0.02], [-0.03, 1.05, -0.02], [-0.02, -0.04, 1.06]],
    hue: [[-3, -2, 1.12, -0.02], [-2, 0, 1.06, 0], [0, 2, 1.10, 0], [-4, 0, 1.15, -0.02], [4, 0, 1.10, -0.02], [4, -2, 1.15, -0.05], [0, 0, 1.08, 0], [0, 0, 1.10, 0]], desat: [0.25, 0.10], split: null },
  // ASTIA: 약한 양의 간섭으로 부드러운 혼색, 피부 채도 0.98 + 명도 +0.01, 하늘 1.12
  'fuji-astia': { mono: false, dye: [[0.98, 0.02, 0.00], [0.01, 0.98, 0.01], [0.00, 0.02, 0.98]],
    hue: [[0, 0, 1.04, 0], [1, 1, 0.98, 0.01], [0, 0, 1.00, 0], [-2, 0, 1.05, 0], [0, 0, 1.02, 0], [0, -2, 1.12, -0.02], N, N], desat: [0.35, 0.20], split: null },
  // Classic Chrome: 양의 간섭(인쇄물 같은 채도 억제), 레드→벽돌색(+6°), 녹색→올리브(−10°, 0.72), 하늘→시안(−10°), 암부 시안·명부 웜 분리
  'fuji-classic-chrome': { mono: false, dye: [[0.94, 0.04, 0.02], [0.03, 0.94, 0.03], [0.02, 0.05, 0.93]],
    hue: [[6, 2, 0.90, -0.02], [2, 0, 0.92, 0], [-6, -2, 0.80, -0.02], [-10, 0, 0.72, -0.02], [-6, 0, 0.88, 0], [-10, 2, 0.80, -0.01], [-6, 0, 0.80, 0], [-4, 0, 0.82, 0]], desat: [0.35, 0.25],
    split: { shadow: [200, 0.008], highlight: [75, 0.006] } },
  // REALA ACE: 약한 음의 간섭으로 맑은 원색 밀도, 레드·블루 채도 1.06, 색회전 최소
  'fuji-reala-ace': { mono: false, dye: [[1.03, -0.02, -0.01], [-0.015, 1.03, -0.015], [-0.01, -0.02, 1.03]],
    hue: [[0, 0, 1.06, -0.01], [0, 0, 1.00, 0], [0, 0, 1.02, 0], [-2, 0, 1.04, -0.01], [0, 0, 1.03, 0], [0, 0, 1.06, -0.02], [0, 0, 1.02, 0], [0, 0, 1.03, 0]], desat: [0.25, 0.15], split: null },
  // PRO Neg. Hi: 약한 양의 간섭, 피부 명부 +1°, 전반 채도 0.92~1.00
  'fuji-pro-neg-hi': { mono: false, dye: [[0.98, 0.015, 0.005], [0.01, 0.98, 0.01], [0.005, 0.015, 0.98]],
    hue: [[2, 0, 0.95, 0], [2, 1, 0.96, 0.01], [0, 0, 0.95, 0], [-2, 0, 0.92, 0], [0, 0, 0.95, 0], [0, 0, 1.00, 0], [0, 0, 0.95, 0], [0, 0, 0.95, 0]], desat: [0.35, 0.20], split: null },
  // PRO Neg. Std: 양의 간섭으로 차분한 혼색, 녹색 +4°(청록 쪽), 암부 약한 청록
  'fuji-pro-neg-std': { mono: false, dye: [[0.97, 0.02, 0.01], [0.015, 0.97, 0.015], [0.01, 0.02, 0.97]],
    hue: [[3, 0, 0.90, 0], [2, 1, 0.94, 0.01], [0, 0, 0.88, 0], [4, 0, 0.85, 0], [0, 0, 0.90, 0], [0, 0, 0.94, 0], [0, 0, 0.88, 0], [0, 0, 0.88, 0]], desat: [0.35, 0.25],
    split: { shadow: [190, 0.006], highlight: [75, 0.000] } },
  // Classic Neg.: R−G 음의 간섭, 녹색→청록(+14°, 암부 +20°/명부 +8°), 피부·레드 명부 코랄 회전(+6°), 암부 시안-그린(185°, 0.020)·명부 코랄-앰버(62°, 0.014)
  'fuji-classic-neg': { mono: false, dye: [[1.04, -0.06, 0.02], [-0.02, 1.04, -0.02], [0.03, -0.06, 1.03]],
    hue: [[-4, 6, 1.00, -0.02], [0, 6, 0.96, 0], [-10, 4, 0.85, 0], [14, -6, 0.80, -0.02], [4, -4, 0.88, 0], [-8, 0, 0.86, -0.01], [0, 0, 0.85, 0], [-4, 0, 0.95, 0]], desat: [0.30, 0.20],
    split: { shadow: [185, 0.020], highlight: [62, 0.014] } },
  // Nostalgic Neg.: 청색 채널에 녹색 혼입(따뜻한 바탕), 피부 명부 +3° 앰버, 명부 골든 앰버 분리(78°, 0.024), 암부 채도 유지(desat −0.10)
  'fuji-nostalgic-neg': { mono: false, dye: [[1.02, 0.00, -0.02], [0.01, 1.00, -0.01], [-0.01, 0.03, 0.98]],
    hue: [[3, 0, 1.00, 0], [3, 3, 1.03, 0.01], [-3, -2, 1.02, 0], [-6, 0, 0.88, 0], [0, 0, 0.90, 0], [-4, 0, 0.92, 0], [0, 0, 0.90, 0], [0, 0, 0.95, 0]], desat: [0.25, -0.10],
    split: { shadow: [40, 0.005], highlight: [78, 0.024] } },
  // ETERNA: 양의 간섭(저채도 시네마), 녹색 +6°(암부 +8°), 암부 청록 분리
  'fuji-eterna': { mono: false, dye: [[0.95, 0.03, 0.02], [0.02, 0.95, 0.03], [0.02, 0.04, 0.94]],
    hue: [[2, 0, 0.85, 0], [2, 0, 0.88, 0], [-4, 0, 0.80, 0], [6, -2, 0.75, 0], [0, 0, 0.85, 0], [-6, 0, 0.85, 0], [0, 0, 0.80, 0], [0, 0, 0.80, 0]], desat: [0.35, 0.25],
    split: { shadow: [200, 0.012], highlight: [80, 0.006] } },
  // ETERNA Bleach Bypass: 강한 양의 간섭(은 잔류 탈색), 녹색 0.90, 강한 명부·암부 탈색
  'fuji-eterna-bleach-bypass': { mono: false, dye: [[0.92, 0.05, 0.03], [0.04, 0.92, 0.04], [0.03, 0.05, 0.92]],
    hue: [N, N, N, [0, 0, 0.90, 0], N, N, N, N], desat: [0.40, 0.30],
    split: { shadow: [210, 0.006], highlight: [75, 0.000] } },
  // ACROS / Monochrome: 필터별 채널 혼합만 담당(톤 차이는 FILM_PRESETS). Ye·R·G 필터 혼합비는 각 행 참고
  'fuji-acros': { mono: true, mixer: [0.2126, 0.7152, 0.0722], split: null, tint: null },
  'fuji-acros-ye': { mono: true, mixer: [0.32, 0.64, 0.04], split: null, tint: null },
  'fuji-acros-r': { mono: true, mixer: [0.52, 0.44, 0.04], split: null, tint: null },
  'fuji-acros-g': { mono: true, mixer: [0.16, 0.78, 0.06], split: null, tint: null },
  'fuji-monochrome': { mono: true, mixer: [0.2126, 0.7152, 0.0722], split: null, tint: null },
  'fuji-monochrome-ye': { mono: true, mixer: [0.32, 0.64, 0.04], split: null, tint: null },
  'fuji-monochrome-r': { mono: true, mixer: [0.52, 0.44, 0.04], split: null, tint: null },
  'fuji-monochrome-g': { mono: true, mixer: [0.16, 0.78, 0.06], split: null, tint: null },
  // Sepia: 표준 혼합 + 68° 조색(C 0.045)
  'fuji-sepia': { mono: true, mixer: [0.2126, 0.7152, 0.0722], split: null, tint: [68, 0.045] },
  // ---------------- RICOH GR (12) ----------------
  // RICOH Standard: 기준 렌더링, 녹색 −2°
  'ricoh-standard': { mono: false, dye: I3,
    hue: [N, N, N, [-2, 0, 1.02, 0], N, N, N, N], desat: [0.30, 0.20], split: null },
  // RICOH Vivid: 음의 간섭 + 전 색상 채도 1.05~1.10
  'ricoh-vivid': { mono: false, dye: [[1.05, -0.03, -0.02], [-0.02, 1.04, -0.02], [-0.02, -0.03, 1.05]],
    hue: [[0, 0, 1.08, 0], [0, 0, 1.05, 0], [0, 0, 1.08, 0], [-2, 0, 1.10, 0], [0, 0, 1.08, 0], [0, 0, 1.10, -0.02], [0, 0, 1.05, 0], [0, 0, 1.05, 0]], desat: [0.25, 0.10], split: null },
  // Positive Film: 음의 간섭, 시안 하늘→코발트(+8°, 명도 −0.02), 블루 밀도(1.15, −0.04), 옐로→앰버(−4°), 피부 명부 앰버(+3°), 암부 블루(235°)·명부 앰버(72°) 분리, 토 채도 유지(desat 0.05)
  'ricoh-positive-film': { mono: false, dye: [[1.05, -0.03, -0.02], [-0.02, 1.05, -0.03], [-0.03, -0.02, 1.05]],
    hue: [[2, 0, 1.10, -0.02], [2, 3, 1.05, 0], [-4, -2, 1.06, 0], [4, 0, 1.00, -0.02], [8, 0, 1.08, -0.02], [-2, 0, 1.15, -0.04], [0, 0, 1.00, 0], [0, 0, 1.00, 0]], desat: [0.25, 0.05],
    split: { shadow: [235, 0.010], highlight: [72, 0.010] } },
  // Negative Film: 양의 간섭, 녹색 +8°, 암부 시안(200°, 0.018)·명부 웜(70°, 0.010)
  'ricoh-negative-film': { mono: false, dye: [[0.96, 0.03, 0.01], [0.02, 0.96, 0.02], [0.01, 0.03, 0.96]],
    hue: [[2, 0, 0.88, 0], [2, 0, 0.94, 0], [-4, 0, 0.88, 0], [8, -2, 0.80, 0], [0, 0, 0.88, 0], [-6, 0, 0.88, 0], [0, 0, 0.85, 0], [0, 0, 0.88, 0]], desat: [0.30, 0.25],
    split: { shadow: [200, 0.018], highlight: [70, 0.010] } },
  // Bleach Bypass: 강한 양의 간섭 + 강한 명부·암부 탈색
  'ricoh-bleach-bypass': { mono: false, dye: [[0.92, 0.05, 0.03], [0.04, 0.92, 0.04], [0.03, 0.05, 0.92]],
    hue: [N, N, N, N, N, N, N, N], desat: [0.40, 0.35], split: null },
  // Retro: 청색 채널이 R·G 를 흡수(황변), 녹색 −8°, 블루 0.78, 암부 웜(60°)·명부 옐로(85°, 0.035)
  'ricoh-retro': { mono: false, dye: [[0.97, 0.03, 0.00], [0.02, 0.98, 0.00], [0.04, 0.06, 0.90]],
    hue: [[4, 0, 0.88, 0], [0, 2, 1.00, 0], N, [-8, 0, 0.82, 0], [0, 0, 0.90, 0], [-6, 0, 0.78, 0], [0, 0, 0.90, 0], [0, 0, 0.90, 0]], desat: [0.30, 0.20],
    split: { shadow: [60, 0.012], highlight: [85, 0.035] } },
  // Cross Process: 비대칭 간섭(B←G +0.08, B←R −0.05), 녹색→옐로그린(−10°, 명부 −4°), 암부 블루(250°, 0.030)·명부 옐로(105°, 0.040)
  'ricoh-cross-process': { mono: false, dye: [[1.04, 0.02, -0.06], [-0.03, 1.06, -0.03], [-0.05, 0.08, 0.97]],
    hue: [[-6, 0, 1.10, 0], [6, 4, 1.00, 0], [6, 0, 1.15, 0.02], [-10, 6, 1.10, 0], N, [-8, 0, 1.10, 0], N, [0, 0, 1.05, 0]], desat: [0.25, 0.10],
    split: { shadow: [250, 0.030], highlight: [105, 0.040] } },
  // HDR Tone: 색 변형 없음(효과는 FILM_PRESETS 의 명료도·톤), 명부 탈색만 약하게
  'ricoh-hdr-tone': { mono: false, dye: I3,
    hue: [N, N, N, N, N, N, N, N], desat: [0.15, 0.00], split: null },
  // RICOH 모노 4종: 표준 혼합(톤 차이는 FILM_PRESETS)
  'ricoh-monotone': { mono: true, mixer: [0.2126, 0.7152, 0.0722], split: null, tint: null },
  'ricoh-soft-monotone': { mono: true, mixer: [0.2126, 0.7152, 0.0722], split: null, tint: null },
  'ricoh-hard-monotone': { mono: true, mixer: [0.2126, 0.7152, 0.0722], split: null, tint: null },
  'ricoh-hi-contrast-bw': { mono: true, mixer: [0.2126, 0.7152, 0.0722], split: null, tint: null },
};
function colorOps2([L, a, b], P) {
  const C = Math.hypot(a, b);
  let h = Math.atan2(b, a) / DEG; if (h < 0) h += 360;
  const w = hueWeights(h), t = tau(L);
  let dh = 0, g = 0, dl = 0;
  for (let i = 0; i < 8; i++) { const r = P.hue[i]; dh += w[i] * (r[0] + r[1] * t); g += w[i] * r[2]; dl += w[i] * r[3]; }
  const wc = sstep(0.0, 0.06, C);
  const h2 = (h + dh * wc) * DEG;
  let C2 = C * g * (1 - P.desat[0] * sstep(0.88, 1.0, L)) * (1 - P.desat[1] * (1 - sstep(0.0, 0.30, L)));
  C2 = Math.max(0, C2);
  return [L + dl * wc, C2 * Math.cos(h2), C2 * Math.sin(h2)];
}
function splitTone([L, a, b], split) {
  if (!split) return [L, a, b];
  const ms = 1 - sstep(0.15, 0.55, L), mh = sstep(0.45, 0.95, L);
  const [sh, sc] = split.shadow, [hh, hc] = split.highlight;
  return [L, a + sc * Math.cos(sh * DEG) * ms + hc * Math.cos(hh * DEG) * mh, b + sc * Math.sin(sh * DEG) * ms + hc * Math.sin(hh * DEG) * mh];
}
function tintOp([L, a, b], tint) {
  if (!tint) return [L, a, b];
  const m = sstep(0.0, 0.25, L) * (1 - sstep(0.85, 1.0, L));
  return [L, a + tint[1] * Math.cos(tint[0] * DEG) * m, b + tint[1] * Math.sin(tint[0] * DEG) * m];
}
// x: scene-linear WS(Rec.709 D65) RGB → 출력: sRGB 인코드 디스플레이 RGB [0,1]
export function renderPoint2(x, P) {
  let lab;
  if (P.mono) {
    const Ym = Math.max(0, P.mixer[0] * x[0] + P.mixer[1] * x[1] + P.mixer[2] * x[2]);
    lab = [Math.cbrt(toneRef(Ym)), 0, 0];
    lab = splitTone(lab, P.split);
    lab = tintOp(lab, P.tint);
  } else {
    const d = P.dye;
    const xd = clipNegLum([d[0][0] * x[0] + d[0][1] * x[1] + d[0][2] * x[2], d[1][0] * x[0] + d[1][1] * x[1] + d[1][2] * x[2], d[2][0] * x[0] + d[2][1] * x[1] + d[2][2] * x[2]]);
    lab = linToOklab([toneRef(xd[0]), toneRef(xd[1]), toneRef(xd[2])]);
    lab = colorOps2(lab, P);
    lab = splitTone(lab, P.split);
  }
  return gamutMap(lab).map(srgbEnc);
}
