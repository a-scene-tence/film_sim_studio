// 후지필름 X-Processor 그레인 이펙트 (거칠기 OFF/약/강 × 크기 소/대) 원터치 프리셋과 은염 입자 노이즈 상수.
// 노이즈 수식은 reference.ts grainNoise 와 glsl/fs_final.ts 가 같은 상수를 쓴다 (docs/COLOR_SCIENCE.md §16.13).
export const GRAIN_CELL = 2.2; // 기본 입자 한 칸 = 2.2 노이즈 단위(GLSL float 리터럴이어야 하므로 정수 금지) (픽셀 단위 salt-and-pepper 를 피하는 최소 응집 크기)

export type FujiGrainId = "off" | "weak-small" | "weak-large" | "strong-small" | "strong-large";
export interface FujiGrain { id: FujiGrainId; label: string; amount: number; size: number }
/** 거칠기 약 = 35, 강 = 70 (그레인 강도 슬라이더), 크기 소 = 0, 대 = 100 (그레인 크기 슬라이더) */
export const FUJI_GRAIN_PRESETS: ReadonlyArray<FujiGrain> = [
  { id: "off", label: "OFF", amount: 0, size: 0 },
  { id: "weak-small", label: "약·소", amount: 35, size: 0 },
  { id: "weak-large", label: "약·대", amount: 35, size: 100 },
  { id: "strong-small", label: "강·소", amount: 70, size: 0 },
  { id: "strong-large", label: "강·대", amount: 70, size: 100 },
];

/** 현재 (강도, 크기) 와 정확히 같은 프리셋 id. 강도 0 이면 크기와 무관하게 off. 없으면 null (미세 조절 중) */
export function matchFujiGrain(amount: number, size: number): FujiGrainId | null {
  if (amount === 0) return "off";
  return FUJI_GRAIN_PRESETS.find((p) => p.amount === amount && p.size === size)?.id ?? null;
}
