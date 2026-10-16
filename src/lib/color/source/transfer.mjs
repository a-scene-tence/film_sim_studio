// docs/COLOR_SCIENCE.md §4.1~§4.10 — 로그/HLG 전달함수 디코드 (코드값 y → 반사율 기준 선형 x). 외부 의존성 없음.

/** S-Log3 §4.1 @param {number} y */
export function slog3(y) {
  return y >= 171.2102946929 / 1023
    ? Math.pow(10, (1023 * y - 420) / 261.5) * 0.19 - 0.01
    : ((1023 * y - 95) * 0.01125) / (171.2102946929 - 95);
}

/** S-Log2 §4.2 @param {number} y */
export function slog2(y) {
  const f = (1023 * y - 64) / 876;
  const s = y >= 0.0882512925 ? Math.pow(10, (f - 0.646596) / 0.432699) - 0.037584 : (f - 0.030001222851889303) / 5;
  return (s * 0.9 * 219) / 155;
}

/** F-Log §4.3 @param {number} y */
export function flog(y) {
  const cut2 = 0.100537775223865, a = 0.555556, b = 0.009468, c = 0.344676, d = 0.790453, e = 8.735631, f = 0.092864;
  return y >= cut2 ? (Math.pow(10, (y - d) / c) - b) / a : (y - f) / e;
}

/** F-Log2 §4.4 @param {number} y */
export function flog2(y) {
  const cut2 = 0.100686685370811, a = 5.555556, b = 0.064829, c = 0.245281, d = 0.384316, e = 8.799461, f = 0.092864;
  return y >= cut2 ? (Math.pow(10, (y - d) / c) - b) / a : (y - f) / e;
}

/** Canon Log 3 §4.5 @param {number} y */
export function clog3(y) {
  let s;
  if (y < 0.097465473) s = -(Math.pow(10, (0.12783901 - y) / 0.36726845) - 1) / 14.98325;
  else if (y <= 0.15277891) s = (y - 0.12512219) / 1.9754798;
  else s = (Math.pow(10, (y - 0.12240537) / 0.36726845) - 1) / 14.98325;
  return 0.9 * s;
}

/** V-Log §4.6 @param {number} y */
export function vlog(y) {
  return y < 0.181 ? (y - 0.125) / 5.6 : Math.pow(10, (y - 0.598206) / 0.241514) - 0.00873;
}

/** N-Log §4.7 @param {number} y */
export function nlog(y) {
  return y < 0.4418377321603128 ? Math.pow(y / (650 / 1023), 3) - 0.0075 : Math.exp((y - 619 / 1023) / (150 / 1023));
}

/** D-Log §4.8 @param {number} y */
export function dlog(y) {
  return y <= 0.14 ? (y - 0.0929) / 6.025 : (Math.pow(10, 3.89616 * y - 2.27752) - 0.0108) / 0.9892;
}

/** D-Log 인코드 (테스트용, Step 4 §4-2) @param {number} x */
export function dlogEncode(x) {
  return x <= 0.0078 ? 6.025 * x + 0.0929 : 0.256663 * Math.log10(0.9892 * x + 0.0108) + 0.584555;
}

/** Samsung Log 디코드 y=CV/1023 → 장면 선형 x (Samsung Log White Paper 2025, Step 4 §4-1) @param {number} y */
export function samsunglog(y) {
  if (y >= 0.206561909) return Math.pow(10, (y - 0.720504856) / 0.258984868) - 0.0003645;
  if (y >= 0) return 0.016904 - Math.pow(10, (y + 0.24597) / -0.20942);
  return -0.05;
}

/** Samsung Log 인코드 x → y (Step 4 §4-1) @param {number} x */
export function samsunglogEncode(x) {
  if (x >= 0.01) return 0.258984868 * Math.log10(x + 0.0003645) + 0.720504856;
  if (x >= -0.05) return -0.20942 * Math.log10(0.016904 - x) - 0.24597;
  return 0;
}

const AL = { R0: -0.05641088, Rt: 0.01, sigma: 47.28711236, beta: 0.00964052, gamma: 0.08550479, delta: 0.69336945 };
const AL_PT = AL.sigma * (AL.Rt - AL.R0) * (AL.Rt - AL.R0);

/** Apple Log §4.9 @param {number} y */
export function applelog(y) {
  if (y >= AL_PT) return Math.pow(2, (y - AL.delta) / AL.gamma) - AL.beta;
  if (y >= 0) return Math.sqrt(y / AL.sigma) + AL.R0;
  return AL.R0;
}

/** HLG 장면 선형 E (BT.2100 역 OETF) §4.10 @param {number} y */
export function hlgE(y) {
  const a = 0.17883277, b = 0.28466892, c = 0.55991073;
  return y <= 0.5 ? (y * y) / 3 : (Math.exp((y - c) / a) + b) / 12;
}

/** HLG → 반사율 기준 x (BT.2408: 18% 그레이 = 신호 38%) §4.10 @param {number} y */
export function hlg(y) {
  return hlgE(y) * (0.18 / 0.0481333333);
}
