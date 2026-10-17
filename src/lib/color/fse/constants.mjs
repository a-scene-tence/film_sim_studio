// 공용 색 상수 — docs/COLOR_SCIENCE.md §5, §6, §7 (진실 원천). Node 생성기와 앱이 공유한다.

/** 톤 중간 입력 (18% 그레이) */
export const MID_IN = 0.18;
/** FSH-v1 셰이퍼 C_S = 0.18·2^−7 */
export const SHAPER_C = 0.00140625;
/** FSH-v1 셰이퍼 X_MAX */
export const SHAPER_XMAX = 16;
/** FSH-v1 셰이퍼 L_S = log2((X_MAX + C_S)/C_S) */
export const SHAPER_L = Math.log2((SHAPER_XMAX + SHAPER_C) / SHAPER_C);
/** 3D LUT 격자 크기 N */
export const LUT_SIZE = 33;
/** colorOps 색상 앵커(°) */
export const HUE_ANCHORS = [29, 60, 110, 142, 195, 264, 300, 328];
export const HUE_ANCHOR_NAMES = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta"];
/** colorOps 색상 가중치 σ_H */
export const HUE_SIGMA = 22;
/** gamutMap 무릎 */
export const GAMUT_KNEE = 0.85;
/** inGamut 허용 오차 */
export const GAMUT_EPS = 1e-6;
/** maxChroma 이분법 반복 횟수 */
export const MAXCHROMA_ITERS = 24;
/** Tref⁻¹ 이분법 반복 횟수 */
export const TONE_INV_ITERS = 48;
/** 기준 톤 T_ref (PROVIA) */
export const REF_TONE = Object.freeze({ a: 1.3, d: 0.92, hdrMax: 2.04, midOut: 0.19 });
