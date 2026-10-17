// STC-v1 피부톤 세부 조정 (docs/COLOR_SCIENCE.md §8.8b) — 3D 피부 클러스터 마스크(색상 × 채도 × 명도)와 3축 변환.
// 상수는 여기 한 곳에만 두고 CPU 참조(reference.ts)와 GLSL(fs_post 의 SKIN_GLSL)이 같은 값을 쓴다.
import { smoothstep as sstep, wrap180 } from "../color/fse/engine.mjs";

/** 피부 중심 색상 (OKLab/Oklch hue°): 실측 피부 표본 44°~49° (RGB 색상 18°~21°) */
export const SKIN_H0 = 47;
/** 붉은 쪽 반폭: 47 − 38 = 9° (RGB 색상 0° 홍조 피부 ≈ Oklch 19°~28° 를 감싼다) */
export const SKIN_HW_RED = 38;
/** 노란 쪽 반폭: 47 + 48 = 95° (RGB 색상 55° 노란 피부 ≈ Oklch 72°~95° 를 감싼다) */
export const SKIN_HW_YEL = 48;
/** 채도 창 s = (max − min)/max (표시 인코딩): 0.08 에서 50 % 로 켜지고 0.72 에서 50 % 로 꺼진다 */
export const SKIN_SAT_IN: readonly [number, number] = [0.0, 0.16];
export const SKIN_SAT_OUT: readonly [number, number] = [0.58, 0.86];
/** 명도 창 (OKLab L): 0.06 에서 50 % 로 켜지고 0.92 에서 50 % 로 꺼진다 */
export const SKIN_LUM_IN: readonly [number, number] = [0.0, 0.12];
export const SKIN_LUM_OUT: readonly [number, number] = [0.84, 1.0];
/** 무채색 축 게이트 (OKLab C): 무채색 근처(베이지 벽·회색)에서 색상 잡음이 마스크를 흔들어 얼룩지지 않도록 C² 로 0 에 수렴 */
export const SKIN_CHROMA_GATE: readonly [number, number] = [0.0, 0.06];
/** 색조 최대 회전 (°, |skinHue| = 100, wSkin = 1) */
export const SKIN_HUE_MAX = 14;
/** 채도 이득 범위: −45 % ~ +35 % */
export const SKIN_SAT_DOWN = 0.45;
export const SKIN_SAT_UP = 0.35;
/** 채도를 낮출 때 명도 보전 (+1.5 %) */
export const SKIN_SAT_LIFT = 0.015;
/** 밝기 커브 리프트: L' = L·(1 + 0.18·k·w·4L(1 − L)·(1 − sstep(0.6, 1, L))) — 중간톤(L = 0.5)에서 최대 ±18 %, 0 과 1 고정, 단조 */
export const SKIN_LUM_MAX = 0.18;
/** 밝기 리프트 하이라이트 숄더: L 0.6 부터 리프트를 줄여 밝은 피부(L 0.84 → +3.4 %)가 날아가지 않게 한다 */
export const SKIN_LUM_SHOULDER: readonly [number, number] = [0.6, 1.0];

export type SkinVec = [number, number, number];
const DEG = Math.PI / 180;

/** 세 값이 모두 0 이면 피부톤 단계를 통째로 건너뛴다 (비트 단위 No-op) */
export const skinOn = (k: ArrayLike<number> | null | undefined): boolean => !!k && (k[0] !== 0 || k[1] !== 0 || k[2] !== 0);

/** 색상 창: 비대칭 올림 코사인 (중심 47°, 붉은 쪽 38°, 노란 쪽 48°) */
export function skinHueW(hDeg: number): number {
  const dh = wrap180(hDeg - SKIN_H0);
  const hw = dh < 0 ? SKIN_HW_RED : SKIN_HW_YEL;
  return Math.abs(dh) < hw ? 0.5 + 0.5 * Math.cos((Math.PI * dh) / hw) : 0;
}

/** 3D 피부 마스크 wSkin ∈ [0,1] = 색상 창 × 무채색 게이트 × 채도 창 × 명도 창. lab = OKLab(표시 선형), v = 표시 인코딩 sRGB */
export function skinMask(L: number, a: number, b: number, v: ArrayLike<number>): number {
  const C = Math.hypot(a, b);
  if (C < 1e-6) return 0;
  const wh = skinHueW(Math.atan2(b, a) / DEG) * sstep(SKIN_CHROMA_GATE[0], SKIN_CHROMA_GATE[1], C);
  if (wh <= 0) return 0;
  const r = Math.min(1, Math.max(0, v[0]!)), g = Math.min(1, Math.max(0, v[1]!)), bb = Math.min(1, Math.max(0, v[2]!));
  const mx = Math.max(r, g, bb);
  const s = (mx - Math.min(r, g, bb)) / Math.max(mx, 1e-4);
  const ws = sstep(SKIN_SAT_IN[0], SKIN_SAT_IN[1], s) * (1 - sstep(SKIN_SAT_OUT[0], SKIN_SAT_OUT[1], s));
  const wl = sstep(SKIN_LUM_IN[0], SKIN_LUM_IN[1], L) * (1 - sstep(SKIN_LUM_OUT[0], SKIN_LUM_OUT[1], L));
  return wh * ws * wl;
}

