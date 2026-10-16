// FSE-v2 상수 — docs/COLOR_SCIENCE.md §5, §6, §7 (진실 원천). Node 생성기와 앱이 공유한다.

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

// ── FSE-v2 추가 상수 — docs/COLOR_SCIENCE.md §6.1a, §6.4, §6.5 ──────────────
/** §6.1a 톤 소프트 니: 기준 톤 OKLab L(= cbrt(y_ref)) 의 섀도 창 1 − smoothstep(TOE_L0, TOE_L1, L)·하이라이트 창 smoothstep(SHOULDER_L, 1, L) 에서 필름 톤을 T_ref 로 되돌리는 비율 */
export const KNEE_TOE_L0 = 0.05;
export const KNEE_TOE_L1 = 0.3;
export const KNEE_SHOULDER_L = 0.8;
export const KNEE_AMOUNT = 0.65;
/** §6.4 채도 감쇠 창: 하이라이트 smoothstep(SHOULDER0, 1, L), 섀도 1 − smoothstep(TOE0, TOE1, L) */
export const DESAT_SHOULDER_L0 = 0.8;
export const DESAT_TOE_L0 = 0.06;
export const DESAT_TOE_L1 = 0.3;
/** §6.4 피부톤 보호 대역 (OKLCh): 색상 [H0, H1]°(가장자리 EDGE° 페이드), L [L0, L1], C [C0, C1] (가장자리 페이드 폭 각각) */
export const SKIN_HUE = Object.freeze([25, 70]);
export const SKIN_HUE_EDGE = 10;
export const SKIN_L = Object.freeze([0.3, 0.9]);
export const SKIN_L_EDGE = 0.08;
export const SKIN_C = Object.freeze([0.02, 0.16]);
export const SKIN_C_EDGE = 0.02;
/** §6.4 피부톤 대역 안에서 색상 이동·L 이동·채도 증가를 억제하는 비율 */
export const SKIN_PROTECT = 0.6;
/** §6.5 스플릿 톤 섀도 마스크의 최심부 중립 수렴: smoothstep(0, SPLIT_BLACK_L, L) */
export const SPLIT_BLACK_L = 0.18;
/** §6.5 스플릿 톤 하이라이트 마스크의 백색 중립 수렴: 1 − smoothstep(SPLIT_WHITE_L, 1, L) */
export const SPLIT_WHITE_L = 0.92;
