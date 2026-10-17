// 후지필름 X-Processor 그레인 이펙트 (거칠기 OFF/약/강 × 크기 소/대) 원터치 프리셋과 은염 입자 노이즈 상수.
// 노이즈 수식은 reference.ts grainNoise 와 glsl/fs_final.ts 가 같은 상수를 쓴다 (docs/COLOR_SCIENCE.md §16.13).
// 저주파 격자 노이즈를 늘려 입자를 키우지 않는다: 항상 픽셀 격자 위의 고주파 백색 노이즈(삼각 PDF)를 짧은 커널로만 묶는다.

/** 삼각 PDF 정규화: (u1 + u2 − 1) ∈ [−1, 1) 의 분산 1/6 → 표준편차 1 로 맞추는 계수 √6 (GLSL float 리터럴이어야 하므로 문자열로 고정) */
export const GRAIN_TRI_NORM = Math.sqrt(6);
/** 소: 중심 셀 70% + 상하좌우 4셀 각 7.5% (합 30%) */
export const GRAIN_W_CENTER = 0.7;
export const GRAIN_W_NEIGHBOR = 0.075;
/** 소 커널 분산 합 √(0.7² + 4·0.075²) — 단위 표준편차로 되돌리는 값 */
export const GRAIN_FINE_STD = Math.sqrt(GRAIN_W_CENTER ** 2 + 4 * GRAIN_W_NEIGHBOR ** 2);
/** 대: 3×3 클러스터 가중 [1 2 1; 2 4 2; 1 2 1]/16 (중심 4/16, 변 2/16, 모서리 1/16), 분산 합 √(36/256) = 0.375 */
export const GRAIN_CLUSTER_STD = 0.375;
/** 대 크기에서 클러스터 비중 55% (나머지 45% 는 소 크기의 고주파 미세 입자) */
export const GRAIN_CLUSTER_MIX = 0.55;
/** 그레인 최종 강도 계수 (표시 값 기준 표준편차 = GAIN · 거칠기/100 · resp) */
export const GRAIN_GAIN = 0.06;
/** 중간톤 응답: resp = FLOOR + (1 − FLOOR)·4·vl·(1 − vl) — 중간톤에서 최대, 하이라이트·암부로 갈수록 필름 농도에 묻힌다 */
export const GRAIN_FLOOR = 0.2;

export type FujiGrainId = "off" | "weak-small" | "weak-large" | "strong-small" | "strong-large";
export interface FujiGrain { id: FujiGrainId; label: string; amount: number; size: number }
/** 거칠기 약 = 35, 강 = 70 (그레인 강도 슬라이더), 크기 소 = 0, 대 = 100 (그레인 크기 값) */
export const FUJI_GRAIN_PRESETS: ReadonlyArray<FujiGrain> = [
  { id: "off", label: "OFF", amount: 0, size: 0 },
  { id: "weak-small", label: "약·소", amount: 35, size: 0 },
  { id: "weak-large", label: "약·대", amount: 35, size: 100 },
  { id: "strong-small", label: "강·소", amount: 70, size: 0 },
  { id: "strong-large", label: "강·대", amount: 70, size: 100 },
];

/** 후지필름 메뉴와 같은 2단 스위치: 거칠기 OFF/약/강, 크기 소/대 */
export type GrainRoughness = "off" | "weak" | "strong";
export type GrainSizeChoice = "small" | "large";
export const GRAIN_ROUGHNESS_AMOUNT: Readonly<Record<Exclude<GrainRoughness, "off">, number>> = { weak: 35, strong: 70 };
export const GRAIN_SIZE_VALUE: Readonly<Record<GrainSizeChoice, number>> = { small: 0, large: 100 };

/** 현재 강도가 약/강 프리셋과 정확히 같으면 그 id, 0 이면 off, 미세 조절 중이면 null */
export function grainRoughnessOf(amount: number): GrainRoughness | null {
  if (amount === 0) return "off";
  return amount === GRAIN_ROUGHNESS_AMOUNT.weak ? "weak" : amount === GRAIN_ROUGHNESS_AMOUNT.strong ? "strong" : null;
}
/** 크기 값 → 소/대 (50 이상이면 대) */
export const grainSizeChoiceOf = (size: number): GrainSizeChoice => (size >= 50 ? "large" : "small");

/** 현재 (강도, 크기) 와 정확히 같은 프리셋 id. 강도 0 이면 크기와 무관하게 off. 없으면 null (미세 조절 중) */
export function matchFujiGrain(amount: number, size: number): FujiGrainId | null {
  if (amount === 0) return "off";
  return FUJI_GRAIN_PRESETS.find((p) => p.amount === amount && p.size === size)?.id ?? null;
}