/**
 * 3축 피부톤 변환 (OKLab). k = (skinHue, skinSat, skinLum)/100, w = skinMask.
 *  색조: (a,b) 를 θ = k₀·14°·w 회전 (L·C 불변, + = 붉은기 완화 → 아이보리, − = 노란기 완화 → 피치 핑크)
 *  채도: C·(1 + w·(k₁ ≥ 0 ? 0.35 : 0.45)·k₁), k₁ < 0 이면 L·(1 + 0.015·|k₁|·w)
 *  밝기: L·(1 + 0.18·k₂·w·4L(1 − L)·(1 − sstep(0.6, 1, L)))
 */
export function skinApply(L: number, a: number, b: number, w: number, k: ArrayLike<number>): SkinVec {
  if (w <= 0) return [L, a, b];
  const th = k[0]! * SKIN_HUE_MAX * w * DEG;
  const c = Math.cos(th), s = Math.sin(th);
  const g = 1 + w * (k[1]! >= 0 ? SKIN_SAT_UP : SKIN_SAT_DOWN) * k[1]!;
  const a2 = (c * a - s * b) * g, b2 = (s * a + c * b) * g;
  let L2 = L * (1 + SKIN_SAT_LIFT * Math.max(-k[1]!, 0) * w);
  L2 = L2 * (1 + SKIN_LUM_MAX * k[2]! * w * 4 * L2 * (1 - L2) * (1 - sstep(SKIN_LUM_SHOULDER[0], SKIN_LUM_SHOULDER[1], L2)));
  return [L2, a2, b2];
}

const f = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** fs_post 에 들어가는 GLSL (위 상수로 생성 — 상수 중복 정의 없음) */
export const SKIN_GLSL = `float skinHueW(float hDeg) {
  float dh = wrap180(hDeg - ${f(SKIN_H0)});
  float hw = dh < 0.0 ? ${f(SKIN_HW_RED)} : ${f(SKIN_HW_YEL)};
  return abs(dh) < hw ? 0.5 + 0.5 * cos(3.141592653589793 * dh / hw) : 0.0;
}
float skinMask(vec3 lab, vec3 v) {
  float C = length(lab.yz);
  if (C < 1e-6) return 0.0;
  float wh = skinHueW(atan(lab.z, lab.y) / DEG) * sstep(${f(SKIN_CHROMA_GATE[0])}, ${f(SKIN_CHROMA_GATE[1])}, C);
  if (wh <= 0.0) return 0.0;
  vec3 c = clamp(v, 0.0, 1.0);
  float mx = max(c.r, max(c.g, c.b));
  float s = (mx - min(c.r, min(c.g, c.b))) / max(mx, 1e-4);
  float ws = sstep(${f(SKIN_SAT_IN[0])}, ${f(SKIN_SAT_IN[1])}, s) * (1.0 - sstep(${f(SKIN_SAT_OUT[0])}, ${f(SKIN_SAT_OUT[1])}, s));
  float wl = sstep(${f(SKIN_LUM_IN[0])}, ${f(SKIN_LUM_IN[1])}, lab.x) * (1.0 - sstep(${f(SKIN_LUM_OUT[0])}, ${f(SKIN_LUM_OUT[1])}, lab.x));
  return wh * ws * wl;
}
vec3 skinApply(vec3 lab, float w, vec3 k) {
  if (w <= 0.0) return lab;
  float th = k.x * ${f(SKIN_HUE_MAX)} * w * DEG;
  float c = cos(th); float s = sin(th);
  float g = 1.0 + w * (k.y >= 0.0 ? ${f(SKIN_SAT_UP)} : ${f(SKIN_SAT_DOWN)}) * k.y;
  vec2 ab = vec2(c * lab.y - s * lab.z, s * lab.y + c * lab.z) * g;
  float L = lab.x * (1.0 + ${f(SKIN_SAT_LIFT)} * max(-k.y, 0.0) * w);
  L = L * (1.0 + ${f(SKIN_LUM_MAX)} * k.z * w * 4.0 * L * (1.0 - L) * (1.0 - sstep(${f(SKIN_LUM_SHOULDER[0])}, ${f(SKIN_LUM_SHOULDER[1])}, L)));
  return vec3(L, ab);
}
`;
